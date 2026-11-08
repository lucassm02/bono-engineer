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
 */

import { EventEmitter } from 'node:events';
import {
  type ConnectionState,
  type DeltaReferenceKind,
  decodeFlags,
  type Id,
  type IngestorState,
  type IngestorStats,
  type Lap,
  type LapCompletedEvent,
  type LapFlag,
  type LapTrace,
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
import { type LiveEngineContext, MemoryEngineContext, type TrackRecords } from './context.ts';
import {
  type CornerHintProvider,
  type CornerHintTargets,
  TraceCornerHintProvider,
} from './corner-hints.ts';
import { DeltaReference, type StoredLap } from './delta-reference.ts';
import { GForceEstimator, headingOf } from './gforce.ts';

export const NOMINAL_MS_PER_PACKET = 1000 / 60;
/** packetId gaps larger than this are a stream reset (matches the ingestor). */
const RESET_GAP = 600;
/** A packet up to this early (ms) still counts as due for the next throttled frame (jitter). */
const FRAME_DUE_TOLERANCE_MS = 1;
/** Flags that make a lap invalid. */
const INVALIDATING: readonly LapFlag[] = ['paused', 'incompleteData', 'discontinuity', 'offTrack'];

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
  /** Not on track / no packets for this long ends the session (default 60 s). */
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

export interface LiveEngineEvents {
  frame: [LiveFrame];
  lapStarted: [LapStartedInfo];
  lapCompleted: [CompletedLap];
  lapDiscarded: [LapDiscardedInfo];
  sessionStarted: [Session];
  sessionUpdated: [Session];
  sessionEnded: [Session];
  trackChanged: [LiveTrackInfo | null];
  stateChanged: [ConnectionState, ConnectionState];
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

function sectorBoundaries(track: Track | null): number[] | null {
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
  #notOnTrackSince: number | null = null;
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
      sessionIdleEndMs: opts.sessionIdleEndMs ?? 60_000,
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

  /** Replay (reference capture) mode. Changing it ends the current session. */
  setReplayMode(on: boolean): void {
    if (on === this.#replayMode) return;
    const before = this.#composeState();
    this.endSession();
    this.#replayMode = on;
    this.#emitStateIfChanged(before);
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
    this.context.saveSession({ ...this.#session });
    this.emit('sessionUpdated', { ...this.#session });
  }

  /** Re-reads the active track from the context (after renames, corner/sector edits). */
  refreshTrack(): void {
    if (!this.#track) return;
    const t = this.context.getTrack(this.#track.id);
    if (!t) return;
    this.#track = t;
    this.#hintCache.clear();
    this.#refreshRecords();
    this.emit('trackChanged', this.trackInfo);
  }

  /** Ends the active session (discarding an unfinished lap). */
  endSession(): void {
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
    s.endedAt = this.#lastReceivedAt ?? Date.now();
    this.context.saveSession({ ...s });
    this.#session = null;
    this.#lastLapCount = null;
    this.#sessionBestRef = null;
    this.#sessionBestLapMs = null;
    this.#sessionBestSectors = [];
    this.#lastLapMs = null;
    this.#fuelHistory = [];
    this.#cornerPass.clear();
    this.emit('sessionEnded', { ...s });
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
    const recvGap = this.#lastReceivedAt === null ? 0 : receivedAtMs - this.#lastReceivedAt;
    if (this.#session && recvGap > this.options.sessionIdleEndMs) this.endSession();
    this.#lastPacketId = p.packetId;
    this.#lastReceivedAt = receivedAtMs;
    this.#received++;

    const f = decodeFlags(p.flags);
    const onTrack = f.carOnTrack && !f.loadingOrProcessing;
    const paused = f.paused;
    this.#state = !onTrack ? 'menu' : paused ? 'paused' : this.#replayMode ? 'replay' : 'onTrack';

    if (onTrack) this.#notOnTrackSince = null;
    else this.#notOnTrackSince ??= receivedAtMs;
    if (
      this.#session &&
      this.#notOnTrackSince !== null &&
      receivedAtMs - this.#notOnTrackSince > this.options.sessionIdleEndMs
    ) {
      this.endSession();
    }
    if (this.#session && onTrack && !paused && p.carCode !== this.#session.carCode) {
      this.endSession();
    }
    if (!this.#session && onTrack && !paused) this.#startSession(p, receivedAtMs);

    if (streamReset) this.#gforce.reset();
    this.#g = this.#gforce.update(p, (dPk * this.#msPerPacket) / 1000);

    if (this.#pending) this.#tryFinalize(p);
    if (this.#session) this.#handleLap(p, receivedAtMs, dPk, streamReset, onTrack, paused, recvGap);

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

  #startSession(p: TelemetryPacket, at: number): void {
    const s: Session = {
      id: this.#newId(),
      trackId: null,
      carCode: p.carCode,
      startedAt: at,
      endedAt: null,
      format: p.format,
      mode: this.#replayMode ? 'replayCapture' : 'live',
      lapCount: 0,
      bestLapMs: null,
      recordingFile: null,
      notes: null,
    };
    this.#session = s;
    this.#lastLapCount = null;
    this.#lap = null;
    this.context.saveSession({ ...s });
    this.emit('sessionStarted', { ...s });
    this.#reloadReference();
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
          if (!this.#track) {
            const t = this.context.findTrackByStart(
              { x: p.position.x, z: p.position.z },
              headingOf(p),
            );
            if (t) this.#setActiveTrack(t, 'probable');
          }
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
    const session = this.#session;
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
    if (complete && this.#trackConfidence !== 'confirmed') {
      const line = lapPolyline(xs, zs);
      const res = this.context.identifyTrack({
        line,
        sourceLapId: lapId,
        y: { s: cumulativeDistance(xs, zs), y: trace.channels.y },
        now: this.#lastReceivedAt ?? Date.now(),
      });
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

    this.context.saveLap(lapRow, trace);

    // ---- session bookkeeping ----
    session.lapCount++;
    if (personal && (session.bestLapMs === null || timeMs < session.bestLapMs))
      session.bestLapMs = timeMs;
    if (track && session.trackId !== track.id) session.trackId = track.id;
    this.context.saveSession({ ...session });
    this.#lastLapMs = timeMs;
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
    this.#records = this.context.getTrackRecords(this.#track.id, this.#carCode(), count);
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
    const cl = this.context.getCenterline(track.id);
    this.#line = cl && cl.x.length >= 2 ? centerlinePolyline(cl) : null;
    this.#hintCache.clear();
    this.#cornerPass.clear();
    if (this.#lap) this.#lap.reacquire = true;
    this.#refreshRecords();
    if (this.#session && this.#session.trackId !== track.id) {
      this.#session.trackId = track.id;
      this.context.saveSession({ ...this.#session });
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
        stored = track ? this.context.loadPersonalBest(track.id, this.#carCode()) : null;
      } else if (this.#deltaLapId) {
        stored = this.context.loadLap(this.#deltaLapId);
      } else if (track) {
        stored = this.context.loadBestReference(track.id, this.#carCode());
      }
      if (stored && !track && stored.lap.trackId) {
        const t = this.context.getTrack(stored.lap.trackId);
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
    const key = `${corner.id}|${ref?.lapId ?? ''}`;
    let targets = this.#hintCache.get(key);
    if (targets === undefined) {
      targets = this.#hints.targetsFor({
        track,
        corner,
        reference: ref ? { lap: ref.lap, trace: ref.trace } : null,
      });
      this.#hintCache.set(key, targets);
    }
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
    const slip = wheelSlipRatios(p);
    return {
      seq: ++this.#seq,
      t: now,
      packetId: p.packetId,
      format: p.format,
      state: this.#composeState(),
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
