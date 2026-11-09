/**
 * LiveEngine: turns decoded telemetry packets into live dashboard frames and closed laps.
 *
 * Deterministic and IO-free: everything is driven by `push(packet, receivedAtMs)`; persistence and
 * track lookup go through a synchronous {@link LiveEngineContext}.
 *
 * - Session/connection state from the simulator flags (+ replay mode set by the capture mode).
 * - Lap detection on lapCount changes (+1 closes a lap; decreases/jumps = restart → discard).
 * - Lap timing by packet count (packetId deltas, so dropped packets still count time; paused
 *   packets don't), calibrated with the game's lastLapMs when the lap closes. The C format's
 *   current lap time is used directly when present.
 * - Distance along the lap: speed integration refined by projection onto the track centerline
 *   (windowed nearest-point search) so the delta does not drift.
 * - Sectors (track gates, default 3 equal), live delta vs a selectable reference, delta rate,
 *   predicted lap, fuel per lap, slip, g-forces, next-corner hints.
 *
 * Replay (Onda 9a): the real console plays a replay with car data but `carOnTrack` false, no lap
 * clock and a lapCount that does not advance. A packet with a car (carCode != 0), not on track, not
 * paused/loading, moving (> 2 m/s) with the position changing is a "replay playing": connection
 * state 'replay', no session, no track time, nothing written to the driver's laps. The live frames
 * keep flowing; `'packet'` carries every packet to the reference capture (see capture/).
 *
 * Session policy (automatic capture, no "start" button):
 * - A session opens by itself at the first packet with the car on a track and not paused.
 * - It stays open through pauses, menus, garage, restarts and short silences (same car, same
 *   track): it only ends after `sessionIdleEndMs` (10 min) of the car being out of the track /
 *   paused / silent, or at once on a car change, a track change (found by the lap geometry),
 *   a replay-mode switch or `endSession()`. `tick(now)` closes it when the console goes quiet.
 * - The lap in progress when the session opens (the app was opened mid-lap) is never stored: only
 *   laps timed from the start line are, so it cannot touch best lap, averages or consistency.
 * - With persistence off (`setPersistence(false)`) the session lives in memory only.
 */

import { EventEmitter } from 'node:events';
import {
  type ConnectionState,
  type DeltaReferenceKind,
  decodeFlags,
  type EngineerCue,
  type Id,
  type IngestorState,
  type IngestorStats,
  type Lap,
  type LapCompletedEvent,
  type LapFlag,
  type LapTrace,
  type LiveEngineerFrame,
  type LiveFrame,
  type LiveGForce,
  type LiveTrackInfo,
  type NextCornerHint,
  pedalToUnit,
  type SectorSplit,
  type SectorStatus,
  type Session,
  suggestedGearOf,
  type TelemetryPacket,
  type Track,
  wheelSlipRatios,
} from '@gt7/shared';
import { TraceBuilder } from '../trace/channels.ts';
import { centerlinePolyline, lapPolyline } from '../track/fingerprint.ts';
import { newId } from '../util/ids.ts';
import { clamp, emaAlpha } from '../util/math.ts';
import { alignToLine, cumulativeDistance, type Polyline } from '../util/polyline.ts';
import {
  EphemeralContext,
  type LiveEngineContext,
  MemoryEngineContext,
  type TrackRecords,
} from './context.ts';
import {
  type CornerHintProvider,
  type CornerHintTargets,
  type EngineerMark,
  TraceCornerHintProvider,
} from './corner-hints.ts';
import { DeltaReference, type StoredLap } from './delta-reference.ts';
import { GForceEstimator, headingOf } from './gforce.ts';

export const NOMINAL_MS_PER_PACKET = 1000 / 60;
/** packetId gaps larger than this are a stream reset (matches the ingestor). */
const RESET_GAP = 600;
/** A packet up to this early (ms) still counts as due for the next throttled frame (jitter). */
const FRAME_DUE_TOLERANCE_MS = 1;
/** Out of the track at least this long (loading, menu): the next lap start re-checks the track. */
const TRACK_RECHECK_GAP_MS = 2000;
/** Silence at least this long also makes the next lap re-check the track. */
const TRACK_RECHECK_SILENCE_MS = 5000;
/** A single step of the "time on track" clock never counts more than this. */
const MAX_TRACK_TIME_STEP_MS = 1000;
/** Flags that make a lap invalid. */
const INVALIDATING: readonly LapFlag[] = ['paused', 'incompleteData', 'discontinuity', 'offTrack'];

/** A "moving" car (m/s) whose position does not change for this long is a frozen stream. */
const FROZEN_MIN_SPEED_MPS = 2;
const FROZEN_MIN_MS = 1000;
/** A frozen stream this long means the driver left the track: the session is closed. */
const FROZEN_END_MS = 30_000;

/** Replay detection: a car faster than this (m/s) with a changing position is "playing". */
const REPLAY_MIN_SPEED_MPS = 2;
/** Identical positions for this many packets while "moving" = the replay is stalled (paused). */
const REPLAY_STALL_PACKETS = 4;
/** A stalled/slow replay still counts as a replay for this long after it last played (ms). */
const REPLAY_GRACE_MS = 3000;

/** What the replay detector made of a packet. */
export type ReplayKind = 'playing' | 'stalled' | 'none';

/** Every packet the engine processed, for consumers that follow the raw stream (reference capture). */
export interface EnginePacketInfo {
  packet: TelemetryPacket;
  receivedAt: number;
  /** Packets since the previous one (packetId delta, 1 for the first). */
  dPk: number;
  /** ms since the previous packet was received (0 for the first). */
  recvGap: number;
  /** The packetId counter restarted (or jumped far): the stream is not continuous with the last. */
  streamReset: boolean;
  /** Car data is present and the car is NOT on a track (replay screen candidate; see ReplayKind). */
  carData: boolean;
  replay: ReplayKind;
  /** The previous packet had exactly the same position. */
  samePosition: boolean;
  msPerPacket: number;
  g: LiveGForce;
}

export interface LiveEngineOptions {
  context?: LiveEngineContext;
  /** Frame emission rate (default 30 Hz). */
  frameRateHz?: number;
  idFactory?: () => Id;
  deltaReference?: DeltaReferenceKind;
  deltaReferenceLapId?: Id | null;
  cornerHints?: CornerHintProvider;
  /** A single packetId gap larger than this flags the lap `incompleteData` (default 15 = 250 ms). */
  maxGapPackets?: number;
  /** Lost packet ratio above this flags the lap `incompleteData` (default 0.02). */
  maxLossRatio?: number;
  /**
   * Out of the track (menu, garage, loading), paused or without packets for this long ends the
   * session (default 10 min). Shorter breaks (restart, back to the pits, Wi-Fi blip) keep it.
   */
  sessionIdleEndMs?: number;
  /** Packets to wait for the game's lastLapMs after a lap change (default 60). */
  lapCloseWaitPackets?: number;
  /** Projection: max distance from the centerline to accept (default 25 m). */
  maxLateralM?: number;
  /** Laps used for the fuel-per-lap average (default 3). */
  fuelAvgLaps?: number;
  /**
   * Max samples kept for a single lap (default 108 000 = 30 min at 60 Hz). A car left idling on
   * the track never closes its lap: past the cap the lap stops recording and is flagged
   * `incompleteData`, so memory stays bounded.
   */
  maxLapSamples?: number;
}

/** Everything about a closed lap (what the store persists and the UI pop-up shows). */
export interface CompletedLap {
  event: LapCompletedEvent;
  lap: Lap;
  trace: LapTrace;
  /** Lap time from packet counting only (before calibration with lastLapMs). */
  countedTimeMs: number;
  /** Lap time reported by the game (lastLapMs), null if not available. */
  gameTimeMs: number | null;
  lengthM: number;
  track: Track | null;
  session: Session;
}

export interface LapStartedInfo {
  sessionId: Id;
  lapNumber: number;
  at: number;
  packetId: number;
}

export interface LapDiscardedInfo {
  sessionId: Id | null;
  lapNumber: number;
  reason: 'outLap' | 'partial' | 'restart' | 'leftTrack' | 'sessionEnd' | 'streamReset';
}

/** Why a session was closed. */
export type SessionEndReason =
  /** `endSession()` (shutdown, tools). */
  | 'manual'
  /** No packets for `sessionIdleEndMs` (PS5 in rest mode, game closed, Wi-Fi down). */
  | 'silence'
  /** Out of the track or paused for `sessionIdleEndMs`. */
  | 'offTrack'
  | 'carChange'
  /** The next laps are on another track. */
  | 'trackChange'
  /** Replay mode or the "save sessions" switch changed. */
  | 'mode';

export interface SessionEndInfo {
  reason: SessionEndReason;
  /** The session was written to the store (false for the live-only mode). */
  persisted: boolean;
}

/** Snapshot of what the engine is doing, for the capture status shown in the UI. */
export interface EngineCaptureInfo {
  session: Session | null;
  /** The open session (or the next one) is written to the store. */
  persisting: boolean;
  /** Time actually driven in the open session (pauses and time off track excluded). */
  trackTimeMs: number;
  /** Last packet: car on a track (not loading). */
  onTrack: boolean;
  paused: boolean;
  replay: boolean;
}

export interface LiveEngineEvents {
  frame: [LiveFrame];
  lapStarted: [LapStartedInfo];
  lapCompleted: [CompletedLap];
  lapDiscarded: [LapDiscardedInfo];
  sessionStarted: [Session];
  sessionUpdated: [Session];
  sessionEnded: [Session, SessionEndInfo];
  trackChanged: [LiveTrackInfo | null];
  stateChanged: [ConnectionState, ConnectionState];
  /** Every accepted packet (only built while someone listens). */
  packet: [EnginePacketInfo];
}

interface LapState {
  number: number;
  timed: boolean;
  startPacketId: number;
  startedAt: number;
  /** Running packets (paused excluded, lost included). */
  counted: number;
  elapsedMs: number;
  useGameClock: boolean;
  dist: number;
  misses: number;
  projectionOffsetM?: number;
  reacquire: boolean;
  builder: TraceBuilder;
  flags: Set<LapFlag>;
  lost: number;
  maxGap: number;
  fuelStart: number;
  fuelEnd: number;
  carCode: number;
  sectorCross: number[];
  sectors: SectorSplit[];
  offTrackRun: number;
  lastX: number;
  lastZ: number;
}

interface PendingClose {
  lap: LapState;
  countedMs: number;
  prevGameLast: number;
  waited: number;
}

interface CornerPass {
  entryDelta: number | null;
  lastPassDeltaMs: number | null;
}

export function sectorBoundaries(track: Track | null): number[] | null {
  if (!track) return null;
  const gates = [...track.sectorGates].sort((a, b) => a.distanceM - b.distanceM);
  if (gates.length === 0) return [track.lengthM / 3, (2 * track.lengthM) / 3];
  return gates.filter((g) => g.distanceM > 1).map((g) => g.distanceM);
}

/** Sector times from a trace (distance/time columns), last sector closes at lapTimeMs. */
export function computeSectorTimes(
  dist: ArrayLike<number>,
  time: ArrayLike<number>,
  boundaries: readonly number[],
  lapTimeMs: number,
): (number | null)[] {
  const crosses: (number | null)[] = [];
  let i = 1;
  for (const b of boundaries) {
    let found: number | null = null;
    for (; i < dist.length; i++) {
      const d0 = dist[i - 1]!;
      const d1 = dist[i]!;
      if (d1 >= b && d0 < b) {
        const u = d1 > d0 ? (b - d0) / (d1 - d0) : 0;
        found = time[i - 1]! + (time[i]! - time[i - 1]!) * u;
        break;
      }
    }
    crosses.push(found);
  }
  const out: (number | null)[] = [];
  let prev: number | null = 0;
  for (const c of crosses) {
    out.push(c !== null && prev !== null ? Math.round(c - prev) : null);
    prev = c;
  }
  out.push(prev !== null ? Math.round(lapTimeMs - prev) : null);
  // make the sum exact (rounding)
  if (out.every((v) => v !== null)) {
    const sum = (out as number[]).reduce((s, v) => s + v, 0);
    out[out.length - 1] = (out[out.length - 1] as number) + (lapTimeMs - sum);
  }
  return out;
}

export class LiveEngine extends EventEmitter<LiveEngineEvents> {
  readonly context: LiveEngineContext;
  readonly options: Required<
    Omit<LiveEngineOptions, 'context' | 'deltaReferenceLapId' | 'idFactory' | 'cornerHints'>
  >;
  readonly #newId: () => Id;
  readonly #hints: CornerHintProvider;

  /** Context of the open session (a throw-away overlay while sessions are not being saved). */
  get #ctx(): LiveEngineContext {
    if (this.#session && this.#ephemeral) {
      this.#eph ??= new EphemeralContext(this.context, { idFactory: this.#newId });
      return this.#eph;
    }
    return this.context;
  }

  #seq = 0;
  /** Due time (receivedAt ms) of the next throttled frame (accumulator: += interval). */
  #nextFrameT = Number.NEGATIVE_INFINITY;
  #lastFrame: LiveFrame | null = null;
  #lastPacket: TelemetryPacket | null = null;
  #lastPacketId: number | null = null;
  #lastReceivedAt: number | null = null;
  #received = 0;
  #ingestorState: IngestorState | null = null;
  #link: LiveFrame['link'] | null = null;
  #replayMode = false;
  #state: ConnectionState = 'disconnected';
  /** Consecutive packets with an unchanged position while the car claims to move. */
  #frozenPk = 0;
  /** Epoch ms since the stream is frozen (null while it is not). */
  #frozenSince: number | null = null;
  /** Since when the car is out of the track or paused (null while it is driving). */
  #inactiveSince: number | null = null;
  /** Since when the car is out of the track (null while on it; pauses do not count). */
  #offTrackSince: number | null = null;
  /** Epoch ms of the last packet that had the car on a track (open session only). */
  #lastActiveAt: number | null = null;
  #onTrackNow = false;
  #pausedNow = false;
  #replayKind: ReplayKind = 'none';
  /** Consecutive packets with the very same position (any state). */
  #samePosPk = 0;
  /** Epoch ms of the last 'playing' replay packet. */
  #replayPlayingAt: number | null = null;
  /** receivedAt of the previous running packet, for the "time on track" clock. */
  #runningSince: number | null = null;
  #trackTimeMs = 0;
  /** The car came back after a break: the next lap must prove it is still the same track. */
  #needTrackCheck = false;
  #lastLapDoneAt: number | null = null;
  /** Last on-track packet before the break that raised `#needTrackCheck`. */
  #activeBeforeBreak: number | null = null;
  #persist = true;
  /** The open session is not written to the store. */
  #ephemeral = false;
  #eph: EphemeralContext | null = null;
  #msPerPacket = NOMINAL_MS_PER_PACKET;
  #calGameMs = 0;
  #calPackets = 0;
  #gforce = new GForceEstimator();
  #g: LiveGForce = { lateral: 0, longitudinal: 0, vertical: null };

  // session
  #session: Session | null = null;
  #lastLapCount: number | null = null;
  #lap: LapState | null = null;
  #pending: PendingClose | null = null;
  #sessionBestRef: DeltaReference | null = null;
  #sessionBestLapMs: number | null = null;
  #sessionBestSectors: (number | null)[] = [];
  #lastLapMs: number | null = null;
  #fuelHistory: number[] = [];

  // track
  #track: Track | null = null;
  #trackConfidence: LiveTrackInfo['confidence'] = 'unknown';
  #line: Polyline | null = null;
  #refLine: Polyline | null = null;
  #records: TrackRecords | null = null;
  #hintCache = new Map<string, CornerHintTargets | null>();
  #engineerLapStart: number | null = null;
  #engineerTrackId: Id | null = null;
  #engineerPlan: {
    id: Id;
    timeMs: number;
    marks: Pick<EngineerMark, 'kind' | 'atM' | 'untilM'>[];
  } | null = null;
  #cornerPass = new Map<string, CornerPass>();

  // delta
  #deltaKind: DeltaReferenceKind;
  #deltaLapId: Id | null;
  #deltaRef: DeltaReference | null = null;
  #deltaMs: number | null = null;
  #deltaRate: number | null = null;
  #reloading = false;

  constructor(opts: LiveEngineOptions = {}) {
    super();
    this.context = opts.context ?? new MemoryEngineContext();
    this.options = {
      frameRateHz: opts.frameRateHz ?? 30,
      deltaReference: opts.deltaReference ?? 'personalBest',
      maxGapPackets: opts.maxGapPackets ?? 15,
      maxLossRatio: opts.maxLossRatio ?? 0.02,
      sessionIdleEndMs: opts.sessionIdleEndMs ?? 600_000,
      lapCloseWaitPackets: opts.lapCloseWaitPackets ?? 60,
      maxLateralM: opts.maxLateralM ?? 25,
      fuelAvgLaps: opts.fuelAvgLaps ?? 3,
      maxLapSamples: opts.maxLapSamples ?? 108_000,
    };
    this.#newId = opts.idFactory ?? (() => newId());
    this.#hints = opts.cornerHints ?? new TraceCornerHintProvider();
    this.#deltaKind = this.options.deltaReference;
    this.#deltaLapId = opts.deltaReferenceLapId ?? null;
  }

  // ---------------------------------------------------------------------------------------------
  // Public getters / setters
  // ---------------------------------------------------------------------------------------------

  /** Composite connection state (ingestor link + packet flags). */
  get state(): ConnectionState {
    return this.#composeState();
  }

  get session(): Session | null {
    return this.#session ? { ...this.#session } : null;
  }

  get track(): Track | null {
    return this.#track;
  }

  get trackInfo(): LiveTrackInfo | null {
    if (!this.#track) return null;
    return {
      id: this.#track.id,
      name: this.#track.name,
      lengthM: this.#track.lengthM,
      confidence: this.#trackConfidence,
    };
  }

  get replayMode(): boolean {
    return this.#replayMode;
  }

  get deltaReference(): { kind: DeltaReferenceKind; lapId: Id | null; activeLapId: Id | null } {
    return {
      kind: this.#deltaKind,
      lapId: this.#deltaLapId,
      activeLapId: this.#deltaRef?.lapId ?? null,
    };
  }

  /** Current calibrated ms per packet (≈ 16.667). */
  get msPerPacket(): number {
    return this.#msPerPacket;
  }

  /** Latest frame (built on demand if none was emitted yet), null before the first packet. */
  get lastFrame(): LiveFrame | null {
    if (!this.#lastPacket) return null;
    return (
      this.#lastFrame ?? this.#buildFrame(this.#lastPacket, this.#lastReceivedAt ?? Date.now())
    );
  }

  /** Builds a fresh frame from the last packet (for on-demand queries like get_live_state). */
  snapshot(now = this.#lastReceivedAt ?? Date.now()): LiveFrame | null {
    return this.#lastPacket ? this.#buildFrame(this.#lastPacket, now) : null;
  }

  /** Link state from the ingestor; non-connected states override the packet-derived state. */
  setIngestorState(s: IngestorState): void {
    const before = this.#composeState();
    this.#ingestorState = s;
    this.#emitStateIfChanged(before);
  }

  setLinkStats(
    stats: Pick<IngestorStats, 'rateHz' | 'lossPct' | 'lost' | 'received' | 'lastPacketAt'>,
  ): void {
    this.#link = {
      rateHz: stats.rateHz,
      lossPct: stats.lossPct,
      lost: stats.lost,
      received: stats.received,
      lastPacketAt: stats.lastPacketAt,
    };
  }

  /** The open session (or, without one, the next) is written to the store. */
  get persisting(): boolean {
    return this.#session ? !this.#ephemeral : this.#persist || this.#replayMode;
  }

  /** What the capture is doing right now (for the status shown in the UI). */
  get captureInfo(): EngineCaptureInfo {
    return {
      session: this.session,
      persisting: this.persisting,
      trackTimeMs: Math.round(this.#trackTimeMs),
      onTrack: this.#onTrackNow,
      paused: this.#pausedNow,
      replay: this.#replayMode || this.#replayKind !== 'none',
    };
  }

  /** A replay is playing (detected from the packets), or the legacy replay mode is on. */
  get replayDetected(): boolean {
    return this.#replayKind !== 'none';
  }

  /** Replay (reference capture) mode. Changing it ends the current session. */
  setReplayMode(on: boolean): void {
    if (on === this.#replayMode) return;
    const before = this.#composeState();
    this.endSession('mode');
    this.#replayMode = on;
    this.#emitStateIfChanged(before);
  }

  /**
   * Turns saving on/off. Off = live view only: sessions, laps and tracks learned from now on live
   * in memory and nothing is written (reference captures, which the user starts explicitly, are
   * still saved). Changing it ends the open session.
   */
  setPersistence(on: boolean): void {
    if (on === this.#persist) return;
    this.#persist = on;
    if (this.#session && !this.#replayMode) this.endSession('mode');
  }

  /**
   * Time-based checks that need no packet: closes the session when the console has been silent, or
   * the car out of the track / paused, for `sessionIdleEndMs`. Call it every few seconds.
   */
  tick(nowMs: number): void {
    const s = this.#session;
    if (!s) return;
    const idle = this.options.sessionIdleEndMs;
    if (this.#lastReceivedAt !== null && nowMs - this.#lastReceivedAt > idle) {
      this.endSession('silence', this.#lastReceivedAt);
    } else if (this.#inactiveSince !== null && nowMs - this.#inactiveSince > idle) {
      this.endSession('offTrack', this.#lastActiveAt ?? this.#inactiveSince);
    }
  }

  /** Selects the delta reference. `lapId` picks a specific lap for 'reference'. */
  setDeltaReference(kind: DeltaReferenceKind, lapId?: Id | null): void {
    this.#deltaKind = kind;
    this.#deltaLapId = kind === 'reference' ? (lapId ?? null) : null;
    this.#reloadReference();
  }

  /** Patches the active session (e.g. recordingFile) and persists it. */
  annotateSession(patch: Partial<Pick<Session, 'recordingFile' | 'notes'>>): void {
    if (!this.#session) return;
    Object.assign(this.#session, patch);
    this.#ctx.saveSession({ ...this.#session });
    this.emit('sessionUpdated', { ...this.#session });
  }

  /**
   * Re-reads the delta reference when it is a "best reference of the track" (a reference lap was
   * just saved by the capture). Other kinds are left alone so the lap in progress is not touched.
   */
  refreshReference(): void {
    if (this.#deltaKind === 'reference' && !this.#deltaLapId) this.#reloadReference();
  }

  /** Re-reads the active track from the context (after renames, corner/sector edits). */
  refreshTrack(): void {
    if (!this.#track) return;
    const t = this.#ctx.getTrack(this.#track.id);
    if (!t) return;
    this.#track = t;
    this.#hintCache.clear();
    this.#refreshRecords();
    this.emit('trackChanged', this.trackInfo);
  }

  /**
   * Ends the active session (discarding an unfinished lap). `endedAt` defaults to the last
   * packet time.
   */
  endSession(reason: SessionEndReason = 'manual', endedAt?: number): void {
    if (this.#pending) this.#finalize(this.#pending, null);
    const s = this.#session;
    if (!s) return;
    if (this.#lap?.timed) {
      this.emit('lapDiscarded', {
        sessionId: s.id,
        lapNumber: this.#lap.number,
        reason: 'sessionEnd',
      });
    }
    this.#lap = null;
    this.#lastLapCount = null;
    this.#finishSession(reason, endedAt);
    this.#clearActiveTrack();
  }

  /** Closes the open session record and resets everything scoped to it (not the lap or track). */
  #finishSession(reason: SessionEndReason, endedAt?: number): void {
    const s = this.#session;
    if (!s) return;
    s.endedAt = Math.max(s.startedAt, endedAt ?? this.#lastReceivedAt ?? Date.now());
    s.trackTimeMs = Math.round(this.#trackTimeMs);
    const persisted = !this.#ephemeral;
    this.#ctx.saveSession({ ...s });
    this.#session = null;
    this.#ephemeral = false;
    this.#sessionBestRef = null;
    this.#sessionBestLapMs = null;
    this.#sessionBestSectors = [];
    this.#lastLapMs = null;
    this.#fuelHistory = [];
    this.#cornerPass.clear();
    this.#trackTimeMs = 0;
    this.#runningSince = null;
    this.#lastLapDoneAt = null;
    this.emit('sessionEnded', { ...s }, { reason, persisted });
  }

  /**
   * True while the packets claim a moving car (> FROZEN_MIN_SPEED_MPS) whose position has not
   * changed for FROZEN_MIN_MS. Counts packets (dPk), so dropped packets still advance the clock.
   */
  #updateFrozen(p: TelemetryPacket, onTrack: boolean, dPk: number, receivedAtMs: number): boolean {
    const prev = this.#lastPacket;
    const same =
      prev !== null &&
      onTrack &&
      p.speedMps > FROZEN_MIN_SPEED_MPS &&
      p.position.x === prev.position.x &&
      p.position.y === prev.position.y &&
      p.position.z === prev.position.z;
    if (!same) {
      this.#frozenPk = 0;
      this.#frozenSince = null;
      return false;
    }
    this.#frozenPk += dPk;
    if (this.#frozenPk * this.#msPerPacket < FROZEN_MIN_MS) return false;
    this.#frozenSince ??= receivedAtMs - this.#frozenPk * this.#msPerPacket;
    return true;
  }

  /**
   * Replay detector (see the class doc). `carData`: there is a car (carCode != 0, a real position)
   * and the game does not say it is on a track, paused or loading. 'playing' needs speed and a
   * position that changes; a replay that stalls (pause, rewind) stays 'stalled' for a few seconds
   * so the state does not flicker, and falls back to the menu after that.
   */
  #classifyReplay(
    p: TelemetryPacket,
    carData: boolean,
    dPk: number,
    receivedAtMs: number,
  ): { kind: ReplayKind; same: boolean } {
    const prev = this.#lastPacket;
    const same =
      prev !== null &&
      p.position.x === prev.position.x &&
      p.position.y === prev.position.y &&
      p.position.z === prev.position.z;
    this.#samePosPk = same ? this.#samePosPk + dPk : 0;
    if (!carData) {
      this.#replayPlayingAt = null;
      return { kind: 'none', same };
    }
    if (p.speedMps > REPLAY_MIN_SPEED_MPS && this.#samePosPk < REPLAY_STALL_PACKETS) {
      this.#replayPlayingAt = receivedAtMs;
      return { kind: 'playing', same };
    }
    if (this.#replayPlayingAt !== null && receivedAtMs - this.#replayPlayingAt <= REPLAY_GRACE_MS) {
      return { kind: 'stalled', same };
    }
    return { kind: 'none', same };
  }

  /** Forgets the active track (not on a known one any more); no-op without one. */
  #clearActiveTrack(): void {
    if (this.#track) {
      this.#track = null;
      this.#trackConfidence = 'unknown';
      this.#line = null;
      this.#records = null;
      this.#hintCache.clear();
      this.emit('trackChanged', null);
    }
    this.#reloadReference();
  }

  // ---------------------------------------------------------------------------------------------
  // Packet processing
  // ---------------------------------------------------------------------------------------------

  /** Feeds one decoded packet. `receivedAtMs` is the epoch ms of reception. */
  push(p: TelemetryPacket, receivedAtMs: number): void {
    const stateBefore = this.#composeState();
    let dPk = 1;
    let streamReset = false;
    if (this.#lastPacketId !== null) {
      const diff = p.packetId - this.#lastPacketId;
      if (diff <= 0 && diff > -RESET_GAP) return; // duplicate / out of order
      if (diff > RESET_GAP || diff <= -RESET_GAP) streamReset = true;
      else dPk = diff;
    }
    const prevReceivedAt = this.#lastReceivedAt;
    const recvGap = prevReceivedAt === null ? 0 : receivedAtMs - prevReceivedAt;
    const idleEnd = this.options.sessionIdleEndMs;
    // the console was silent for too long (PS5 in rest mode, game closed, Wi-Fi down)
    if (this.#session && prevReceivedAt !== null && recvGap > idleEnd) {
      this.endSession('silence', prevReceivedAt);
    }
    this.#lastPacketId = p.packetId;
    this.#lastReceivedAt = receivedAtMs;
    this.#received++;

    const f = decodeFlags(p.flags);
    const onTrack = f.carOnTrack && !f.loadingOrProcessing;
    // Frozen stream: observed on a real PS5 (Sport Mode time trial) after leaving the track to a
    // menu/replay screen — the flags still say "car on track" and the lap clock keeps counting, but
    // every car value is identical. A moving car cannot keep the exact same position, so this is
    // treated like a pause (no track time, the lap is invalid) and ends the session after a while.
    // (When the game itself says "paused" its data is frozen too; that keeps the normal pause rules.)
    const frozen = this.#updateFrozen(p, onTrack && !f.paused, dPk, receivedAtMs);
    const paused = f.paused || frozen;
    const carData =
      !f.carOnTrack &&
      !f.loadingOrProcessing &&
      !f.paused &&
      p.carCode !== 0 &&
      (p.position.x !== 0 || p.position.y !== 0 || p.position.z !== 0);
    const replay = this.#classifyReplay(p, carData, dPk, receivedAtMs);
    this.#replayKind = replay.kind;
    this.#onTrackNow = onTrack;
    this.#pausedNow = paused;
    this.#state = !onTrack
      ? replay.kind !== 'none'
        ? 'replay'
        : 'menu'
      : paused
        ? 'paused'
        : this.#replayMode
          ? 'replay'
          : 'onTrack';

    // out of the track / paused for too long (checked before the clocks below are reset)
    if (
      this.#session &&
      this.#inactiveSince !== null &&
      receivedAtMs - this.#inactiveSince > idleEnd
    ) {
      this.endSession('offTrack', this.#lastActiveAt ?? this.#inactiveSince);
    }
    // a frozen stream is not a real pause: the driver left the track, so close the session sooner
    if (
      this.#session &&
      this.#frozenSince !== null &&
      receivedAtMs - this.#frozenSince > FROZEN_END_MS
    ) {
      this.endSession('offTrack', this.#lastActiveAt ?? this.#frozenSince);
    }
    // a break (loading screen, back to the garage, silence, stream reset) means the track may have
    // changed: the next lap start has to confirm it
    const offFor = this.#offTrackSince === null ? 0 : receivedAtMs - this.#offTrackSince;
    if (
      onTrack &&
      (offFor >= TRACK_RECHECK_GAP_MS || recvGap >= TRACK_RECHECK_SILENCE_MS || streamReset)
    ) {
      if (!this.#needTrackCheck) this.#activeBeforeBreak = this.#lastActiveAt;
      this.#needTrackCheck = true;
    }
    this.#offTrackSince = onTrack ? null : (this.#offTrackSince ?? receivedAtMs);
    const running = onTrack && !paused;
    this.#inactiveSince = running ? null : (this.#inactiveSince ?? receivedAtMs);

    if (this.#session && running && p.carCode !== this.#session.carCode) {
      this.endSession('carChange', this.#lastActiveAt ?? undefined);
    }
    if (!this.#session && running) this.#startSession(p, receivedAtMs);
    if (this.#session) {
      if (onTrack) this.#lastActiveAt = receivedAtMs;
      // "time on track" clock: only consecutive running packets count
      if (running) {
        if (this.#runningSince !== null) {
          this.#trackTimeMs += clamp(receivedAtMs - this.#runningSince, 0, MAX_TRACK_TIME_STEP_MS);
        }
        this.#runningSince = receivedAtMs;
      } else {
        this.#runningSince = null;
      }
    }

    if (streamReset) this.#gforce.reset();
    this.#g = this.#gforce.update(p, (dPk * this.#msPerPacket) / 1000);

    if (this.#pending) this.#tryFinalize(p);
    if (this.#session && replay.kind !== 'none') {
      // watching a replay: the driver's lap in progress (if any) is over and nothing of the replay
      // reaches the driver's laps; the next on-track packet starts a fresh lap
      if (this.#lap?.timed) this.#discard(this.#lap, 'leftTrack');
      this.#lap = null;
      this.#lastLapCount = null;
    } else if (this.#session) {
      this.#handleLap(p, receivedAtMs, dPk, streamReset, onTrack, paused, recvGap);
    }

    if (this.listenerCount('packet') > 0) {
      this.emit('packet', {
        packet: p,
        receivedAt: receivedAtMs,
        dPk,
        recvGap,
        streamReset,
        carData,
        replay: replay.kind,
        samePosition: replay.same,
        msPerPacket: this.#msPerPacket,
        g: { ...this.#g },
      });
    }

    this.#lastPacket = p;
    const changed = this.#composeState() !== stateBefore;
    if (changed) this.emit('stateChanged', this.#composeState(), stateBefore);
    const interval = 1000 / this.options.frameRateHz;
    // Accumulator throttle: the due time advances by exactly one interval per emitted frame, so
    // 60 Hz packets with integer-ms jitter yield 30 fps on average (a "now - last >= interval"
    // test skips 2 or 3 packets and averages ~21 fps). Far behind (gap, pause) → resync.
    const due =
      receivedAtMs >= this.#nextFrameT - FRAME_DUE_TOLERANCE_MS ||
      this.#nextFrameT - receivedAtMs > 4 * interval; // clock went backwards
    if (changed || due) {
      if (due) {
        this.#nextFrameT += interval;
        const lag = receivedAtMs - this.#nextFrameT;
        if (!Number.isFinite(lag) || lag >= interval || lag < -2 * interval) {
          this.#nextFrameT = receivedAtMs + interval;
        }
      }
      const frame = this.#buildFrame(p, receivedAtMs);
      this.#lastFrame = frame;
      this.emit('frame', frame);
    } else {
      this.#lastFrame = null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Internals: state
  // ---------------------------------------------------------------------------------------------

  #composeState(): ConnectionState {
    switch (this.#ingestorState) {
      case 'stopped':
      case 'timeout':
        return 'disconnected';
      case 'connecting':
        return 'connecting';
      case 'switchingFormat':
        return 'switchingFormat';
      default:
        return this.#lastPacket || this.#received ? this.#state : 'disconnected';
    }
  }

  #emitStateIfChanged(before: ConnectionState): void {
    const now = this.#composeState();
    if (now !== before) this.emit('stateChanged', now, before);
  }

  /** Opens a session (and the lap bookkeeping) at a packet with the car running on a track. */
  #startSession(p: TelemetryPacket, at: number): void {
    this.#lastLapCount = null;
    this.#lap = null;
    this.#needTrackCheck = false;
    this.#openSession(p.carCode, p.format, at);
  }

  #openSession(carCode: number, format: Session['format'], at: number): void {
    const s: Session = {
      id: this.#newId(),
      trackId: null,
      carCode,
      startedAt: at,
      endedAt: null,
      format,
      mode: this.#replayMode ? 'replayCapture' : 'live',
      lapCount: 0,
      bestLapMs: null,
      recordingFile: null,
      notes: null,
      trackTimeMs: 0,
    };
    this.#ephemeral = !this.#persist && !this.#replayMode;
    this.#session = s;
    this.#trackTimeMs = 0;
    this.#runningSince = null;
    this.#lastLapDoneAt = null;
    this.#lastActiveAt = at;
    this.#ctx.saveSession({ ...s });
    this.emit('sessionStarted', { ...s });
    this.#reloadReference();
  }

  /**
   * Closes the open session and opens a new one for the same car, keeping the lap in progress and
   * the active track (used when the laps being driven belong to another track).
   */
  #switchSession(reason: SessionEndReason, at: number, endedAt: number): void {
    const cur = this.#session;
    if (!cur) return;
    if (this.#pending) this.#finalize(this.#pending, null);
    const { carCode, format } = cur;
    this.#finishSession(reason, endedAt);
    this.#openSession(carCode, format, at);
  }

  // ---------------------------------------------------------------------------------------------
  // Internals: laps
  // ---------------------------------------------------------------------------------------------

  #newLap(p: TelemetryPacket, at: number, timed: boolean): LapState {
    return {
      number: p.lapCount,
      timed,
      startPacketId: p.packetId,
      startedAt: at,
      counted: 0,
      elapsedMs: timed && p.currentLapMs !== undefined ? p.currentLapMs : 0,
      useGameClock: p.currentLapMs !== undefined,
      dist: 0,
      misses: 0,
      reacquire: !timed,
      builder: new TraceBuilder(timed ? 6000 : 256),
      flags: new Set(),
      lost: 0,
      maxGap: 0,
      fuelStart: p.fuelLevel,
      fuelEnd: p.fuelLevel,
      carCode: p.carCode,
      sectorCross: [],
      sectors: [],
      offTrackRun: 0,
      lastX: p.position.x,
      lastZ: p.position.z,
    };
  }

  #discard(lap: LapState, reason: LapDiscardedInfo['reason']): void {
    if (lap.timed || reason === 'restart') {
      this.emit('lapDiscarded', {
        sessionId: this.#session?.id ?? null,
        lapNumber: lap.number,
        reason,
      });
    }
  }

  #handleLap(
    p: TelemetryPacket,
    at: number,
    dPk: number,
    streamReset: boolean,
    onTrack: boolean,
    paused: boolean,
    recvGap: number,
  ): void {
    const lc = p.lapCount;
    const prevLc = this.#lastLapCount;
    this.#lastLapCount = lc;

    if (prevLc === null || !this.#lap) {
      this.#lap = this.#newLap(p, at, false);
      if (onTrack && !paused) this.#sample(this.#lap, p, 0, paused);
      return;
    }

    if (lc !== prevLc) {
      const old = this.#lap;
      if (lc === prevLc + 1 && !streamReset) {
        if (!paused) old.counted += dPk;
        if (dPk > 1) {
          old.lost += dPk - 1;
          old.maxGap = Math.max(old.maxGap, dPk - 1);
        }
        if (old.timed) this.#beginClose(old, p);
        else this.#discard(old, old.number === 0 ? 'outLap' : 'partial');
        const lap = this.#newLap(p, at, lc >= 1);
        this.#lap = lap;
        if (lap.timed && this.#session) {
          this.#checkTrackAtLapStart(p, at);
          this.emit('lapStarted', {
            sessionId: this.#session.id,
            lapNumber: lc,
            at,
            packetId: p.packetId,
          });
        }
        this.#sample(lap, p, 0, paused);
      } else {
        if (this.#pending) this.#finalize(this.#pending, null);
        this.#discard(old, streamReset ? 'streamReset' : 'restart');
        this.#lap = this.#newLap(p, at, false);
        this.#sample(this.#lap, p, 0, paused);
      }
      return;
    }

    const lap = this.#lap;
    if (streamReset) {
      if (lap.timed) {
        this.#discard(lap, 'streamReset');
        this.#lap = this.#newLap(p, at, false);
      }
      return;
    }
    if (dPk > 1) {
      lap.lost += dPk - 1;
      lap.maxGap = Math.max(lap.maxGap, dPk - 1);
    }
    if (!onTrack) {
      if (lap.timed) {
        this.#discard(lap, 'leftTrack');
        this.#lap = this.#newLap(p, at, false);
      }
      return;
    }
    if (paused) {
      lap.flags.add('paused');
      return;
    }
    // receive gap with few packetIds elapsed: the game was frozen (paused without the flag)
    if (recvGap > 1000 && dPk * this.#msPerPacket < recvGap * 0.5) lap.flags.add('paused');
    this.#sample(lap, p, dPk, paused);
  }

  /**
   * At the start line of a timed lap: finds the track from the line position when none is active
   * yet or when the car came back from a break (it may be on another track now). A different
   * known track closes the session and opens a new one; an unknown start line drops the active
   * track so the lap is identified from its geometry when it closes.
   */
  #checkTrackAtLapStart(p: TelemetryPacket, at: number): void {
    const session = this.#session;
    if (!session || (this.#track && !this.#needTrackCheck)) return;
    const t = this.#ctx.findTrackByStart({ x: p.position.x, z: p.position.z }, headingOf(p));
    if (t) {
      if (this.#track?.id === t.id) {
        this.#needTrackCheck = false; // same track as before the break
        return;
      }
      if (session.trackId && session.trackId !== t.id) {
        this.#switchSession(
          'trackChange',
          at,
          this.#activeBeforeBreak ?? this.#lastLapDoneAt ?? session.startedAt,
        );
      }
      this.#needTrackCheck = false;
      this.#setActiveTrack(t, 'probable');
    } else if (this.#track) {
      this.#clearActiveTrack();
    }
  }

  /** Advances timing/distance/sectors/delta with one running packet and appends a sample. */
  #sample(lap: LapState, p: TelemetryPacket, dPk: number, paused: boolean): void {
    if (paused) return;
    const dt = (dPk * this.#msPerPacket) / 1000;
    lap.counted += dPk;
    const prevElapsed = lap.elapsedMs;
    lap.elapsedMs =
      lap.useGameClock && p.currentLapMs !== undefined && lap.timed
        ? p.currentLapMs
        : lap.counted * this.#msPerPacket;
    lap.fuelEnd = p.fuelLevel;
    if (p.carCode !== lap.carCode) lap.flags.add('discontinuity');

    // ---- teleport detection ----
    const jump = Math.hypot(p.position.x - lap.lastX, p.position.z - lap.lastZ);
    if (dPk > 0 && dPk < 10 && jump > 20 + p.speedMps * dt * 3) {
      lap.flags.add('discontinuity');
      lap.reacquire = true;
    }
    lap.lastX = p.position.x;
    lap.lastZ = p.position.z;

    // ---- distance ----
    const prevDist = lap.dist;
    const expected = lap.dist + p.speedMps * dt;
    const line = this.#line ?? this.#refLine;
    let dist = expected;
    lap.projectionOffsetM = undefined;
    if (line) {
      const L = line.length;
      let proj = lap.reacquire
        ? line.project(p.position.x, p.position.z)
        : line.project(p.position.x, p.position.z, expected - 30, expected + 60);
      if (proj && proj.dist > this.options.maxLateralM) proj = null;
      if (!proj && lap.misses > 60) {
        const full = line.project(p.position.x, p.position.z);
        if (full && full.dist <= this.options.maxLateralM) proj = full;
      }
      if (proj) {
        let s = proj.s;
        const ref = lap.reacquire ? (lap.timed ? Math.min(expected, L) : s) : expected;
        if (s - ref > L / 2) s -= L;
        else if (ref - s > L / 2) s += L;
        if (
          lap.timed &&
          !lap.reacquire &&
          lap.builder.length > 0 &&
          (s < prevDist - 50 || s > prevDist + 200)
        ) {
          lap.flags.add('discontinuity');
        }
        dist = s;
        lap.projectionOffsetM = proj.dist;
        lap.misses = 0;
        lap.reacquire = false;
      } else {
        lap.misses++;
      }
    }
    lap.dist = dist;

    // ---- off track (C format surfaces) ----
    if (p.surfaceTypes) {
      const off = p.surfaceTypes.every((c) => c !== 'T' && c !== 'C');
      lap.offTrackRun = off ? lap.offTrackRun + 1 : 0;
      if (lap.timed && lap.offTrackRun >= 30) lap.flags.add('offTrack');
    }

    // ---- delta ----
    const ref = this.#deltaRef;
    if (lap.builder.length === 0) {
      this.#deltaMs = null;
      this.#deltaRate = null;
    }
    if (ref && lap.timed) {
      const d = lap.elapsedMs - ref.timeAt(dist);
      if (this.#deltaMs !== null && dt > 0) {
        const inst = (d - this.#deltaMs) / dt;
        const a = emaAlpha(dt, 0.5);
        this.#deltaRate =
          this.#deltaRate === null ? inst : this.#deltaRate + (inst - this.#deltaRate) * a;
      }
      this.#deltaMs = d;
    } else {
      this.#deltaMs = null;
      this.#deltaRate = null;
    }

    // ---- sectors (live) ----
    const bounds = sectorBoundaries(this.#track);
    if (bounds && lap.timed && dPk > 0) {
      const k = lap.sectorCross.length;
      const b = bounds[k];
      if (b !== undefined && prevDist < b && dist >= b) {
        const u = dist > prevDist ? (b - prevDist) / (dist - prevDist) : 1;
        const crossT = prevElapsed + (lap.elapsedMs - prevElapsed) * u;
        const prevCross = k === 0 ? 0 : lap.sectorCross[k - 1]!;
        lap.sectorCross.push(crossT);
        const t = Math.round(crossT - prevCross);
        lap.sectors.push({
          index: k,
          timeMs: t,
          status: this.#sectorStatus(k, t, bounds.length + 1),
          deltaMs: this.#refSectorDelta(k, t, bounds.length + 1),
        });
      }
    }

    // ---- corner passes (for lastPassDeltaMs) ----
    if (this.#track && this.#deltaMs !== null && dPk > 0) {
      for (const c of this.#track.corners) {
        const pass = this.#cornerPass.get(c.id) ?? { entryDelta: null, lastPassDeltaMs: null };
        if (prevDist < c.entryM && dist >= c.entryM) pass.entryDelta = this.#deltaMs;
        if (prevDist < c.exitM && dist >= c.exitM && pass.entryDelta !== null) {
          pass.lastPassDeltaMs = this.#deltaMs - pass.entryDelta;
          pass.entryDelta = null;
        }
        this.#cornerPass.set(c.id, pass);
      }
    }

    // ---- trace sample ----
    // laps not timed from the start line (entry / out laps) are never stored: keep no samples
    if (!lap.timed) return;
    if (lap.builder.length >= this.options.maxLapSamples) {
      lap.flags.add('incompleteData');
      return;
    }
    const slip = wheelSlipRatios(p);
    const g = this.#g;
    lap.builder.push({
      tMs: lap.elapsedMs,
      distanceM: dist,
      packetId: p.packetId,
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      speedKmh: p.speedMps * 3.6,
      rpm: p.engineRpm,
      gear: p.gear,
      throttle: pedalToUnit(p.throttle),
      brake: pedalToUnit(p.brake),
      clutch: p.clutchPedal,
      steeringRad: p.steeringAngle ?? Number.NaN,
      throttleRaw: p.throttleRaw !== undefined ? pedalToUnit(p.throttleRaw) : Number.NaN,
      yawRate: p.angularVelocity.y,
      latG: g.lateral,
      lonG: g.longitudinal,
      vertG: g.vertical ?? Number.NaN,
      slipFL: slip[0],
      slipFR: slip[1],
      slipRL: slip[2],
      slipRR: slip[3],
      tyreTempFL: p.tyreTemp[0],
      tyreTempFR: p.tyreTemp[1],
      tyreTempRL: p.tyreTemp[2],
      tyreTempRR: p.tyreTemp[3],
      suspFL: p.suspensionHeight[0],
      suspFR: p.suspensionHeight[1],
      suspRL: p.suspensionHeight[2],
      suspRR: p.suspensionHeight[3],
      fuelL: p.fuelLevel,
      flags: p.flags,
    });
  }

  #sectorStatus(i: number, t: number, count: number): SectorStatus {
    const rec = this.#records;
    const overall =
      rec && rec.overallBestSectorsMs.length === count
        ? (rec.overallBestSectorsMs[i] ?? null)
        : null;
    const pb =
      rec && rec.personalBestSectorsMs.length === count
        ? (rec.personalBestSectorsMs[i] ?? null)
        : null;
    const sb =
      this.#sessionBestSectors.length === count ? (this.#sessionBestSectors[i] ?? null) : null;
    if (overall === null || t <= overall) return 'overallBest';
    if (pb === null || t <= pb) return 'personalBest';
    if (sb === null || t <= sb) return 'sessionBest';
    return 'slower';
  }

  #refSectorDelta(i: number, t: number, count: number): number | null {
    const ref = this.#deltaRef;
    if (!ref || ref.lap.sectorTimesMs.length !== count) return null;
    const r = ref.lap.sectorTimesMs[i];
    return r === null || r === undefined ? null : t - r;
  }

  #beginClose(lap: LapState, p: TelemetryPacket): void {
    if (this.#pending) this.#finalize(this.#pending, null);
    const prevGameLast = this.#lastPacket?.lastLapMs ?? -1;
    this.#pending = { lap, countedMs: lap.counted * this.#msPerPacket, prevGameLast, waited: 0 };
    this.#tryFinalize(p);
  }

  #tryFinalize(p: TelemetryPacket): void {
    const pc = this.#pending;
    if (!pc) return;
    const g = p.lastLapMs;
    const plausible = g > 0 && Math.abs(g - pc.countedMs) <= Math.max(5000, pc.countedMs * 0.05);
    if (plausible && g !== pc.prevGameLast) {
      this.#finalize(pc, g);
      return;
    }
    pc.waited++;
    if (pc.waited >= this.options.lapCloseWaitPackets) {
      this.#finalize(pc, plausible && Math.abs(g - pc.countedMs) <= 300 ? g : null);
    }
  }

  #finalize(pc: PendingClose, gameMs: number | null): void {
    this.#pending = null;
    let session = this.#session;
    if (!session) return;
    const lap = pc.lap;
    const flags = lap.flags;
    const countedMs = pc.countedMs;
    const lapId = this.#newId();
    const timeMs =
      gameMs ?? Math.round(lap.useGameClock ? Math.max(lap.elapsedMs, countedMs) : countedMs);
    if (gameMs !== null && Math.abs(gameMs - countedMs) > Math.max(200, gameMs * 0.003)) {
      flags.add('timeMismatch');
    }
    // gap / loss flags
    const lossRatio = lap.lost / Math.max(1, lap.counted);
    if (lap.maxGap > this.options.maxGapPackets || lossRatio > this.options.maxLossRatio) {
      flags.add('incompleteData');
    }
    if (this.#replayMode) flags.add('replay');
    // calibrate ms/packet with clean laps
    const clean = !flags.has('paused') && !flags.has('discontinuity') && lap.lost === 0;
    if (gameMs !== null && clean && lap.counted > 0 && !lap.useGameClock) {
      // cumulative calibration: averages out the ±1 frame quantization of each lap; only a
      // systematic deviation (> 0.1 %) from 60 Hz moves the packet period away from nominal
      this.#calGameMs += gameMs;
      this.#calPackets += lap.counted;
      const ratio = this.#calGameMs / this.#calPackets / NOMINAL_MS_PER_PACKET;
      this.#msPerPacket =
        Math.abs(ratio - 1) > 0.001
          ? clamp(NOMINAL_MS_PER_PACKET * ratio, 15.5, 18)
          : NOMINAL_MS_PER_PACKET;
    }

    // ---- trace ----
    const trace = lap.builder.build(lapId, 60);
    const tCol = trace.channels.tMs as Float64Array;
    if (!lap.useGameClock && countedMs > 0) {
      const k = timeMs / countedMs;
      for (let i = 0; i < tCol.length; i++) tCol[i] = tCol[i]! * k;
    }
    const xs = trace.channels.x;
    const zs = trace.channels.z;

    // ---- track identification ----
    const complete = !flags.has('discontinuity') && trace.length > 600;
    if (complete && (this.#trackConfidence !== 'confirmed' || this.#needTrackCheck)) {
      const line = lapPolyline(xs, zs);
      const res = this.#ctx.identifyTrack({
        line,
        sourceLapId: lapId,
        y: { s: cumulativeDistance(xs, zs), y: trace.channels.y },
        now: this.#lastReceivedAt ?? Date.now(),
      });
      // this lap was driven on another track than the session's: it belongs to a new session
      if (session.trackId && session.trackId !== res.track.id) {
        this.#switchSession(
          'trackChange',
          lap.startedAt,
          Math.min(
            this.#activeBeforeBreak ?? this.#lastLapDoneAt ?? session.startedAt,
            lap.startedAt,
          ),
        );
        session = this.#session ?? session;
      }
      this.#needTrackCheck = false;
      this.#setActiveTrack(res.track, 'confirmed');
    }
    const track = this.#track;

    // ---- distance channel aligned to the centerline ----
    if (this.#line) trace.channels.distanceM = alignToLine(this.#line, xs, zs);
    else trace.channels.distanceM = cumulativeDistance(xs, zs);
    const dCol = trace.channels.distanceM;
    const lengthM = track?.lengthM ?? (dCol.length ? Number(dCol[dCol.length - 1]) : 0);

    // ---- sectors ----
    const bounds = sectorBoundaries(track) ?? [lengthM / 3, (2 * lengthM) / 3];
    const count = bounds.length + 1;
    const sectorTimesMs = computeSectorTimes(dCol, tCol, bounds, timeMs);
    const sectorStatus = sectorTimesMs.map((t, i) =>
      t === null ? ('pending' as const) : this.#sectorStatus(i, t, count),
    );

    const valid = !INVALIDATING.some((f) => flags.has(f));
    const replay = flags.has('replay');
    const fuelUsed = lap.fuelStart - lap.fuelEnd;
    const fuelUsedL =
      replay || this.#lastPacket?.fuelCapacity === 0 || !(fuelUsed > 0) ? null : fuelUsed;
    const flagList = [...flags];
    const lapRow: Lap = {
      id: lapId,
      sessionId: session.id,
      number: lap.number,
      timeMs,
      sectorTimesMs,
      valid,
      flags: flagList,
      isReference: false,
      referenceMeta: null,
      startedAt: lap.startedAt,
      carCode: lap.carCode,
      trackId: track?.id ?? null,
      fuelUsedL,
      sampleCount: trace.length,
      lostPackets: lap.lost,
      traceFile: null,
    };

    // ---- comparisons (before records are updated) ----
    const ref = this.#deltaRef;
    const personal = valid && !replay;
    const isSessionBest =
      personal && (this.#sessionBestLapMs === null || timeMs < this.#sessionBestLapMs);
    const pbBefore = this.#records?.personalBestLapMs ?? null;
    const isPersonalBest = personal && (pbBefore === null || timeMs < pbBefore);
    let bestSectorIndex: number | null = null;
    if (ref && ref.lap.sectorTimesMs.length === count) {
      let best = Number.POSITIVE_INFINITY;
      sectorTimesMs.forEach((t, i) => {
        const r = ref.lap.sectorTimesMs[i];
        if (t === null || r === null || r === undefined) return;
        if (t - r < best) {
          best = t - r;
          bestSectorIndex = i;
        }
      });
    }

    this.#ctx.saveLap(lapRow, trace);

    // ---- session bookkeeping ----
    session.lapCount++;
    if (personal && (session.bestLapMs === null || timeMs < session.bestLapMs))
      session.bestLapMs = timeMs;
    if (track && session.trackId !== track.id) session.trackId = track.id;
    this.#ctx.saveSession({ ...session });
    this.#lastLapMs = timeMs;
    this.#lastLapDoneAt = this.#lastReceivedAt ?? Date.now();
    if (personal) {
      if (this.#sessionBestSectors.length !== count) {
        this.#sessionBestSectors = Array.from({ length: count }, () => null);
      }
      sectorTimesMs.forEach((t, i) => {
        const cur = this.#sessionBestSectors[i] ?? null;
        if (t !== null && (cur === null || t < cur)) this.#sessionBestSectors[i] = t;
      });
      if (fuelUsedL !== null) {
        this.#fuelHistory.push(fuelUsedL);
        if (this.#fuelHistory.length > this.options.fuelAvgLaps) this.#fuelHistory.shift();
      }
    }
    const stored: StoredLap = { lap: lapRow, trace };
    if (isSessionBest) {
      this.#sessionBestLapMs = timeMs;
      this.#sessionBestRef = new DeltaReference(stored);
    }
    this.#refreshRecords();
    if (this.#deltaKind === 'sessionBest' && isSessionBest)
      this.#useReference(this.#sessionBestRef);
    else if (this.#deltaKind === 'personalBest' && isPersonalBest)
      this.#useReference(new DeltaReference(stored));
    else if (!this.#deltaRef) this.#reloadReference();

    const event: LapCompletedEvent = {
      sessionId: session.id,
      lapId,
      lapNumber: lap.number,
      timeMs,
      sectorTimesMs,
      sectorStatus,
      valid,
      flags: flagList,
      deltaMs: ref ? timeMs - ref.timeMs : null,
      deltaReference: this.#deltaKind,
      isPersonalBest,
      isSessionBest,
      bestSectorIndex,
      fuelUsedL,
      completedAt: this.#lastReceivedAt ?? Date.now(),
      trackId: track?.id ?? null,
    };
    this.emit('sessionUpdated', { ...session });
    this.emit('lapCompleted', {
      event,
      lap: lapRow,
      trace,
      countedTimeMs: countedMs,
      gameTimeMs: gameMs,
      lengthM,
      track,
      session: { ...session },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Internals: track & reference
  // ---------------------------------------------------------------------------------------------

  #carCode(): number {
    return this.#session?.carCode ?? this.#lastPacket?.carCode ?? 0;
  }

  #refreshRecords(): void {
    if (!this.#track) {
      this.#records = null;
      return;
    }
    const count = (sectorBoundaries(this.#track)?.length ?? 2) + 1;
    this.#records = this.#ctx.getTrackRecords(this.#track.id, this.#carCode(), count);
  }

  #setActiveTrack(track: Track, confidence: LiveTrackInfo['confidence']): void {
    const same = this.#track?.id === track.id;
    this.#trackConfidence = confidence;
    if (same) {
      this.#track = track;
      this.emit('trackChanged', this.trackInfo);
      return;
    }
    this.#track = track;
    const cl = this.#ctx.getCenterline(track.id);
    this.#line = cl && cl.x.length >= 2 ? centerlinePolyline(cl) : null;
    this.#hintCache.clear();
    this.#cornerPass.clear();
    if (this.#lap) this.#lap.reacquire = true;
    this.#refreshRecords();
    if (this.#session && this.#session.trackId !== track.id) {
      this.#session.trackId = track.id;
      this.#ctx.saveSession({ ...this.#session });
      this.emit('sessionUpdated', { ...this.#session });
    }
    this.emit('trackChanged', this.trackInfo);
    this.#reloadReference();
  }

  #useReference(ref: DeltaReference | null): void {
    this.#deltaRef = ref;
    this.#refLine =
      !this.#line && ref && ref.trace.length > 2
        ? lapPolyline(ref.trace.channels.x, ref.trace.channels.z)
        : null;
    this.#hintCache.clear();
    this.#deltaMs = null;
    this.#deltaRate = null;
  }

  #reloadReference(): void {
    if (this.#reloading) return;
    this.#reloading = true;
    try {
      const track = this.#track;
      let stored: StoredLap | null = null;
      if (this.#deltaKind === 'sessionBest') {
        this.#useReference(this.#sessionBestRef);
        return;
      }
      if (this.#deltaKind === 'personalBest') {
        stored = track ? this.#ctx.loadPersonalBest(track.id, this.#carCode()) : null;
      } else if (this.#deltaLapId) {
        stored = this.#ctx.loadLap(this.#deltaLapId);
      } else if (track) {
        stored = this.#ctx.loadBestReference(track.id, this.#carCode());
      }
      if (stored && !track && stored.lap.trackId) {
        const t = this.#ctx.getTrack(stored.lap.trackId);
        if (t) {
          this.#reloading = false;
          this.#setActiveTrack(t, 'probable');
          return; // #setActiveTrack reloaded the reference
        }
      }
      this.#useReference(stored ? new DeltaReference(stored) : null);
    } finally {
      this.#reloading = false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Internals: frame
  // ---------------------------------------------------------------------------------------------

  #engineerFrame(p: TelemetryPacket, state: ConnectionState): LiveEngineerFrame {
    const track = this.#track;
    const lap = this.#lap;
    const line = this.#line;
    const lapStart = lap?.startedAt ?? null;
    const trackId = track?.id ?? null;
    if (lapStart !== this.#engineerLapStart || trackId !== this.#engineerTrackId) {
      this.#engineerLapStart = lapStart;
      this.#engineerTrackId = trackId;
      this.#engineerPlan = null;
    }
    if (state !== 'onTrack') return { status: 'suspended' };
    if (!track || !line || this.#needTrackCheck || this.#trackConfidence !== 'confirmed') {
      return { status: 'waitingTrack' };
    }
    if (
      !lap?.timed ||
      lap.carCode !== p.carCode ||
      lap.flags.has('discontinuity') ||
      lap.offTrackRun > 0 ||
      (lap.projectionOffsetM ?? Infinity) > 12 ||
      p.speedMps < 8 ||
      p.gear <= 0
    )
      return { status: 'suspended' };

    const ref = this.#deltaRef;
    if (!this.#engineerPlan) {
      if (!ref) return { status: 'waitingReference' };
      if (!ref.lap.valid || ref.lap.trackId !== track.id || ref.lap.carCode !== p.carCode) {
        return { status: 'incompatible' };
      }
      const marks = new Map<string, Pick<EngineerMark, 'kind' | 'atM' | 'untilM'>>();
      const stored = { lap: ref.lap, trace: ref.trace };
      for (const corner of track.corners) {
        for (const mark of this.#cornerTargets(track, corner, stored)?.engineerMarks ?? []) {
          // The analysis line is smoothed. Reproject each pedal sample onto the live line so the
          // countdown and the action point use the same distance coordinate.
          const point = line.project(
            mark.position.x,
            mark.position.z,
            mark.atM - 60,
            mark.atM + 60,
          );
          if (!point || point.dist > 18) continue;
          const end =
            mark.endPosition && mark.untilM !== undefined
              ? line.project(
                  mark.endPosition.x,
                  mark.endPosition.z,
                  mark.untilM - 60,
                  mark.untilM + 60,
                )
              : null;
          if (mark.kind === 'coast' && (!end || end.dist > 18)) continue;
          const span = end ? line.wrap(end.s - point.s) : 0;
          if (span > line.length / 2) continue;
          marks.set(`${mark.kind}|${Math.round(point.s)}`, {
            kind: mark.kind,
            atM: point.s,
            untilM: end ? point.s + span : undefined,
          });
        }
      }
      this.#engineerPlan = { id: ref.lapId, timeMs: ref.timeMs, marks: [...marks.values()] };
    }

    const plan = this.#engineerPlan;
    if (plan.marks.length === 0) return { status: 'noCues' };
    const length = line.length;
    const cues: EngineerCue[] = [];
    for (const [i, mark] of plan.marks.entries()) {
      const offset = mark.atM - lap.dist;
      const aheadM = offset - Math.round(offset / length) * length;
      const span = mark.untilM === undefined ? 0 : mark.untilM - mark.atM;
      if (aheadM > 310 || aheadM + span < -18) continue;
      cues.push({
        id: `${plan.id}|${i}`,
        kind: mark.kind,
        aheadM,
        ...(span > 0 ? { endAheadM: aheadM + span } : {}),
      });
    }
    return {
      status: 'ready',
      referenceLapId: plan.id,
      referenceLapMs: plan.timeMs,
      pendingReference: plan.id !== ref?.lapId,
      cues,
    };
  }

  #cornerTargets(track: Track, corner: Track['corners'][number], reference: StoredLap | null) {
    const key = `${corner.id}|${reference?.lap.id ?? ''}`;
    let targets = this.#hintCache.get(key);
    if (targets === undefined) {
      targets = this.#hints.targetsFor({ track, corner, reference });
      this.#hintCache.set(key, targets);
    }
    return targets;
  }

  #nextCorner(dist: number | null): NextCornerHint | null {
    const track = this.#track;
    if (!track || dist === null || track.corners.length === 0) return null;
    const corners = [...track.corners].sort((a, b) => a.entryM - b.entryM);
    const L = track.lengthM;
    const d = ((dist % L) + L) % L;
    let corner = corners.find((c) => c.entryM >= d);
    let distance: number;
    if (corner) distance = corner.entryM - d;
    else {
      corner = corners[0]!;
      distance = corner.entryM + L - d;
    }
    const ref = this.#deltaRef;
    const targets = this.#cornerTargets(
      track,
      corner,
      ref ? { lap: ref.lap, trace: ref.trace } : null,
    );
    return {
      cornerId: corner.id,
      name: corner.name,
      direction: corner.direction,
      distanceToEntryM: distance,
      referenceBrakePointM: targets?.referenceBrakePointM ?? null,
      referenceMinSpeedKmh: targets?.referenceMinSpeedKmh ?? null,
      referenceGearAtApex: targets?.referenceGearAtApex ?? null,
      ...(targets?.referenceThrottleOnM != null && Number.isFinite(targets.referenceThrottleOnM)
        ? { referenceThrottleOnM: targets.referenceThrottleOnM }
        : {}),
      lastPassDeltaMs: this.#cornerPass.get(corner.id)?.lastPassDeltaMs ?? null,
    };
  }

  #buildFrame(p: TelemetryPacket, now: number): LiveFrame {
    const lap = this.#lap;
    const ref = this.#deltaRef;
    const timed = !!lap?.timed;
    const lengthM = this.#track?.lengthM ?? ref?.lengthM ?? null;
    const dist = lap ? lap.dist : null;
    const bounds = sectorBoundaries(this.#track);
    const sectors: SectorSplit[] = [];
    if (bounds) {
      const count = bounds.length + 1;
      for (let i = 0; i < count; i++) {
        const done = timed ? lap?.sectors[i] : undefined;
        sectors.push(done ?? { index: i, timeMs: null, status: 'pending', deltaMs: null });
      }
    }
    const fuelAvg = this.#fuelHistory.length
      ? this.#fuelHistory.reduce((s, v) => s + v, 0) / this.#fuelHistory.length
      : null;
    const fraction = lengthM && dist !== null ? clamp(dist / lengthM, 0, 1) : null;
    let neededToFinish: number | null = null;
    if (fuelAvg !== null && p.totalLaps > 0) {
      const remainingLaps = Math.max(
        0,
        p.totalLaps - Math.max(1, p.lapCount) + (1 - (fraction ?? 0)),
      );
      neededToFinish = remainingLaps * fuelAvg;
    }
    const delta = timed ? this.#deltaMs : null;
    const flagsInvalid = lap ? INVALIDATING.some((f) => lap.flags.has(f)) : true;
    const state = this.#composeState();
    const slip = wheelSlipRatios(p);
    return {
      seq: ++this.#seq,
      t: now,
      packetId: p.packetId,
      format: p.format,
      state,
      car: {
        speedKmh: p.speedMps * 3.6,
        rpm: p.engineRpm,
        gear: p.gear,
        suggestedGear: suggestedGearOf(p),
        throttle: pedalToUnit(p.throttle),
        brake: pedalToUnit(p.brake),
        clutch: p.clutchPedal,
        throttleRaw: p.throttleRaw !== undefined ? pedalToUnit(p.throttleRaw) : null,
        brakeRaw: p.brakeRaw !== undefined ? pedalToUnit(p.brakeRaw) : null,
        steeringRad: p.steeringAngle ?? null,
        boostBar: p.boost - 1,
        oilPressureBar: p.oilPressure,
        rpmAlert: { min: p.rpmAlertMin, max: p.rpmAlertMax },
        maxSpeedKmh: p.calculatedMaxSpeedKmh,
        carCode: p.carCode,
      },
      tyres: {
        tempC: [...p.tyreTemp],
        slip,
        suspensionM: [...p.suspensionHeight],
        surface: p.surfaceTypes ? [...p.surfaceTypes] : null,
      },
      fuel: {
        level: p.fuelLevel,
        capacity: p.fuelCapacity,
        perLapAvg: fuelAvg,
        lapsRemaining: fuelAvg && fuelAvg > 0 ? p.fuelLevel / fuelAvg : null,
        neededToFinish,
        energyRecovery: p.energyRecovery ?? null,
      },
      g: { ...this.#g },
      flags: decodeFlags(p.flags),
      position: { ...p.position },
      headingRad: headingOf(p),
      lap: {
        lap: p.lapCount,
        totalLaps: p.totalLaps > 0 ? p.totalLaps : null,
        currentLapMs: lap ? Math.max(0, Math.round(lap.elapsedMs)) : 0,
        lastLapMs: this.#lastLapMs ?? (p.lastLapMs > 0 ? p.lastLapMs : null),
        bestLapMs: this.#sessionBestLapMs ?? (p.bestLapMs > 0 ? p.bestLapMs : null),
        predictedLapMs: ref && delta !== null ? Math.round(ref.timeMs + delta) : null,
        delta: {
          ms: delta,
          reference: this.#deltaKind,
          referenceLapId: ref?.lapId ?? null,
          rateMsPerS: timed ? this.#deltaRate : null,
        },
        referenceLapMs: ref?.timeMs ?? null,
        currentLapValid: timed && !flagsInvalid,
      },
      sectors,
      distanceM: dist,
      lapFraction: fraction,
      track: this.trackInfo,
      nextCorner: this.#nextCorner(dist),
      engineer: this.#engineerFrame(p, state),
      link: this.#link ?? {
        rateHz: 0,
        lossPct: 0,
        lost: 0,
        received: this.#received,
        lastPacketAt: this.#lastReceivedAt,
      },
    };
  }
}
