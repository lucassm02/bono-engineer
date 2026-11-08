/**
 * Per-corner driver metrics (PLANO-APP.md §5.2) computed on the raw samples of a prepared lap
 * (60 Hz, aligned distance), so distances are not quantized by a resampling grid.
 *
 * Windows per corner (k), with prev/next corners wrapping around the lap:
 * - vmin search: [entry − 20, exit + 20] clipped to the midpoints of the gaps to the neighbours;
 * - brake episode: the last braking run (gaps < 0.4 s merged) ending before the vmin, starting
 *   after the previous corner's apex;
 * - throttle pickup: start of the throttle-on run (≥ THROTTLE_ON_THRESHOLD) that follows the vmin;
 * - coasting: [min(brake point, entry − 30) − 10, exit];
 * - steering corrections: [entry − 15, exit + 15], zig-zag count with hysteresis, minus the one
 *   reversal any clean corner has (turn in → unwind).
 */

import {
  BRAKE_ON_THRESHOLD,
  COAST_PEDAL_THRESHOLD,
  type Corner,
  type CornerMetrics,
  EXIT_SPEED_OFFSET_M,
  FRONT_LOCK_SLIP_THRESHOLD,
  FULL_THROTTLE_THRESHOLD,
  SimulatorFlags,
  THROTTLE_ON_THRESHOLD,
} from '@gt7/shared';
import { type NumArray, valueAtIndex } from './math.ts';
import {
  channel,
  indexAtDistance,
  lateralAtDistance,
  type PreparedLap,
  sampleAtOrAfter,
  timeAtDistance,
} from './prepare.ts';
import { deltaBetween } from './resample.ts';

export interface MetricsOptions {
  /** Comparison lap for `timeDeltaS` (null otherwise). */
  reference?: PreparedLap;
  /** Distance range for `timeDeltaS` (default: brake zone start → exit + EXIT_SPEED_OFFSET_M). */
  zone?: { fromM: number; toM: number };
  /** Minimum swing (rad) between steering reversals counted as a correction, default 0.15. */
  steeringSwingRad?: number;
  /** Gaps shorter than this inside a braking run are merged (s), default 0.4. */
  brakeGapS?: number;
}

/** Neighbour-aware search windows of a corner inside a corner list. */
export interface CornerWindows {
  corner: Corner;
  /** Earliest distance a brake point of this corner may have. */
  brakeFromM: number;
  vminFromM: number;
  vminToM: number;
}

/** Builds the search windows of every corner (corners sorted by distance). */
export function cornerWindows(corners: readonly Corner[], lengthM: number): CornerWindows[] {
  const n = corners.length;
  return corners.map((c, k) => {
    const prev = n > 1 ? corners[(k - 1 + n) % n]! : null;
    const next = n > 1 ? corners[(k + 1) % n]! : null;
    const prevExit = prev ? (k === 0 ? prev.exitM - lengthM : prev.exitM) : c.entryM - 500;
    const prevApex = prev ? (k === 0 ? prev.apexM - lengthM : prev.apexM) : c.entryM - 500;
    const nextEntry = next ? (k === n - 1 ? next.entryM + lengthM : next.entryM) : c.exitM + 500;
    return {
      corner: c,
      brakeFromM: Math.max(prevApex, c.entryM - 600),
      vminFromM: Math.max(c.entryM - 20, (prevExit + c.entryM) / 2),
      vminToM: Math.min(c.exitM + 20, (c.exitM + nextEntry) / 2),
    };
  });
}

function sampleDt(t: Float64Array, i: number): number {
  const a = t[i]!;
  const b = t[Math.min(t.length - 1, i + 1)]!;
  const d = b - a;
  return d > 0 && d < 0.5 ? d : 0;
}

/**
 * Zig-zag reversal count of a signal with hysteresis `swing`, minus one (the turn-in/unwind
 * reversal of a clean corner). Returns 0 for fewer than 3 samples.
 */
export function countReversals(values: readonly number[], swing: number): number {
  if (values.length < 3) return 0;
  let dir = 0;
  let hi = values[0]!;
  let lo = values[0]!;
  let count = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (dir === 0) {
      if (v > hi) hi = v;
      if (v < lo) lo = v;
      if (hi - v >= swing) {
        dir = -1;
        lo = v;
      } else if (v - lo >= swing) {
        dir = 1;
        hi = v;
      }
    } else if (dir === 1) {
      if (v > hi) hi = v;
      else if (hi - v >= swing) {
        count++;
        dir = -1;
        lo = v;
      }
    } else if (v < lo) lo = v;
    else if (v - lo >= swing) {
      count++;
      dir = 1;
      hi = v;
    }
  }
  return Math.max(0, count - 1);
}

interface BrakeEpisode {
  start: number;
  end: number;
}

function findBrakeEpisode(
  lap: PreparedLap,
  brake: NumArray,
  fromIdx: number,
  vminIdx: number,
  gapS: number,
): BrakeEpisode | null {
  const on = (i: number) => brake[i]! >= BRAKE_ON_THRESHOLD;
  let end = -1;
  for (let i = vminIdx; i >= fromIdx; i--) {
    if (on(i)) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  // if still braking at vmin, extend the end forward
  if (end === vminIdx) {
    while (end + 1 < lap.n && on(end + 1)) end++;
  }
  let start = end;
  let i = end - 1;
  while (i >= fromIdx) {
    if (on(i)) {
      start = i;
      i--;
      continue;
    }
    // gap: look back up to gapS for more braking
    let j = i;
    while (j >= fromIdx && !on(j) && lap.t[start]! - lap.t[j]! <= gapS) j--;
    if (j >= fromIdx && on(j) && lap.t[start]! - lap.t[j]! <= gapS) {
      i = j;
      continue;
    }
    break;
  }
  return { start, end };
}

/** Computes the metrics of one corner for one lap. */
export function computeCornerMetrics(
  lap: PreparedLap,
  win: CornerWindows,
  opts: MetricsOptions = {},
): CornerMetrics {
  const c = win.corner;
  const tr = lap.trace;
  const { s, t } = lap;
  const speed = channel(tr, 'speedKmh');
  const brake = channel(tr, 'brake');
  const throttle = channel(tr, 'throttle');
  const gear = channel(tr, 'gear');
  const steer = channel(tr, 'steeringRad');
  const yaw = channel(tr, 'yawRate');
  const flags = channel(tr, 'flags');
  const slipFL = channel(tr, 'slipFL');
  const slipFR = channel(tr, 'slipFR');
  const slipRL = channel(tr, 'slipRL');
  const slipRR = channel(tr, 'slipRR');
  const L = lap.lengthM;

  // ---- vmin / apex ----
  const i0 = sampleAtOrAfter(lap, win.vminFromM);
  const i1 = Math.max(i0, Math.min(lap.n - 1, Math.floor(indexAtDistance(lap, win.vminToM))));
  let vminIdx = i0;
  for (let i = i0; i <= i1; i++) if (speed[i]! < speed[vminIdx]!) vminIdx = i;
  const minSpeedKmh = speed[vminIdx]!;
  const minSpeedM = s[vminIdx]!;

  // ---- braking ----
  const brakeFromIdx = sampleAtOrAfter(lap, win.brakeFromM);
  const ep = findBrakeEpisode(lap, brake, brakeFromIdx, vminIdx, opts.brakeGapS ?? 0.4);
  let brakePointM: number | null = null;
  let peakBrake: number | null = null;
  let timeToPeakBrakeS: number | null = null;
  let brakeReleaseM: number | null = null;
  let brakingDurationS: number | null = null;
  let trailBrakingS: number | null = null;
  let trailBrakingArea: number | null = null;
  let brakeReleaseToApexM: number | null = null;
  let frontLockPeak: number | null = null;
  let frontLockS = 0;
  if (ep) {
    brakePointM = s[ep.start]!;
    brakeReleaseM = s[ep.end]!;
    brakingDurationS = t[ep.end]! - t[ep.start]!;
    let pk = 0;
    for (let i = ep.start; i <= ep.end; i++) pk = Math.max(pk, brake[i]!);
    peakBrake = pk;
    let ip = ep.start;
    while (ip < ep.end && brake[ip]! < 0.95 * pk) ip++;
    timeToPeakBrakeS = t[ip]! - t[ep.start]!;
    brakeReleaseToApexM = minSpeedM - brakeReleaseM;

    // trail braking: brake applied while the car is turning (≥ 25% of the corner's peak turn)
    const turn = lap.hasSteering ? steer : yaw;
    const ta = sampleAtOrAfter(lap, c.entryM - 20);
    const tb = Math.max(ta, Math.floor(indexAtDistance(lap, c.exitM)));
    let peakTurn = 0;
    for (let i = ta; i <= tb; i++) {
      const v = Math.abs(turn[i]!);
      if (Number.isFinite(v)) peakTurn = Math.max(peakTurn, v);
    }
    let dur = 0;
    let area = 0;
    if (peakTurn > 0) {
      for (let i = ep.start; i <= Math.min(ep.end, vminIdx); i++) {
        const frac = Math.min(1, Math.abs(turn[i]!) / peakTurn);
        if (brake[i]! >= BRAKE_ON_THRESHOLD && frac >= 0.25) {
          const dt = sampleDt(t, i);
          dur += dt;
          area += brake[i]! * frac * dt;
        }
      }
    }
    trailBrakingS = dur;
    trailBrakingArea = area;

    // front lock under braking
    let lock = Number.NaN;
    for (let i = ep.start; i <= ep.end; i++) {
      const f = -Math.min(slipFL[i]!, slipFR[i]!);
      if (!Number.isFinite(f)) continue;
      lock = Number.isNaN(lock) ? f : Math.max(lock, f);
      if (f >= FRONT_LOCK_SLIP_THRESHOLD) frontLockS += sampleDt(t, i);
    }
    frontLockPeak = Number.isFinite(lock) ? Math.max(0, lock) : null;
  }

  // ---- throttle ----
  let throttlePickupM: number | null = null;
  let timeToFullThrottleS: number | null = null;
  const exitLimitIdx = Math.min(
    lap.n - 1,
    Math.floor(indexAtDistance(lap, c.exitM + EXIT_SPEED_OFFSET_M + 100)),
  );
  let k = vminIdx;
  while (k <= exitLimitIdx && throttle[k]! < THROTTLE_ON_THRESHOLD) k++;
  if (k <= exitLimitIdx) {
    const floorIdx = ep ? Math.max(ep.end, i0) : i0;
    let p = k;
    while (p - 1 >= floorIdx && throttle[p - 1]! >= THROTTLE_ON_THRESHOLD) p--;
    throttlePickupM = s[p]!;
    let f = p;
    while (f <= exitLimitIdx && throttle[f]! < FULL_THROTTLE_THRESHOLD) f++;
    if (f <= exitLimitIdx) timeToFullThrottleS = t[f]! - t[p]!;
  }

  // ---- coasting ----
  const coastFrom = Math.min(brakePointM ?? c.entryM - 30, c.entryM - 30) - 10;
  const ca = sampleAtOrAfter(lap, Math.max(coastFrom, win.brakeFromM));
  const cb = Math.floor(indexAtDistance(lap, c.exitM));
  let coastingS = 0;
  for (let i = ca; i <= cb; i++) {
    if (throttle[i]! < COAST_PEDAL_THRESHOLD && brake[i]! < COAST_PEDAL_THRESHOLD) {
      coastingS += sampleDt(t, i);
    }
  }

  // ---- exit / grip ----
  const exitAt = c.exitM + EXIT_SPEED_OFFSET_M;
  const exitSpeedKmh =
    exitAt <= Math.min(L, s[lap.n - 1]!) ? valueAtIndex(speed, indexAtDistance(lap, exitAt)) : null;
  const ga = sampleAtOrAfter(lap, Math.min(brakePointM ?? c.entryM, c.entryM) - 10);
  const gb = Math.floor(indexAtDistance(lap, exitAt));
  let tcsActiveS = 0;
  let rearSlip = Number.NaN;
  for (let i = ga; i <= gb; i++) {
    const fl = flags[i]!;
    if (Number.isFinite(fl) && (fl & SimulatorFlags.TcsActive) !== 0) tcsActiveS += sampleDt(t, i);
    if (i >= vminIdx && throttle[i]! >= THROTTLE_ON_THRESHOLD) {
      const r = Math.max(slipRL[i]!, slipRR[i]!);
      if (Number.isFinite(r)) rearSlip = Number.isNaN(rearSlip) ? r : Math.max(rearSlip, r);
    }
  }

  // ---- steering corrections ----
  let steeringCorrections: number | null = null;
  if (lap.hasSteering) {
    const sa = sampleAtOrAfter(lap, c.entryM - 15);
    const sb = Math.floor(indexAtDistance(lap, c.exitM + 15));
    const vals: number[] = [];
    for (let i = sa; i <= sb; i++) vals.push(steer[i]!);
    steeringCorrections = countReversals(vals, opts.steeringSwingRad ?? 0.15);
  }

  // ---- line ----
  const entryLat = lateralAtDistance(lap, c.entryM);
  const apexLat = lateralAtDistance(lap, c.apexM);
  const exitLat = lateralAtDistance(lap, c.exitM);
  const lateralOffsetM =
    Number.isFinite(entryLat) && Number.isFinite(apexLat) && Number.isFinite(exitLat)
      ? { entry: entryLat, apex: apexLat, exit: exitLat }
      : null;

  // ---- time ----
  const timeInCornerS = timeAtDistance(lap, c.exitM) - timeAtDistance(lap, c.entryM);
  let timeDeltaS: number | null = null;
  if (opts.reference) {
    const zone = opts.zone ?? {
      fromM: (brakePointM ?? c.entryM - 50) - 10,
      toM: exitAt,
    };
    timeDeltaS = deltaBetween(lap, opts.reference, zone.fromM, zone.toM);
  }

  const entryIdx = indexAtDistance(lap, c.entryM);
  return {
    cornerId: c.id,
    lapId: lap.lapId,
    brakePointM,
    peakBrake,
    timeToPeakBrakeS,
    brakeReleaseM,
    brakingDurationS,
    trailBrakingS,
    trailBrakingArea,
    brakeReleaseToApexM,
    entrySpeedKmh: c.entryM >= 0 ? valueAtIndex(speed, entryIdx) : null,
    minSpeedKmh,
    minSpeedM,
    apexM: minSpeedM,
    exitSpeedKmh,
    gearAtApex: gear[vminIdx]!,
    throttlePickupM,
    timeToFullThrottleS,
    coastingS,
    lateralOffsetM,
    rearSlipPeak: Number.isFinite(rearSlip) ? rearSlip : null,
    tcsActiveS,
    frontLockPeak,
    frontLockS,
    steeringCorrections,
    timeInCornerS,
    timeDeltaS,
  };
}

/** Metrics of every corner of a lap. */
export function computeLapMetrics(
  lap: PreparedLap,
  corners: readonly Corner[],
  opts: Omit<MetricsOptions, 'zone'> & { zones?: { fromM: number; toM: number }[] } = {},
): CornerMetrics[] {
  const wins = cornerWindows(corners, lap.lengthM);
  return wins.map((w, i) => {
    const zone = opts.zones?.[i];
    return computeCornerMetrics(lap, w, zone ? { ...opts, zone } : opts);
  });
}
