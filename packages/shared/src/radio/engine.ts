/**
 * Radio decision engine: the deterministic scheduler between the rules and the audio adapter.
 *
 * Per frame: (1) validate inputs and context, (2) let each eligible rule confirm its condition,
 * (3) pick one utterance by priority with mode, level, per-corner limit and per-rule interval,
 * (4) check the speech window (fits before the deadline, free window, radio busy, urgent may
 * replace a tip; no local playback → panel) and (5) log every decision.
 *
 * The clock is the frame time (`LiveFrame.t`) and the utterance duration is injected, so the
 * same frames + config + env produce the same decisions (replays, tests). No DOM, no Web Audio:
 * the web adapter plays `speak` and stops on `stop`.
 */

import type { LiveCornerPass, LiveFrame } from '../live.ts';
import {
  availableChannels,
  discontinuity,
  freeWindowMs,
  phaseOf,
  suspensionReason,
  WINDOW_MARGIN_MS,
} from './context.ts';
import type { RadioUtterance } from './phrases.ts';
import { type AnyRadioRule, phaseBlock, priorityRank, RADIO_RULES, ruleRuns } from './registry.ts';
import {
  DEFAULT_RADIO_PREFERENCES,
  type RadioEngineConfig,
  radioEngineConfig,
} from './settings.ts';
import type {
  RadioBlock,
  RadioCandidate,
  RadioChannel,
  RadioDecision,
  RadioOutcome,
  RadioPanelNote,
  RadioPhase,
  RadioPriority,
  RadioRuleContext,
  RadioStepEnv,
  RadioStepResult,
} from './types.ts';

/** How long the latest message stays on the panel. */
export const RADIO_PANEL_MS = 6000;
/** Max deliveries per corner pass by level (Essencial keeps one call per corner). */
export const RADIO_CORNER_LIMIT = { essential: 1, detailed: 3, mute: 3 } as const;
/** Without a block started by the driver, a block closes every this many valid laps. */
export const AUTO_BLOCK_LAPS = 5;
/** Spoken decisions kept for the rules (no repetition in the summary). */
const RECENT_SPOKEN = 40;
/** Corner pass ids remembered (each pass reaches the rules once). */
const SEEN_PASSES = 256;
/** Channels whose absence is transient and not worth a log entry. */
const QUIET_CHANNELS: ReadonlySet<RadioChannel> = new Set(['progress']);

export interface RadioEngineOptions {
  /** Playback duration (ms) of an utterance with the pack that would play it; null = no clip. */
  utteranceMs: (utterance: RadioUtterance) => number | null;
  rules?: readonly AnyRadioRule[];
  config?: RadioEngineConfig;
  /** Decisions kept in memory (ring buffer). */
  logLimit?: number;
}

interface Pending {
  rule: AnyRadioRule;
  candidate: RadioCandidate;
  priority: RadioPriority;
  reason: string;
}

interface Active {
  decision: RadioDecision;
  endT: number;
  deadlineT: number | undefined;
  urgent: boolean;
}

interface Evaluated {
  rule: AnyRadioRule;
  index: number;
  candidate: RadioCandidate;
  priority: RadioPriority;
  id: string;
}

export class RadioEngine {
  readonly #utteranceMs: RadioEngineOptions['utteranceMs'];
  readonly #rules: readonly AnyRadioRule[];
  readonly #logLimit: number;
  #config: RadioEngineConfig;
  /** A corner drill is running (env.drill): only the drill rules and car alerts speak. */
  #drilling = false;
  #log: RadioDecision[] = [];
  #seq = 0;
  #states = new Map<string, unknown>();
  #suppressed = new Map<string, RadioChannel>();
  #pending = new Map<string, Pending>();
  #lastDelivery = new Map<string, number>();
  #cornerCalls = new Map<string, number>();
  #active: Active | null = null;
  #previous: LiveFrame | null = null;
  #context: string | null = null;
  #sticky = { session: null as string | null, track: null as string | null };
  #contextStartT = 0;
  #timedLapSeen = false;
  #suspended: string | null = null;
  #note: RadioPanelNote | null = null;
  #summaryRequested = false;
  #approachSpeedKmh = 0;
  #seenPasses = new Set<string>();
  #spoken: RadioDecision[] = [];
  #blockSeq = 0;
  #envBlock: string | null = null;
  #trainingBlock: RadioBlock = this.#newBlock(null);

  constructor(options: RadioEngineOptions) {
    this.#utteranceMs = options.utteranceMs;
    this.#rules = options.rules ?? RADIO_RULES;
    this.#logLimit = options.logLimit ?? 500;
    this.#config = options.config ?? radioEngineConfig(DEFAULT_RADIO_PREFERENCES);
  }

  get config(): Readonly<RadioEngineConfig> {
    return this.#config;
  }

  /**
   * The configuration the rules see. During a corner drill the engineer works as in Treino with
   * the corner calls on, whatever the driver's mode is: the drill is a mode of its own.
   */
  get #cfg(): RadioEngineConfig {
    return this.#drilling
      ? { ...this.#config, mode: 'training', trainingProfile: 'learnTrack' }
      : this.#config;
  }

  /** Decisions so far, oldest first (bounded by `logLimit`). */
  get log(): readonly RadioDecision[] {
    return this.#log;
  }

  /** New preferences. A mode or Treino profile change is a context change (next step). */
  configure(config: RadioEngineConfig): void {
    this.#config = config;
  }

  /** Resumo sob demanda: rules see `summaryRequested` on the next step. */
  requestSummary(): void {
    this.#summaryRequested = true;
  }

  /**
   * The adapter could not start the call it was given: the information stays on the panel and
   * the radio is free again.
   */
  playbackFailed(): void {
    const active = this.#active;
    if (!active) return;
    this.#active = null;
    const d = active.decision;
    this.#push({ ...d, seq: ++this.#seq, outcome: 'panel', reason: 'falha na reprodução' });
    this.#note = this.#note && { ...this.#note, spoken: false };
  }

  /**
   * Pause, hidden page, stale or lost signal: drop pending items and timing windows (what was
   * already said is kept). Returns whether a call was playing (the adapter stops it).
   */
  suspend(reason: string, frame?: LiveFrame | null): boolean {
    const wasActive = this.#active !== null;
    if (this.#suspended === reason && !wasActive && this.#pending.size === 0) return false;
    this.#suspended = reason;
    this.#interrupt(reason, frame ?? this.#previous);
    this.#previous = null;
    return wasActive;
  }

  /** Forget everything (new install of the HUD, explicit reset). */
  reset(): void {
    this.#states.clear();
    this.#suppressed.clear();
    this.#pending.clear();
    this.#lastDelivery.clear();
    this.#cornerCalls.clear();
    this.#active = null;
    this.#previous = null;
    this.#context = null;
    this.#sticky = { session: null, track: null };
    this.#timedLapSeen = false;
    this.#suspended = null;
    this.#note = null;
    this.#summaryRequested = false;
    this.#seenPasses.clear();
    this.#spoken = [];
    this.#envBlock = null;
    this.#trainingBlock = this.#newBlock(null);
  }

  #newBlock(id: string | null): RadioBlock {
    return id
      ? { id, explicit: true, validLaps: 0 }
      : { id: `auto-${++this.#blockSeq}`, explicit: false, validLaps: 0 };
  }

  step(frame: LiveFrame, env: RadioStepEnv): RadioStepResult {
    const firstSeq = this.#seq;
    const t = frame.t;
    const result = (phase: RadioPhase, speak: RadioStepResult['speak'], stop: boolean) => ({
      phase,
      speak,
      stop,
      decisions: this.#log.filter((d) => d.seq > firstSeq),
      panel:
        this.#note && t - this.#note.t <= RADIO_PANEL_MS && t >= this.#note.t ? this.#note : null,
      suspended: this.#suspended,
    });

    // 1. Validate the inputs.
    const suspension = suspensionReason(frame, env.sampleAgeMs ?? 0);
    if (suspension) {
      const stop = this.suspend(suspension, frame);
      return result('unknown', null, stop);
    }
    this.#suspended = null;
    // The same frame again (re-render without a new packet): nothing new to decide.
    const last = this.#previous;
    if (last && last.seq === frame.seq && last.t === frame.t)
      return result(phaseOf(frame, this.#timedLapSeen), null, false);
    let stop = false;
    const fresh = this.#context === null;
    if (this.#contextChanged(frame)) {
      if (!fresh) stop = this.#interrupt('mudança de contexto', frame) || stop;
      this.#states.clear();
      this.#suppressed.clear();
      this.#lastDelivery.clear();
      this.#cornerCalls.clear();
      this.#timedLapSeen = false;
      this.#contextStartT = t;
      this.#previous = null;
      this.#envBlock = env.blockId ?? null;
      this.#trainingBlock = this.#newBlock(this.#envBlock);
    }
    const gap = discontinuity(frame, this.#previous);
    if (gap) {
      stop = this.#interrupt(gap, frame) || stop;
      this.#approachSpeedKmh = frame.car.speedKmh;
      this.#previous = frame;
      return result(phaseOf(frame, this.#timedLapSeen), null, stop);
    }

    const previous = this.#previous;
    this.#previous = frame;
    const speedWeight = previous ? Math.min(1, (t - previous.t) / 250) : 1;
    this.#approachSpeedKmh += (frame.car.speedKmh - this.#approachSpeedKmh) * speedWeight;
    const latency = env.outputLatencyMs;
    const outputLatencyMs =
      latency !== undefined && Number.isFinite(latency) && latency >= 0
        ? latency + Math.max(0, env.sampleAgeMs ?? 0)
        : 0;
    const lineCrossed = !!previous && frame.lap.lap > previous.lap.lap;
    const phase = phaseOf(frame, this.#timedLapSeen);
    if (frame.lap.currentLapValid) this.#timedLapSeen = true;
    const channels = availableChannels(frame, previous);

    // Training blocks: the driver's start/end (env.blockId), else every AUTO_BLOCK_LAPS valid laps.
    let blockEnded: RadioBlock | null = null;
    const envBlock = env.blockId ?? null;
    if (envBlock !== this.#envBlock) {
      if (this.#trainingBlock.explicit) blockEnded = this.#trainingBlock;
      this.#trainingBlock = this.#newBlock(envBlock);
      this.#envBlock = envBlock;
    }
    if (lineCrossed && previous?.lap.currentLapValid) {
      this.#trainingBlock = {
        ...this.#trainingBlock,
        validLaps: this.#trainingBlock.validLaps + 1,
      };
      if (!this.#trainingBlock.explicit && this.#trainingBlock.validLaps >= AUTO_BLOCK_LAPS) {
        blockEnded = this.#trainingBlock;
        this.#trainingBlock = this.#newBlock(null);
      }
    }
    const passes: LiveCornerPass[] = [];
    for (const pass of frame.cornerPasses ?? []) {
      if (this.#seenPasses.has(pass.id)) continue;
      this.#seenPasses.add(pass.id);
      passes.push(pass);
      if (this.#seenPasses.size > SEEN_PASSES)
        this.#seenPasses.delete(this.#seenPasses.values().next().value!);
    }
    const engineer = frame.engineer;
    const focus = env.focusCornerIds ? new Set(env.focusCornerIds) : null;
    const cues =
      engineer?.status === 'ready'
        ? engineer.cues.filter((cue) => !focus || (cue.cornerId && focus.has(cue.cornerId)))
        : [];
    this.#drilling = env.drill === true;
    const config = this.#cfg;
    const audio = env.audio === 'ready' && config.speechLevel !== 'mute';
    const ctx: RadioRuleContext = {
      frame,
      previous,
      t,
      config,
      phase,
      channels,
      cues,
      utteranceMs: this.#utteranceMs,
      audio,
      outputLatencyMs,
      approachSpeedKmh: this.#approachSpeedKmh,
      contextStartT: this.#contextStartT,
      lineCrossed,
      timedLapSeen: this.#timedLapSeen,
      summaryRequested: this.#summaryRequested,
      passes,
      focus,
      assist: new Set(env.assistCornerIds ?? []),
      block: this.#trainingBlock,
      blockEnded,
      recentSpoken: this.#spoken,
    };
    this.#summaryRequested = false;

    const active = this.#active;
    if (active && (t >= active.endT || (active.deadlineT !== undefined && t >= active.deadlineT))) {
      if (t < active.endT) stop = true; // still talking past the useful point: cut it
      this.#active = null;
    }

    // 2. Each eligible rule confirms its condition.
    const evaluated: Evaluated[] = [];
    this.#rules.forEach((rule, index) => {
      if (this.#drilling && !rule.drill && !rule.carAlert) return;
      if (!ruleRuns(rule, config)) return;
      const missing = rule.requires?.find((channel) => !channels.has(channel));
      if (missing) {
        if (this.#suppressed.get(rule.id) !== missing && !QUIET_CHANNELS.has(missing)) {
          this.#decide(frame, phase, rule, rule.priority, null, 'suppressed', `sem ${missing}`);
          this.#dropPendingOf(rule, frame, phase, `sem ${missing}`);
        }
        this.#suppressed.set(rule.id, missing);
        return;
      }
      this.#suppressed.delete(rule.id);
      const state = this.#state(rule);
      for (const candidate of rule.evaluate(ctx, state)) {
        evaluated.push({
          rule,
          index,
          candidate,
          priority: candidate.priority ?? rule.priority,
          id: `${rule.id}:${candidate.key}`,
        });
      }
    });

    // 3. Order: priority class, registry order, urgent first, earliest deadline, key.
    evaluated.sort(
      (a, b) =>
        priorityRank(a.priority) - priorityRank(b.priority) ||
        a.index - b.index ||
        Number(!!b.candidate.urgent) - Number(!!a.candidate.urgent) ||
        (a.candidate.deadlineT ?? Number.POSITIVE_INFINITY) -
          (b.candidate.deadlineT ?? Number.POSITIVE_INFINITY) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    // 4. Window check, one utterance per step.
    let speak: RadioStepResult['speak'] = null;
    const seen = new Set<string>();
    let window: number | null = null;
    for (const item of evaluated) {
      const { candidate, id } = item;
      seen.add(id);
      // Detalhado-only items are simply not eligible with Essencial (not pending, not logged).
      const level = candidate.level ?? item.rule.level ?? 'essential';
      if (level === 'detailed' && config.speechLevel === 'essential') continue;
      const block = this.#block(item, frame, phase, t);
      if (block) {
        this.#wait(item, block);
        continue;
      }
      if (candidate.panelOnly) {
        this.#deliver(item, ctx, 'panel', 'somente painel', null);
        continue;
      }
      if (config.speechLevel === 'mute' || env.audio === 'off') {
        this.#deliver(
          item,
          ctx,
          'panel',
          config.speechLevel === 'mute' ? 'mudo' : 'sem áudio local',
          null,
        );
        continue;
      }
      if (env.audio === 'wait') {
        this.#wait(item, 'áudio em espera');
        continue;
      }
      const durationMs = this.#utteranceMs(candidate.utterance);
      if (durationMs === null) {
        this.#deliver(item, ctx, 'panel', 'sem clipe de áudio', null);
        continue;
      }
      if (speak) {
        this.#wait(item, 'uma fala por vez');
        continue;
      }
      const busy = this.#active;
      const interrupt = !!busy && !!candidate.urgent && !busy.urgent;
      if (busy && !interrupt) {
        this.#wait(item, 'rádio ocupado');
        continue;
      }
      const timeToFinishMs = outputLatencyMs + durationMs;
      if (candidate.deadlineT !== undefined && t + timeToFinishMs > candidate.deadlineT) {
        this.#wait(item, 'não cabe antes do ponto');
        continue;
      }
      if (candidate.needsFreeWindow) {
        window ??= freeWindowMs(frame, engineer?.status === 'ready' ? engineer.cues : []);
        if (window < timeToFinishMs + WINDOW_MARGIN_MS) {
          this.#wait(item, 'sem janela livre');
          continue;
        }
      }
      const decision = this.#deliver(
        item,
        ctx,
        'spoken',
        interrupt && busy ? `substituiu ${busy.decision.ruleId}` : undefined,
        durationMs,
      );
      this.#active = {
        decision,
        endT: t + timeToFinishMs,
        deadlineT: candidate.deadlineT,
        urgent: !!candidate.urgent,
      };
      speak = {
        utterance: candidate.utterance,
        durationMs,
        decision,
        ...(candidate.cueId ? { cueId: candidate.cueId } : {}),
        interrupt,
      };
    }

    // 5. Pending items the rules no longer propose were discarded.
    for (const [id, pending] of this.#pending) {
      if (seen.has(id)) continue;
      this.#pending.delete(id);
      this.#decide(
        frame,
        phase,
        pending.rule,
        pending.priority,
        pending.candidate,
        'discarded',
        pending.reason,
      );
    }
    return result(phase, speak, stop);
  }

  /**
   * Session, track, car, mode or Treino profile changed. An id that only appears (track
   * identified, session opened after the first frames) is not a change; a different id is.
   */
  #contextChanged(frame: LiveFrame): boolean {
    const sticky = this.#sticky;
    const session = frame.sessionId ?? null;
    const track = frame.track?.id ?? null;
    const swapped =
      (session !== null && sticky.session !== null && session !== sticky.session) ||
      (track !== null && sticky.track !== null && track !== sticky.track);
    if (session !== null) sticky.session = session;
    if (track !== null) sticky.track = track;
    const c = this.#config;
    const key = [frame.car.carCode, c.mode, c.mode === 'training' ? c.trainingProfile : '-'].join(
      '|',
    );
    const changed = swapped || key !== this.#context;
    this.#context = key;
    return changed;
  }

  #state(rule: AnyRadioRule): unknown {
    if (!this.#states.has(rule.id)) this.#states.set(rule.id, rule.init());
    return this.#states.get(rule.id);
  }

  #cornerPass(frame: LiveFrame, cornerId: string): string {
    return `${frame.lap.startedAt ?? frame.lap.lap}|${cornerId}`;
  }

  /** Mode, level, per-corner limit and interval. */
  #block(item: Evaluated, frame: LiveFrame, phase: RadioPhase, t: number): string | null {
    const { rule, candidate, priority } = item;
    const config = this.#cfg;
    const phaseReason = phaseBlock(candidate, priority, config, phase);
    if (phaseReason) return phaseReason;
    if (candidate.cornerId) {
      const calls = this.#cornerCalls.get(this.#cornerPass(frame, candidate.cornerId)) ?? 0;
      if (calls >= RADIO_CORNER_LIMIT[config.speechLevel]) return 'limite da curva';
    }
    const last = this.#lastDelivery.get(rule.id);
    if (rule.intervalMs && last !== undefined && t - last < rule.intervalMs) return 'intervalo';
    return null;
  }

  #wait(item: Evaluated, reason: string): void {
    this.#pending.set(item.id, {
      rule: item.rule,
      candidate: item.candidate,
      priority: item.priority,
      reason,
    });
  }

  #deliver(
    item: Evaluated,
    ctx: RadioRuleContext,
    outcome: 'spoken' | 'panel',
    reason: string | undefined,
    durationMs: number | null,
  ): RadioDecision {
    const { rule, candidate, priority, id } = item;
    this.#pending.delete(id);
    const decision = this.#decide(
      ctx.frame,
      ctx.phase,
      rule,
      priority,
      candidate,
      outcome,
      reason,
      durationMs,
    );
    this.#lastDelivery.set(rule.id, ctx.t);
    if (outcome === 'spoken') {
      this.#spoken = [...this.#spoken, decision].slice(-RECENT_SPOKEN);
    }
    if (candidate.cornerId) {
      const pass = this.#cornerPass(ctx.frame, candidate.cornerId);
      this.#cornerCalls.set(pass, (this.#cornerCalls.get(pass) ?? 0) + 1);
      if (this.#cornerCalls.size > 64)
        this.#cornerCalls.delete(this.#cornerCalls.keys().next().value!);
    }
    rule.delivered?.(candidate, this.#state(rule), ctx);
    const current = this.#note;
    // The panel keeps the most important message of the moment.
    if (
      !current ||
      current.t !== ctx.t ||
      priorityRank(priority) < priorityRank(current.priority)
    ) {
      this.#note = {
        ruleId: rule.id,
        priority,
        label: candidate.label,
        utterance: candidate.panelOnly ? null : candidate.utterance,
        spoken: outcome === 'spoken',
        t: ctx.t,
      };
    }
    return decision;
  }

  #dropPendingOf(rule: AnyRadioRule, frame: LiveFrame, phase: RadioPhase, reason: string): void {
    for (const [id, pending] of this.#pending) {
      if (pending.rule !== rule) continue;
      this.#pending.delete(id);
      this.#decide(frame, phase, rule, pending.priority, pending.candidate, 'discarded', reason);
    }
  }

  /** Clears pending items and timing windows; returns whether a call was playing. */
  #interrupt(reason: string, frame: LiveFrame | null): boolean {
    this.#summaryRequested = false;
    for (const pending of this.#pending.values()) {
      if (frame)
        this.#decide(
          frame,
          'unknown',
          pending.rule,
          pending.priority,
          pending.candidate,
          'discarded',
          reason,
        );
    }
    this.#pending.clear();
    for (const rule of this.#rules) {
      const state = this.#states.get(rule.id);
      if (state !== undefined) rule.interrupt?.(state);
    }
    const wasActive = this.#active !== null;
    this.#active = null;
    return wasActive;
  }

  #decide(
    frame: LiveFrame,
    phase: RadioPhase,
    rule: AnyRadioRule,
    priority: RadioPriority,
    candidate: RadioCandidate | null,
    outcome: RadioOutcome,
    reason?: string,
    durationMs?: number | null,
  ): RadioDecision {
    const engineer = frame.engineer;
    const decision: RadioDecision = {
      seq: ++this.#seq,
      t: frame.t,
      frameSeq: frame.seq,
      lap: frame.lap.lap,
      distanceM: frame.distanceM,
      mode: this.#cfg.mode,
      phase,
      ruleId: rule.id,
      priority,
      key: candidate?.key ?? '-',
      outcome,
      ...(reason ? { reason } : {}),
      ...(candidate && !candidate.panelOnly ? { utterance: candidate.utterance } : {}),
      ...(candidate ? { label: candidate.label, evidence: candidate.evidence } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      referenceLapId:
        engineer?.status === 'ready' ? engineer.referenceLapId : frame.lap.delta.referenceLapId,
      ...(candidate?.cornerId ? { cornerId: candidate.cornerId } : {}),
    };
    this.#push(decision);
    return decision;
  }

  #push(decision: RadioDecision): void {
    this.#log.push(decision);
    if (this.#log.length > this.#logLimit) this.#log.splice(0, this.#log.length - this.#logLimit);
  }
}
