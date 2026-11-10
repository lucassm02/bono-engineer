/**
 * Reference (replay) capture by geometry (Onda 9a).
 *
 * What the real console sends during a replay (measured on a PS5): car data (speed, rpm, pedals,
 * position, tyres...) at ~60 Hz in real time, but `carOnTrack` false, no lap clock (currentLapMs 0,
 * no lastLapTime) and a lapCount that never advances. So nothing the game says about laps can be
 * used. This capture therefore ignores the game's lap bookkeeping entirely:
 *
 * 1. **Track**: the user may pass a `trackId`; otherwise the track is found from the position — the
 *    known track whose centerline the car stays on (mean distance, nearest wins). A replay on a track
 *    the app never saw is reported as "unknown track: drive it live first".
 * 2. **Laps**: the car's progress along the centerline is tracked (windowed projection, unwrapped).
 *    A fixed gate through the centerline origin defines start/finish. The packets on either side
 *    of the gate are interpolated to get the crossing time and the trace endpoints.
 * 3. **Time**: counted from packets, `(packetId_end − packetId_start) × msPerPacket` with fractional
 *    packet ids at both ends. Dropped packets still count, but the result is an estimate.
 *    The game's clock is never used. When the user typed the ranking time it is compared with the
 *    measured one (tolerance 300 ms); the difference is reported either way.
 * 4. **Validity**: a lap is valid only if it runs from one crossing to the next without a pause,
 *    rewind, fast-forward or jump (position stalls or leaps), with few lost packets, a length within
 *    ±2 % of the track, real-time speed (1x) and the expected car. A replay that starts mid-lap is
 *    fine: the partial first lap is ignored and the next complete one is captured.
 *
 * The packets come from `LiveEngine`'s `'packet'` event; the engine itself opens no session and
 * writes no lap while a replay plays. A valid lap is stored as a reference lap (isReference +
 * ReferenceMeta) in its own `replayCapture` session, with the same trace channels as live laps.
 *
 * Validation issue codes: 'paused', 'discontinuity', 'packetGaps', 'lengthMismatch',
 * 'timeMismatch', 'carMismatch', 'notRealtime', 'interrupted'. A rejected lap is not stored; the
 * capture keeps waiting for the next lap.
 */

import { EventEmitter } from 'node:events';
import {
  type CaptureState,
  type CaptureWaiting,
  type Id,
  type Lap,
  type LapCompletedEvent,
  type LapSample,
  type LapTrace,
  pedalToUnit,
  type ReferenceCaptureStatus,
  type ReferenceMeta,
  type Session,
  type TelemetryPacket,
  type Track,
  type TrackCenterline,
  wheelSlipRatios,
} from '@gt7/shared';
import {
  type CompletedLap,
  computeSectorTimes,
  type EnginePacketInfo,
  type LiveEngine,
  sectorBoundaries,
} from '../live/live-engine.ts';
import { LAP_SAMPLE_CHANNELS, TraceBuilder } from '../trace/channels.ts';
import { centerlinePolyline, lapPolyline } from '../track/fingerprint.ts';
import { newId } from '../util/ids.ts';
import type { Polyline } from '../util/polyline.ts';

export interface ReferenceCaptureMeta {
  driverName: string;
  carName?: string | null;
  /** Ranking lap time typed by the user (validation). */
  rankingTimeMs?: number | null;
  notes?: string | null;
  /** If set, the captured lap must be driven with this car. */
  expectedCarCode?: number | null;
  /** Track chosen by the user; skips the automatic identification from the position. */
  trackId?: Id | null;
}

export interface ReferenceCaptureStore {
  setReference(lapId: Id, meta: ReferenceMeta | null): unknown;
  deleteLap?(lapId: Id): Promise<boolean> | boolean;
  listTracks(): Track[];
  getTrack(trackId: Id): Track | null;
  getCenterline(trackId: Id): TrackCenterline | null;
  saveSession(session: Session): void;
  saveLap(lap: Lap, trace?: LapTrace): unknown;
}

export interface ReferenceCaptureOptions {
  engine: LiveEngine;
  store: ReferenceCaptureStore;
  /** Optional hook on start (e.g. switch the ingestor to another packet format). Off by default. */
  enter?: () => Promise<void>;
  /** Called when the capture ends (success or stop), e.g. restore the live format. */
  exit?: () => Promise<void>;
  /** Max relative lap length difference vs the known track length (default 0.02). */
  lengthTolerance?: number;
  /** Max |measured lap time − ranking time| (default 300 ms). */
  timeToleranceMs?: number;
  /** Max single packetId gap (default 6 packets = 100 ms). */
  maxGapPackets?: number;
  /** Max lost packet ratio (default 0.005). */
  maxLossRatio?: number;
  idFactory?: () => Id;
  /**
   * Compare the lap time counted from packets with the wall clock (default true): a replay played
   * in slow motion or fast-forward is rejected as 'notRealtime'. Tests that stream packets in
   * compressed time turn it off.
   */
  checkRealtime?: boolean;
}

export interface ReferenceCaptureEvents {
  status: [ReferenceCaptureStatus];
  captured: [CompletedLap, Lap];
  /** A lap (or attempt) was rejected; the lap is null when the replay ended before it closed. */
  invalid: [string[], CompletedLap | null];
}

/** pt-BR text of an issue code (shown by the UI and in notices). */
export const CAPTURE_ISSUE_TEXT: Record<string, string> = {
  paused: 'o replay foi pausado durante a volta',
  discontinuity: 'houve salto, volta ou avanço rápido no replay',
  packetGaps: 'muitos pacotes perdidos durante a volta',
  lengthMismatch: 'a distância percorrida não bate com a da pista',
  timeMismatch: 'o tempo medido não bate com o tempo do ranking digitado',
  carMismatch: 'o carro do replay não é o esperado',
  notRealtime: 'o replay não estava em velocidade 1×',
  interrupted: 'o replay foi interrompido antes de fechar a volta',
};

export function captureIssueText(code: string): string {
  return CAPTURE_ISSUE_TEXT[code] ?? code;
}

/** Pure validation of a captured lap (exported for tests and the UI). */
export function validateReferenceLap(
  c: CompletedLap,
  meta: ReferenceCaptureMeta,
  opts: {
    lengthTolerance?: number;
    timeToleranceMs?: number;
    maxGapPackets?: number;
    maxLossRatio?: number;
  } = {},
): string[] {
  const issues: string[] = [];
  const flags = c.lap.flags;
  if (flags.includes('paused')) issues.push('paused');
  if (flags.includes('discontinuity')) issues.push('discontinuity');
  const tr = c.trace;
  let maxGap = 0;
  const ids = tr.channels.packetId;
  for (let i = 1; i < tr.length; i++)
    maxGap = Math.max(maxGap, Number(ids[i]) - Number(ids[i - 1]) - 1);
  const lossRatio = c.lap.lostPackets / Math.max(1, tr.length + c.lap.lostPackets);
  if (maxGap > (opts.maxGapPackets ?? 6) || lossRatio > (opts.maxLossRatio ?? 0.005)) {
    issues.push('packetGaps');
  }
  if (c.track && tr.length > 2) {
    const len = lapPolyline(tr.channels.x, tr.channels.z).length;
    if (Math.abs(len - c.track.lengthM) / c.track.lengthM > (opts.lengthTolerance ?? 0.02)) {
      issues.push('lengthMismatch');
    }
  }
  if (
    meta.rankingTimeMs &&
    Math.abs(c.lap.timeMs - meta.rankingTimeMs) > (opts.timeToleranceMs ?? 300)
  ) {
    issues.push('timeMismatch');
  }
  if (
    meta.expectedCarCode !== undefined &&
    meta.expectedCarCode !== null &&
    c.lap.carCode !== meta.expectedCarCode
  ) {
    issues.push('carMismatch');
  }
  return issues;
}

// -------------------------------------------------------------------------------------------------
// Tuning
// -------------------------------------------------------------------------------------------------

/** Identification: the car counts as "on the track" within this distance of the centerline (m). */
const IDENT_LATERAL_M = 20;
/** Identification: evaluate every Nth moving packet (the projection is a full search). */
const IDENT_EVERY = 3;
/** Identification needs this many evaluations, with this share of them inside the tolerance. */
const IDENT_MIN_EVALS = 30;
const IDENT_MIN_INSIDE = 0.9;
const IDENT_WINDOW = 60;
/** After this many evaluations without a match the track is reported unknown (≈ 3 s moving). */
const IDENT_UNKNOWN_EVALS = 60;
/** Further than this from the locked track's line for FAR_PACKETS = not the right track (m). */
const FAR_M = 100;
const FAR_PACKETS = 60;
/** Position stalls: identical position this many packets in a row while recording = paused. */
const STALL_PACKETS = 4;
/** No packet for this long, with few packetIds elapsed = the game froze (pause) (ms). */
const FREEZE_RECV_MS = 500;
/** Lost packets in a row beyond which the stretch is unusable (1.5 s). */
const HUGE_GAP_PACKETS = 90;
/** Moving at least this fast (m/s) for a line crossing to count. */
const CROSSING_MIN_SPEED_MPS = 1;
/** Only look for a gate crossing on the part of the course near start/finish. */
const CROSSING_WINDOW_M = 40;
/** Replay speed check: implied vs reported speed, and wall clock vs packet time. */
const SPEED_RATIO_MIN = 0.85;
const SPEED_RATIO_MAX = 1.15;
const WALL_TOLERANCE_MS = 400;
const WALL_TOLERANCE_REL = 0.02;
/** Status republish interval while recording (ms). */
const STATUS_EVERY_MS = 500;

interface Candidate {
  track: Track;
  line: Polyline;
  hist: { inside: boolean; dist: number }[];
}

interface Recording {
  startPk: number;
  startRecv: number;
  startU: number;
  msPerPacket: number;
  builder: TraceBuilder;
  carCode: number;
  format: TelemetryPacket['format'];
  lastPk: number;
  lastU: number;
  lost: number;
  startGap: number;
  pathLen: number;
  speedLen: number;
  lastX: number;
  lastZ: number;
  samples: number;
}

interface TimingGate {
  x: number;
  z: number;
  dx: number;
  dz: number;
}

interface Crossing {
  pk: number;
  recv: number;
  u: number;
  gap: number;
  sample: LapSample;
}

/** Use the course on both sides of the line so a single resampled segment cannot tilt the gate. */
function timingGate(line: Polyline): TimingGate {
  const origin = line.pointAt(0);
  const before = line.pointAt(-8);
  const after = line.pointAt(8);
  const dx = after.x - before.x;
  const dz = after.z - before.z;
  const length = Math.hypot(dx, dz);
  return length > 0
    ? { x: origin.x, z: origin.z, dx: dx / length, dz: dz / length }
    : { x: origin.x, z: origin.z, dx: Math.sin(origin.heading), dz: Math.cos(origin.heading) };
}

function gateOffset(gate: TimingGate, { x, z }: TelemetryPacket['position']): number {
  return (x - gate.x) * gate.dx + (z - gate.z) * gate.dz;
}

function replaySample(info: EnginePacketInfo): LapSample {
  const p = info.packet;
  const slip = wheelSlipRatios(p);
  const g = info.g;
  return {
    tMs: 0,
    distanceM: 0,
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
  };
}

function crossingSample(before: EnginePacketInfo, after: EnginePacketInfo, f: number): LapSample {
  if (f === 1) return replaySample(after);
  const a = replaySample(before);
  const b = replaySample(after);
  const sample = { ...a };
  for (const channel of LAP_SAMPLE_CHANNELS) {
    sample[channel] =
      channel === 'flags' || channel === 'gear' || channel === 'packetId'
        ? (f < 0.5 ? a : b)[channel]
        : a[channel] + f * (b[channel] - a[channel]);
  }
  return sample;
}

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export class ReferenceCapture extends EventEmitter<ReferenceCaptureEvents> {
  readonly options: ReferenceCaptureOptions;
  readonly #newId: () => Id;
  #state: CaptureState = 'idle';
  #meta: ReferenceCaptureMeta | null = null;
  #lapId: Id | null = null;
  #issues: string[] = [];
  #lastCapture: CompletedLap | null = null;
  #waiting: CaptureWaiting | null = null;
  #replayDetected = false;
  #hint: string | null = null;
  #measured: number | null = null;
  #diff: number | null = null;
  #timeSource: 'ranking' | 'packets' | null = null;

  // track
  #candidates: Candidate[] = [];
  #identTick = 0;
  #identEvals = 0;
  #track: Track | null = null;
  #line: Polyline | null = null;
  #gate: TimingGate | null = null;
  #far = 0;

  // stream
  #prevU: number | null = null;
  #prevInfo: EnginePacketInfo | null = null;
  #stillPk = 0;
  #rec: Recording | null = null;
  #lastStatusAt = 0;
  #lastKey = '';
  /** receivedAt of the packet being handled (clock for the status throttle). */
  #now = 0;

  #onPacket = (info: EnginePacketInfo) => this.#handle(info);

  constructor(opts: ReferenceCaptureOptions) {
    super();
    this.options = opts;
    this.#newId = opts.idFactory ?? (() => newId());
  }

  get status(): ReferenceCaptureStatus {
    const rec = this.#rec;
    const L = this.#line?.length ?? 0;
    const base: ReferenceCaptureStatus = {
      state: this.#state,
      driverName: this.#meta?.driverName ?? null,
      lapId: this.#lapId,
      issues: [...this.#issues],
      waiting: this.#state === 'waitingLapStart' ? this.#waiting : null,
      replayDetected: this.#replayDetected,
      trackId: this.#track?.id ?? null,
      trackName: this.#track?.name ?? null,
      recordingMs:
        rec && this.#state === 'recording'
          ? Math.max(0, Math.round((rec.lastPk - rec.startPk) * rec.msPerPacket))
          : null,
      lapFraction:
        rec && L > 0 && this.#state === 'recording'
          ? Math.min(1, Math.max(0, (rec.lastU - rec.startU) / L))
          : null,
      measuredLapMs: this.#measured,
      rankingTimeMs: this.#meta?.rankingTimeMs ?? null,
      diffMs: this.#diff,
      timeSource: this.#timeSource,
      hint: this.#hint,
    };
    return base;
  }

  get active(): boolean {
    return this.#state !== 'idle';
  }

  /** Arms the capture: waits for a replay, identifies the track and records the next full lap. */
  async start(meta: ReferenceCaptureMeta): Promise<ReferenceCaptureStatus> {
    if (this.active) await this.stop(true);
    this.#meta = { ...meta };
    this.#lapId = null;
    this.#issues = [];
    this.#lastCapture = null;
    this.#measured = null;
    this.#diff = null;
    this.#timeSource = null;
    this.#replayDetected = false;
    this.#resetStream();
    this.#resetTrack();
    const e = this.options.engine;
    e.on('packet', this.#onPacket);
    if (this.options.enter) {
      this.#state = 'switchingFormat';
      this.#hint = 'Preparando a captura…';
      this.#publish();
      try {
        await this.options.enter();
      } catch (err) {
        await this.stop(false);
        throw err;
      }
      if ((this.#state as CaptureState) === 'idle') return this.status;
    }
    // explicit track: lock it now (or explain why not)
    if (meta.trackId) this.#lockExplicit(meta.trackId);
    else this.#loadCandidates();
    this.#state = 'waitingLapStart';
    this.#setWaiting('replay', true);
    return this.status;
  }

  /** Stops waiting/recording. `save = false` also deletes a lap this run already captured. */
  async stop(save = true): Promise<ReferenceCaptureStatus> {
    if (!save && this.#lapId) {
      const id = this.#lapId;
      this.#lapId = null;
      await this.options.store.deleteLap?.(id);
    }
    const wasActive = this.active;
    this.#detach();
    this.#rec = null;
    this.#state = 'idle';
    this.#waiting = null;
    this.#hint = null;
    this.#publish();
    if (wasActive) await this.#exit();
    return this.status;
  }

  /** Last lap seen by this capture run (valid or not). */
  get lastCapture(): CompletedLap | null {
    return this.#lastCapture;
  }

  // -----------------------------------------------------------------------------------------------
  // Setup helpers
  // -----------------------------------------------------------------------------------------------

  #detach(): void {
    this.options.engine.off('packet', this.#onPacket);
  }

  async #exit(): Promise<void> {
    try {
      await this.options.exit?.();
    } catch {
      // exit problems are reported by the owner (runtime notices)
    }
  }

  #resetStream(): void {
    this.#prevU = null;
    this.#prevInfo = null;
    this.#stillPk = 0;
    this.#rec = null;
    this.#far = 0;
  }

  #resetTrack(): void {
    this.#candidates = [];
    this.#identTick = 0;
    this.#identEvals = 0;
    this.#track = null;
    this.#line = null;
    this.#gate = null;
  }

  #lineOf(trackId: Id): Polyline | null {
    const cl = this.options.store.getCenterline(trackId);
    return cl && cl.x.length >= 3 ? centerlinePolyline(cl) : null;
  }

  #loadCandidates(): void {
    this.#candidates = [];
    for (const track of this.options.store.listTracks()) {
      const line = this.#lineOf(track.id);
      if (line) this.#candidates.push({ track, line, hist: [] });
    }
  }

  #lockExplicit(trackId: Id): void {
    const track = this.options.store.getTrack(trackId);
    const line = track ? this.#lineOf(trackId) : null;
    if (track && line) {
      this.#track = track;
      this.#line = line;
      this.#gate = timingGate(line);
      this.#candidates = [];
    } else {
      this.#loadCandidates(); // unknown id: fall back to the automatic identification
    }
  }

  #lock(c: Candidate): void {
    this.#track = c.track;
    this.#line = c.line;
    this.#gate = timingGate(c.line);
    this.#candidates = [];
    this.#prevU = null;
    this.#far = 0;
  }

  // -----------------------------------------------------------------------------------------------
  // Packet handling
  // -----------------------------------------------------------------------------------------------

  #handle(info: EnginePacketInfo): void {
    if (this.#state !== 'waitingLapStart' && this.#state !== 'recording') return;
    this.#now = info.receivedAt;
    const p = info.packet;
    const mpp = info.msPerPacket;

    // ---- not a replay (menu, live driving, loading) ----
    if (!info.carData) {
      this.#replayDetected = false;
      this.#breakStream('interrupted');
      this.#setWaiting('replay');
      return;
    }
    this.#replayDetected = true;
    if (this.#line && this.#state === 'waitingLapStart') this.#setWaiting('startLine');

    // ---- stream continuity ----
    const frozen = info.recvGap > FREEZE_RECV_MS && info.dPk * mpp < info.recvGap * 0.5;
    if (info.streamReset || frozen || info.dPk - 1 > HUGE_GAP_PACKETS) {
      this.#breakStream(frozen ? 'paused' : 'discontinuity');
    }
    this.#stillPk = info.samePosition ? this.#stillPk + info.dPk : 0;
    if (this.#stillPk >= STALL_PACKETS && this.#rec) {
      this.#breakStream('paused');
    }
    const previousPosition = this.#prevInfo?.packet.position;
    if (previousPosition && !info.samePosition) {
      const jump = Math.hypot(p.position.x - previousPosition.x, p.position.z - previousPosition.z);
      const reach = p.speedMps * ((info.dPk * mpp) / 1000);
      if (jump > 15 + 2.5 * reach) this.#breakStream('discontinuity');
    }

    // ---- track ----
    if (!this.#line) {
      this.#identify(info);
      this.#remember(info, null);
      this.#publishKey(info.receivedAt);
      return;
    }
    const prog = this.#progress(p);
    if (!prog) {
      this.#remember(info, null);
      return;
    }
    const { u, dist } = prog;
    // far from the line for a while: not this track
    if (dist > FAR_M) {
      this.#far += info.dPk;
      if (this.#far >= FAR_PACKETS) {
        this.#breakStream('discontinuity');
        if (this.#meta?.trackId) {
          this.#setWaiting('track');
        } else {
          this.#resetTrack();
          this.#loadCandidates();
          this.#setWaiting('track');
        }
        this.#remember(info, null);
        return;
      }
    } else {
      this.#far = 0;
    }

    const crossing = dist <= CROSSING_WINDOW_M ? this.#crossing(info, u) : null;
    if (crossing && (!this.#rec || crossing.u > this.#rec.startU)) {
      if (this.#rec) {
        if (Math.round((crossing.u - this.#rec.startU) / this.#line.length) !== 1) {
          this.#breakStream('discontinuity');
        } else if (this.#finishLap(crossing)) {
          return;
        }
      }
      this.#startLap(info, crossing);
    }
    if (this.#rec) this.#addSample(info, u);
    this.#remember(info, u);
    this.#publishKey(info.receivedAt);
  }

  #remember(info: EnginePacketInfo, u: number | null): void {
    this.#prevU = u;
    this.#prevInfo = u === null ? null : info;
  }

  #crossing(info: EnginePacketInfo, u: number): Crossing | null {
    const line = this.#line!;
    const gate = this.#gate!;
    const lineU = Math.round(u / line.length) * line.length;
    const p = info.packet;
    if (Math.abs(u - lineU) > CROSSING_WINDOW_M || p.speedMps < CROSSING_MIN_SPEED_MPS) {
      return null;
    }

    const offset = gateOffset(gate, p.position);
    const prev = this.#prevInfo;
    const prevU = this.#prevU;
    if (!prev || prevU === null) {
      // A replay can open on the first frame after the line. Allow up to 1.5 packets.
      const forwardMps = p.velocity.x * gate.dx + p.velocity.z * gate.dz;
      const metresPerPacket = (forwardMps * info.msPerPacket) / 1000;
      if (info.samePosition || forwardMps <= 10 || offset < 0 || offset > 1.5 * metresPerPacket) {
        return null;
      }
      const back = offset / metresPerPacket;
      const sample = replaySample(info);
      sample.x -= offset * gate.dx;
      sample.z -= offset * gate.dz;
      return {
        pk: p.packetId - back,
        recv: info.receivedAt - back * info.msPerPacket,
        u: lineU,
        gap: 0,
        sample,
      };
    }
    if (Math.abs(prevU - lineU) > CROSSING_WINDOW_M) return null;
    const before = gateOffset(gate, prev.packet.position);
    if (before >= 0 || offset < 0) return null;
    const f = -before / (offset - before);
    return {
      pk: prev.packet.packetId + f * (p.packetId - prev.packet.packetId),
      recv: prev.receivedAt + f * (info.receivedAt - prev.receivedAt),
      u: lineU,
      gap: info.dPk - 1,
      sample: crossingSample(prev, info, f),
    };
  }

  /** Progress along the locked line, unwrapped (continuous across laps). */
  #progress(p: TelemetryPacket): { u: number; dist: number } | null {
    const line = this.#line!;
    const L = line.length;
    const x = p.position.x;
    const z = p.position.z;
    const prev = this.#prevU;
    if (prev === null) {
      const pr = line.project(x, z);
      return pr ? { u: pr.s, dist: pr.dist } : null;
    }
    const local = ((prev % L) + L) % L;
    let pr = line.project(x, z, local - 40, local + 120);
    if (!pr || pr.dist > 60) {
      const full = line.project(x, z);
      if (full && (!pr || full.dist < pr.dist)) pr = full;
    }
    if (!pr) return null;
    let delta = pr.s - local;
    if (delta < -L / 2) delta += L;
    else if (delta > L / 2) delta -= L;
    return { u: prev + delta, dist: pr.dist };
  }

  #identify(info: EnginePacketInfo): void {
    const p = info.packet;
    if (p.speedMps < 3) {
      this.#setWaiting('replay'); // a replay screen with the car standing still
      return;
    }
    if (this.#candidates.length === 0) {
      this.#loadCandidates();
      if (this.#candidates.length === 0) {
        this.#setWaiting('unknownTrack');
        return;
      }
    }
    if (this.#identTick++ % IDENT_EVERY !== 0) return;
    this.#identEvals++;
    let best: { c: Candidate; mean: number } | null = null;
    for (const c of this.#candidates) {
      const pr = c.line.project(p.position.x, p.position.z);
      const dist = pr ? pr.dist : Number.POSITIVE_INFINITY;
      c.hist.push({ inside: dist <= IDENT_LATERAL_M, dist });
      if (c.hist.length > IDENT_WINDOW) c.hist.shift();
      if (c.hist.length < IDENT_MIN_EVALS) continue;
      const inside = c.hist.filter((h) => h.inside).length / c.hist.length;
      if (inside < IDENT_MIN_INSIDE) continue;
      const mean = c.hist.reduce((s, h) => s + Math.min(h.dist, 1000), 0) / c.hist.length;
      if (!best || mean < best.mean) best = { c, mean };
    }
    if (best) {
      this.#lock(best.c);
      this.#setWaiting('startLine', true);
    } else if (this.#identEvals >= IDENT_UNKNOWN_EVALS) {
      this.#setWaiting('unknownTrack');
    } else {
      this.#setWaiting('track');
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Laps
  // -----------------------------------------------------------------------------------------------

  #startLap(info: EnginePacketInfo, crossing: Crossing): void {
    const p = info.packet;
    const builder = new TraceBuilder(6000);
    builder.push(crossing.sample);
    this.#rec = {
      startPk: crossing.pk,
      startRecv: crossing.recv,
      startU: crossing.u,
      msPerPacket: info.msPerPacket,
      builder,
      carCode: p.carCode,
      format: p.format,
      lastPk: crossing.pk,
      lastU: crossing.u,
      lost: 0,
      startGap: crossing.gap,
      pathLen: 0,
      speedLen: 0,
      lastX: p.position.x,
      lastZ: p.position.z,
      samples: 0,
    };
    this.#state = 'recording';
    this.#hint = 'Gravando a volta. Não pause, volte nem avance o replay.';
    this.#publish();
  }

  #addSample(info: EnginePacketInfo, u: number): void {
    const rec = this.#rec!;
    const p = info.packet;
    const mpp = rec.msPerPacket;
    if (rec.samples > 0) {
      rec.lost += Math.max(0, info.dPk - 1);
      rec.pathLen += Math.hypot(p.position.x - rec.lastX, p.position.z - rec.lastZ);
      rec.speedLen += (p.speedMps * info.dPk * mpp) / 1000;
    }
    rec.lastX = p.position.x;
    rec.lastZ = p.position.z;
    rec.lastPk = p.packetId;
    rec.lastU = u;
    rec.samples++;
    // hard cap: a replay left running on a track that never closes the lap
    if (rec.builder.length >= 108_000 || p.packetId <= rec.startPk) return;
    rec.builder.push({
      ...replaySample(info),
      tMs: (p.packetId - rec.startPk) * mpp,
      distanceM: Math.max(0, Math.min(this.#line!.length, u - rec.startU)),
    });
  }

  /** The lap in progress is unusable (pause, jump, replay gone). Waits for the next crossing. */
  #breakStream(code: string): void {
    const had = this.#rec;
    this.#prevU = null;
    this.#prevInfo = null;
    this.#stillPk = 0;
    this.#far = 0;
    if (!had) return;
    this.#rec = null;
    this.#state = 'waitingLapStart';
    this.#issues = [code];
    this.#waiting = this.#line ? 'startLine' : 'replay';
    this.#hint =
      code === 'interrupted'
        ? `Volta descartada: ${captureIssueText(code)}. Abra o replay de novo e deixe tocar sem pausar.`
        : `Volta descartada: ${captureIssueText(code)}. Deixe o replay seguir sem pausar; gravo a próxima volta.`;
    this.#publish();
    this.emit('invalid', [code], null);
  }

  /** Closes the lap at a crossing. Returns true when it was valid and saved (capture done). */
  #finishLap(crossing: Crossing): boolean {
    const rec = this.#rec!;
    const meta = this.#meta!;
    const track = this.#track!;
    const line = this.#line!;
    const rankingMs = meta.rankingTimeMs ?? null;
    this.#rec = null;
    this.#state = 'validating';
    this.#hint = 'Validando a volta…';
    this.#publish();

    const elapsedMs = (crossing.pk - rec.startPk) * rec.msPerPacket;
    const measuredMs = Math.round(elapsedMs);
    const wallMs = crossing.recv - rec.startRecv;
    const extra: string[] = [];
    const speedRatio = rec.pathLen > 0 ? rec.speedLen / rec.pathLen : 1;
    if (
      speedRatio < SPEED_RATIO_MIN ||
      speedRatio > SPEED_RATIO_MAX ||
      (this.options.checkRealtime !== false &&
        Math.abs(wallMs - measuredMs) >
          Math.max(WALL_TOLERANCE_MS, measuredMs * WALL_TOLERANCE_REL))
    ) {
      extra.push('notRealtime');
    }

    const lapId = this.#newId();
    const sessionId = this.#newId();
    rec.builder.push({ ...crossing.sample, tMs: elapsedMs, distanceM: line.length });
    const trace = rec.builder.build(lapId, 60);
    const draft = this.#buildCompleted({
      rec,
      track,
      lapId,
      sessionId,
      timeMs: measuredMs,
      trace,
      crossingRecv: crossing.recv,
      measuredMs,
    });
    this.#lastCapture = draft;
    const issues = [...extra, ...validateReferenceLap(draft, meta, this.options)];
    if (
      Math.max(rec.startGap, crossing.gap) > (this.options.maxGapPackets ?? 6) &&
      !issues.includes('packetGaps')
    ) {
      issues.push('packetGaps');
    }
    this.#measured = measuredMs;
    this.#diff = rankingMs ? measuredMs - rankingMs : null;

    if (issues.length) {
      this.#issues = issues;
      this.#state = 'waitingLapStart';
      this.#hint = `Volta descartada: ${issues.map(captureIssueText).join('; ')}. Gravo a próxima volta.`;
      this.emit('invalid', issues, draft);
      // the next lap starts at this very crossing: keep recording it
      return false;
    }

    // ---- accepted ----
    const useRanking = rankingMs !== null;
    const timeMs = useRanking ? rankingMs : measuredMs;
    const k = timeMs / elapsedMs;
    const t = trace.channels.tMs;
    for (let i = 0; i < t.length - 1; i++) t[i] = t[i]! * k;
    t[t.length - 1] = timeMs;
    const final = this.#buildCompleted({
      rec,
      track,
      lapId,
      sessionId,
      timeMs,
      trace,
      crossingRecv: crossing.recv,
      measuredMs,
    });
    const refMeta: ReferenceMeta = {
      driverName: meta.driverName,
      source: 'replayCapture',
      rankingTimeMs: rankingMs,
      carName: meta.carName ?? null,
      notes: meta.notes ?? null,
      capturedAt: crossing.recv,
      timeSource: useRanking ? 'ranking' : 'packets',
      measuredTimeMs: measuredMs,
    };
    const store = this.options.store;
    store.saveSession({ ...final.session });
    store.saveLap(final.lap, final.trace);
    const updated = store.setReference(lapId, refMeta);
    const lap: Lap =
      updated && typeof updated === 'object' && 'id' in updated
        ? (updated as Lap)
        : { ...final.lap, isReference: true, referenceMeta: refMeta };
    this.#lastCapture = final;
    this.#lapId = lapId;
    this.#issues = [];
    this.#timeSource = useRanking ? 'ranking' : 'packets';
    this.#detach();
    this.#state = 'idle';
    this.#waiting = null;
    this.#hint = useRanking
      ? `Volta salva: ${fmtTime(timeMs)} (tempo do ranking; medido pelos pacotes: diferença de ${Math.abs(this.#diff ?? 0)} ms).`
      : `Volta salva: ${fmtTime(timeMs)} (tempo estimado pela telemetria).`;
    this.#publish();
    this.options.engine.refreshReference();
    this.emit('captured', final, lap);
    queueMicrotask(() => void this.#exit());
    return true;
  }

  #buildCompleted(a: {
    rec: Recording;
    track: Track;
    lapId: Id;
    sessionId: Id;
    timeMs: number;
    trace: LapTrace;
    crossingRecv: number;
    measuredMs: number;
  }): CompletedLap {
    const { rec, track, trace, timeMs } = a;
    const dCol = trace.channels.distanceM;
    const tCol = trace.channels.tMs;
    const bounds = sectorBoundaries(track) ?? [track.lengthM / 3, (2 * track.lengthM) / 3];
    const sectorTimesMs = computeSectorTimes(dCol, tCol, bounds, timeMs);
    const session: Session = {
      id: a.sessionId,
      trackId: track.id,
      carCode: rec.carCode,
      startedAt: Math.round(rec.startRecv),
      endedAt: Math.round(a.crossingRecv),
      format: rec.format,
      mode: 'replayCapture',
      lapCount: 1,
      bestLapMs: null,
      recordingFile: null,
      notes: null,
      trackTimeMs: 0,
    };
    const lap: Lap = {
      id: a.lapId,
      sessionId: a.sessionId,
      number: 1,
      timeMs,
      sectorTimesMs,
      valid: true,
      flags: ['replay'],
      isReference: false,
      referenceMeta: null,
      startedAt: Math.round(rec.startRecv),
      carCode: rec.carCode,
      trackId: track.id,
      fuelUsedL: null,
      sampleCount: trace.length,
      lostPackets: rec.lost,
      traceFile: null,
    };
    const event: LapCompletedEvent = {
      sessionId: a.sessionId,
      lapId: a.lapId,
      lapNumber: 1,
      timeMs,
      sectorTimesMs,
      sectorStatus: sectorTimesMs.map((t) => (t === null ? 'pending' : 'slower')),
      valid: true,
      flags: ['replay'],
      deltaMs: null,
      deltaReference: this.options.engine.deltaReference.kind,
      isPersonalBest: false,
      isSessionBest: false,
      bestSectorIndex: null,
      fuelUsedL: null,
      completedAt: Math.round(a.crossingRecv),
      trackId: track.id,
    };
    return {
      event,
      lap,
      trace,
      countedTimeMs: a.measuredMs,
      gameTimeMs: null,
      lengthM: track.lengthM,
      track,
      session,
    };
  }

  // -----------------------------------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------------------------------

  #setWaiting(w: CaptureWaiting, force = false): void {
    if (this.#state !== 'waitingLapStart') return;
    if (!force && this.#waiting === w) return;
    this.#waiting = w;
    const name = this.#track?.name ?? null;
    switch (w) {
      case 'replay':
        this.#hint =
          'Aguardando o replay. No jogo, abra o replay da volta e deixe tocar em velocidade 1×.';
        break;
      case 'track':
        this.#hint = this.#meta?.trackId
          ? `O replay não parece estar na pista escolhida${name ? ` (${name})` : ''}.`
          : 'Replay detectado — identificando a pista…';
        break;
      case 'unknownTrack':
        this.#hint =
          'Pista desconhecida — dirija essa pista ao vivo primeiro (uma volta completa) para o app aprender o traçado; depois capture o replay.';
        break;
      case 'startLine':
        this.#hint = `Replay detectado${name ? ` em ${name}` : ''}. Aguardando o carro cruzar a linha de largada…`;
        break;
    }
    this.#publish();
  }

  /** Republishes when the visible key changes, or every STATUS_EVERY_MS while recording. */
  #publishKey(now: number): void {
    const key = `${this.#state}|${this.#waiting}|${this.#replayDetected}|${this.#track?.id ?? ''}`;
    if (key !== this.#lastKey) {
      this.#publish();
      return;
    }
    if (this.#state === 'recording' && now - this.#lastStatusAt >= STATUS_EVERY_MS) {
      this.#hint = `Gravando a volta ${fmtTime(this.status.recordingMs ?? 0)}. Não pause, volte nem avance o replay.`;
      this.#publish();
    }
  }

  #publish(): void {
    this.#lastKey = `${this.#state}|${this.#waiting}|${this.#replayDetected}|${this.#track?.id ?? ''}`;
    this.#lastStatusAt = this.#now;
    this.emit('status', this.status);
  }
}
