/**
 * Analysis contract: corners, per-corner driver metrics, lap comparison, consistency, traces.
 *
 * Owned by @gt7/analysis (wave 2). See PLANO-APP.md §5. Wave 2 additions are additive: optional
 * fields on existing interfaces plus new result types (distance delta, microsectors, validity).
 *
 * Conventions:
 * - Distances are meters along the lap (aligned to the track centerline), speeds km/h,
 *   durations seconds (`...S`) or ms (`...Ms`), pedals 0–1.
 * - Time deltas are "subject minus reference": POSITIVE = subject is SLOWER (time lost),
 *   NEGATIVE = time gained. Same sign as the live delta display.
 * - Metrics that cannot be computed (e.g. no braking in a flat-out kink, no steering channel in
 *   format A) are `null`, never 0.
 */

import type { Id } from './domain.ts';

export type CornerDirection = 'left' | 'right';

/** Coarse corner classification by minimum speed / radius. */
export type CornerKind = 'hairpin' | 'slow' | 'medium' | 'fast' | 'kink' | 'chicane';

export interface Corner {
  /** Stable id within a track, e.g. "T1". */
  id: string;
  /** 0-based order along the lap. */
  index: number;
  /** User-given name ("Eau Rouge"), null if unnamed. */
  name: string | null;
  entryM: number;
  apexM: number;
  exitM: number;
  direction: CornerDirection;
  kind?: CornerKind;
  /** Approximate minimum radius of the centerline in meters. */
  minRadiusM?: number;
  /** User note for a visual brake marker ("placa de 100 m"). */
  brakeMarkerNote?: string | null;
}

/** Distance after the corner exit where exit speed is measured. */
export const EXIT_SPEED_OFFSET_M = 50;
/** Brake pedal threshold (0–1) defining the brake point. */
export const BRAKE_ON_THRESHOLD = 0.05;
/** Throttle threshold (0–1) defining the throttle pickup point. */
export const THROTTLE_ON_THRESHOLD = 0.1;
/** Both pedals below this (0–1) count as coasting ("roda livre"). Maintenance throttle is above. */
export const COAST_PEDAL_THRESHOLD = 0.02;
/** Throttle (0–1) considered "full throttle" for time-to-full-throttle. */
export const FULL_THROTTLE_THRESHOLD = 0.98;
/** Front slip ratio magnitude (positive) above which a front wheel counts as locking. */
export const FRONT_LOCK_SLIP_THRESHOLD = 0.12;
/** Default distance step (m) of resampled traces. */
export const DEFAULT_RESAMPLE_STEP_M = 2;
/** Default number of equal-length microsectors per lap. */
export const DEFAULT_MICROSECTOR_COUNT = 25;

export interface LateralOffsets {
  /** Lateral offset (m) vs reference line; + = left of the line in driving direction. */
  entry: number;
  apex: number;
  exit: number;
}

/** Driver metrics for one corner of one lap (PLANO-APP.md §5.2). */
export interface CornerMetrics {
  cornerId: string;
  lapId: Id;

  // Braking
  /** Distance where brake first exceeds {@link BRAKE_ON_THRESHOLD} for this corner. */
  brakePointM: number | null;
  /** Peak brake pressure 0–1. */
  peakBrake: number | null;
  /** Time from brake-on to peak brake. */
  timeToPeakBrakeS: number | null;
  /** Distance where brake drops below threshold again. */
  brakeReleaseM: number | null;
  /** Total braking duration. */
  brakingDurationS: number | null;

  // Trail braking (brake still applied while turning in)
  /** Duration of brake/steering (or yaw build-up) overlap. */
  trailBrakingS: number | null;
  /** Integral of brake × normalized steering/yaw over the overlap (dimensionless·s). */
  trailBrakingArea: number | null;
  /** Distance from brake release to apex (+ = released before apex). */
  brakeReleaseToApexM: number | null;

  // Speed / apex
  entrySpeedKmh: number | null;
  minSpeedKmh: number;
  /** Where the minimum speed happened. */
  minSpeedM: number;
  /** Measured apex location (vmin / innermost point). */
  apexM: number;
  /** Speed at exitM + {@link EXIT_SPEED_OFFSET_M}. */
  exitSpeedKmh: number | null;
  gearAtApex: number;

  // Throttle
  /** Distance where throttle exceeds {@link THROTTLE_ON_THRESHOLD} after the apex region. */
  throttlePickupM: number | null;
  /** Time from throttle pickup to ≥ 98% throttle. */
  timeToFullThrottleS: number | null;
  /** Time with neither brake nor throttle applied inside the corner window. */
  coastingS: number;

  // Line
  /** Offsets vs the reference lap line; null when no reference line is available. */
  lateralOffsetM: LateralOffsets | null;

  // Grip / stability
  /** Peak rear slip ratio on exit (traction). */
  rearSlipPeak: number | null;
  /** Time with TCS flag active inside the corner window. */
  tcsActiveS: number;
  /** Peak front lock (most negative front slip ratio) under braking, as a positive number. */
  frontLockPeak: number | null;
  /** Time with front slip below the lock threshold. */
  frontLockS: number;
  /** Number of steering direction reversals (B+ formats), null when no steering channel. */
  steeringCorrections: number | null;

  // Time
  /** Time spent between entryM and exitM. */
  timeInCornerS: number;
  /** Time delta vs the comparison lap across this corner (see sign convention). */
  timeDeltaS: number | null;
}

/** Numeric metric keys that can be diffed / aggregated. */
export type CornerMetricKey = {
  [K in keyof CornerMetrics]: CornerMetrics[K] extends number | null ? K : never;
}[keyof CornerMetrics];

/** Per-metric difference subject − reference (null when either side is null). */
export type CornerMetricsDiff = { [K in CornerMetricKey]?: number | null };

export interface CornerComparisonRow {
  corner: Corner;
  /** Subject lap metrics. */
  a: CornerMetrics;
  /** Reference lap metrics. */
  b: CornerMetrics;
  diff: CornerMetricsDiff;
  /** Time lost (+) / gained (−) in ms across the corner (entry → exit + exit straight share). */
  timeLostMs: number;
  /** Rule-based findings for this corner, ranked by estimated cost (pt-BR message/action set). */
  findings?: CornerFinding[];
  /** Distance range used for `timeLostMs` (zones of consecutive corners never overlap). */
  zone?: { fromM: number; toM: number };
  /** Breakdown of the zone delta (plus the following straight, not included in timeLostMs). */
  phaseLoss?: CornerPhaseLoss;
}

/** Structured hint the coach/UI can phrase ("brakes 18 m earlier"). */
export interface CornerFinding {
  kind:
    | 'brakeEarlier'
    | 'brakeLater'
    | 'lowerMinSpeed'
    | 'higherMinSpeed'
    | 'lateThrottle'
    | 'earlyThrottle'
    | 'coasting'
    | 'noTrailBraking'
    | 'earlyApex'
    | 'lateApex'
    | 'lineOffset'
    | 'exitSlip'
    | 'frontLock'
    | 'steeringCorrections'
    | 'gearChoice'
    | 'slowerExit'
    | 'softBraking';
  /** Magnitude in the metric's unit (m, km/h, s...). */
  value: number;
  unit: 'm' | 'kmh' | 's' | 'count' | 'gear' | 'ratio';
  /** Estimated cost in ms (for ranking), if known. */
  costMs?: number | null;
  /** Corner the finding refers to (e.g. "T1"). */
  cornerId?: string;
  /** Diagnosis with numbers, pt-BR ("Você freia 18 m antes da referência na T1"). */
  message?: string;
  /** ONE concrete action, pt-BR ("Freie mais tarde, perto do marco de 120 m."). */
  action?: string;
  /** How much to trust it (magnitude vs threshold, replay smoothing). */
  confidence?: FindingConfidence;
  /** Subject / reference values of the underlying metric (same unit as `value`). */
  subjectValue?: number | null;
  referenceValue?: number | null;
}

export type FindingConfidence = 'high' | 'medium' | 'low';

/** Time lost (+) / gained (−) in ms per phase of a corner zone (from the distance delta). */
export interface CornerPhaseLoss {
  /** Zone start (brake zone) → corner entry. */
  brakingMs: number;
  /** Entry → exit. */
  midMs: number;
  /** Exit → zone end (exit + EXIT_SPEED_OFFSET_M). */
  exitMs: number;
  /** Zone end → next corner zone start (the straight that follows). */
  followingStraightMs: number;
}

export interface LapComparison {
  trackId: Id | null;
  /** Subject lap (usually yours). */
  lapA: Id;
  /** Reference lap. */
  lapB: Id;
  lapATimeMs: number;
  lapBTimeMs: number;
  /** lapA − lapB. */
  totalDeltaMs: number;
  rows: CornerComparisonRow[];
  /** Rows sorted by timeLostMs descending, first N (default 3). */
  topLosses: CornerComparisonRow[];
  /** Time lost on straights / non-corner segments (sum of the rest). */
  straightsDeltaMs: number;
  warnings: string[];
  /** All findings of all corners, ranked by estimated cost (desc). */
  findings?: CornerFinding[];
  /** ONE finding (the costliest) per corner, ranked by cost: the coaching plan. */
  keyFindings?: CornerFinding[];
  /** Delta per sector (ms, subject − reference), sectors from the track gates or 3 equal. */
  sectorDeltasMs?: number[];
  /** Sector start distances used for `sectorDeltasMs`. */
  sectorStartsM?: number[];
  /** Reference line length (m). */
  lengthM?: number;
  /** True when the reference was captured from a replay (smoothed inputs). */
  referenceIsReplay?: boolean;
}

export interface MetricStats {
  n: number;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
}

export interface ConsistencyReport {
  sessionId: Id;
  lapIds: Id[];
  lapTime: MetricStats;
  /** Per corner: stats for every numeric metric. */
  corners: {
    cornerId: string;
    metrics: { [K in CornerMetricKey]?: MetricStats };
  }[];
  /** Corners/metrics with the largest spread, most inconsistent first. */
  highlights: {
    cornerId: string;
    metric: CornerMetricKey;
    stdDev: number;
    /** max − min across laps, in the metric unit. */
    range?: number;
    /** pt-BR sentence ("Ponto de frenagem na T6 varia 15 m entre as voltas"). */
    message?: string;
  }[];
}

/** Channels available for traces / charts. */
export type TraceChannel =
  | 'timeS'
  | 'speedKmh'
  | 'throttle'
  | 'brake'
  | 'clutch'
  | 'gear'
  | 'rpm'
  | 'steering'
  | 'yawRate'
  | 'latG'
  | 'lonG'
  | 'deltaS'
  | 'lateralOffsetM'
  | 'x'
  | 'y'
  | 'z'
  | 'slipFL'
  | 'slipFR'
  | 'slipRL'
  | 'slipRR'
  | 'tyreTempFL'
  | 'tyreTempFR'
  | 'tyreTempRL'
  | 'tyreTempRR'
  | 'tcs'
  | 'asm';

export const TRACE_CHANNELS: readonly TraceChannel[] = [
  'timeS',
  'speedKmh',
  'throttle',
  'brake',
  'clutch',
  'gear',
  'rpm',
  'steering',
  'yawRate',
  'latG',
  'lonG',
  'deltaS',
  'lateralOffsetM',
  'x',
  'y',
  'z',
  'slipFL',
  'slipFR',
  'slipRL',
  'slipRR',
  'tyreTempFL',
  'tyreTempFR',
  'tyreTempRL',
  'tyreTempRR',
  'tcs',
  'asm',
] as const;

/** A lap trace resampled on a regular distance grid. */
export interface ResampledTrace {
  lapId: Id;
  fromM: number;
  toM: number;
  stepM: number;
  /** Grid positions (length = number of points). */
  distanceM: number[];
  /** Requested channels, each the same length as distanceM. NaN where unavailable. */
  channels: Partial<Record<TraceChannel, number[]>>;
}

// ---------------------------------------------------------------------------------------------
// Wave 2 result types (@gt7/analysis)
// ---------------------------------------------------------------------------------------------

/** Time delta of a lap vs a reference on a regular distance grid. */
export interface DistanceDelta {
  lapId: Id;
  referenceLapId: Id;
  stepM: number;
  distanceM: number[];
  /** Cumulative delta (s), subject − reference: + = slower. */
  deltaS: number[];
  /** Smoothed derivative d(delta)/d(distance) in seconds per 100 m (+ = losing time here). */
  rateSPer100m: number[];
  /** Delta at the end of the lap (s). */
  totalS: number;
}

/** Microsector times of one lap. */
export interface MicrosectorLap {
  lapId: Id;
  lapTimeMs: number;
  /** Time per microsector (ms), length = count. */
  microMs: number[];
  /** Time per sector (ms). */
  sectorMs: number[];
}

export interface MicrosectorReport {
  count: number;
  lengthM: number;
  /** Microsector boundaries (m), length = count + 1. */
  boundariesM: number[];
  /** Sector start distances (m), first = 0. */
  sectorStartsM: number[];
  laps: MicrosectorLap[];
  bestMicroMs: number[];
  bestMicroLapIds: Id[];
  bestSectorMs: number[];
  bestSectorLapIds: Id[];
  bestLapId: Id;
  bestLapMs: number;
  /** Sum of the best microsectors (≤ best lap). */
  theoreticalBestMs: number;
  /** Sum of the best sectors (≤ best lap, ≥ theoreticalBestMs). */
  theoreticalBestSectorsMs: number;
}

/** Map coloring of one microsector of a lap vs a reference. */
export interface MicrosectorColor {
  index: number;
  fromM: number;
  toM: number;
  /** Subject − reference (ms). */
  deltaMs: number;
  /** best = equals the best microsector of the set (purple). */
  tone: 'gain' | 'loss' | 'neutral' | 'best';
  /** 0–1, |delta| relative to the largest |delta| of the lap. */
  intensity: number;
  /** Suggested CSS color for the tone. */
  color: string;
}

export type LapIssueKind =
  | 'offTrack'
  | 'timeGap'
  | 'distanceJump'
  | 'backwards'
  | 'incomplete'
  | 'timeMismatch';

/** Subset of domain LapFlag produced by the validity heuristics. */
export type LapValidityFlag = 'offTrack' | 'discontinuity' | 'incompleteData' | 'timeMismatch';

export interface LapValidityReport {
  lapId: Id;
  /** False when the lap went off track or the data has gaps/jumps (time not trustworthy). */
  valid: boolean;
  flags: LapValidityFlag[];
  issues: { kind: LapIssueKind; atM: number | null; value: number; message: string }[];
}
