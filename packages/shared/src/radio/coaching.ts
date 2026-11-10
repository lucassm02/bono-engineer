/**
 * Treino rules of delivery step 3 (spec do engenheiro de rádio): driving events on the radio, the
 * Ganhar tempo correction and immediate intervention, the lap/block summary with praise and the
 * Consistência block summary. They read the corner pass reviews made by the core about 80 m after
 * each corner exit (frame.cornerPasses → ctx.passes, each pass seen once) and the lap timing.
 *
 * Every rule here is deterministic over the frames, the config and the step env (blocks, focus).
 */

import { BRAKE_ON_THRESHOLD } from '../analysis.ts';
import type {
  LiveCornerCause,
  LiveCornerCauseKind,
  LiveCornerPass,
  LiveDrivingEventCall,
} from '../live.ts';
import { isBrakeCue, REACTION_MS } from './cues.ts';
import {
  ADHERENCE,
  type Adherence,
  CAUSE_ACTIONS,
  CAUSE_FOCUS,
  CAUSE_WORDS,
  cornerSegment,
  EVENT_ACTIONS,
  EVENT_WORDS,
  type EventAction,
  fromCornerSegment,
  GOOD_LAP,
  gearSegment,
  LIFT_THROTTLE,
  lapDeltaUtterance,
  type RadioUtterance,
  TO_GOAL,
  tenthsAmount,
  toCornerSegment,
  utteranceKeys,
  VARIATION,
  YOU_IMPROVED,
  YOU_IMPROVED_HERE,
} from './phrases.ts';
import { cornerNumber, formatLapMs, LAP_TIME_WAIT_MS } from './rules.ts';
import type { RadioCandidate, RadioRule, RadioRuleContext } from './types.ts';

const inFocus = (ctx: RadioRuleContext, cornerId: string) =>
  ctx.focus === null || ctx.focus.has(cornerId);
const seconds = (ms: number) => (ms / 1000).toFixed(1).replace('.', ',');

// ---- Eventos de pilotagem ---------------------------------------------------------------------

/** A driving event not spoken this long after the review is dropped (the moment passed). */
export const EVENT_MAX_AGE_MS = 10_000;

const EVENT_LABELS: Record<LiveDrivingEventCall['kind'], string> = {
  frontLock: 'Travamento dianteiro',
  oversteer: 'Saída de traseira',
  understeer: 'Saída de frente',
  exitTraction: 'Perda de tração',
};

/** The one action of an event (same choice as the analysis text of driving-events.ts). */
export function eventAction(e: LiveDrivingEventCall): EventAction {
  switch (e.kind) {
    case 'frontLock':
      return 'easeBrakePeak';
    case 'exitTraction':
      return 'doseThrottle';
    case 'oversteer':
      return e.phase === 'braking'
        ? 'releaseSmoother'
        : (e.throttle ?? 0) >= 0.3
          ? 'progressiveThrottle'
          : 'smootherPedals';
    case 'understeer':
      return e.phase === 'braking' || e.phase === 'entry'
        ? 'turnLessOnEntry'
        : (e.throttle ?? 0) >= 0.3
          ? 'slowerThrottle'
          : 'lessSteering';
  }
}

/** "Na T9" + "você travou a dianteira." + "Na próxima, alivie o pico do freio." */
export function drivingEventUtterance(
  e: LiveDrivingEventCall,
  cornerId: string,
): RadioUtterance | null {
  const n = cornerNumber(cornerId);
  return n ? [cornerSegment(n), EVENT_WORDS[e.kind], EVENT_ACTIONS[eventAction(e)]] : null;
}

/** The car is straight again: past `settledM` in the same lap (or already in the next one). */
function settled(ctx: RadioRuleContext, pass: LiveCornerPass, settledM: number): boolean {
  const { frame } = ctx;
  if (frame.lap.startedAt !== undefined && frame.lap.startedAt !== pass.lapStartedAt) return true;
  return frame.distanceM !== null && frame.distanceM >= settledM;
}

interface EventState {
  pending: Map<string, { pass: LiveCornerPass; since: number }>;
}

/**
 * The high-confidence driving event of a corner pass (at most one per pass, chosen by the core),
 * once the car is straight again, in a free window. Probable events stay in the review.
 */
export const drivingEventRule: RadioRule<EventState> = {
  id: 'drivingEvent',
  priority: 'feedback',
  modes: ['training'],
  profiles: ['learnTrack', 'gainTime'],
  init: () => ({ pending: new Map() }),
  evaluate(ctx, s) {
    for (const pass of ctx.passes) {
      if (pass.event && pass.event.settledM !== null && inFocus(ctx, pass.cornerId))
        s.pending.set(pass.id, { pass, since: ctx.t });
    }
    const out: RadioCandidate[] = [];
    for (const [id, { pass, since }] of s.pending) {
      const e = pass.event!;
      if (ctx.t - since > EVENT_MAX_AGE_MS || !inFocus(ctx, pass.cornerId)) {
        s.pending.delete(id);
        continue;
      }
      if (!settled(ctx, pass, e.settledM!)) continue;
      const utterance = drivingEventUtterance(e, pass.cornerId);
      out.push({
        key: id,
        cornerId: pass.cornerId,
        utterance: utterance ?? [],
        label: `${EVENT_LABELS[e.kind]} na ${pass.cornerId} · ${e.action}`,
        evidence: {
          passId: pass.id,
          lapStartedAt: pass.lapStartedAt,
          event: e.id,
          kind: e.kind,
          phase: e.phase,
          startM: e.startM,
          endM: e.endM,
          settledM: e.settledM,
        },
        needsFreeWindow: true,
        ...(utterance ? {} : { panelOnly: true }),
      });
    }
    return out;
  },
  delivered(candidate, s) {
    s.pending.delete(candidate.key);
  },
  interrupt(s) {
    s.pending.clear();
  },
};

// ---- Ganhar tempo: correção posterior ---------------------------------------------------------

/** An isolated (non-recurring) cause is spoken only when clear and at least this costly (ms). */
export const CORRECTION_ISOLATED_MIN_MS = 250;
/** A correction not spoken this long after the review is dropped (ms). */
export const CORRECTION_MAX_AGE_MS = 12_000;
/** Spoken corrections per lap by level: one action at a time. */
export const CORRECTION_PER_LAP = { essential: 1, detailed: 2, mute: 2 } as const;
/** Passes of a corner looked at for a recurring pattern. */
export const CORRECTION_HISTORY = 3;
/** Clean passes that resolve the block priority. */
export const PRIORITY_RESOLVED_PASSES = 2;

/** "Na T4" + "você segurou o freio." + "Na próxima, comece a soltar quando virar." */
export function correctionUtterance(
  cornerId: string,
  cause: LiveCornerCause,
): RadioUtterance | null {
  const n = cornerNumber(cornerId);
  if (!n) return null;
  if (cause.kind === 'gear') return cause.gear ? [cornerSegment(n), gearSegment(cause.gear)] : null;
  return [cornerSegment(n), CAUSE_WORDS[cause.kind], CAUSE_ACTIONS[cause.kind]];
}

interface PendingCorrection {
  pass: LiveCornerPass;
  cause: LiveCornerCause;
  recurring: boolean;
  isolated: boolean;
  since: number;
}

interface CorrectionState {
  history: Map<string, (LiveCornerCauseKind | null)[]>;
  blockId: string | null;
  /** The block priority: the first correction spoken in the block, until resolved. */
  priority: { cornerId: string; kind: LiveCornerCauseKind; clean: number } | null;
  pending: Map<string, PendingCorrection>;
  /** Spoken corrections per lap (lap start time). */
  perLap: Map<number, number>;
  /** Lap number of the last spoken correction per corner + cause. */
  lastLap: Map<string, number>;
}

/**
 * Ganhar tempo, post-hoc correction: after the car straightens (free window), the best-supported
 * cause of a pass and one action. Recurring patterns (same cause in 2 of the last 3 passes) come
 * first; an isolated cause only when clear (high) and costly; everything else goes to the review
 * (panel). One priority per block (the first recurring correction spoken, until two clean
 * passes resolve it), at most one action per lap (Essencial), never the same correction on consecutive laps, and
 * a pass with a car event leaves the call to that event. Clean passes: silence.
 */
export const cornerCorrectionRule: RadioRule<CorrectionState> = {
  id: 'cornerCorrection',
  priority: 'instruction',
  modes: ['training'],
  profiles: ['gainTime'],
  init: () => ({
    history: new Map(),
    blockId: null,
    priority: null,
    pending: new Map(),
    perLap: new Map(),
    lastLap: new Map(),
  }),
  evaluate(ctx, s) {
    if (s.blockId !== ctx.block.id) {
      s.blockId = ctx.block.id;
      s.priority = null;
    }
    if (s.priority && !inFocus(ctx, s.priority.cornerId)) s.priority = null;
    for (const pass of ctx.passes) {
      if (!inFocus(ctx, pass.cornerId)) continue;
      const cause = pass.incomparable ? null : pass.cause;
      const history = [...(s.history.get(pass.cornerId) ?? []), cause?.kind ?? null].slice(
        -CORRECTION_HISTORY,
      );
      s.history.set(pass.cornerId, history);
      const priority = s.priority;
      if (priority && priority.cornerId === pass.cornerId) {
        priority.clean = cause?.kind === priority.kind ? 0 : priority.clean + 1;
        if (priority.clean >= PRIORITY_RESOLVED_PASSES) s.priority = null;
      }
      if (!cause || pass.event) continue;
      s.pending.set(pass.id, {
        pass,
        cause,
        recurring:
          cause.confidence !== 'low' && history.filter((k) => k === cause.kind).length >= 2,
        isolated: cause.confidence === 'high' && cause.costMs >= CORRECTION_ISOLATED_MIN_MS,
        since: ctx.t,
      });
    }
    const out: RadioCandidate[] = [];
    for (const [id, p] of s.pending) {
      if (ctx.t - p.since > CORRECTION_MAX_AGE_MS || !inFocus(ctx, p.pass.cornerId)) {
        s.pending.delete(id);
        continue;
      }
      const { pass, cause } = p;
      const key = `${pass.cornerId}:${cause.kind}`;
      const priority = s.priority;
      const utterance = correctionUtterance(pass.cornerId, cause);
      const review = !(p.recurring || p.isolated)
        ? 'ocorrência menor'
        : priority &&
            (priority.cornerId !== pass.cornerId || priority.kind !== cause.kind) &&
            !p.isolated
          ? 'fora da prioridade do bloco'
          : (s.perLap.get(pass.lapStartedAt) ?? 0) >= CORRECTION_PER_LAP[ctx.config.speechLevel]
            ? 'uma ação por volta'
            : s.lastLap.get(key) === pass.lap - 1
              ? 'falado na volta anterior'
              : !utterance
                ? 'sem frase'
                : null;
      out.push({
        key: id,
        cornerId: pass.cornerId,
        utterance: utterance ?? [],
        label: review ? `Revisão · ${cause.message}` : cause.message,
        evidence: {
          passId: pass.id,
          lapStartedAt: pass.lapStartedAt,
          lap: pass.lap,
          kind: cause.kind,
          confidence: cause.confidence,
          costMs: cause.costMs,
          timeLostMs: pass.timeLostMs,
          recurring: p.recurring,
          review,
        },
        needsFreeWindow: true,
        ...(review ? { panelOnly: true, priority: 'feedback' as const } : {}),
      });
    }
    return out;
  },
  delivered(candidate, s) {
    const p = s.pending.get(candidate.key);
    s.pending.delete(candidate.key);
    if (!p || candidate.panelOnly) return;
    const lapStartedAt = p.pass.lapStartedAt;
    s.perLap.set(lapStartedAt, (s.perLap.get(lapStartedAt) ?? 0) + 1);
    if (s.perLap.size > 8) s.perLap.delete(s.perLap.keys().next().value!);
    s.lastLap.set(`${p.pass.cornerId}:${p.cause.kind}`, p.pass.lap);
    // A recurring pattern becomes the block priority; an isolated intervention does not.
    if (p.recurring) s.priority ??= { cornerId: p.pass.cornerId, kind: p.cause.kind, clean: 0 };
  },
  interrupt(s) {
    s.pending.clear();
  },
};

// ---- Ganhar tempo: intervenção imediata -------------------------------------------------------

/** "Alivia o acelerador" is not said earlier than this before the reference brake point (ms). */
export const LIFT_MAX_LEAD_MS = 4000;
/** Consecutive passes of a corner with an entry event that make the intervention sure. */
export const LIFT_RECURRING_PASSES = 2;

const entryIssue = (pass: LiveCornerPass) =>
  !!pass.event &&
  (pass.event.kind === 'frontLock' ||
    (pass.event.kind === 'understeer' &&
      (pass.event.phase === 'braking' || pass.event.phase === 'entry')));

/**
 * Ganhar tempo, immediate intervention, only with high confidence and time to act: the last two
 * passes of the corner ended in a high-confidence entry event (front lock or understeer on
 * entry), the driver is still flat out approaching the reference brake point, and "Alivia o
 * acelerador." still ends a reaction time before that point.
 */
export const liftThrottleRule: RadioRule<{ issues: Map<string, boolean[]>; said: Set<string> }> = {
  id: 'liftThrottle',
  priority: 'instruction',
  modes: ['training'],
  profiles: ['gainTime'],
  init: () => ({ issues: new Map(), said: new Set() }),
  evaluate(ctx, s) {
    for (const pass of ctx.passes) {
      const list = [...(s.issues.get(pass.cornerId) ?? []), entryIssue(pass)];
      s.issues.set(pass.cornerId, list.slice(-LIFT_RECURRING_PASSES));
    }
    const { frame, t } = ctx;
    if (frame.engineer?.status !== 'ready' || !ctx.audio) return [];
    const car = frame.car;
    const speed = car.speedKmh / 3.6;
    if (
      speed < 15 ||
      (car.throttleRaw ?? car.throttle) < 0.9 ||
      (car.brakeRaw ?? car.brake) >= BRAKE_ON_THRESHOLD
    )
      return [];
    const out: RadioCandidate[] = [];
    for (const cue of ctx.cues) {
      const cornerId = cue.cornerId;
      if (!cornerId || !isBrakeCue(cue.kind) || cue.aheadM < 0) continue;
      const issues = s.issues.get(cornerId) ?? [];
      if (issues.length < LIFT_RECURRING_PASSES || !issues.every(Boolean)) continue;
      const key = `${frame.lap.startedAt ?? frame.lap.lap}|${cornerId}`;
      if (s.said.has(key)) continue;
      const eta = (cue.aheadM / speed) * 1000;
      const budget = eta - REACTION_MS - ctx.config.anticipationMs;
      if (eta > LIFT_MAX_LEAD_MS || budget < (ctx.utteranceMs(LIFT_THROTTLE) ?? Infinity)) continue;
      out.push({
        key,
        cornerId,
        utterance: LIFT_THROTTLE,
        label: `Alivie o acelerador antes da ${cornerId}`,
        evidence: {
          aheadM: Math.round(cue.aheadM),
          speedKmh: Math.round(car.speedKmh),
          passesWithEntryEvent: issues.length,
        },
        urgent: true,
        deadlineT: t + budget,
      });
    }
    return out;
  },
  delivered(candidate, s) {
    s.said.add(candidate.key);
    if (s.said.size > 64) s.said.delete(s.said.values().next().value!);
  },
};

// ---- Voltas fechadas (resumo, consistência) ---------------------------------------------------

/** A closed lap with its corner passes. */
export interface ClosedLap {
  startedAt: number;
  lap: number;
  lapMs: number;
  valid: boolean;
  passes: ReadonlyMap<string, LiveCornerPass>;
}

interface LapBook {
  passes: Map<number, Map<string, LiveCornerPass>>;
  summaryRequested: boolean;
  closing: {
    at: number;
    startedAt: number;
    lap: number;
    valid: boolean;
    lastBefore: number | null;
  } | null;
}

const newBook = (): LapBook => ({ passes: new Map(), closing: null, summaryRequested: false });

/** Wait for the lap time when the driver asks just after crossing the line. */
function takeSummaryRequest(ctx: RadioRuleContext, book: LapBook): boolean {
  book.summaryRequested ||= ctx.summaryRequested;
  if (book.closing) return false;
  const requested = book.summaryRequested;
  book.summaryRequested = false;
  return requested;
}

/** Collects the passes by lap and returns the lap closed in this step, once its time is known. */
function closeLaps(ctx: RadioRuleContext, book: LapBook): ClosedLap | null {
  for (const pass of ctx.passes) {
    let lap = book.passes.get(pass.lapStartedAt);
    if (!lap) {
      lap = new Map();
      book.passes.set(pass.lapStartedAt, lap);
      if (book.passes.size > 4) book.passes.delete(book.passes.keys().next().value!);
    }
    lap.set(pass.cornerId, pass);
  }
  const { frame, previous, t } = ctx;
  if (ctx.lineCrossed && previous && previous.lap.lap >= 1 && previous.lap.startedAt !== undefined)
    book.closing = {
      at: t,
      startedAt: previous.lap.startedAt,
      lap: previous.lap.lap,
      valid: previous.lap.currentLapValid === true,
      lastBefore: previous.lap.lastLapMs,
    };
  const c = book.closing;
  if (!c) return null;
  const last = frame.lap.lastLapMs;
  if (!(last !== null && last !== c.lastBefore) && t - c.at < LAP_TIME_WAIT_MS) return null;
  book.closing = null;
  if (last === null) return null;
  return {
    startedAt: c.startedAt,
    lap: c.lap,
    lapMs: last,
    valid: c.valid,
    passes: book.passes.get(c.startedAt) ?? new Map(),
  };
}

/** Goal lap time: the Consistência target, else the reference lap. */
function goalMs(ctx: RadioRuleContext): number | null {
  const engineer = ctx.frame.engineer;
  return (
    ctx.config.consistencyTargetMs ??
    ctx.frame.lap.referenceLapMs ??
    (engineer?.status === 'ready' ? engineer.referenceLapMs : null)
  );
}

// ---- Resumo e elogios -------------------------------------------------------------------------

/** A summary not spoken this long after it was decided is dropped (ms). */
export const SUMMARY_MAX_AGE_MS = 20_000;
/** Minimum gain (ms) of a corner inside an improved stretch, and of the whole stretch. */
export const GAIN_CORNER_MIN_MS = 30;
export const GAIN_MIN_MS = 100;
/** Minimum lap time gain of a block (ms) worth saying. */
export const BLOCK_GAIN_MIN_MS = 50;
/** Generic praise ("Boa volta") at most this often (ms). */
export const PRAISE_INTERVAL_MS = 180_000;

interface Gain {
  from: string;
  to: string;
  fromN: number;
  toN: number;
  ms: number;
}

/**
 * Best improved stretch of consecutive corners against the block baseline lap (zone losses vs the
 * same reference): every corner ≥ GAIN_CORNER_MIN_MS, the stretch ≥ GAIN_MIN_MS.
 */
export function cornerGain(base: ClosedLap, lap: ClosedLap): Gain | null {
  const gains: { id: string; n: number; ms: number }[] = [];
  for (const [id, pass] of lap.passes) {
    const before = base.passes.get(id);
    const n = cornerNumber(id);
    if (
      !n ||
      !before ||
      pass.timeLostMs === null ||
      before.timeLostMs === null ||
      pass.referenceLapId !== before.referenceLapId
    )
      continue;
    gains.push({ id, n, ms: before.timeLostMs - pass.timeLostMs });
  }
  gains.sort((a, b) => a.n - b.n);
  let best: Gain | null = null;
  let run: typeof gains = [];
  const close = () => {
    const ms = run.reduce((sum, g) => sum + g.ms, 0);
    if (run.length && ms >= GAIN_MIN_MS && (!best || ms > best.ms))
      best = {
        from: run[0]!.id,
        to: run.at(-1)!.id,
        fromN: run[0]!.n,
        toN: run.at(-1)!.n,
        ms,
      };
    run = [];
  };
  for (const g of gains) {
    if (g.ms < GAIN_CORNER_MIN_MS || (run.length && g.n !== run.at(-1)!.n + 1)) close();
    if (g.ms >= GAIN_CORNER_MIN_MS) run.push(g);
  }
  close();
  return best;
}

const gainUtterance = (g: Gain): string[] =>
  g.fromN === g.toN
    ? [cornerSegment(g.fromN), YOU_IMPROVED_HERE]
    : [YOU_IMPROVED, fromCornerSegment(g.fromN), toCornerSegment(g.toN)];

const gainLabel = (g: Gain) =>
  `${g.from === g.to ? `melhorou na ${g.from}` : `melhorou da ${g.from} à ${g.to}`} (−${seconds(g.ms)} s)`;

/** Corrections already spoken for the passes of this lap (the summary does not repeat them). */
function spokenPasses(ctx: RadioRuleContext): Set<string> {
  const ids = new Set<string>();
  for (const d of ctx.recentSpoken)
    if (d.ruleId === 'cornerCorrection' && typeof d.evidence?.passId === 'string')
      ids.add(d.evidence.passId);
  return ids;
}

/** The costliest sustained cause of the lap not already corrected on the radio. */
function nextAction(ctx: RadioRuleContext, lap: ClosedLap): LiveCornerPass | null {
  const said = spokenPasses(ctx);
  const passes = [...lap.passes.values()].filter(
    (p) =>
      p.cause &&
      !p.incomparable &&
      p.cause.confidence !== 'low' &&
      cornerNumber(p.cornerId) &&
      !said.has(p.id) &&
      inFocus(ctx, p.cornerId),
  );
  passes.sort((a, b) => b.cause!.costMs - a.cause!.costMs || a.cornerId.localeCompare(b.cornerId));
  return passes[0] ?? null;
}

const actionUtterance = (pass: LiveCornerPass): string[] => [
  cornerSegment(cornerNumber(pass.cornerId)!),
  CAUSE_FOCUS[pass.cause!.kind],
];

/** The cause seen most often in a block (≥ 2 passes), for the block's next action. */
function blockAction(ctx: RadioRuleContext, laps: readonly ClosedLap[]): LiveCornerPass | null {
  const counts = new Map<string, { n: number; last: LiveCornerPass }>();
  for (const lap of laps)
    for (const p of lap.passes.values()) {
      if (!p.cause || p.incomparable || p.cause.confidence === 'low') continue;
      if (!cornerNumber(p.cornerId) || !inFocus(ctx, p.cornerId)) continue;
      const key = `${p.cornerId}:${p.cause.kind}`;
      const c = counts.get(key);
      counts.set(key, { n: (c?.n ?? 0) + 1, last: p });
    }
  const best = [...counts.entries()]
    .filter(([, c]) => c.n >= 2)
    .sort(([ka, a], [kb, b]) => b.n - a.n || (ka < kb ? -1 : 1))[0];
  return best?.[1].last ?? null;
}

interface SummaryState {
  book: LapBook;
  blockId: string | null;
  /** Valid laps of the current block (the first one is the baseline). */
  laps: ClosedLap[];
  /** A block that ended; `waitLap` while its last lap is still closing. */
  ended: { laps: ClosedLap[]; waitLap: boolean } | null;
  lastLap: ClosedLap | null;
  pending: { candidate: RadioCandidate; expiresT: number } | null;
  lastPraiseT: number | null;
}

function praiseDue(ctx: RadioRuleContext, s: SummaryState, deserved: boolean): boolean {
  return (
    ctx.config.praise &&
    deserved &&
    (s.lastPraiseT === null || ctx.t - s.lastPraiseT >= PRAISE_INTERVAL_MS)
  );
}

function lapSummary(
  ctx: RadioRuleContext,
  s: SummaryState,
  lap: ClosedLap,
  postLine: boolean,
  block: readonly ClosedLap[],
): RadioCandidate | null {
  if (!lap.valid) return null;
  const before = block.filter((l) => l !== lap && l.startedAt < lap.startedAt);
  const base = before[0] ?? null;
  const bestBefore = before.length ? Math.min(...before.map((l) => l.lapMs)) : null;
  const goal = goalMs(ctx);
  const withinGoal = goal !== null && lap.lapMs <= goal + ctx.config.goalToleranceMs;
  const gain = base ? cornerGain(base, lap) : null;
  const action = nextAction(ctx, lap);
  const praise = praiseDue(ctx, s, (bestBefore !== null && lap.lapMs < bestBefore) || withinGoal);
  if (!gain && !action && !praise) return null;
  const utterance = [
    ...(praise ? [GOOD_LAP] : []),
    ...(gain ? gainUtterance(gain) : []),
    ...(action ? actionUtterance(action) : []),
  ];
  const label = [
    `Volta ${formatLapMs(lap.lapMs)}`,
    gain ? gainLabel(gain) : null,
    action
      ? `próxima: ${action.cause!.message.charAt(0).toLowerCase()}${action.cause!.message.slice(1)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    key: `lap-${lap.startedAt}`,
    utterance,
    label,
    evidence: {
      lap: lap.lap,
      lapMs: lap.lapMs,
      baselineMs: base?.lapMs ?? null,
      gainFrom: gain?.from ?? null,
      gainTo: gain?.to ?? null,
      gainMs: gain ? Math.round(gain.ms) : null,
      actionCorner: action?.cornerId ?? null,
      actionKind: action?.cause?.kind ?? null,
      praise,
      goalMs: goal,
    },
    needsFreeWindow: true,
    ...(postLine ? { postLine: true } : {}),
  };
}

function blockSummary(
  ctx: RadioRuleContext,
  s: SummaryState,
  laps: readonly ClosedLap[],
  key: string,
): RadioCandidate {
  const goal = goalMs(ctx);
  if (!laps.length)
    return {
      key,
      utterance: [],
      label: 'Bloco sem voltas válidas',
      evidence: { laps: 0 },
      panelOnly: true,
    };
  const base = laps[0]!;
  const best = laps.reduce((a, b) => (b.lapMs < a.lapMs ? b : a));
  const gainMs = base.lapMs - best.lapMs;
  const toGoal = goal === null ? null : best.lapMs - goal;
  const withinGoal = toGoal !== null && toGoal <= ctx.config.goalToleranceMs;
  const action = blockAction(ctx, laps);
  const praise = praiseDue(ctx, s, gainMs >= GAIN_MIN_MS || withinGoal);
  const utterance = [
    ...(praise ? [GOOD_LAP] : []),
    ...(laps.length >= 2 && gainMs >= BLOCK_GAIN_MIN_MS
      ? utteranceKeys(lapDeltaUtterance(gainMs / 100))
      : []),
    ...(toGoal !== null && !withinGoal ? [TO_GOAL, tenthsAmount(toGoal / 100)] : []),
    ...(action ? actionUtterance(action) : []),
  ];
  const label = [
    `Bloco · ${laps.length} volta${laps.length > 1 ? 's' : ''} válida${laps.length > 1 ? 's' : ''}`,
    `melhor ${formatLapMs(best.lapMs)}`,
    laps.length >= 2 ? `vs. base ${gainMs >= 0 ? '−' : '+'}${seconds(Math.abs(gainMs))} s` : null,
    toGoal !== null ? (withinGoal ? 'na meta' : `meta a ${seconds(toGoal)} s`) : null,
    action ? `foco: ${action.cornerId}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    key,
    utterance,
    label,
    evidence: {
      laps: laps.length,
      baselineMs: base.lapMs,
      bestMs: best.lapMs,
      gainMs,
      goalMs: goal,
      actionCorner: action?.cornerId ?? null,
      actionKind: action?.cause?.kind ?? null,
      praise,
    },
    needsFreeWindow: true,
    ...(utterance.length ? {} : { panelOnly: true }),
  };
}

/**
 * Resumo e elogios (Aprender pista, Ganhar tempo): per lap, per block or on demand, in the first
 * free window after the line (dropped after SUMMARY_MAX_AGE_MS if the corners keep demanding
 * attention). A valid lap gives one relevant gain against the block baseline ("Você melhorou da
 * T1 à T3.") and at most one next action ("Na T4 · foque na soltura do freio."), never a
 * correction already spoken that lap; nothing relevant → silence. "Boa volta." is generic praise:
 * off by default, at most every PRAISE_INTERVAL_MS, with an improvement or a lap within the goal
 * tolerance. A block summary measures the best lap against the baseline and the goal.
 */
export const lapSummaryRule: RadioRule<SummaryState> = {
  id: 'lapSummary',
  priority: 'summary',
  modes: ['training'],
  profiles: ['learnTrack', 'gainTime'],
  init: () => ({
    book: newBook(),
    blockId: null,
    laps: [],
    ended: null,
    lastLap: null,
    pending: null,
    lastPraiseT: null,
  }),
  evaluate(ctx, s) {
    const { t } = ctx;
    if (ctx.block.id !== s.blockId) {
      if (s.blockId !== null && ctx.blockEnded?.id === s.blockId)
        s.ended = { laps: s.laps, waitLap: ctx.lineCrossed };
      s.laps = [];
      s.blockId = ctx.block.id;
    }
    const closed = closeLaps(ctx, s.book);
    const summary = ctx.config.summary;
    const set = (candidate: RadioCandidate | null, from = t) => {
      if (candidate) s.pending = { candidate, expiresT: from + SUMMARY_MAX_AGE_MS };
    };
    if (closed) {
      s.lastLap = closed;
      const ended = s.ended?.waitLap ? s.ended : null;
      if (closed.valid) (ended ? ended.laps : s.laps).push(closed);
      if (ended) ended.waitLap = false;
      if (summary === 'lap') set(lapSummary(ctx, s, closed, true, ended?.laps ?? s.laps));
    }
    if (s.ended && !s.ended.waitLap) {
      if (summary === 'block') {
        const c = blockSummary(ctx, s, s.ended.laps, `block-${t}`);
        set({ ...c, postLine: true });
      }
      s.ended = null;
    }
    if (takeSummaryRequest(ctx, s.book)) {
      const c =
        (s.lastLap ? lapSummary(ctx, s, s.lastLap, false, s.laps) : null) ??
        (s.laps.length >= 2 ? blockSummary(ctx, s, s.laps, `demand-${t}`) : null);
      set(
        c ?? {
          key: `demand-${t}`,
          utterance: [],
          label: s.lastLap ? 'Sem mudança relevante' : 'Sem volta completa para resumir',
          evidence: { laps: s.laps.length },
          panelOnly: true,
        },
      );
    }
    if (s.pending && t > s.pending.expiresT) s.pending = null;
    return s.pending ? [s.pending.candidate] : [];
  },
  delivered(candidate, s, ctx) {
    s.pending = null;
    if (!candidate.panelOnly && candidate.evidence.praise === true) s.lastPraiseT = ctx.t;
  },
  interrupt(s) {
    s.pending = null;
    s.book.closing = null;
    s.book.summaryRequested = false;
  },
};

// ---- Consistência -----------------------------------------------------------------------------

/** Spread (ms) below which the variation is not worth saying. */
export const CONSISTENCY_MIN_SPREAD_MS = 50;

export function adherenceOf(within: number, laps: number): Adherence {
  if (laps <= 0 || within <= 0) return 'none';
  if (within === laps) return 'all';
  if (within * 2 > laps) return 'most';
  if (within * 2 === laps) return 'half';
  return 'few';
}

interface ConsistencyState {
  book: LapBook;
  blockId: string | null;
  laps: ClosedLap[];
  lastBlock: ClosedLap[];
  ended: { laps: ClosedLap[]; waitLap: boolean } | null;
  pending: { candidate: RadioCandidate; expiresT: number } | null;
}

function consistencySummary(
  ctx: RadioRuleContext,
  laps: readonly ClosedLap[],
  key: string,
): RadioCandidate {
  if (laps.length < 2)
    return {
      key,
      utterance: [],
      label: `Consistência · ${laps.length} volta válida no bloco (mínimo 2)`,
      evidence: { laps: laps.length },
      panelOnly: true,
    };
  const times = laps.map((l) => l.lapMs);
  const n = times.length;
  const mean = times.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const spread = Math.max(...times) - Math.min(...times);
  const target = goalMs(ctx) ?? Math.min(...times);
  const within = times.filter((ms) => ms <= target + ctx.config.goalToleranceMs).length;
  const adherence = adherenceOf(within, n);
  // Corner with the largest spread of its zone time (review hint for the panel).
  let worst: { id: string; ms: number } | null = null;
  const byCorner = new Map<string, number[]>();
  for (const lap of laps)
    for (const p of lap.passes.values())
      if (p.timeLostMs !== null)
        byCorner.set(p.cornerId, [...(byCorner.get(p.cornerId) ?? []), p.timeLostMs]);
  for (const [id, values] of byCorner) {
    if (values.length < 2) continue;
    const ms = Math.max(...values) - Math.min(...values);
    if (!worst || ms > worst.ms) worst = { id, ms };
  }
  return {
    key,
    utterance: [
      ...(spread >= CONSISTENCY_MIN_SPREAD_MS ? [VARIATION, tenthsAmount(spread / 100)] : []),
      ADHERENCE[adherence],
    ],
    label: [
      `Consistência · ${n} voltas`,
      `variação ${seconds(spread)} s (desvio ${seconds(sd)} s)`,
      `${within}/${n} na meta ${formatLapMs(target)}`,
      worst ? `maior variação na ${worst.id} (${seconds(worst.ms)} s)` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    evidence: {
      laps: n,
      spreadMs: spread,
      stdDevMs: Math.round(sd),
      targetMs: target,
      within,
      adherence,
      worstCorner: worst?.id ?? null,
    },
    needsFreeWindow: true,
    postLine: true,
  };
}

/**
 * Consistência: the target pace (config) or the reference lap to repeat; measures the spread and
 * the adherence to the goal over the valid laps of the block and summarizes at the end of the block
 * (or on demand), never per pass.
 */
export const consistencyRule: RadioRule<ConsistencyState> = {
  id: 'consistency',
  priority: 'summary',
  modes: ['training'],
  profiles: ['consistency'],
  init: () => ({
    book: newBook(),
    blockId: null,
    laps: [],
    lastBlock: [],
    ended: null,
    pending: null,
  }),
  evaluate(ctx, s) {
    const { t } = ctx;
    if (ctx.block.id !== s.blockId) {
      if (s.blockId !== null && ctx.blockEnded?.id === s.blockId)
        s.ended = { laps: s.laps, waitLap: ctx.lineCrossed };
      s.laps = [];
      s.blockId = ctx.block.id;
    }
    const closed = closeLaps(ctx, s.book);
    if (closed?.valid) (s.ended?.waitLap ? s.ended.laps : s.laps).push(closed);
    if (closed && s.ended) s.ended.waitLap = false;
    const set = (candidate: RadioCandidate) => {
      s.pending = { candidate, expiresT: t + SUMMARY_MAX_AGE_MS };
    };
    if (s.ended && !s.ended.waitLap) {
      s.lastBlock = s.ended.laps;
      if (ctx.config.summary === 'block' || ctx.config.summary === 'lap') {
        set(consistencySummary(ctx, s.ended.laps, `block-${t}`));
      }
      s.ended = null;
    }
    if (takeSummaryRequest(ctx, s.book)) {
      const laps = s.laps.length >= 2 || s.lastBlock.length < 2 ? s.laps : s.lastBlock;
      set({ ...consistencySummary(ctx, laps, `demand-${t}`), postLine: false });
    }
    if (s.pending && t > s.pending.expiresT) s.pending = null;
    return s.pending ? [s.pending.candidate] : [];
  },
  delivered(_candidate, s) {
    s.pending = null;
  },
  interrupt(s) {
    s.pending = null;
    s.book.closing = null;
    s.book.summaryRequested = false;
  },
};
