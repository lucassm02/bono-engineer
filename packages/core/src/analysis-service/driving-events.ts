/**
 * Driving events (docs/spec-engenheiro-de-radio.md, "Eventos de pilotagem"): deterministic rules
 * over the recorded samples of a prepared lap that flag understeer ("saída de frente"), oversteer
 * ("saída de traseira"), front lock ("travamento dianteiro") and exit traction loss ("perda de
 * tração na saída"), each with corner, distance/time range, evidence, confidence and ONE action.
 *
 * Signals (verified on a real PS5 session, Huracán Gr.4 at Trial Mountain):
 * - yawRate (world Y angular velocity) + = left, like steeringRad and latG (+ = left);
 * - steady cornering obeys yaw ≈ v·steer / G with G ≈ 75–85 m for that car, so the expected yaw of
 *   a steering input is calibrated per lap ({@link calibrateDrivingEventModel}) and capped by the
 *   lap's grip (p95 lateral acceleration / speed);
 * - sideslip build-up = ∫(yaw − course rate) dt, the course rate taken from the X/Z positions
 *   (agrees with latG/v within a few %, and does not depend on the accelerometer frame);
 * - slip ratios are wheel surface speed / car speed − 1 (all four wheels read ≈ −6% in a straight
 *   hard stop and +2% accelerating with this car, so thresholds sit well beyond that);
 * - one-sample car-speed drops (impacts) make every wheel look like it spins: such samples are
 *   rejected by comparing dv/dt with the measured longitudinal acceleration.
 *
 * Use on a whole stored lap: `detectDrivingEvents(prepared, corners)`. Live, per corner pass:
 * calibrate a model once from a previous lap of the car (`calibrateDrivingEventModel`), keep the
 * samples of the current lap, and when the car is ~80 m past a corner exit call
 * `detectCornerPassEvents(prepareLap(partialTrace, line), corners, cornerId, { model })`; the
 * radio then takes `radioEventForPass(events)` (high confidence only, at most one per pass) once
 * the car reaches `settledM`.
 */

import {
  type CornerWindows,
  channel,
  cornerWindows,
  indexAtDistance,
  type PreparedLap,
  sampleAtOrAfter,
} from '@gt7/analysis';
import {
  type Corner,
  type DrivingEvent,
  type DrivingEventEvidence,
  type DrivingEventKind,
  type DrivingEventModel,
  type DrivingEventPhase,
  type FindingConfidence,
  FRONT_LOCK_SLIP_THRESHOLD,
  SimulatorFlags,
} from '@gt7/shared';

const G0 = 9.81;
const DEG = 180 / Math.PI;

/** Rule thresholds, tuned on the recorded Trial Mountain laps (see driving-events.test.ts). */
export const DRIVING_EVENT_THRESHOLDS = {
  /** Gaps shorter than this inside a run of candidate samples are merged (s). */
  mergeGapS: 0.1,
  /** Car-speed derivative that disagrees with lonG by more than this is an impact/glitch (m/s²). */
  glitchAccMps2: 30,
  /** Samples around a glitch that are ignored (s). */
  glitchMarginS: 0.25,
  /** Distance to the reference line considered off track (m). */
  offTrackM: 9,
  /** |vertG − baseline| that marks a crest, compression or kerb (g). */
  verticalDisturbanceG: 0.6,

  /** Minimum speed of the steering/rotation rules (m/s, ≈ 54 km/h). */
  minSpeedMps: 15,
  /** Yaw response lag behind the steering input (s). */
  steerLagS: 0.12,
  /** Steering faster than this is a transition, not a held input (rad/s). */
  maxSteerRateRadS: 1.5,
  /** Before/after a steering sign change the car is changing direction (s). */
  transitionWindowS: 0.5,

  understeerMinSteerRad: 0.1,
  /** Expected yaw below this is too little input to judge (rad/s ≈ 7°/s). */
  understeerMinExpectedYaw: 0.12,
  /** Actual / expected yaw at or below this is a candidate sample. */
  understeerYawRatio: 0.6,
  understeerHighYawRatio: 0.45,
  understeerMinS: 0.3,
  understeerHighS: 0.4,
  /** Outward drift needed (m): low / medium / high. */
  understeerMinOpeningM: 1,
  understeerMediumOpeningM: 1.5,
  understeerHighOpeningM: 2.5,

  minYawRad: 0.1,
  /** Body rotation beyond the path that makes a candidate sample (rad/s ≈ 5.7°/s). */
  oversteerRateRadS: 0.1,
  /** Accumulated rotation beyond the path (°): minimum / without countersteer / strong. */
  oversteerMinSlipDeg: 4,
  oversteerMediumSlipDeg: 6,
  oversteerHighSlipDeg: 15,
  /** Yaw / linear yaw of the steering input that counts as "more than the input". */
  oversteerYawRatio: 1.35,
  countersteerMinRad: 0.05,
  countersteerMinS: 0.1,
  countersteerHighS: 0.15,
  /** Long countersteer that confirms a slide even with little accumulated rotation (s). */
  countersteerLongS: 0.25,

  lockMinSpeedMps: 8.3,
  lockMinBrake: 0.1,
  /** Front slip that starts a lock signal / counts as lock / deep lock. */
  lockSignalSlip: 0.1,
  lockSlip: FRONT_LOCK_SLIP_THRESHOLD,
  lockDeepSlip: 0.18,
  lockMinS: 0.15,
  lockSignalMinS: 0.25,
  lockHighS: 0.4,

  tractionMinThrottle: 0.3,
  tractionSlip: 0.1,
  tractionHighSlip: 0.15,
  tractionMinS: 0.2,
  tractionMediumS: 0.25,
  tractionHighS: 0.3,
} as const;

export type DrivingEventThresholds = {
  -readonly [K in keyof typeof DRIVING_EVENT_THRESHOLDS]: number;
};

export interface DetectDrivingEventsOptions {
  /** Response model; default calibrated from `lap` itself (needs a full lap). */
  model?: DrivingEventModel;
  thresholds?: Partial<DrivingEventThresholds>;
  /** Only events starting in [fromM, toM] (aligned distance). */
  fromM?: number;
  toM?: number;
}

export interface DrivingEventsResult {
  events: DrivingEvent[];
  model: DrivingEventModel;
  warnings: string[];
}

/** Fallback v·steer/yaw (m) when a lap has too few clean cornering samples to calibrate. */
const DEFAULT_STEER_GAIN_M = 80;
const MIN_CALIBRATION_SAMPLES = 150;

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
}

const finite = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);

/**
 * Response model of a lap: steering gain from clean steady cornering (same-sign steering and yaw,
 * 15–45 m/s, slow steering, body following the path), grip cap and vertical baseline.
 */
export function calibrateDrivingEventModel(lap: PreparedLap): DrivingEventModel {
  const tr = lap.trace;
  const speed = channel(tr, 'speedKmh');
  const steer = channel(tr, 'steeringRad');
  const yaw = channel(tr, 'yawRate');
  const lat = channel(tr, 'latG');
  const vert = channel(tr, 'vertG');
  const gains: number[] = [];
  const latAcc: number[] = [];
  const verts: number[] = [];
  for (let i = 1; i < lap.n - 1; i++) {
    const v = speed[i]! / 3.6;
    if (finite(vert[i])) verts.push(vert[i]!);
    if (!(v >= 15) || !finite(lat[i])) continue;
    latAcc.push(Math.abs(lat[i]! * G0));
    const st = steer[i]!;
    const y = yaw[i]!;
    if (!finite(st) || !finite(y) || v > 45) continue;
    if (Math.abs(st) < 0.1 || Math.abs(y) < 0.1 || Math.sign(st) !== Math.sign(y)) continue;
    const dt = lap.t[i + 1]! - lap.t[i - 1]!;
    if (!(dt > 0) || Math.abs((steer[i + 1]! - steer[i - 1]!) / dt) > 0.5) continue;
    if (Math.abs(y - (lat[i]! * G0) / v) > 0.05) continue;
    gains.push((v * st) / y);
  }
  const g = median(gains);
  return {
    steerGainM:
      gains.length >= MIN_CALIBRATION_SAMPLES && Number.isFinite(g)
        ? Math.min(200, Math.max(40, g))
        : null,
    maxLatAccMps2: Math.max(8, finite(percentile(latAcc, 0.95)) ? percentile(latAcc, 0.95) : 8),
    verticalBaselineG: verts.length ? median(verts) : 0,
    samples: gains.length,
  };
}

/** Per-sample signals shared by every rule. */
interface Signals {
  lap: PreparedLap;
  th: DrivingEventThresholds;
  model: DrivingEventModel;
  gain: number;
  hasSteering: boolean;
  v: Float64Array;
  steer: ArrayLike<number>;
  steerLag: Float64Array;
  yaw: ArrayLike<number>;
  courseRate: Float64Array;
  throttle: ArrayLike<number>;
  brake: ArrayLike<number>;
  slip: ArrayLike<number>[];
  flags: ArrayLike<number>;
  vert: ArrayLike<number>;
  /** Sample usable: no impact glitch nearby, sane time step. */
  ok: Uint8Array;
  /** Lap times (s) of the impact glitches. */
  impacts: number[];
}

function buildSignals(
  lap: PreparedLap,
  model: DrivingEventModel,
  th: DrivingEventThresholds,
): Signals {
  const tr = lap.trace;
  const { n, t } = lap;
  const speed = channel(tr, 'speedKmh');
  const steer = channel(tr, 'steeringRad');
  const lon = channel(tr, 'lonG');
  const x = channel(tr, 'x');
  const z = channel(tr, 'z');
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.max(0, (speed[i]! || 0) / 3.6);

  // Steering as the car feels it: the input `steerLagS` earlier.
  const steerLag = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    while (j < i && t[j + 1]! <= t[i]! - th.steerLagS) j++;
    steerLag[i] = steer[j]!;
  }

  // Course (direction of travel) rate from the positions, central differences over ±2 samples.
  const courseRate = new Float64Array(n);
  for (let i = 2; i < n - 2; i++) {
    const ax = x[i]! - x[i - 2]!;
    const az = z[i]! - z[i - 2]!;
    const bx = x[i + 2]! - x[i]!;
    const bz = z[i + 2]! - z[i]!;
    const dt = t[i + 1]! - t[i - 1]!;
    if (Math.hypot(ax, az) < 0.3 || Math.hypot(bx, bz) < 0.3 || !(dt > 0) || dt > 0.2) continue;
    let d = Math.atan2(bx, bz) - Math.atan2(ax, az);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    courseRate[i] = d / dt;
  }

  // Impact / speed glitches: car speed changing faster than the measured acceleration allows.
  const ok = new Uint8Array(n).fill(1);
  const impacts: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const dt = t[i + 1]! - t[i - 1]!;
    if (!(dt > 0) || dt > 0.25) {
      ok[i] = 0;
      continue;
    }
    const dv = (v[i + 1]! - v[i - 1]!) / dt;
    const measured = finite(lon[i]) ? lon[i]! * G0 : 0;
    if (Math.abs(dv - measured) > th.glitchAccMps2) {
      if (!impacts.length || t[i]! - impacts[impacts.length - 1]! > 0.2) impacts.push(t[i]!);
      for (let k = i; k >= 0 && t[i]! - t[k]! <= th.glitchMarginS; k--) ok[k] = 0;
      for (let k = i; k < n && t[k]! - t[i]! <= th.glitchMarginS; k++) ok[k] = 0;
    }
  }

  return {
    lap,
    th,
    model,
    gain: model.steerGainM ?? DEFAULT_STEER_GAIN_M,
    hasSteering: lap.hasSteering,
    v,
    steer,
    steerLag,
    yaw: channel(tr, 'yawRate'),
    courseRate,
    throttle: channel(tr, 'throttle'),
    brake: channel(tr, 'brake'),
    slip: [
      channel(tr, 'slipFL'),
      channel(tr, 'slipFR'),
      channel(tr, 'slipRL'),
      channel(tr, 'slipRR'),
    ],
    flags: channel(tr, 'flags'),
    vert: channel(tr, 'vertG'),
    ok,
    impacts,
  };
}

/** An impact (car-speed jump) happened during the run or up to `afterS` before it. */
function nearImpact(sig: Signals, a: number, b: number, afterS: number): boolean {
  const { t } = sig.lap;
  return sig.impacts.some((x) => x >= t[a]! - afterS && x <= t[b]!);
}

/** Runs of consecutive candidate samples in [a, b] (gaps ≤ mergeGapS merged), as [start, end]. */
function findRuns(
  sig: Signals,
  a: number,
  b: number,
  candidate: (i: number) => boolean,
): [number, number][] {
  const { t } = sig.lap;
  const runs: [number, number][] = [];
  let start = -1;
  let last = -1;
  for (let i = a; i <= b; i++) {
    if (!sig.ok[i] || !candidate(i)) continue;
    if (start >= 0 && t[i]! - t[last]! <= sig.th.mergeGapS + 1e-9) {
      last = i;
      continue;
    }
    if (start >= 0) runs.push([start, last]);
    start = i;
    last = i;
  }
  if (start >= 0) runs.push([start, last]);
  return runs;
}

function sampleDt(t: Float64Array, i: number): number {
  const d = t[Math.min(t.length - 1, i + 1)]! - t[i]!;
  return d > 0 && d < 0.1 ? d : 0;
}

function indexAtTime(t: Float64Array, from: number, targetS: number): number {
  let i = from;
  if (targetS >= t[from]!) {
    while (i < t.length - 1 && t[i + 1]! <= targetS) i++;
  } else {
    while (i > 0 && t[i]! > targetS) i--;
  }
  return i;
}

const LEVELS: FindingConfidence[] = ['low', 'medium', 'high'];

function downgrade(c: FindingConfidence, steps: number): FindingConfidence | null {
  const k = LEVELS.indexOf(c) - steps;
  return k >= 0 ? LEVELS[k]! : null;
}

function emptyEvidence(speedKmh: number): DrivingEventEvidence {
  return {
    speedKmh,
    steeringDeg: null,
    steeringChangeDeg: null,
    yawRateDps: null,
    expectedYawRateDps: null,
    yawRatio: null,
    lineOpeningM: null,
    slipAngleDeg: null,
    countersteerS: null,
    frontSlipPeak: null,
    rearSlipPeak: null,
    brake: null,
    throttle: null,
    tcsActiveS: null,
    verticalG: null,
  };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const roundOrNull = (v: number | null, d: number) =>
  v === null || !Number.isFinite(v) ? null : round(v, d);

/** Context notes shared by the rules: vertical disturbance, off track, replay. */
function contextNotes(
  sig: Signals,
  a: number,
  b: number,
): { notes: string[]; steps: number; verticalG: number } {
  const { lap, th, model } = sig;
  let vmax = 0;
  let offTrack = false;
  for (let i = a; i <= b; i++) {
    const vg = sig.vert[i]!;
    if (finite(vg)) vmax = Math.max(vmax, Math.abs(vg - model.verticalBaselineG));
    if (lap.distToLine[i]! > th.offTrackM) offTrack = true;
  }
  const notes: string[] = [];
  let steps = 0;
  if (vmax >= th.verticalDisturbanceG) {
    notes.push(
      `Carga vertical variou ${vmax.toFixed(1).replace('.', ',')} g (lombada, compressão ou zebra).`,
    );
    steps++;
  }
  if (offTrack) {
    notes.push('Fora da linha da pista (grama ou zebra larga): aderência diferente.');
    steps++;
  }
  if (lap.isReplay) {
    notes.push('Volta de replay: entradas suavizadas.');
    steps++;
  }
  if (nearImpact(sig, a, b, 1)) {
    notes.push('Impacto ou salto de velocidade logo antes: evidência contaminada.');
    steps++;
  }
  return { notes, steps, verticalG: vmax };
}

interface Candidate {
  kind: DrivingEventKind;
  a: number;
  b: number;
  confidence: FindingConfidence;
  evidence: DrivingEventEvidence;
  notes: string[];
  /** Mean pedals at the start, for phase and action. */
  brakeStart: number;
  throttleMean: number;
}

function meanOf(values: ArrayLike<number>, a: number, b: number, abs = false): number {
  let s = 0;
  let k = 0;
  for (let i = a; i <= b; i++) {
    const v = values[i]!;
    if (!finite(v)) continue;
    s += abs ? Math.abs(v) : v;
    k++;
  }
  return k ? s / k : Number.NaN;
}

/** Steering sign changed (|steer| > 0.1 rad both ways) between ta and tb. */
function steeringReverses(sig: Signals, ta: number, tb: number, sign: number): boolean {
  const { t } = sig.lap;
  const i0 = indexAtTime(t, 0, ta);
  for (let i = i0; i < sig.lap.n && t[i]! <= tb; i++) {
    const st = sig.steer[i]!;
    if (finite(st) && Math.sign(st) === -sign && Math.abs(st) > 0.1) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------- understeer

function detectUndersteer(sig: Signals, a: number, b: number, locked: Uint8Array): Candidate[] {
  if (!sig.hasSteering) return [];
  const { lap, th, model, gain, v, steer, steerLag, yaw } = sig;
  const { t } = lap;
  const expected = (i: number) =>
    Math.min((v[i]! * Math.abs(steerLag[i]!)) / gain, model.maxLatAccMps2 / Math.max(v[i]!, 1));
  const steerRate = (i: number) => {
    const dt = t[Math.min(lap.n - 1, i + 1)]! - t[Math.max(0, i - 1)]!;
    return dt > 0 ? (steer[Math.min(lap.n - 1, i + 1)]! - steer[Math.max(0, i - 1)]!) / dt : 0;
  };
  const runs = findRuns(sig, a, b, (i) => {
    const st = steerLag[i]!;
    if (!finite(st) || !finite(steer[i]) || locked[i]) return false;
    if (v[i]! < th.minSpeedMps || Math.abs(st) < th.understeerMinSteerRad) return false;
    if (Math.sign(st) !== Math.sign(steer[i]!)) return false;
    if (Math.abs(steerRate(i)) > th.maxSteerRateRadS) return false;
    const exp = expected(i);
    if (exp < th.understeerMinExpectedYaw) return false;
    return (yaw[i]! * Math.sign(st)) / exp <= th.understeerYawRatio;
  });
  const out: Candidate[] = [];
  for (const [ra, rb] of runs) {
    const dur = t[rb]! - t[ra]!;
    if (dur < th.understeerMinS) continue;
    const sign = Math.sign(steer[ra]!);
    // A direction change, not a car that refuses to turn.
    if (steeringReverses(sig, t[ra]! - th.transitionWindowS / 2, t[rb]!, sign)) continue;
    let yawS = 0;
    let expS = 0;
    for (let i = ra; i <= rb; i++) {
      yawS += yaw[i]! * sign;
      expS += expected(i);
    }
    const k = rb - ra + 1;
    const ratio = yawS / expS;
    if (ratio < -0.3) continue; // still rotating out of the previous turn
    const st0 = Math.abs(steer[ra]!);
    const st1 = Math.abs(steer[rb]!);
    if (st1 < st0 - 0.05) continue; // the driver unwound: not a held input
    const after = indexAtTime(t, rb, t[rb]! + 0.3);
    const opening = -sign * (lap.lateral[after]! - lap.lateral[ra]!);
    if (!(opening >= th.understeerMinOpeningM)) continue;
    let confidence: FindingConfidence =
      ratio <= th.understeerHighYawRatio &&
      opening >= th.understeerHighOpeningM &&
      dur >= th.understeerHighS
        ? 'high'
        : opening >= th.understeerMediumOpeningM
          ? 'medium'
          : 'low';
    const ctx = contextNotes(sig, ra, rb);
    const c = downgrade(confidence, ctx.steps);
    if (!c) continue;
    confidence = c;
    const evidence = emptyEvidence(v[ra]! * 3.6);
    evidence.steeringDeg = meanOf(steer, ra, rb, true) * DEG;
    evidence.steeringChangeDeg = (st1 - st0) * DEG;
    evidence.yawRateDps = (yawS / k) * DEG;
    evidence.expectedYawRateDps = (expS / k) * DEG;
    evidence.yawRatio = ratio;
    evidence.lineOpeningM = opening;
    evidence.brake = meanOf(sig.brake, ra, rb);
    evidence.throttle = meanOf(sig.throttle, ra, rb);
    evidence.verticalG = ctx.verticalG;
    out.push({
      kind: 'understeer',
      a: ra,
      b: rb,
      confidence,
      evidence,
      notes: ctx.notes,
      brakeStart: sig.brake[ra]!,
      throttleMean: evidence.throttle,
    });
  }
  return out;
}

// -------------------------------------------------------------------------------- oversteer

function detectOversteer(sig: Signals, a: number, b: number): Candidate[] {
  const { lap, th, gain, v, steer, yaw, courseRate } = sig;
  const { t } = lap;
  const betaRate = (i: number) => (yaw[i]! - courseRate[i]!) * Math.sign(yaw[i]!);
  const runs = findRuns(
    sig,
    a,
    b,
    (i) =>
      v[i]! >= th.minSpeedMps * 0.8 &&
      Math.abs(yaw[i]!) >= th.minYawRad &&
      betaRate(i) >= th.oversteerRateRadS,
  );
  const out: Candidate[] = [];
  for (const [ra0, rb] of runs) {
    // A run keeps one rotation direction.
    let ra = ra0;
    const sign = Math.sign(yaw[rb]!);
    while (ra < rb && Math.sign(yaw[ra]!) !== sign) ra++;
    let beta = 0;
    let cs = 0;
    let ratioSum = 0;
    let ratioN = 0;
    for (let i = ra; i <= rb; i++) {
      const dt = sampleDt(t, i);
      beta += Math.max(0, betaRate(i)) * dt;
      const st = steer[i]!;
      if (!finite(st)) continue;
      const yawAbs = Math.abs(yaw[i]!);
      const prev = Math.abs(yaw[Math.max(0, i - 3)]!);
      const dtp = t[i]! - t[Math.max(0, i - 3)]!;
      const unwinding = dtp > 0 && (yawAbs - prev) / dtp < -0.5;
      if (Math.sign(st) === -sign && Math.abs(st) >= th.countersteerMinRad && yawAbs >= 0.15) {
        if (!unwinding) cs += dt;
      } else if (Math.abs(st) >= 0.03 && Math.sign(st) === sign) {
        ratioSum += yawAbs / ((v[i]! * Math.abs(st)) / gain);
        ratioN++;
      }
    }
    const betaDeg = beta * DEG;
    if (betaDeg < th.oversteerMinSlipDeg) continue;
    const ratio = ratioN ? ratioSum / ratioN : Number.NaN;
    const transition =
      sig.hasSteering &&
      steeringReverses(sig, t[ra]! - th.transitionWindowS, t[rb]!, sign) &&
      cs < th.countersteerMinS;
    if (transition) continue;
    let confidence: FindingConfidence | null = null;
    if (sig.hasSteering) {
      if (
        (cs >= th.countersteerHighS && betaDeg >= th.oversteerMediumSlipDeg) ||
        cs >= th.countersteerLongS
      )
        confidence = 'high';
      else if (
        betaDeg >= th.oversteerHighSlipDeg &&
        Number.isFinite(ratio) &&
        ratio >= th.oversteerYawRatio * 1.1 &&
        sig.brake[ra]! < th.lockMinBrake
      )
        confidence = 'high';
      else if (cs >= th.countersteerMinS) confidence = 'medium';
      else if (
        betaDeg >= th.oversteerMediumSlipDeg &&
        Number.isFinite(ratio) &&
        ratio >= th.oversteerYawRatio
      )
        confidence = 'medium';
    } else if (betaDeg >= th.oversteerHighSlipDeg) {
      confidence = 'medium';
    } else if (betaDeg >= th.oversteerMediumSlipDeg * 1.5) {
      confidence = 'low';
    }
    if (!confidence) continue;
    const ctx = contextNotes(sig, ra, rb);
    const c = downgrade(confidence, ctx.steps);
    if (!c) continue;
    const evidence = emptyEvidence(v[ra]! * 3.6);
    evidence.slipAngleDeg = betaDeg;
    evidence.countersteerS = sig.hasSteering ? cs : null;
    evidence.yawRatio = Number.isFinite(ratio) ? ratio : null;
    evidence.yawRateDps = meanOf(yaw, ra, rb, true) * DEG;
    evidence.steeringDeg = sig.hasSteering ? meanOf(steer, ra, rb, true) * DEG : null;
    evidence.brake = meanOf(sig.brake, ra, rb);
    evidence.throttle = meanOf(sig.throttle, ra, rb);
    evidence.verticalG = ctx.verticalG;
    let front = 0;
    let rear = 0;
    let rearSpin = 0;
    for (let i = ra; i <= rb; i++) {
      if (sig.brake[i]! >= th.lockMinBrake) {
        front = Math.min(front, frontSlip(sig, i));
        rear = Math.min(rear, rearSlipMin(sig, i));
      } else if (sig.throttle[i]! >= th.tractionMinThrottle) {
        rearSpin = Math.max(rearSpin, rearSlipMax(sig, i));
      }
    }
    if (sig.brake[ra]! >= th.lockMinBrake) {
      evidence.frontSlipPeak = front;
      evidence.rearSlipPeak = rear;
    } else if (rearSpin > 0) {
      evidence.rearSlipPeak = rearSpin;
    }
    out.push({
      kind: 'oversteer',
      a: ra,
      b: rb,
      confidence: c,
      evidence,
      notes: ctx.notes,
      brakeStart: sig.brake[ra]!,
      throttleMean: evidence.throttle,
    });
  }
  return out;
}

// ------------------------------------------------------------------------------- front lock

function frontSlip(sig: Signals, i: number): number {
  return Math.min(sig.slip[0]![i]!, sig.slip[1]![i]!);
}

function rearSlipMin(sig: Signals, i: number): number {
  return Math.min(sig.slip[2]![i]!, sig.slip[3]![i]!);
}

function rearSlipMax(sig: Signals, i: number): number {
  return Math.max(sig.slip[2]![i]!, sig.slip[3]![i]!);
}

function isLockSample(sig: Signals, i: number, slip: number): boolean {
  const f = frontSlip(sig, i);
  return (
    sig.v[i]! >= sig.th.lockMinSpeedMps &&
    sig.brake[i]! >= sig.th.lockMinBrake &&
    finite(f) &&
    f <= -slip
  );
}

function detectFrontLock(sig: Signals, a: number, b: number): Candidate[] {
  const { lap, th, v } = sig;
  const { t } = lap;
  const runs = findRuns(sig, a, b, (i) => isLockSample(sig, i, th.lockSignalSlip));
  const out: Candidate[] = [];
  for (const [ra, rb] of runs) {
    let peak = 0;
    let rearPeak = 0;
    let lockS = 0;
    let signalS = 0;
    for (let i = ra; i <= rb; i++) {
      const f = frontSlip(sig, i);
      const r = rearSlipMin(sig, i);
      const dt = sampleDt(t, i);
      if (finite(f)) peak = Math.min(peak, f);
      if (finite(r)) rearPeak = Math.min(rearPeak, r);
      if (f <= -th.lockSignalSlip) signalS += dt;
      if (f <= -th.lockSlip) lockS += dt;
    }
    // Rears locking clearly more than the fronts: not a front lock (rotation is judged apart).
    if (rearPeak < peak - 0.03) continue;
    let confidence: FindingConfidence | null = null;
    if (lockS >= th.lockHighS && peak <= -th.lockDeepSlip) confidence = 'high';
    else if (lockS >= th.lockMinS) confidence = 'medium';
    else if (signalS >= th.lockSignalMinS) confidence = 'low';
    if (!confidence) continue;
    const ctx = contextNotes(sig, ra, rb);
    // Vertical load changes are expected under braking; only replay/off track lower a lock.
    const steps = ctx.steps - (ctx.verticalG >= th.verticalDisturbanceG ? 1 : 0);
    const c = downgrade(confidence, steps);
    if (!c) continue;
    const notes = ctx.notes.filter((n) => !n.startsWith('Carga vertical'));
    if (rearPeak <= -th.lockSlip) {
      notes.push('As traseiras também escorregaram: freada no limite nas quatro rodas.');
    }
    const evidence = emptyEvidence(v[ra]! * 3.6);
    evidence.frontSlipPeak = peak;
    evidence.rearSlipPeak = rearPeak;
    evidence.brake = meanOf(sig.brake, ra, rb);
    evidence.steeringDeg = sig.hasSteering ? meanOf(sig.steer, ra, rb, true) * DEG : null;
    evidence.verticalG = ctx.verticalG;
    out.push({
      kind: 'frontLock',
      a: ra,
      b: rb,
      confidence: c,
      evidence,
      notes,
      brakeStart: sig.brake[ra]!,
      throttleMean: meanOf(sig.throttle, ra, rb),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------- exit traction

function detectExitTraction(sig: Signals, a: number, b: number): Candidate[] {
  const { lap, th, v } = sig;
  const { t } = lap;
  const tcsOn = (i: number) => {
    const f = sig.flags[i]!;
    return finite(f) && (f & SimulatorFlags.TcsActive) !== 0;
  };
  const runs = findRuns(sig, a, b, (i) => {
    if (v[i]! < th.lockMinSpeedMps) return false;
    if (sig.throttle[i]! < th.tractionMinThrottle || sig.brake[i]! >= 0.05) return false;
    const r = rearSlipMax(sig, i);
    return (finite(r) && r >= th.tractionSlip) || tcsOn(i);
  });
  const out: Candidate[] = [];
  for (const [ra, rb] of runs) {
    const dur = t[rb]! - t[ra]!;
    let peak = 0;
    let tcs = 0;
    for (let i = ra; i <= rb; i++) {
      const r = rearSlipMax(sig, i);
      if (finite(r)) peak = Math.max(peak, r);
      if (tcsOn(i)) tcs += sampleDt(t, i);
    }
    if (dur < th.tractionMinS && tcs < th.tractionMinS) continue;
    // After an impact the car slows while the wheels keep turning: not wheelspin.
    if (nearImpact(sig, ra, rb, 1)) continue;
    let confidence: FindingConfidence =
      (peak >= th.tractionHighSlip && dur >= th.tractionHighS) || tcs >= th.tractionHighS
        ? 'high'
        : peak >= th.tractionSlip && dur >= th.tractionMediumS
          ? 'medium'
          : 'low';
    const ctx = contextNotes(sig, ra, rb);
    const c = downgrade(confidence, ctx.steps);
    if (!c) continue;
    confidence = c;
    const evidence = emptyEvidence(v[ra]! * 3.6);
    evidence.rearSlipPeak = peak;
    evidence.throttle = meanOf(sig.throttle, ra, rb);
    evidence.tcsActiveS = tcs;
    evidence.steeringDeg = sig.hasSteering ? meanOf(sig.steer, ra, rb, true) * DEG : null;
    evidence.verticalG = ctx.verticalG;
    out.push({
      kind: 'exitTraction',
      a: ra,
      b: rb,
      confidence,
      evidence,
      notes: ctx.notes,
      brakeStart: sig.brake[ra]!,
      throttleMean: evidence.throttle,
    });
  }
  return out;
}

// --------------------------------------------------------------------- corners and wording

/** Corner of an event: braking belongs to the corner ahead, the rest to the corner it is in. */
function cornerFor(
  windows: CornerWindows[],
  lengthM: number,
  kind: DrivingEventKind,
  startM: number,
  endM: number,
): Corner | null {
  if (windows.length === 0) return null;
  const mid = (startM + endM) / 2;
  const shifts = [0, -lengthM, lengthM];
  if (kind === 'frontLock') {
    let best: Corner | null = null;
    let bestAhead = Number.POSITIVE_INFINITY;
    for (const w of windows) {
      for (const k of shifts) {
        const apex = w.corner.apexM + k;
        if (startM >= w.brakeFromM + k - 20 && startM <= apex && apex - startM < bestAhead) {
          bestAhead = apex - startM;
          best = w.corner;
        }
      }
    }
    if (best) return best;
  }
  let best: Corner | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const w of windows) {
    for (const k of shifts) {
      const from = w.corner.entryM + k - 20;
      const to = w.corner.exitM + k + 20;
      const gap = mid < from ? from - mid : mid > to ? mid - to : 0;
      if (gap < bestGap) {
        bestGap = gap;
        best = w.corner;
      }
    }
  }
  return bestGap <= 120 ? best : null;
}

function phaseOf(
  c: Candidate,
  corner: Corner | null,
  startM: number,
  endM: number,
  L: number,
): DrivingEventPhase {
  if (c.kind === 'frontLock' || c.brakeStart >= 0.1) return 'braking';
  if (c.kind === 'exitTraction') return 'exit';
  if (!corner) return 'mid';
  let mid = (startM + endM) / 2;
  if (mid - corner.apexM > L / 2) mid -= L;
  if (corner.apexM - mid > L / 2) mid += L;
  if (mid < corner.apexM - 15) return 'entry';
  if (mid > corner.apexM + 15) return 'exit';
  return 'mid';
}

const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
const num = (v: number, d = 1) => v.toFixed(d).replace('.', ',');

const KIND_TEXT: Record<DrivingEventKind, string> = {
  understeer: 'saída de frente',
  oversteer: 'saída de traseira',
  frontLock: 'travamento dianteiro',
  exitTraction: 'perda de tração na saída',
};

const PREFIX: Record<FindingConfidence, string> = {
  high: '',
  medium: 'Provável ',
  low: 'Possível ',
};

function describe(
  c: Candidate,
  phase: DrivingEventPhase,
  where: string,
  dur: number,
): { message: string; action: string } {
  const e = c.evidence;
  const head = `${PREFIX[c.confidence]}${KIND_TEXT[c.kind]}`;
  const title = `${head.charAt(0).toUpperCase()}${head.slice(1)}${where}`;
  const crest =
    e.verticalG !== null && e.verticalG >= DRIVING_EVENT_THRESHOLDS.verticalDisturbanceG;
  switch (c.kind) {
    case 'understeer': {
      const message =
        `${title}: volante a ${Math.round(e.steeringDeg ?? 0)}° e ` +
        `${(e.yawRatio ?? 0) <= 0.05 ? 'quase sem guinada' : `guinada ${pct(1 - (e.yawRatio ?? 0))} abaixo do esperado`} por ${num(dur)} s; ` +
        `a linha abriu ${num(e.lineOpeningM ?? 0)} m.`;
      const action =
        phase === 'braking' || phase === 'entry'
          ? 'Solte o freio aos poucos e vire menos até a frente morder.'
          : crest
            ? 'Na lombada, vire menos e espere o carro assentar antes de pedir mais volante.'
            : (e.throttle ?? 0) >= 0.3
              ? 'Abra o acelerador mais devagar até a frente apontar para a saída.'
              : 'Tire um pouco de volante e espere a frente morder antes de acelerar.';
      return { message, action };
    }
    case 'oversteer': {
      const cs = e.countersteerS ?? 0;
      const why =
        cs >= DRIVING_EVENT_THRESHOLDS.countersteerMinS
          ? ` e pediu ${num(cs, 2)} s de contravolante`
          : e.yawRatio !== null
            ? ` (guinada ${num(e.yawRatio)}× a esperada para o volante)`
            : '';
      const wheels =
        phase === 'braking' && e.rearSlipPeak !== null && e.frontSlipPeak !== null
          ? `; na freada, traseiras ${pct(e.rearSlipPeak)} e dianteiras ${pct(e.frontSlipPeak)} mais lentas que o carro`
          : '';
      const message = `${title}: o carro girou ${num(e.slipAngleDeg ?? 0)}° além da trajetória${why}${wheels}.`;
      const action =
        phase === 'braking'
          ? 'Solte o freio mais suave na entrada para a traseira assentar.'
          : (e.throttle ?? 0) >= 0.3
            ? 'Acelere de forma progressiva e só abra tudo com o volante desfazendo.'
            : 'Suavize a troca de pedais no meio da curva para manter a traseira.';
      return { message, action };
    }
    case 'frontLock':
      return {
        message: `${title}: roda dianteira ${pct(e.frontSlipPeak ?? 0)} mais lenta que o carro por ${num(dur, 2)} s na freada.`,
        action: 'Alivie o pico do freio e solte aos poucos enquanto vira.',
      };
    case 'exitTraction': {
      const tcs = (e.tcsActiveS ?? 0) > 0 ? `, TCS ativo ${num(e.tcsActiveS ?? 0, 2)} s` : '';
      return {
        message: `${title}: traseira patinou ${pct(e.rearSlipPeak ?? 0)} por ${num(dur, 2)} s com ${pct(e.throttle ?? 0)} de acelerador${tcs}.`,
        action: 'Dose o acelerador: abra aos poucos enquanto desfaz o volante.',
      };
    }
  }
}

/** First distance after `from` where steering and yaw stay low for 0.3 s (car straight). */
function settledAfter(sig: Signals, from: number): number | null {
  const { lap } = sig;
  const { t, s } = lap;
  let start = -1;
  for (let i = from; i < lap.n; i++) {
    const st = sig.steer[i]!;
    const straight =
      Math.abs(sig.yaw[i]!) < 0.1 && (!sig.hasSteering || !finite(st) || Math.abs(st) < 0.12);
    if (!straight) {
      start = -1;
      continue;
    }
    if (start < 0) start = i;
    if (t[i]! - t[start]! >= 0.3) return s[start]!;
  }
  return null;
}

const KIND_ORDER: Record<DrivingEventKind, number> = {
  frontLock: 0,
  understeer: 1,
  oversteer: 2,
  exitTraction: 3,
};

function overlaps(x: Candidate, y: Candidate, t: Float64Array, marginS = 0): boolean {
  return t[x.a]! <= t[y.b]! + marginS && t[y.a]! <= t[x.b]! + marginS;
}

function roundEvidence(e: DrivingEventEvidence): DrivingEventEvidence {
  return {
    speedKmh: round(e.speedKmh, 1),
    steeringDeg: roundOrNull(e.steeringDeg, 1),
    steeringChangeDeg: roundOrNull(e.steeringChangeDeg, 1),
    yawRateDps: roundOrNull(e.yawRateDps, 1),
    expectedYawRateDps: roundOrNull(e.expectedYawRateDps, 1),
    yawRatio: roundOrNull(e.yawRatio, 2),
    lineOpeningM: roundOrNull(e.lineOpeningM, 2),
    slipAngleDeg: roundOrNull(e.slipAngleDeg, 1),
    countersteerS: roundOrNull(e.countersteerS, 2),
    frontSlipPeak: roundOrNull(e.frontSlipPeak, 3),
    rearSlipPeak: roundOrNull(e.rearSlipPeak, 3),
    brake: roundOrNull(e.brake, 2),
    throttle: roundOrNull(e.throttle, 2),
    tcsActiveS: roundOrNull(e.tcsActiveS, 2),
    verticalG: roundOrNull(e.verticalG, 2),
  };
}

/**
 * Detects the driving events of a prepared lap (optionally restricted to events starting in
 * [fromM, toM]). Pure and deterministic: same samples, model and thresholds → same events.
 */
export function detectDrivingEvents(
  lap: PreparedLap,
  corners: readonly Corner[],
  opts: DetectDrivingEventsOptions = {},
): DrivingEventsResult {
  const th: DrivingEventThresholds = { ...DRIVING_EVENT_THRESHOLDS, ...opts.thresholds };
  const model = opts.model ?? calibrateDrivingEventModel(lap);
  const warnings: string[] = [];
  if (!lap.hasSteering) {
    warnings.push(
      'Sem canal de volante neste formato: saída de frente não é avaliada e saída de traseira usa só a rotação.',
    );
  } else if (model.steerGainM === null) {
    warnings.push(
      'Poucas amostras de curva estável para calibrar a resposta do volante: usado um valor padrão.',
    );
  }
  if (lap.n < 10) return { events: [], model, warnings };
  const sig = buildSignals(lap, model, th);
  const a = opts.fromM === undefined ? 0 : sampleAtOrAfter(lap, opts.fromM);
  const b =
    opts.toM === undefined
      ? lap.n - 1
      : Math.max(a, Math.min(lap.n - 1, Math.floor(indexAtDistance(lap, opts.toM))));

  const locks = detectFrontLock(sig, a, b);
  // Samples of a front lock are judged as lock, not as understeer.
  const locked = new Uint8Array(lap.n);
  for (const i of locks) for (let k = i.a; k <= i.b; k++) locked[k] = 1;
  const oversteer = detectOversteer(sig, a, b);
  const traction: Candidate[] = [];
  for (const c of detectExitTraction(sig, a, b)) {
    // Wheelspin with a lateral slide is reported as "saída de traseira".
    const slide = oversteer.find((o) => overlaps(o, c, lap.t, 0.2));
    if (slide) {
      slide.evidence.rearSlipPeak = Math.max(
        slide.evidence.rearSlipPeak ?? 0,
        c.evidence.rearSlipPeak ?? 0,
      );
      slide.evidence.tcsActiveS = (slide.evidence.tcsActiveS ?? 0) + (c.evidence.tcsActiveS ?? 0);
      continue;
    }
    traction.push(c);
  }
  const understeer = detectUndersteer(sig, a, b, locked).filter(
    (u) => !oversteer.some((o) => overlaps(o, u, lap.t)),
  );

  const windows = cornerWindows(
    [...corners].sort((x, y) => x.entryM - y.entryM),
    lap.lengthM,
  );
  const events: DrivingEvent[] = [];
  for (const c of [...locks, ...understeer, ...oversteer, ...traction]) {
    const startM = lap.s[c.a]!;
    const endM = lap.s[c.b]!;
    const corner = cornerFor(windows, lap.lengthM, c.kind, startM, endM);
    const phase = phaseOf(c, corner, startM, endM, lap.lengthM);
    const dur = lap.t[c.b]! - lap.t[c.a]!;
    const where = corner
      ? c.kind === 'exitTraction'
        ? ` da ${corner.id}`
        : ` na ${corner.id}`
      : ' na reta';
    const text = describe(c, phase, where, dur);
    events.push({
      id: `${c.kind}:${corner?.id ?? '-'}:${Math.round(startM)}`,
      kind: c.kind,
      lapId: lap.lapId,
      cornerId: corner?.id ?? null,
      phase,
      startM: round(startM, 1),
      endM: round(endM, 1),
      startS: round(lap.t[c.a]!, 3),
      endS: round(lap.t[c.b]!, 3),
      durationS: round(dur, 3),
      confidence: c.confidence,
      evidence: roundEvidence(c.evidence),
      notes: c.notes,
      message: text.message,
      action: text.action,
      settledM: (() => {
        const m = settledAfter(sig, c.b);
        return m === null ? null : round(m, 1);
      })(),
    });
  }
  events.sort((x, y) => x.startM - y.startM || KIND_ORDER[x.kind] - KIND_ORDER[y.kind]);
  return { events, model, warnings };
}

/**
 * Events of one pass through a corner (live use): scans from the corner's brake window to
 * 80 m after its exit and keeps the events assigned to that corner.
 */
export function detectCornerPassEvents(
  lap: PreparedLap,
  corners: readonly Corner[],
  cornerId: string,
  opts: Omit<DetectDrivingEventsOptions, 'fromM' | 'toM'> = {},
): DrivingEvent[] {
  const sorted = [...corners].sort((x, y) => x.entryM - y.entryM);
  const w = cornerWindows(sorted, lap.lengthM).find((x) => x.corner.id === cornerId);
  if (!w) return [];
  return detectDrivingEvents(lap, sorted, {
    ...opts,
    fromM: w.brakeFromM - 20,
    toM: w.corner.exitM + 80,
  }).events.filter((e) => e.cornerId === cornerId);
}

const RADIO_PRIORITY: Record<DrivingEventKind, number> = {
  oversteer: 0,
  frontLock: 1,
  understeer: 2,
  exitTraction: 3,
};

/**
 * The one event the radio may call for a corner pass: high confidence only, most safety-relevant
 * kind first (oversteer, lock, understeer, traction), then the longest. Null when none qualifies.
 * Call it after the car reaches the event's `settledM`.
 */
export function radioEventForPass(events: readonly DrivingEvent[]): DrivingEvent | null {
  const eligible = events.filter((e) => e.confidence === 'high');
  eligible.sort(
    (x, y) =>
      RADIO_PRIORITY[x.kind] - RADIO_PRIORITY[y.kind] ||
      y.durationS - x.durationS ||
      x.startM - y.startM,
  );
  return eligible[0] ?? null;
}
