/**
 * Contracts of the radio decision engine: rules produce candidates, the scheduler picks at most
 * one utterance per frame and logs every decision. Pure data, no DOM or Web Audio.
 */

import type { EngineerCue, LiveCornerPass, LiveFrame } from '../live.ts';
import type { RadioUtterance } from './phrases.ts';
import type { RadioEngineConfig, RadioMode, TrainingProfile } from './settings.ts';

/**
 * Priority classes, highest first: alerta crítico > decisão de estratégia > instrução acionável
 * > feedback > resumo.
 */
export const RADIO_PRIORITIES = [
  'critical',
  'strategy',
  'instruction',
  'feedback',
  'summary',
] as const;
export type RadioPriority = (typeof RADIO_PRIORITIES)[number];

/**
 * Phase inside the mode, derived from the lap timing:
 * - outLap: before the first timed lap of the context (out lap, pit exit, joined mid-lap);
 * - timedLap: a valid timed lap is running (the fast lap in Classificação);
 * - untimedLap: invalidated or cool-down lap after timed laps;
 * - unknown: not enough data to tell → quietest behaviour.
 */
export type RadioPhase = 'outLap' | 'timedLap' | 'untimedLap' | 'unknown';

/** Inputs a rule may require; the rule is suppressed while any is missing. */
export type RadioChannel =
  /** Four plausible per-wheel temperatures. */
  | 'tyreTemps'
  /** A reliable consumption sample (per-lap average > 0). */
  | 'fuel'
  /** Lap counter, validity and lap times. */
  | 'lapTiming'
  /** Lap distance moving forward (no jump since the previous frame). */
  | 'progress'
  /** Engineer cues from a compatible reference (status ready). */
  | 'cues';

export interface RadioCandidate {
  /** Stable key: the same candidate across frames (pending item), unique within the rule. */
  key: string;
  utterance: RadioUtterance;
  /** Panel text (pt-BR); also shown when the audio is muted or unavailable. */
  label: string;
  /** Evidence logged with the decision. */
  evidence: Readonly<Record<string, number | string | boolean | null>>;
  cornerId?: string;
  /** Corner cue id (journal). */
  cueId?: string;
  /** May interrupt a non-urgent call that is playing (e.g. a braking call over a tip). */
  urgent?: boolean;
  /** Frame time (ms) by which the utterance must have finished; omitted = no limit. */
  deadlineT?: number;
  /** Needs a free window (no braking, cornering or imminent corner) for its whole duration. */
  needsFreeWindow?: boolean;
  /** Allowed right after the line even when the next timed lap already started. */
  postLine?: boolean;
  /** Never spoken: delivered to the panel only (e.g. tyre values without a trusted range). */
  panelOnly?: boolean;
  /** Overrides the rule's priority class for this candidate. */
  priority?: RadioPriority;
  /** Overrides the rule's level: 'detailed' = only with Detalhado. */
  level?: 'essential' | 'detailed';
}

/**
 * A training block: the laps between the driver's block start and end, or (without an explicit
 * block) every AUTO_BLOCK_LAPS valid laps. The block baseline measures improvement.
 */
export interface RadioBlock {
  id: string;
  /** Started by the driver (env.blockId) rather than automatic. */
  explicit: boolean;
  /** Valid laps closed in the block so far. */
  validLaps: number;
}

export interface RadioRuleContext {
  frame: LiveFrame;
  previous: LiveFrame | null;
  /** Frame time (ms), the engine clock. */
  t: number;
  config: Readonly<RadioEngineConfig>;
  phase: RadioPhase;
  channels: ReadonlySet<RadioChannel>;
  /** Engineer cues of the frame, filtered by the focused corners (empty when not ready). */
  cues: readonly EngineerCue[];
  /** Duration (ms) the utterance will take with the pack that would play it; null = no clip. */
  utteranceMs: (utterance: RadioUtterance) => number | null;
  /** True when this device can play audio now (the cue timing depends on it). */
  audio: boolean;
  /** Frame time when the current context (session/track/car/mode) started. */
  contextStartT: number;
  /** A lap closed in this frame (lap counter advanced). */
  lineCrossed: boolean;
  /** A timed lap was seen in this context (out lap is over). */
  timedLapSeen: boolean;
  /** Driver asked for the summary (Resumo sob demanda); consumed by this step. */
  summaryRequested: boolean;
  /** Corner pass reviews seen for the first time in this step (frame.cornerPasses). */
  passes: readonly LiveCornerPass[];
  /** Focused corners (corner training / Ganhar tempo focus), null = every corner. */
  focus: ReadonlySet<string> | null;
  /** Corners where the driver re-enabled the help (Aprender pista). */
  assist: ReadonlySet<string>;
  /** Current training block. */
  block: Readonly<RadioBlock>;
  /** The block that ended in this step (driver ended it, or the automatic size was reached). */
  blockEnded: Readonly<RadioBlock> | null;
  /** Latest spoken decisions (most recent last, bounded): avoids repeating a correction. */
  recentSpoken: readonly RadioDecision[];
}

/**
 * A deterministic rule. Its state is created by `init` on every context change, and only
 * mutated by `evaluate`, `delivered` and `interrupt`.
 */
export interface RadioRule<S = unknown> {
  id: string;
  priority: RadioPriority;
  /** Modes where the rule runs. */
  modes: readonly RadioMode[];
  /** Treino profiles where the rule runs (omitted = every profile). */
  profiles?: readonly TrainingProfile[];
  /** Car alert: allowed by Livre and by Corrida. */
  carAlert?: boolean;
  /** Lowest speech level that lets the rule speak ('detailed' = Detalhado only). */
  level?: 'essential' | 'detailed';
  requires?: readonly RadioChannel[];
  /** Minimum time between two deliveries of the rule. */
  intervalMs?: number;
  init(): S;
  evaluate(ctx: RadioRuleContext, state: S): readonly RadioCandidate[];
  /** The candidate was spoken or shown on the panel. */
  delivered?(candidate: RadioCandidate, state: S, ctx: RadioRuleContext): void;
  /** Pause, signal loss or discontinuity: drop timing windows, keep what was already said. */
  interrupt?(state: S): void;
}

export type RadioOutcome = 'spoken' | 'panel' | 'discarded' | 'suppressed';

/** One logged decision (spec: regra, instante/distância, evidências, referência, frase, motivo). */
export interface RadioDecision {
  /** Order in the log. */
  seq: number;
  /** Frame time (ms). */
  t: number;
  frameSeq: number;
  lap: number;
  distanceM: number | null;
  mode: RadioMode;
  phase: RadioPhase;
  ruleId: string;
  priority: RadioPriority;
  key: string;
  outcome: RadioOutcome;
  /** Why it was discarded, suppressed or kept on the panel. */
  reason?: string;
  utterance?: RadioUtterance;
  label?: string;
  durationMs?: number | null;
  referenceLapId: string | null;
  cornerId?: string;
  evidence?: RadioCandidate['evidence'];
}

/** What the audio adapter must do after a step. */
export interface RadioSpeech {
  utterance: RadioUtterance;
  durationMs: number;
  decision: RadioDecision;
  cueId?: string;
  /** Replaces a call that is still playing. */
  interrupt: boolean;
}

export interface RadioPanelNote {
  ruleId: string;
  priority: RadioPriority;
  label: string;
  spoken: boolean;
  /** Frame time when it was decided. */
  t: number;
}

export interface RadioStepResult {
  phase: RadioPhase;
  /** Play this now (at most one per step). */
  speak: RadioSpeech | null;
  /** Stop the call that is playing (expired, cleared or context changed). */
  stop: boolean;
  /** Log entries added by this step. */
  decisions: readonly RadioDecision[];
  /** Latest message for the panel, null when none is current. */
  panel: RadioPanelNote | null;
  /** The engine is suspended (paused, menu, replay, stale or lost signal). */
  suspended: string | null;
}

/** Per-step inputs from the device (part of the replay input, so replays stay deterministic). */
export interface RadioStepEnv {
  /**
   * 'ready': this device plays the radio. 'wait': hold speech, keep the candidates pending (pack
   * loading, menu open). 'off': no local playback (muted, other device, volume 0, audio
   * unavailable) → decisions go to the panel.
   */
  audio: 'ready' | 'wait' | 'off';
  /** Age of the frame (ms) when it is evaluated; 0 or omitted in replays. */
  sampleAgeMs?: number;
  /** Corner training: only these corners get corner calls. */
  focusCornerIds?: readonly string[] | null;
  /** Aprender pista: corners where the help is always on (not reduced after repeated success). */
  assistCornerIds?: readonly string[] | null;
  /** Training block started by the driver; a change ends the previous block. null = automatic. */
  blockId?: string | null;
}
