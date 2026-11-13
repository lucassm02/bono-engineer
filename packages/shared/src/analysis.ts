/**
 * Analysis contract: corners, per-corner driver metrics, lap comparison, consistency, traces.
 *
 * Owned by @gt7/analysis (wave 2). See APP-PLAN.md §5. Wave 2 additions are additive: optional
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

import type { Id, Lap, Track } from './domain.ts';

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

/** Driver metrics for one corner of one lap (APP-PLAN.md §5.2). */
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

// ---------------------------------------------------------------------------------------------
// Driving events (docs/radio-engineer-spec.md, "Eventos de pilotagem")
// ---------------------------------------------------------------------------------------------

/**
 * Car behaviour detected from one lap's samples:
 * - understeer: "saída de frente" (steering held, yaw below the expected response, line opening);
 * - oversteer: "saída de traseira" (rotation beyond the input with sideslip or countersteer);
 * - frontLock: "travamento dianteiro" (front wheel slower than the car while braking);
 * - exitTraction: "perda de tração na saída" (longitudinal slip under throttle, no lateral slide).
 */
export type DrivingEventKind = 'understeer' | 'oversteer' | 'frontLock' | 'exitTraction';

export const DRIVING_EVENT_KINDS: readonly DrivingEventKind[] = [
  'understeer',
  'oversteer',
  'frontLock',
  'exitTraction',
] as const;

/** Where in the corner the event started. */
export type DrivingEventPhase = 'braking' | 'entry' | 'mid' | 'exit';

/**
 * Measured values behind an event (null = channel unavailable or not used by that rule).
 * Angles in degrees, rates in °/s, slip ratios as fractions (−0.15 = front wheel 15% slower).
 */
export interface DrivingEventEvidence {
  /** Speed at the start of the event (km/h). */
  speedKmh: number;
  /** Mean steering wheel angle magnitude during the event (°). */
  steeringDeg: number | null;
  /** Steering magnitude at the end minus at the start (°, + = more lock added). */
  steeringChangeDeg: number | null;
  /** Mean yaw rate in the steering direction (°/s). */
  yawRateDps: number | null;
  /** Yaw rate expected for the speed and steering, capped by the lap's grip (°/s). */
  expectedYawRateDps: number | null;
  /** Mean actual / expected yaw rate (< 1 = less rotation than the input asks). */
  yawRatio: number | null;
  /** Lateral drift towards the outside of the turn during the event (m, + = line opening). */
  lineOpeningM: number | null;
  /** Rotation accumulated beyond the path direction (sideslip build-up, °). */
  slipAngleDeg: number | null;
  /** Time steering against the rotation (s). */
  countersteerS: number | null;
  /** Most negative front slip ratio (braking). */
  frontSlipPeak: number | null;
  /** Most negative rear slip ratio under braking, or the highest one under throttle. */
  rearSlipPeak: number | null;
  /** Mean brake pedal (0–1). */
  brake: number | null;
  /** Mean throttle pedal (0–1). */
  throttle: number | null;
  /** Time with the TCS flag active (s). */
  tcsActiveS: number | null;
  /** Largest vertical acceleration deviation (g): crests, compressions, kerbs. */
  verticalG: number | null;
}

export interface DrivingEvent {
  /** Stable id within the lap: `${kind}:${cornerId ?? '-'}:${round(startM)}`. */
  id: string;
  kind: DrivingEventKind;
  lapId: Id;
  /** Corner of the event (track corner segmentation), null on a straight. */
  cornerId: string | null;
  phase: DrivingEventPhase;
  /** Aligned distance range (m). */
  startM: number;
  endM: number;
  /** Lap clock time range (s). */
  startS: number;
  endS: number;
  durationS: number;
  /** 'high' = clear evidence (eligible for the radio); medium/low = probable, review only. */
  confidence: FindingConfidence;
  evidence: DrivingEventEvidence;
  /** pt-BR reasons that lowered the confidence or distinctions applied ("lombada", "replay"…). */
  notes: string[];
  /** pt-BR diagnosis ("Provável saída de frente na T2: …"). */
  message: string;
  /** ONE short pt-BR instruction for the next pass. */
  action: string;
  /**
   * First distance after the event where the car is straight again (low steering and yaw), when
   * the radio may speak. Null when it did not straighten inside the analysed window.
   */
  settledM: number | null;
}

/** Per-lap response model used by the event rules (calibrated from a lap, reusable live). */
export interface DrivingEventModel {
  /** v·steer / yaw (m) in linear cornering; null when it could not be calibrated. */
  steerGainM: number | null;
  /** 95th percentile of |lateral acceleration| (m/s²): the grip cap of the expected yaw. */
  maxLatAccMps2: number;
  /** Median vertical acceleration (g), the baseline for crest/kerb detection. */
  verticalBaselineG: number;
  /** Samples used for the steering calibration. */
  samples: number;
}

export interface LapDrivingEvents {
  lapId: Id;
  trackId: Id | null;
  /** Sorted by start distance. */
  events: DrivingEvent[];
  model: DrivingEventModel;
  /** Channels that were missing (rules suppressed), pt-BR. */
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------
// Wave 3 result types (AnalysisService in @gt7/core; consumed by MCP, server REST and web)
// ---------------------------------------------------------------------------------------------

/**
 * Symbolic reference for comparisons:
 * - personalBest: best own valid lap (not replay/reference) on the same track + car;
 * - sessionBest: best valid lap of the subject's session;
 * - bestReference: fastest reference lap of the track (same car preferred);
 * - auto: bestReference, else personalBest, else sessionBest (never the subject itself).
 */
export type ComparisonReferenceKind = 'personalBest' | 'sessionBest' | 'bestReference' | 'auto';

export const COMPARISON_REFERENCE_KINDS: readonly ComparisonReferenceKind[] = [
  'personalBest',
  'sessionBest',
  'bestReference',
  'auto',
] as const;

/** Compact AI summary object (JSON-serializable, units in the keys). */
export type AiSummary = Record<string, unknown>;

export interface TrackSectorRange {
  index: number;
  fromM: number;
  toM: number;
}

/** Corner plus its apex position on the map (world X/Z). */
export interface MapCorner extends Corner {
  apexX: number;
  apexZ: number;
}

export interface TrackCarRecord {
  carCode: number;
  laps: number;
  validLaps: number;
  personalBestLapId: Id | null;
  personalBestMs: number | null;
}

export interface TrackAnalysis {
  track: Track;
  /** Reference line downsampled for maps (world X/Z), closed loop. */
  map: { stepM: number; lengthM: number; x: number[]; z: number[] } | null;
  corners: MapCorner[];
  sectors: TrackSectorRange[];
  records: {
    /** Fastest valid lap incl. references/replays. */
    overallBestLapId: Id | null;
    overallBestMs: number | null;
    cars: TrackCarRecord[];
    references: { lapId: Id; driverName: string | null; timeMs: number; carCode: number }[];
  };
  sessionCount: number;
  lapCount: number;
}

export interface LapAnalysis {
  lap: Lap;
  track: Track;
  lengthM: number;
  corners: Corner[];
  sectorStartsM: number[];
  /** Same order as `corners`. */
  metrics: CornerMetrics[];
  validity: LapValidityReport;
  summary: AiSummary;
}

export interface LapComparisonResult {
  comparison: LapComparison;
  lap: Lap;
  referenceLap: Lap;
  /** How the reference was chosen ('lap' = explicit id). */
  referenceKind: ComparisonReferenceKind | 'lap';
  /** pt-BR Markdown report. */
  markdown: string;
  summary: AiSummary;
}

// ---------------------------------------------------------------------------------------------
// Time lost per corner (spec 15)
// ---------------------------------------------------------------------------------------------

/** A probable cause of a corner loss, with the number that supports it. */
export interface CornerLossReason {
  kind: CornerFinding['kind'];
  /** Diagnosis with numbers, pt-BR ("Você freia 18 m antes da referência na T1"). */
  message: string;
  /** The one action that goes with it, pt-BR. */
  action: string | null;
  confidence: FindingConfidence;
  costMs: number | null;
}

export interface CornerLossRow {
  cornerId: string;
  name: string | null;
  /** Time lost in the corner zone (ms, > 0), subject − reference. */
  lossMs: number;
  phaseLoss: CornerPhaseLoss | null;
  /** Probable causes, strongest first; empty when no rule is confident enough (show the loss only). */
  reasons: CornerLossReason[];
  /** [subject, reference] brake point (m) and minimum speed (km/h) of the corner. */
  brakePointM: [number | null, number | null];
  minSpeedKmh: [number | null, number | null];
}

/**
 * The corners where a lap loses the most time against another. Listed losses + `otherCornersMs` +
 * `straightsMs` add up to `totalDeltaMs` (within rounding).
 */
export interface CornerLossReport {
  lapA: Id;
  lapB: Id;
  totalDeltaMs: number;
  rows: CornerLossRow[];
  /** All the other corners together (gains, small losses and losses past the list), ms. */
  otherCornersMs: number;
  /** Time on the straights and other stretches outside the corner zones, ms. */
  straightsMs: number;
  /** Corners below this loss (ms) are not listed. */
  minLossMs: number;
  referenceIsReplay: boolean;
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------
// Session summary (spec 12)
// ---------------------------------------------------------------------------------------------

export type SummaryTrend = 'improving' | 'steady' | 'worsening';

/** The earlier session a summary compares with (same track and car). */
export interface SummaryBaseline {
  sessionId: Id;
  startedAt: number;
  bestLapMs: number;
  /** Average of its (up to) 5 best clean laps. */
  top5AvgMs: number | null;
  lapCount: number;
}

/** This session against one baseline; negative = faster than it. */
export interface SummaryComparison {
  baselineMs: number;
  /** Best lap of the session − baseline best (ms). */
  bestDeltaMs: number;
  /** Average of the 5 best of the session − baseline's (ms), null when either is unknown. */
  paceDeltaMs: number | null;
  /** Session the baseline comes from (null for the goal). */
  sessionId: Id | null;
  startedAt: number | null;
}

/** How one corner changed against the baseline lap (negative = gained, positive = lost). */
export interface SummaryCornerChange {
  cornerId: string;
  name: string | null;
  deltaMs: number;
}

/** A rule-made suggestion: `text` is a pt-BR template with {0}, {1} placeholders for `values`. */
export interface SummarySuggestion {
  code: 'invalidLaps' | 'cornerLoss' | 'inconsistent' | 'paceGap' | 'worsening';
  text: string;
  values: (string | number)[];
}

export interface SessionSummary {
  sessionId: Id;
  trackId: Id | null;
  carCode: number;
  startedAt: number;
  endedAt: number | null;
  /** Time driven (pauses and time off the track out) when known, else the session span. */
  durationMs: number | null;
  laps: { total: number; valid: number; invalid: number };
  /** Fewer than 3 clean laps: no pace spread, trend or suggestions about consistency. */
  reduced: boolean;
  best: {
    lapId: Id;
    lapNumber: number;
    timeMs: number;
    /** Best valid lap on the track and car before this session, null the first time. */
    previousBestMs: number | null;
    /** best − previous best (ms, negative = improved), null the first time. */
    deltaMs: number | null;
    firstTime: boolean;
  } | null;
  pace: {
    top5AvgMs: number;
    medianMs: number;
    fastestMs: number;
    slowestMs: number;
    /** slowest − fastest clean lap (ms). */
    spreadMs: number;
    histogram: { fromMs: number; toMs: number; count: number }[];
  } | null;
  consistency: {
    stdDevMs: number;
    trend: SummaryTrend | null;
    /** Change of the lap time per lap (ms), from a straight line through the clean laps. */
    slopeMsPerLap: number | null;
  } | null;
  comparisons: {
    lastSession: SummaryComparison | null;
    bestSession: SummaryComparison | null;
    goal: SummaryComparison | null;
  };
  /** Where the session gained and lost against the previous best lap; null without data. */
  corners: { gains: SummaryCornerChange[]; losses: SummaryCornerChange[] } | null;
  suggestions: SummarySuggestion[];
}

/** One sector of the track in the sector table (spec 14). */
export interface SectorTableRow {
  index: number;
  fromM: number;
  toM: number;
  /** Best time of the sector among the laps (ms). */
  bestMs: number;
  /** Lap that made it. */
  bestLapId: Id;
  /** Average of the (up to) 5 best times of the sector (ms). */
  avgTopMs: number;
  /** What the best lap spends in this sector above the best sector time (ms, ≥ 0). */
  bestLapLossMs: number;
}

/**
 * Best time per sector and the ideal lap (sum of the best sectors) of a set of laps. The ideal lap
 * is a ceiling, not a promise: the exit of a sector depends on how the car entered it.
 */
export interface SectorTable {
  lengthM: number;
  sectorStartsM: number[];
  rows: SectorTableRow[];
  /** Laps that entered the table. */
  lapCount: number;
  bestLapId: Id;
  bestLapMs: number;
  /** Sum of the best sectors (≤ best lap). */
  idealLapMs: number;
  /** best lap − ideal lap (≥ 0). */
  gainMs: number;
}

export interface MicrosectorAnalysis {
  report: MicrosectorReport;
  referenceLapId: Id;
  /** Map colors of every other lap vs the reference. */
  colors: { lapId: Id; colors: MicrosectorColor[] }[];
}

/** Key metrics of one corner on one day's best lap (diffs = subject − baseline). */
export interface EvolutionCornerPoint {
  cornerId: string;
  brakePointM: number | null;
  minSpeedKmh: number | null;
  exitSpeedKmh: number | null;
  throttlePickupM: number | null;
  /** Time lost (+) vs the baseline lap in the corner zone (ms), null without baseline. */
  timeLostMs: number | null;
  brakePointDiffM: number | null;
  minSpeedDiffKmh: number | null;
  exitSpeedDiffKmh: number | null;
  throttlePickupDiffM: number | null;
}

export interface EvolutionDay {
  /** Local date YYYY-MM-DD. */
  date: string;
  sessions: number;
  laps: number;
  validLaps: number;
  bestLapId: Id | null;
  bestLapMs: number | null;
  /** Mean of the 3 fastest valid laps of the day (ms). */
  top3MeanMs: number | null;
  /** Standard deviation of the valid lap times of the day (ms). */
  lapTimeStdDevMs: number | null;
  /** bestLapMs − baseline lap time (ms). */
  gapToBaselineMs: number | null;
  corners: EvolutionCornerPoint[];
}

export interface EvolutionTrend {
  cornerId: string | null;
  metric:
    | 'lapTimeMs'
    | 'timeLostMs'
    | 'brakePointDiffM'
    | 'minSpeedDiffKmh'
    | 'exitSpeedDiffKmh'
    | 'throttlePickupDiffM';
  first: number;
  last: number;
  /** last − first. */
  change: number;
  /** True when the change goes in the good direction (closer to the baseline / faster). */
  improved: boolean;
  /** pt-BR sentence. */
  message: string;
}

export interface EvolutionReport {
  trackId: Id;
  carCode: number | null;
  /** Lap the days are compared with: best reference lap, else the all-time personal best. */
  baseline: { kind: 'reference' | 'personalBest'; lapId: Id; timeMs: number } | null;
  days: EvolutionDay[];
  /** Most relevant changes between the first and the last day, biggest first. */
  trends: EvolutionTrend[];
}

// ---------------------------------------------------------------------------------------------
// Weekly summary ("Resumo da semana"): what the driver did in 7 days, per track
// ---------------------------------------------------------------------------------------------

/** A goal chased on a track, seen from the end of the week. */
export interface WeeklyGoalState {
  targetMs: number;
  reached: boolean;
  /** How far the best lap is from the goal (ms, > 0), 0 once reached. */
  remainingMs: number;
}

/** One track (and car) driven during the week. */
export interface WeeklyTrackRow {
  trackId: Id;
  /** Filled by the service; null when the track has no name. */
  trackName: string | null;
  /** Car the driver used most on the track in the week. */
  carCode: number;
  sessions: number;
  laps: number;
  validLaps: number;
  /** Best valid lap of the week (ms), null without a valid lap. */
  bestMs: number | null;
  /** Best valid own lap on this track and car before the week (ms), null the first time. */
  previousBestMs: number | null;
  /** bestMs − previousBestMs (negative = faster than before), null when either is missing. */
  deltaMs: number | null;
  /** The week's best lap beat the previous best (a personal record). */
  isRecord: boolean;
  /** First valid lap ever on this track and car. */
  firstTime: boolean;
  /** The active goal against the best lap overall (week or before), null without a goal. */
  goal: WeeklyGoalState | null;
}

export interface WeeklyGoalReached {
  trackId: Id;
  trackName: string | null;
  carCode: number | null;
  targetMs: number;
  achievedAt: number;
}

/** GET /api/analysis/weekly?weeksAgo=: 0 = the last 7 days, 1 = the 7 days before them, ... */
export interface WeeklySummary {
  weeksAgo: number;
  /** Window [fromMs, toMs) in epoch ms. */
  fromMs: number;
  toMs: number;
  sessions: number;
  laps: number;
  validLaps: number;
  /** Time on track in the week (ms): sum of the sessions' durations. */
  drivingMs: number;
  /** Tracks driven, most laps first. */
  tracks: WeeklyTrackRow[];
  /** Personal records of the week (first times do not count). */
  records: number;
  goalsReached: WeeklyGoalReached[];
}
