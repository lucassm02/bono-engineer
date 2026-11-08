/**
 * Projection of world X/Z points onto a {@link Centerline}: distance along the line, signed lateral
 * offset (+ = LEFT of the line in driving direction) and segment index.
 *
 * Sequential points (a lap) use a windowed search around the previous segment (fast, and it never
 * jumps to a nearby but different part of the track); a global search is the fallback when the
 * point is far from the windowed match or the match sits on the window edge.
 */

import type { Centerline } from './centerline.ts';
import { type NumArray, signedWrap, wrapDistance } from './math.ts';

export interface Projection {
  /** Distance along the line in [0, lengthM). */
  distanceM: number;
  /** Signed lateral offset (m), + = left of the line. */
  lateralM: number;
  /** Segment index (from point i to point i+1). */
  segment: number;
  /** Euclidean distance to the line (m). */
  distToLineM: number;
}

export interface ProjectOptions {
  /** Segment hint for a windowed search (e.g. the previous sample's segment). */
  hint?: number;
  /** Window behind / ahead of the hint (m). Defaults 30 / 80. */
  windowBackM?: number;
  windowAheadM?: number;
  /** Windowed matches farther than this from the line trigger a global search (m). Default 25. */
  maxSnapM?: number;
}

function segmentCount(line: Centerline): number {
  return line.closed ? line.n : line.n - 1;
}

interface SegHit {
  seg: number;
  t: number;
  d2: number;
}

function testSegment(line: Centerline, seg: number, px: number, pz: number, best: SegHit): void {
  const n = line.n;
  const a = seg;
  const b = seg + 1 === n ? 0 : seg + 1;
  const ax = line.x[a]!;
  const az = line.z[a]!;
  const dx = line.x[b]! - ax;
  const dz = line.z[b]! - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const fx = ax + dx * t - px;
  const fz = az + dz * t - pz;
  const d2 = fx * fx + fz * fz;
  if (d2 < best.d2) {
    best.seg = seg;
    best.t = t;
    best.d2 = d2;
  }
}

function toProjection(line: Centerline, hit: SegHit, px: number, pz: number): Projection {
  const n = line.n;
  const a = hit.seg;
  const b = a + 1 === n ? 0 : a + 1;
  const dx = line.x[b]! - line.x[a]!;
  const dz = line.z[b]! - line.z[a]!;
  const len = Math.hypot(dx, dz) || 1;
  // left normal of direction (dx, dz) is (dz, −dx)
  const lateral = ((px - line.x[a]!) * dz - (pz - line.z[a]!) * dx) / len;
  let d = line.s[a]! + hit.t * line.stepM;
  if (line.closed) d = wrapDistance(d, line.lengthM);
  return { distanceM: d, lateralM: lateral, segment: a, distToLineM: Math.sqrt(hit.d2) };
}

/** Projects one point. With `hint`, searches a window around it first. */
export function projectPoint(
  line: Centerline,
  x: number,
  z: number,
  opts: ProjectOptions = {},
): Projection {
  const nseg = segmentCount(line);
  const best: SegHit = { seg: 0, t: 0, d2: Number.POSITIVE_INFINITY };
  if (opts.hint !== undefined && Number.isFinite(opts.hint)) {
    const back = Math.ceil((opts.windowBackM ?? 30) / line.stepM);
    const ahead = Math.ceil((opts.windowAheadM ?? 80) / line.stepM);
    const maxSnap = opts.maxSnapM ?? 25;
    const h = Math.round(opts.hint);
    for (let k = -back; k <= ahead; k++) {
      let seg = h + k;
      if (line.closed) seg = ((seg % nseg) + nseg) % nseg;
      else if (seg < 0 || seg >= nseg) continue;
      testSegment(line, seg, x, z, best);
    }
    const rel = line.closed ? signedWrap(best.seg - h, nseg) : best.seg - h;
    const onEdge = rel <= -back || rel >= ahead;
    if (!onEdge && best.d2 <= maxSnap * maxSnap) return toProjection(line, best, x, z);
    best.d2 = Number.POSITIVE_INFINITY;
  }
  for (let seg = 0; seg < nseg; seg++) testSegment(line, seg, x, z, best);
  return toProjection(line, best, x, z);
}

export interface PathProjection {
  /**
   * Unwrapped distance per point: continuous across the start/finish line (a lap that starts just
   * before the line begins slightly negative and ends slightly above lengthM).
   */
  distanceM: Float64Array;
  lateralM: Float64Array;
  distToLineM: Float64Array;
  segment: Int32Array;
}

export interface ProjectPathOptions extends Omit<ProjectOptions, 'hint'> {
  /**
   * How to place the first point on a closed line: 'lapStart' (default) maps a first projection in
   * the second half of the line to a negative distance (the lap started just before the line);
   * 'raw' keeps it in [0, L).
   */
  start?: 'lapStart' | 'raw';
}

/** Projects a sequence of points (e.g. a lap), unwrapping distance across the start/finish. */
export function projectPath(
  line: Centerline,
  xs: NumArray,
  zs: NumArray,
  opts: ProjectPathOptions = {},
): PathProjection {
  const n = xs.length;
  const distanceM = new Float64Array(n);
  const lateralM = new Float64Array(n);
  const distToLineM = new Float64Array(n);
  const segment = new Int32Array(n);
  const L = line.lengthM;
  let hint: number | undefined;
  let unwrapped = Number.NaN;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const z = zs[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      distanceM[i] = unwrapped;
      lateralM[i] = Number.NaN;
      distToLineM[i] = Number.NaN;
      segment[i] = -1;
      continue;
    }
    const p = projectPoint(line, x, z, { ...opts, hint });
    hint = p.segment;
    if (Number.isNaN(unwrapped)) {
      unwrapped =
        line.closed && (opts.start ?? 'lapStart') === 'lapStart' && p.distanceM > L / 2
          ? p.distanceM - L
          : p.distanceM;
    } else if (line.closed) {
      unwrapped += signedWrap(p.distanceM - wrapDistance(unwrapped, L), L);
    } else {
      unwrapped = p.distanceM;
    }
    distanceM[i] = unwrapped;
    lateralM[i] = p.lateralM;
    distToLineM[i] = p.distToLineM;
    segment[i] = p.segment;
  }
  return { distanceM, lateralM, distToLineM, segment };
}
