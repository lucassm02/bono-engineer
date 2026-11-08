/**
 * Persistent domain model: tracks, sessions, laps, stored traces.
 *
 * Implemented by @gt7/core (SQLite + trace files). Consumed by server, analysis, mcp and web.
 * IDs are opaque strings (core decides the scheme, e.g. ULID/UUID). Times are epoch ms unless the
 * field name says otherwise; durations are in ms (`...Ms`) or seconds (`...S`); distances in meters.
 */

import type { Corner } from './analysis.ts';
import type { PacketFormat, Vec2 } from './telemetry.ts';

export type Id = string;

/** Which lap the live delta / comparisons are measured against. */
export type DeltaReferenceKind = 'personalBest' | 'sessionBest' | 'reference';

export const DELTA_REFERENCE_KINDS: readonly DeltaReferenceKind[] = [
  'personalBest',
  'sessionBest',
  'reference',
] as const;

/** How the session was captured. */
export type SessionMode = 'live' | 'replayCapture';

/**
 * Track identity inferred from geometry (GT7 sends no track id).
 * Two laps match a track when start point is within a few meters, length within ~1% and shape
 * descriptor is close.
 */
export interface TrackFingerprint {
  /** Start/finish point (position where lapCount changes), world X/Z. */
  start: Vec2;
  /** Heading at the start line in radians (atan2(dx, dz)). */
  startHeadingRad: number;
  /** Lap length in meters. */
  lengthM: number;
  /** Bounding box of the centerline, world X/Z. */
  bbox: { min: Vec2; max: Vec2 };
  /**
   * Coarse shape descriptor: e.g. curvature or heading sampled at N equidistant points.
   * Comparison metric is up to the core implementation; version it with `shapeVersion`.
   */
  shape: number[];
  shapeVersion: number;
}

/** Sector boundary at a distance along the lap (optionally drawn as a gate line on the map). */
export interface SectorGate {
  /** 0-based index of the sector that STARTS at this gate (gate 0 is the start line). */
  index: number;
  distanceM: number;
  /** Optional gate line endpoints for map display / user-defined gates. */
  line?: { a: Vec2; b: Vec2 };
}

export interface Track {
  id: Id;
  /** Display name ("Synthetic Ring", "Spa-Francorchamps") — user editable. */
  name: string;
  /** Optional layout/variant label. */
  layout?: string | null;
  fingerprint: TrackFingerprint;
  lengthM: number;
  /**
   * Reference centerline used for distance alignment. Points to the lap whose X/Z trace defines
   * the line (core may also store a derived resampled polyline file).
   */
  centerline: { sourceLapId: Id | null; file: string | null; stepM: number } | null;
  /** Sector gates sorted by distance; default: 3 equal-length sectors. */
  sectorGates: SectorGate[];
  /** Detected/edited corners sorted by distance. */
  corners: Corner[];
  /** 'auto' = inferred, 'user' = confirmed/edited by user, 'builtin' = shipped definition. */
  source: 'auto' | 'user' | 'builtin';
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: Id;
  /** Null until the track is identified. */
  trackId: Id | null;
  carCode: number;
  startedAt: number;
  /** Null while the session is in progress. */
  endedAt: number | null;
  /** Packet format captured. */
  format: PacketFormat;
  mode: SessionMode;
  /** Number of completed laps stored. */
  lapCount: number;
  bestLapMs: number | null;
  /** Path of the raw recording (.gt7rec) relative to the data dir, if recorded. */
  recordingFile: string | null;
  notes?: string | null;
}

/** Quality flags attached to a lap. */
export type LapFlag =
  /** Packet loss above threshold or gaps that could not be interpolated. */
  | 'incompleteData'
  /** Game was paused during the lap. */
  | 'paused'
  /** Out lap (started from pit/grid, not a flying lap). */
  | 'outLap'
  /** In lap (ended in the pits / session end before crossing). */
  | 'inLap'
  /** Track limits exceeded (surface/offset based). */
  | 'offTrack'
  /** Lap time measured locally disagrees with the game's lastLapMs beyond tolerance. */
  | 'timeMismatch'
  /** Captured from a replay (smoothed inputs, fuel unreliable). */
  | 'replay'
  /** Rewind/jump detected (packetId or distance discontinuity). */
  | 'discontinuity';

/** Metadata for reference laps (e.g. world-ranking replay captures). */
export interface ReferenceMeta {
  driverName: string;
  source: 'replayCapture' | 'import' | 'own';
  /** Lap time shown in the in-game ranking, typed by the user, for validation. */
  rankingTimeMs: number | null;
  carName?: string | null;
  notes?: string | null;
  capturedAt: number;
}

export interface Lap {
  id: Id;
  sessionId: Id;
  /** Game lap number (lapCount value during this lap). */
  number: number;
  /** Lap time in ms (calibrated with the game's lastLapMs when available). */
  timeMs: number;
  /** Sector times in ms, one per sector of the track (null for sectors with missing data). */
  sectorTimesMs: (number | null)[];
  valid: boolean;
  flags: LapFlag[];
  isReference: boolean;
  referenceMeta: ReferenceMeta | null;
  /** Epoch ms when the lap started. */
  startedAt: number;
  carCode: number;
  trackId: Id | null;
  /** Fuel used in liters, null if unknown/unreliable. */
  fuelUsedL: number | null;
  /** Number of telemetry samples stored for the lap. */
  sampleCount: number;
  /** Packets missing inside the lap (packetId gaps). */
  lostPackets: number;
  /** Path of the lap trace file relative to the data dir. */
  traceFile: string | null;
}

/**
 * One per-packet sample of a lap, already enriched with derived values. Stored column-wise as a
 * {@link LapTrace}; this row type is the canonical channel list.
 */
export interface LapSample {
  /** ms since lap start. */
  tMs: number;
  /** Distance along the lap in meters (aligned to the track centerline when available). */
  distanceM: number;
  packetId: number;
  x: number;
  y: number;
  z: number;
  speedKmh: number;
  rpm: number;
  gear: number;
  /** 0–1 (after aids). */
  throttle: number;
  /** 0–1. */
  brake: number;
  /** 0–1. */
  clutch: number;
  /** Steering wheel angle in rad (B+ formats), NaN when unavailable. */
  steeringRad: number;
  /** Raw throttle 0–1 (~ format), NaN when unavailable. */
  throttleRaw: number;
  /** Yaw rate rad/s. */
  yawRate: number;
  /** Lateral acceleration in g (+ = left). */
  latG: number;
  /** Longitudinal acceleration in g (+ = accelerating). */
  lonG: number;
  /** Vertical acceleration in g, NaN when unavailable. */
  vertG: number;
  slipFL: number;
  slipFR: number;
  slipRL: number;
  slipRR: number;
  tyreTempFL: number;
  tyreTempFR: number;
  tyreTempRL: number;
  tyreTempRR: number;
  suspFL: number;
  suspFR: number;
  suspRL: number;
  suspRR: number;
  fuelL: number;
  /** Raw simulator flags bitfield. */
  flags: number;
}

export type LapSampleChannel = keyof LapSample;

/** Column-oriented lap samples (one array per channel, all the same length). */
export interface LapTrace {
  lapId: Id;
  /** Nominal sample rate (60 for live captures). */
  sampleRateHz: number;
  length: number;
  channels: { [K in LapSampleChannel]: Float64Array | number[] };
}
