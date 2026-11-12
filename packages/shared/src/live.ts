/**
 * Live state contract: what the dashboard receives at ~30–60 Hz and lap events.
 *
 * Produced by @gt7/core (lap engine) from ingested packets; owned by the core agent in later
 * waves (may extend). Units: speeds km/h, pedals 0–1, times ms, distances m, temps °C.
 * Values unavailable in the current packet format are `null`.
 */

import type { CornerDirection } from './analysis.ts';
import type { DeltaReferenceKind, Id } from './domain.ts';
import type {
  DecodedFlags,
  IngestorStats,
  PacketFormat,
  SurfaceChar,
  Vec3,
  Wheels,
} from './telemetry.ts';
import type { LiveTrackContext } from './track-context.ts';

/**
 * High-level state shown to the user.
 * - disconnected: no data (ingestor stopped or timed out).
 * - connecting: heartbeats sent, waiting for the first packet.
 * - switchingFormat: ingestor cooling down to change the packet format.
 * - menu: packets arriving but car not on track (menus, loading).
 * - onTrack: driving.
 * - paused: on track but paused.
 * - replay: a replay is playing (car data with `carOnTrack` false, moving, position advancing — the
 *   game's replay screen) or the app is in the legacy replay mode. It is not a driving session.
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'switchingFormat'
  | 'menu'
  | 'onTrack'
  | 'paused'
  | 'replay';

/** Colour status of a sector split (purple/green/yellow in the UI). */
export type SectorStatus = 'overallBest' | 'personalBest' | 'sessionBest' | 'slower' | 'pending';

export interface SectorSplit {
  /** 0-based sector index. */
  index: number;
  /** Split time in ms; null while the sector is pending. */
  timeMs: number | null;
  status: SectorStatus;
  /** Difference vs the same sector of the delta reference lap (+ = slower), null if unknown. */
  deltaMs: number | null;
}

export interface LiveDelta {
  /** Current delta vs reference in ms (+ = slower). Null when no reference is available. */
  ms: number | null;
  reference: DeltaReferenceKind;
  /** Lap used as reference, null if none. */
  referenceLapId: Id | null;
  /** Rate of change of the delta in ms per second (trend arrow: + = losing time). */
  rateMsPerS: number | null;
}

export interface LiveLapTiming {
  /** Current lap number (game lapCount; 0 before crossing the start line). */
  lap: number;
  /** Total laps of the event, null in time trial / free run. */
  totalLaps: number | null;
  /** Elapsed time of the current lap. */
  currentLapMs: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  /** Predicted lap time = reference lap time + current delta. */
  predictedLapMs: number | null;
  delta: LiveDelta;
  /** Lap time of the delta reference lap, null if none. (core, additive) */
  referenceLapMs?: number | null;
  /**
   * False once the current lap got an invalidating flag (pause, packet gaps, discontinuity) or
   * when it is not a timed lap (out lap / joined mid-lap). (core, additive)
   */
  currentLapValid?: boolean;
  startedAt?: number;
}

export interface LiveTrackInfo {
  id: Id | null;
  name: string | null;
  lengthM: number | null;
  /** How sure the core is about the identification. */
  confidence: 'confirmed' | 'probable' | 'unknown';
}

export interface NextCornerHint {
  cornerId: string;
  name: string | null;
  direction: CornerDirection;
  /** Distance from the car to the corner entry (m). */
  distanceToEntryM: number;
  /** Reference lap targets for this corner (Treino de curva / Mapa), null if unknown. */
  referenceBrakePointM: number | null;
  referenceMinSpeedKmh: number | null;
  referenceGearAtApex: number | null;
  /** Lap distance (m) where the reference picks up the throttle in this corner (optional). */
  referenceThrottleOnM?: number;
  /** Result of the user's last pass through this corner, vs reference (+ = slower), ms. */
  lastPassDeltaMs: number | null;
}

export const ENGINEER_CUE_KINDS = [
  'brake',
  'brakeHard',
  'brakeLight',
  'release',
  'releaseSmooth',
  'coast',
  'throttle',
  'throttleSmooth',
] as const;
export type EngineerCueKind = (typeof ENGINEER_CUE_KINDS)[number];

export interface EngineerCue {
  id: string;
  cornerId?: string;
  kind: EngineerCueKind;
  /** Signed distance from the car to the action point. */
  aheadM: number;
  /** Measured peak brake pedal input (0–1) of the reference braking zone, when reliable. */
  brakePeak?: number;
  /** Remaining distance to the end of an instruction that spans a zone. */
  endAheadM?: number;
}

export interface EngineerRadioCall {
  cornerId: string;
  kind: EngineerCueKind;
  text: string;
  distanceM: number;
  actionDistanceM: number;
}

export interface EngineerRadioLog {
  deviceId: Id;
  referenceLapId: Id;
  calls: EngineerRadioCall[];
}

export type LiveEngineerFrame =
  | { status: 'waitingTrack' | 'waitingReference' | 'incompatible' | 'noCues' | 'suspended' }
  | {
      status: 'ready';
      referenceLapId: Id;
      referenceLapMs: number;
      pendingReference: boolean;
      cues: EngineerCue[];
    };

/**
 * Cause of a corner pass that lost time against the reference (Ganhar tempo), chosen from the
 * per-corner metrics of the analysis with an observable effect (zone delta):
 * - heldBrake: brake released later and held longer while turning ("segurou o freio");
 * - brakeEarly: braked well before the reference;
 * - lateThrottle: picked the throttle up later;
 * - coasting: time without any pedal between braking and throttle;
 * - gear: different gear at the apex.
 */
export type LiveCornerCauseKind = 'heldBrake' | 'brakeEarly' | 'lateThrottle' | 'coasting' | 'gear';

export interface LiveCornerCause {
  kind: LiveCornerCauseKind;
  /** high = clear and costly; medium = probable (recurring only); low = review only. */
  confidence: 'high' | 'medium' | 'low';
  /** Time the cause explains in the zone (ms, ≥ 0). */
  costMs: number;
  /** pt-BR diagnosis for the panel and the review. */
  message: string;
  /** Measured values (subject, reference) behind the cause. */
  evidence: Record<string, number | null>;
  /** Reference gear at the apex (gear cause only). */
  gear?: number;
}

/** The radio-eligible driving event of a corner pass (high confidence, see DrivingEvent). */
export interface LiveDrivingEventCall {
  id: string;
  kind: 'understeer' | 'oversteer' | 'frontLock' | 'exitTraction';
  phase: 'braking' | 'entry' | 'mid' | 'exit';
  /** Lap distance where the car is straight again; null = it did not straighten. */
  settledM: number | null;
  startM: number;
  endM: number;
  /** Mean throttle during the event (0–1), null when unknown. */
  throttle: number | null;
  /** pt-BR diagnosis and action (panel, review). */
  message: string;
  action: string;
}

/**
 * Review of one pass through a corner, made by the core ~80 m after the exit (or just before the
 * line for the last corner) against the engineer reference. Additive (core, live).
 */
export interface LiveCornerPass {
  /** `${lapStartedAt}|${cornerId}`. */
  id: string;
  cornerId: string;
  lap: number;
  lapStartedAt: number;
  /** Reference the pass was compared with (null = none compatible). */
  referenceLapId: Id | null;
  referenceIsReplay: boolean;
  /** Lap distance where the review was made. */
  atM: number;
  /** Zone time vs the reference (+ = slower, ms), null without a comparable reference. */
  timeLostMs: number | null;
  /** Why the pass cannot be compared with the reference (review only), when it cannot. */
  incomparable?: string;
  brakePointM: number | null;
  referenceBrakePointM: number | null;
  gearAtApex: number | null;
  referenceGearAtApex: number | null;
  /** Best-supported cause with an observable effect, null on a clean pass. */
  cause: LiveCornerCause | null;
  /** High-confidence driving event of the pass (at most one), null when none. */
  event: LiveDrivingEventCall | null;
}

/** Car channels of the live frame. */
export interface LiveCar {
  speedKmh: number;
  rpm: number;
  gear: number;
  suggestedGear: number | null;
  /** 0–1 after aids. */
  throttle: number;
  /** 0–1. */
  brake: number;
  /** 0–1. */
  clutch: number;
  /** Raw driver throttle/brake 0–1 (~ format+), null otherwise. */
  throttleRaw: number | null;
  brakeRaw: number | null;
  /** Steering wheel angle rad (B+), null otherwise. */
  steeringRad: number | null;
  /** Boost in bar (raw − 1). */
  boostBar: number;
  oilPressureBar: number;
  /** Shift-light range from the packet (0x88/0x8A). */
  rpmAlert: { min: number; max: number };
  maxSpeedKmh: number;
  carCode: number;
}

export interface LiveTyres {
  tempC: Wheels;
  /** Slip ratio (+ spin, − lock). */
  slip: Wheels;
  /** Suspension height in meters. */
  suspensionM: Wheels;
  /** Surface per wheel (C format), null otherwise. */
  surface: Wheels<SurfaceChar> | null;
}

export interface LiveFuel {
  /** Liters (or battery % for EVs). */
  level: number;
  capacity: number;
  /** Average consumption per lap, null until a full lap is known. */
  perLapAvg: number | null;
  lapsRemaining: number | null;
  /** Liters needed to finish the event (races only), null otherwise. */
  neededToFinish: number | null;
  /** Energy recovery (~ format, hybrids/EVs), null otherwise. */
  energyRecovery: number | null;
}

export interface LiveGForce {
  /** + = left. */
  lateral: number;
  /** + = accelerating. */
  longitudinal: number;
  /** null when unavailable (A format; computed otherwise). */
  vertical: number | null;
}

/** Passes shown in the drill card and kept in the frame. */
export const DRILL_HISTORY = 10;

/** One pass through the corner being drilled (spec 18). */
export interface LiveDrillPass {
  /** 1-based pass number in this drill. */
  n: number;
  /** Time from the corner entry to its exit (ms). */
  timeMs: number;
  entrySpeedKmh: number;
  minSpeedKmh: number;
  exitSpeedKmh: number;
  /** Where braking started, metres before the corner entry; null = no braking in the approach. */
  brakePointM: number | null;
  /** Epoch ms of the exit. */
  at: number;
}

/**
 * The corner drill in the frame (spec 18): the driver picked one corner and the engineer talks
 * only about it. Passes are measured by position (entry to exit of the track's corner), so slow
 * laps between passes and laps that are not valid or complete do not matter.
 */
export interface LiveDrill {
  cornerId: string;
  cornerName: string | null;
  startedAt: number;
  /** approach = within DRILL_APPROACH_M of the entry; in = between entry and exit. */
  phase: 'away' | 'approach' | 'in';
  /** Distance to the entry (m, ahead), null when unknown. */
  distanceToEntryM: number | null;
  /** The last DRILL_HISTORY passes, oldest first. */
  passes: LiveDrillPass[];
  /** Passes so far in this drill. */
  count: number;
  /** Fastest pass of the drill, null before the first. */
  best: LiveDrillPass | null;
  /** The driver's target for the stretch time (ms), when set. */
  targetMs: number | null;
  /** Reference braking point, metres before the entry, when a reference exists. */
  referenceBrakeM: number | null;
}

/** Distance before the entry from which the drill counts as approaching (m). */
export const DRILL_APPROACH_M = 400;

/** A drill that was stopped, as stored with the session (spec 18). */
export interface CornerDrill {
  id: Id;
  sessionId: Id | null;
  trackId: Id;
  cornerId: string;
  /** Every pass of the drill, oldest first. */
  passes: LiveDrillPass[];
  startedAt: number;
  endedAt: number;
  targetMs: number | null;
}

/** How long (ms) a reached goal stays in the frame so the screen and the radio can celebrate. */
export const GOAL_CELEBRATION_MS = 20_000;

/** The active goal of the track and car in the frame (spec 13). */
export interface LiveGoal {
  id: Id;
  targetMs: number;
  /** Null = any car. */
  carCode: number | null;
  /**
   * Where the current lap stands against the goal pace (+ = behind, ms): the elapsed time minus
   * the time the goal lap would have at this distance. Null outside a timed lap.
   */
  deltaMs: number | null;
  /** Lap time that reached the goal, kept for GOAL_CELEBRATION_MS after the lap; else null. */
  reachedLapMs: number | null;
  /** Epoch ms of the lap that reached the goal (matches reachedLapMs). */
  reachedAt: number | null;
}

/** One dashboard frame (server → clients, ~30–60 Hz). Keep it JSON-serializable. */
export interface LiveFrame {
  sessionId?: Id | null;
  /** Monotonic frame sequence number. */
  seq: number;
  /** Server epoch ms when the frame was produced. */
  t: number;
  packetId: number;
  format: PacketFormat;
  state: ConnectionState;
  car: LiveCar;
  tyres: LiveTyres;
  fuel: LiveFuel;
  g: LiveGForce;
  flags: DecodedFlags;
  /** World position (for the mini map). */
  position: Vec3;
  /** Heading in radians (atan2(vx, vz)). */
  headingRad: number;
  lap: LiveLapTiming;
  sectors: SectorSplit[];
  /** Distance along the current lap in meters, null if unknown. */
  distanceM: number | null;
  /** Distance as a fraction of the lap 0–1, null if the track length is unknown. */
  lapFraction: number | null;
  track: LiveTrackInfo | null;
  /**
   * What the app knows about the track right now: name, confidence, learning guide, corners.
   * Absent in frames from servers older than specs 05/06. (core, additive)
   */
  trackContext?: LiveTrackContext;
  nextCorner: NextCornerHint | null;
  engineer?: LiveEngineerFrame;
  /**
   * The latest corner pass reviews of the session (most recent last, at most 2): the radio
   * accumulates them by id. Omitted while none was made. (core, additive)
   */
  cornerPasses?: LiveCornerPass[];
  /** The driver's goal for this track and car; omitted while there is none. (core, additive) */
  goal?: LiveGoal;
  /** The corner drill in progress; omitted otherwise. (core, additive) */
  drill?: LiveDrill;
  /** UDP link quality. */
  link: Pick<IngestorStats, 'rateHz' | 'lossPct' | 'lost' | 'received' | 'lastPacketAt'>;
}

/** Emitted once when a lap closes (drives the lap pop-up card and the Tempos view). */
export interface LapCompletedEvent {
  startedAt?: number;
  carCode?: number;
  engineerReferenceLapId?: Id;
  sessionId: Id;
  lapId: Id;
  lapNumber: number;
  timeMs: number;
  sectorTimesMs: (number | null)[];
  sectorStatus: SectorStatus[];
  valid: boolean;
  /** Reasons when invalid (LapFlag values). */
  flags: string[];
  /** vs the delta reference lap (+ = slower), null if none. */
  deltaMs: number | null;
  deltaReference: DeltaReferenceKind;
  isPersonalBest: boolean;
  isSessionBest: boolean;
  /** Index of this lap's best sector relative to the reference (for the pop-up), null if none. */
  bestSectorIndex: number | null;
  fuelUsedL: number | null;
  completedAt: number;
  /** Track the lap was identified on, null if unknown. (core, additive) */
  trackId?: Id | null;
  /** This lap reached the active goal of the track and car. (core, additive) */
  goalReached?: boolean;
}
