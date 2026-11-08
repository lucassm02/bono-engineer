/**
 * 2D (X/Z) polyline with cumulative distance, closed-loop support, resampling and windowed
 * nearest-point projection. Used for track centerlines and lap distance alignment.
 *
 * Lateral sign follows the app convention: + = left of the driving direction. With heading θ
 * (direction (sin θ, cos θ)), "left" is (cos θ, −sin θ), i.e. left = (dz, −dx) of a unit segment.
 */

import { upperIndex } from './math.ts';

export interface Projection {
  /** Distance along the polyline (0..length). */
  s: number;
  /** Signed lateral offset (+ = left). */
  lateral: number;
  /** Euclidean distance from the point to the polyline. */
  dist: number;
  /** Segment index. */
  segment: number;
}

export class Polyline {
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Cumulative distance at each vertex (s[0] = 0). */
  readonly s: Float64Array;
  readonly closed: boolean;
  /** Total length; for closed polylines it includes the closing segment. */
  readonly length: number;

  constructor(x: ArrayLike<number>, z: ArrayLike<number>, closed = true) {
    const n = Math.min(x.length, z.length);
    if (n < 2) throw new Error('Polyline needs at least 2 points');
    this.x = Float64Array.from({ length: n }, (_, i) => x[i]!);
    this.z = Float64Array.from({ length: n }, (_, i) => z[i]!);
    this.closed = closed;
    this.s = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      this.s[i] =
        this.s[i - 1]! + Math.hypot(this.x[i]! - this.x[i - 1]!, this.z[i]! - this.z[i - 1]!);
    }
    const closing = closed
      ? Math.hypot(this.x[0]! - this.x[n - 1]!, this.z[0]! - this.z[n - 1]!)
      : 0;
    this.length = this.s[n - 1]! + closing;
  }

  get size(): number {
    return this.x.length;
  }

  /** Number of segments (closed: n, open: n − 1). */
  get segments(): number {
    return this.closed ? this.size : this.size - 1;
  }

  #segEnd(i: number): number {
    return i + 1 < this.size ? i + 1 : 0;
  }

  /** Wraps s into [0, length) for closed polylines, clamps for open ones. */
  wrap(s: number): number {
    if (!this.closed) return Math.min(this.length, Math.max(0, s));
    const L = this.length;
    let v = s % L;
    if (v < 0) v += L;
    return v;
  }

  /** Point and heading (atan2(dx, dz)) at distance s. */
  pointAt(s: number): { x: number; z: number; heading: number } {
    const sv = this.wrap(s);
    let i = upperIndex(this.s, sv);
    if (i < 0) i = 0;
    if (!this.closed && i >= this.size - 1) i = this.size - 2;
    const j = this.#segEnd(i);
    const s0 = this.s[i]!;
    const s1 = j === 0 ? this.length : this.s[j]!;
    const u = s1 > s0 ? (sv - s0) / (s1 - s0) : 0;
    const dx = this.x[j]! - this.x[i]!;
    const dz = this.z[j]! - this.z[i]!;
    return { x: this.x[i]! + dx * u, z: this.z[i]! + dz * u, heading: Math.atan2(dx, dz) };
  }

  /** Resamples every `step` meters along the path (closed: the closing segment is included). */
  resample(step: number): Polyline {
    const n = Math.max(2, Math.floor(this.length / step));
    const xs = new Float64Array(n);
    const zs = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const p = this.pointAt(k * step);
      xs[k] = p.x;
      zs[k] = p.z;
    }
    return new Polyline(xs, zs, this.closed);
  }

  #projectSegment(i: number, px: number, pz: number): Projection {
    const j = this.#segEnd(i);
    const ax = this.x[i]!;
    const az = this.z[i]!;
    const dx = this.x[j]! - ax;
    const dz = this.z[j]! - az;
    const len2 = dx * dx + dz * dz;
    let u = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
    if (u < 0) u = 0;
    else if (u > 1) u = 1;
    const qx = ax + dx * u;
    const qz = az + dz * u;
    const len = Math.sqrt(len2);
    const s0 = this.s[i]!;
    const s1 = j === 0 ? this.length : this.s[j]!;
    const lateral = len > 0 ? ((px - ax) * dz - (pz - az) * dx) / len : 0;
    return { s: s0 + (s1 - s0) * u, lateral, dist: Math.hypot(px - qx, pz - qz), segment: i };
  }

  /**
   * Nearest point on the polyline. With a window [sFrom, sTo] (may extend past 0 / length on
   * closed polylines) only segments overlapping the window are searched; without it, all are.
   */
  project(px: number, pz: number, sFrom?: number, sTo?: number): Projection | null {
    const nSeg = this.segments;
    let best: Projection | null = null;
    const consider = (i: number) => {
      const p = this.#projectSegment(i, px, pz);
      if (!best || p.dist < best.dist) best = p;
    };
    if (sFrom === undefined || sTo === undefined || sTo - sFrom >= this.length) {
      for (let i = 0; i < nSeg; i++) consider(i);
      return best;
    }
    const span = Math.max(0, sTo - sFrom);
    const start = this.wrap(sFrom);
    let i = upperIndex(this.s, start);
    if (i < 0) i = 0;
    if (!this.closed && i >= nSeg) i = nSeg - 1;
    let covered = this.s[i]! - start; // ≤ 0: part of the first segment before sFrom
    for (let k = 0; k < nSeg; k++) {
      consider(i);
      const j = this.#segEnd(i);
      covered += (j === 0 ? this.length : this.s[j]!) - this.s[i]!;
      if (covered >= span) break;
      if (!this.closed && j >= this.size - 1) break;
      i = j;
    }
    return best;
  }
}

/**
 * Cumulative 2D path length of a point sequence (open), starting at 0.
 */
export function cumulativeDistance(x: ArrayLike<number>, z: ArrayLike<number>): Float64Array {
  const n = Math.min(x.length, z.length);
  const out = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    out[i] = out[i - 1]! + Math.hypot(x[i]! - x[i - 1]!, z[i]! - z[i - 1]!);
  }
  return out;
}

/**
 * Projects a sequence of points onto a closed line, tracking progress so that distances stay
 * continuous (window search around the previous position, full search to (re)acquire).
 * Returns distances in line units, starting near 0 and growing past `line.length` only if the
 * sequence goes around more than once (it is unwrapped).
 */
export function alignToLine(
  line: Polyline,
  x: ArrayLike<number>,
  z: ArrayLike<number>,
  opts: { back?: number; ahead?: number; maxLateral?: number } = {},
): Float64Array {
  const back = opts.back ?? 30;
  const ahead = opts.ahead ?? 80;
  const maxLat = opts.maxLateral ?? 40;
  const n = Math.min(x.length, z.length);
  const out = new Float64Array(n);
  let prev: number | null = null;
  let laps = 0;
  for (let k = 0; k < n; k++) {
    let p: Projection | null;
    if (prev === null) {
      p = line.project(x[k]!, z[k]!);
      if (p && k === 0 && p.s > line.length / 2) {
        // first sample just behind the line origin: treat as slightly negative distance
        laps = -1;
      }
    } else {
      const local = prev - laps * line.length;
      p = line.project(x[k]!, z[k]!, local - back, local + ahead);
      if (!p || p.dist > maxLat) p = line.project(x[k]!, z[k]!);
    }
    if (!p) {
      out[k] = prev ?? 0;
      continue;
    }
    let s = p.s + laps * line.length;
    if (prev !== null) {
      if (s < prev - line.length / 2) {
        laps++;
        s += line.length;
      } else if (s > prev + line.length / 2) {
        laps--;
        s -= line.length;
      }
    }
    out[k] = s;
    prev = s;
  }
  return out;
}
