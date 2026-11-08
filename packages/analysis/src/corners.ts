/**
 * Automatic corner detection from the reference line curvature, optionally blended with the
 * reference lap's yaw rate (dynamic curvature = yawRate / speed) and using its speed minima.
 *
 * Heuristics (documented decisions):
 * - A corner is a run where |κ| ≥ `onCurvature` (default 1/400 m⁻¹, i.e. radius < 400 m) with the
 *   same sign, extended outwards until |κ| drops below `edgeFraction` (50%) of the run's peak; for a
 *   constant-radius arc with a smoothed curvature step this lands on the true arc boundaries.
 * - Runs turning less than `minTurnDeg` are dropped unless the reference lap shows a pronounced
 *   speed minimum there.
 * - Same-direction runs separated by less than `mergeGapM` are merged (double-apex = ONE corner).
 * - Opposite-direction corners closer than `chicaneGapM` stay SEPARATE corners (each one has its own
 *   brake/apex/exit) but both get kind 'chicane'.
 * - Apex = |κ|-weighted centroid between entry and exit (geometric apex). The per-lap measured apex
 *   (vmin location) lives in CornerMetrics.apexM.
 * - Kind: hairpin (turn ≥ 130° and radius < 40 m), kink (turn < 40° and radius > 150 m), otherwise
 *   by the reference vmin (or a radius-based estimate): slow < 90 km/h, medium < 140, fast.
 * - A corner crossing the start/finish line gets a negative entryM (distance before the line).
 */

import type { Corner, CornerKind } from '@gt7/shared';
import type { Centerline } from './centerline.ts';
import { movingAverage, percentile } from './math.ts';
import { type PreparedLap, valueAtDistance } from './prepare.ts';

export interface DetectCornersOptions {
  /** Reference lap: yaw rate blended into the curvature, speed minima used for kinds. */
  reference?: PreparedLap;
  /** |κ| threshold that starts a corner (1/m), default 1/400. */
  onCurvature?: number;
  /** Minimum total heading change (deg), default 12. */
  minTurnDeg?: number;
  /** Fraction of the run peak defining entry/exit, default 0.5. */
  edgeFraction?: number;
  /** Same-direction runs closer than this are merged (m), default 15. */
  mergeGapM?: number;
  /** Opposite-direction corners closer than this are a chicane (m), default 60. */
  chicaneGapM?: number;
  /** Minimum corner length (m), default 6. */
  minLengthM?: number;
}

interface Region {
  start: number;
  end: number;
  sign: 1 | -1;
}

/** Curvature signal used for detection (geometric, blended with yaw/speed when available). */
export function detectionCurvature(line: Centerline, reference?: PreparedLap): Float64Array {
  const k = Float64Array.from(line.curvature);
  if (!reference) return k;
  const n = line.n;
  const dyn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = line.s[i]!;
    const v = valueAtDistance(reference, 'speedKmh', d) / 3.6;
    const yaw = valueAtDistance(reference, 'yawRate', d);
    dyn[i] = v > 5 && Number.isFinite(yaw) ? yaw / v : Number.NaN;
  }
  const win = Math.max(1, Math.round(10 / line.stepM)) | 1;
  const dynS = movingAverage(dyn, win, line.closed);
  // the real yaw sign convention is unverified: align it with the geometric curvature
  let corr = 0;
  let valid = 0;
  for (let i = 0; i < n; i++) {
    const v = dynS[i]!;
    if (!Number.isFinite(v)) continue;
    corr += v * k[i]!;
    valid++;
  }
  if (valid < n * 0.8) return k;
  const sign = corr < 0 ? -1 : 1;
  for (let i = 0; i < n; i++) {
    const v = dynS[i]!;
    if (Number.isFinite(v)) k[i] = (k[i]! + sign * v) / 2;
  }
  return k;
}

function kindFor(turnDeg: number, minRadiusM: number, vminKmh: number): CornerKind {
  if (turnDeg >= 130 && minRadiusM < 40) return 'hairpin';
  if (turnDeg < 40 && minRadiusM > 150) return 'kink';
  if (vminKmh < 90) return 'slow';
  if (vminKmh < 140) return 'medium';
  return 'fast';
}

/** Detects corners T1..Tn on a reference line. */
export function detectCorners(line: Centerline, opts: DetectCornersOptions = {}): Corner[] {
  const on = opts.onCurvature ?? 1 / 400;
  const minTurn = ((opts.minTurnDeg ?? 12) * Math.PI) / 180;
  const edge = opts.edgeFraction ?? 0.5;
  const mergeGap = opts.mergeGapM ?? 15;
  const chicaneGap = opts.chicaneGapM ?? 60;
  const minLen = opts.minLengthM ?? 6;
  const n = line.n;
  const step = line.stepM;
  const L = line.lengthM;
  const kappa = detectionCurvature(line, opts.reference);

  // Rotate the index space so it starts on a straight (handles corners across s = 0).
  let i0 = 0;
  if (line.closed) {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(kappa[i]!);
      if (a < on * 0.25) {
        i0 = i;
        break;
      }
      if (a < best) {
        best = a;
        i0 = i;
      }
    }
  }
  const at = (j: number) => kappa[(j + i0) % n]!;

  // 1) runs above threshold
  const runs: Region[] = [];
  let cur: Region | null = null;
  for (let j = 0; j < n; j++) {
    const v = at(j);
    const sgn: 1 | -1 = v >= 0 ? 1 : -1;
    if (Math.abs(v) >= on) {
      if (cur && cur.sign === sgn && cur.end === j - 1) cur.end = j;
      else {
        cur = { start: j, end: j, sign: sgn };
        runs.push(cur);
      }
    } else cur = null;
  }

  // 2) extend to edge * peak, without crossing neighbours
  const regions: Region[] = runs.map((r, idx) => {
    const vals: number[] = [];
    for (let j = r.start; j <= r.end; j++) vals.push(Math.abs(at(j)));
    const peak = percentile(vals, 90);
    const lim = edge * peak;
    const prevEnd = idx > 0 ? runs[idx - 1]!.end : -1;
    const nextStart = idx < runs.length - 1 ? runs[idx + 1]!.start : n;
    let a = r.start;
    while (a - 1 > prevEnd && at(a - 1) * r.sign >= lim) a--;
    let b = r.end;
    while (b + 1 < nextStart && at(b + 1) * r.sign >= lim) b++;
    return { start: a, end: b, sign: r.sign };
  });

  // 3) merge same-direction regions separated by a short gap (double apex)
  const merged: Region[] = [];
  for (const r of regions) {
    const last = merged.at(-1);
    if (last && last.sign === r.sign && (r.start - last.end) * step < mergeGap) {
      last.end = r.end;
    } else merged.push({ ...r });
  }

  // 4) build corners
  const unwrap = (j: number) => {
    // distance of rotated index j, continuous inside one region
    return (j + i0) * step;
  };
  const speedAt = (d: number) =>
    opts.reference ? valueAtDistance(opts.reference, 'speedKmh', ((d % L) + L) % L) : Number.NaN;

  interface Draft {
    entry: number;
    apex: number;
    exit: number;
    sign: 1 | -1;
    turn: number;
    minRadius: number;
    vmin: number;
  }
  const drafts: Draft[] = [];
  for (const r of merged) {
    if ((r.end - r.start + 1) * step < minLen) continue;
    let turn = 0;
    let wsum = 0;
    let wpos = 0;
    const absVals: number[] = [];
    for (let j = r.start; j <= r.end; j++) {
      const v = at(j);
      turn += v * step;
      const w = Math.abs(v);
      absVals.push(w);
      wsum += w;
      wpos += w * unwrap(j);
    }
    let entry = unwrap(r.start);
    let exit = unwrap(r.end) + step;
    let apex = wsum > 0 ? wpos / wsum : (entry + exit) / 2;
    // normalize to lap distances: entry may become negative when crossing the line
    while (apex >= L) {
      entry -= L;
      apex -= L;
      exit -= L;
    }
    if (entry >= L) entry -= L;
    const minRadius = 1 / Math.max(1e-6, percentile(absVals, 95));
    let vmin = Number.NaN;
    if (opts.reference) {
      vmin = Number.POSITIVE_INFINITY;
      for (let d = entry - 20; d <= exit + 20; d += 2) vmin = Math.min(vmin, speedAt(d));
    }
    const pronounced =
      opts.reference !== undefined &&
      Number.isFinite(vmin) &&
      Math.max(speedAt(entry - 150), speedAt(entry - 75)) - vmin > 15;
    if (Math.abs(turn) < minTurn && !pronounced) continue;
    drafts.push({ entry, apex, exit, sign: r.sign, turn, minRadius, vmin });
  }
  drafts.sort((a, b) => a.entry - b.entry);

  const corners: Corner[] = drafts.map((d, index) => {
    const turnDeg = (Math.abs(d.turn) * 180) / Math.PI;
    const vEst = Number.isFinite(d.vmin) ? d.vmin : Math.sqrt(1.5 * 9.81 * d.minRadius) * 3.6;
    return {
      id: `T${index + 1}`,
      index,
      name: null,
      entryM: d.entry,
      apexM: d.apex,
      exitM: d.exit,
      direction: d.sign > 0 ? 'left' : 'right',
      kind: kindFor(turnDeg, d.minRadius, vEst),
      minRadiusM: Math.round(d.minRadius),
    };
  });
  // chicanes: opposite-direction neighbours with a short gap
  for (let i = 0; i + 1 < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[i + 1]!;
    if (a.direction !== b.direction && b.entryM - a.exitM < chicaneGap) {
      a.kind = 'chicane';
      b.kind = 'chicane';
    }
  }
  return corners;
}

/** Total heading change of a corner on the line (deg, signed: + = left). */
export function cornerTurnDeg(line: Centerline, corner: Corner): number {
  let turn = 0;
  for (let d = corner.entryM; d < corner.exitM; d += line.stepM) {
    const i = Math.floor((((d % line.lengthM) + line.lengthM) % line.lengthM) / line.stepM);
    turn += line.curvature[Math.min(line.n - 1, i)]! * line.stepM;
  }
  return (turn * 180) / Math.PI;
}
