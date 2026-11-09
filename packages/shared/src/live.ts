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
  nextCorner: NextCornerHint | null;
  engineer?: LiveEngineerFrame;
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
}
