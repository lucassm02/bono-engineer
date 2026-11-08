/**
 * Reference line ("centerline") of a track, built from the X/Z positions of one clean lap.
 *
 * Conventions (same as the synthetic generator and @gt7/shared):
 * - World X/Z plane, Y up. Heading θ = atan2(dx, dz): θ = 0 points to +Z, direction (sin θ, cos θ).
 * - Signed curvature κ = dθ/ds: POSITIVE = LEFT turn.
 * - Left normal n = (cos θ, −sin θ); lateral offsets are measured along n (+ = left of the line).
 * - The line starts (s = 0) at the first point given, normally the first sample after the
 *   start/finish crossing. A closed line joins its last point back to the first.
 */

import type { LapTrace } from '@gt7/shared';
import { movingAverage, type NumArray, wrapAngle, wrapDistance } from './math.ts';

export interface Centerline {
  closed: boolean;
  /** Total length (m), including the closing segment of a closed loop. */
  lengthM: number;
  /** Uniform spacing between points (m). */
  stepM: number;
  /** Number of points. Closed: segment n−1 joins the last point to the first. */
  n: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Distance of each point (s[i] = i·stepM). */
  s: Float64Array;
  /** Heading θ (rad) at each point. */
  heading: Float64Array;
  /** Smoothed signed curvature (1/m, + = left) at each point. */
  curvature: Float64Array;
}

export interface CenterlineOptions {
  /** Point spacing (m), default 1. */
  stepM?: number;
  /** Position smoothing window (m), default 6 (two box passes). */
  smoothM?: number;
  /** Curvature smoothing window (m), default 10 (two box passes). */
  curvatureSmoothM?: number;
  /** Closed loop (circuit), default true. */
  closed?: boolean;
}

export interface CenterlinePoints {
  x: NumArray;
  z: NumArray;
  y?: NumArray;
}

interface Poly {
  x: number[];
  y: number[];
  z: number[];
}

function cumulative(p: Poly, closed: boolean): { cum: number[]; total: number } {
  const n = p.x.length;
  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1]! + Math.hypot(p.x[i]! - p.x[i - 1]!, p.z[i]! - p.z[i - 1]!);
  }
  const total = closed
    ? cum[n - 1]! + Math.hypot(p.x[0]! - p.x[n - 1]!, p.z[0]! - p.z[n - 1]!)
    : cum[n - 1]!;
  return { cum, total };
}

/** Resamples a polyline uniformly by arc length into `count` points (closed: excluding the end). */
function resampleUniform(p: Poly, closed: boolean, count: number): { poly: Poly; step: number } {
  const { cum, total } = cumulative(p, closed);
  const n = p.x.length;
  const segs = closed ? count : count - 1;
  const step = total / segs;
  const out: Poly = { x: [], y: [], z: [] };
  let j = 0;
  for (let k = 0; k < count; k++) {
    const d = k * step;
    while (j < n - 1 && cum[j + 1]! < d) j++;
    let ax: number;
    let ay: number;
    let az: number;
    let bx: number;
    let by: number;
    let bz: number;
    let d0: number;
    let d1: number;
    if (j < n - 1) {
      ax = p.x[j]!;
      ay = p.y[j]!;
      az = p.z[j]!;
      bx = p.x[j + 1]!;
      by = p.y[j + 1]!;
      bz = p.z[j + 1]!;
      d0 = cum[j]!;
      d1 = cum[j + 1]!;
    } else {
      // closing segment (closed) or the very end (open)
      ax = p.x[n - 1]!;
      ay = p.y[n - 1]!;
      az = p.z[n - 1]!;
      bx = closed ? p.x[0]! : ax;
      by = closed ? p.y[0]! : ay;
      bz = closed ? p.z[0]! : az;
      d0 = cum[n - 1]!;
      d1 = closed ? total : d0;
    }
    const t = d1 > d0 ? Math.min(1, Math.max(0, (d - d0) / (d1 - d0))) : 0;
    out.x.push(ax + (bx - ax) * t);
    out.y.push(ay + (by - ay) * t);
    out.z.push(az + (bz - az) * t);
  }
  return { poly: out, step };
}

/**
 * Builds a reference line: drops NaN / duplicate points, resamples by arc length, smooths, resamples
 * again to an exact uniform step and computes heading and signed curvature.
 */
export function buildCenterline(
  points: CenterlinePoints,
  opts: CenterlineOptions = {},
): Centerline {
  const closed = opts.closed ?? true;
  const stepTarget = opts.stepM ?? 1;
  const smoothM = opts.smoothM ?? 6;
  const curvSmoothM = opts.curvatureSmoothM ?? 10;

  // 1) clean input
  const raw: Poly = { x: [], y: [], z: [] };
  const n0 = points.x.length;
  for (let i = 0; i < n0; i++) {
    const x = points.x[i]!;
    const z = points.z[i]!;
    const y = points.y ? points.y[i]! : 0;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const k = raw.x.length;
    if (k > 0 && Math.hypot(x - raw.x[k - 1]!, z - raw.z[k - 1]!) < 0.05) continue;
    raw.x.push(x);
    raw.y.push(Number.isFinite(y) ? y : 0);
    raw.z.push(z);
  }
  if (closed) {
    while (
      raw.x.length > 3 &&
      Math.hypot(raw.x.at(-1)! - raw.x[0]!, raw.z.at(-1)! - raw.z[0]!) < 0.05
    ) {
      raw.x.pop();
      raw.y.pop();
      raw.z.pop();
    }
  }
  if (raw.x.length < 4) throw new Error('buildCenterline: need at least 4 distinct points');

  // 2) uniform resample, 3) smooth positions, 4) uniform resample again
  const total0 = cumulative(raw, closed).total;
  const count = Math.max(8, Math.round(total0 / stepTarget) + (closed ? 0 : 1));
  const first = resampleUniform(raw, closed, count).poly;
  const win = Math.max(1, Math.round(smoothM / stepTarget)) | 1;
  let sx: NumArray = first.x;
  let sy: NumArray = first.y;
  let sz: NumArray = first.z;
  for (let pass = 0; pass < 2; pass++) {
    sx = movingAverage(sx, win, closed);
    sy = movingAverage(sy, win, closed);
    sz = movingAverage(sz, win, closed);
  }
  if (!closed) {
    // keep the true endpoints of an open line
    (sx as Float64Array)[0] = first.x[0]!;
    (sz as Float64Array)[0] = first.z[0]!;
  }
  const smoothPoly: Poly = { x: Array.from(sx), y: Array.from(sy), z: Array.from(sz) };
  const total1 = cumulative(smoothPoly, closed).total;
  const count2 = Math.max(8, Math.round(total1 / stepTarget) + (closed ? 0 : 1));
  const { poly, step } = resampleUniform(smoothPoly, closed, count2);

  const n = poly.x.length;
  const x = Float64Array.from(poly.x);
  const y = Float64Array.from(poly.y);
  const z = Float64Array.from(poly.z);
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = i * step;

  // heading by central differences
  const heading = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = i - 1;
    let b = i + 1;
    if (closed) {
      a = (a + n) % n;
      b = b % n;
    } else {
      a = Math.max(0, a);
      b = Math.min(n - 1, b);
    }
    heading[i] = Math.atan2(x[b]! - x[a]!, z[b]! - z[a]!);
  }
  // curvature dθ/ds
  const kappa = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = i - 1;
    let b = i + 1;
    if (closed) {
      a = (a + n) % n;
      b = b % n;
    } else {
      a = Math.max(0, a);
      b = Math.min(n - 1, b);
    }
    const span = closed ? 2 * step : (b - a) * step;
    kappa[i] = span > 0 ? wrapAngle(heading[b]! - heading[a]!) / span : 0;
  }
  const cwin = Math.max(1, Math.round(curvSmoothM / step)) | 1;
  let curvature = movingAverage(kappa, cwin, closed);
  curvature = movingAverage(curvature, cwin, closed);

  return {
    closed,
    lengthM: closed ? n * step : (n - 1) * step,
    stepM: step,
    n,
    x,
    y,
    z,
    s,
    heading,
    curvature,
  };
}

/** Builds the reference line from a lap trace's x/y/z channels. */
export function centerlineFromTrace(trace: LapTrace, opts: CenterlineOptions = {}): Centerline {
  return buildCenterline(
    { x: trace.channels.x, z: trace.channels.z, y: trace.channels.y },
    { closed: true, ...opts },
  );
}

export interface LinePoint {
  x: number;
  y: number;
  z: number;
  heading: number;
  curvature: number;
}

/** Interpolated point at distance d (wraps on closed lines, clamps on open ones). */
export function pointAtDistance(line: Centerline, d: number): LinePoint {
  const n = line.n;
  let dd = line.closed ? wrapDistance(d, line.lengthM) : Math.min(Math.max(d, 0), line.lengthM);
  if (!line.closed && dd >= line.lengthM) dd = line.lengthM - 1e-9;
  const f = dd / line.stepM;
  const i0 = Math.min(n - 1, Math.floor(f));
  const i1 = line.closed ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
  const t = f - i0;
  const L = (a: Float64Array) => a[i0]! + (a[i1]! - a[i0]!) * t;
  return {
    x: L(line.x),
    y: L(line.y),
    z: L(line.z),
    heading: line.heading[i0]! + wrapAngle(line.heading[i1]! - line.heading[i0]!) * t,
    curvature: L(line.curvature),
  };
}

/** Points of the line between two distances (for map overlays), every `stepM` meters. */
export function linePolyline(
  line: Centerline,
  fromM: number,
  toM: number,
  stepM = 5,
): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const span = Math.max(0, toM - fromM);
  const k = Math.max(1, Math.ceil(span / stepM));
  for (let i = 0; i <= k; i++) {
    const p = pointAtDistance(line, fromM + (span * i) / k);
    out.push({ x: p.x, z: p.z });
  }
  return out;
}

/** Serializable form (plain arrays) for storage by core. */
export interface CenterlinePolyline {
  closed: boolean;
  stepM: number;
  x: number[];
  y: number[];
  z: number[];
}

export function centerlineToPolyline(line: Centerline): CenterlinePolyline {
  return {
    closed: line.closed,
    stepM: line.stepM,
    x: Array.from(line.x),
    y: Array.from(line.y),
    z: Array.from(line.z),
  };
}

/** Rebuilds a line from a stored polyline (already uniform; light smoothing only). */
export function centerlineFromPolyline(p: CenterlinePolyline): Centerline {
  return buildCenterline(p, { closed: p.closed, stepM: p.stepM, smoothM: p.stepM });
}
