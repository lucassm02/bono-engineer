/** Small numeric helpers (pure, isomorphic). */

import type { MetricStats } from '@gt7/shared';

/** Read-only numeric array (plain arrays and typed arrays). */
export type NumArray = ArrayLike<number>;

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wraps an index into [0, n). */
export function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** Wraps a distance into [0, L). */
export function wrapDistance(d: number, lengthM: number): number {
  const r = d % lengthM;
  return r < 0 ? r + lengthM : r;
}

/** Wraps a distance difference into [−L/2, L/2). */
export function signedWrap(d: number, lengthM: number): number {
  return wrapDistance(d + lengthM / 2, lengthM) - lengthM / 2;
}

/** Wraps an angle into (−π, π]. */
export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/** First index i with arr[i] >= x (arr ascending); arr.length if none. */
export function lowerBound(arr: NumArray, x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Fractional index of `x` in an ascending array (clamped to [0, n−1]). Flat runs resolve to their
 * first index.
 */
export function fractionalIndex(xs: NumArray, x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (x <= xs[0]!) return 0;
  if (x >= xs[n - 1]!) return n - 1;
  const i = lowerBound(xs, x);
  const x1 = xs[i]!;
  const x0 = xs[i - 1]!;
  return x1 > x0 ? i - 1 + (x - x0) / (x1 - x0) : i;
}

/** Linear interpolation of `ys` at fractional index `fi`. */
export function valueAtIndex(ys: NumArray, fi: number): number {
  const n = ys.length;
  if (n === 0) return Number.NaN;
  if (fi <= 0) return ys[0]!;
  if (fi >= n - 1) return ys[n - 1]!;
  const i = Math.floor(fi);
  const t = fi - i;
  const a = ys[i]!;
  if (t === 0) return a;
  return a + (ys[i + 1]! - a) * t;
}

/** Interpolates ys(x) on ascending xs (ends held). */
export function interp(xs: NumArray, ys: NumArray, x: number): number {
  return valueAtIndex(ys, fractionalIndex(xs, x));
}

/**
 * Centered moving average with a window of `window` samples (forced odd). `circular` wraps around
 * the ends (closed loops); otherwise the window shrinks at the edges. NaN values are skipped.
 */
export function movingAverage(values: NumArray, window: number, circular: boolean): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  const half = Math.max(0, Math.floor(window / 2));
  if (half === 0 || n === 0) {
    for (let i = 0; i < n; i++) out[i] = values[i]!;
    return out;
  }
  for (let i = 0; i < n; i++) {
    let acc = 0;
    let cnt = 0;
    for (let k = -half; k <= half; k++) {
      let j = i + k;
      if (circular) j = wrapIndex(j, n);
      else if (j < 0 || j >= n) continue;
      const v = values[j]!;
      if (Number.isNaN(v)) continue;
      acc += v;
      cnt++;
    }
    out[i] = cnt > 0 ? acc / cnt : Number.NaN;
  }
  return out;
}

/** Population statistics; null for an empty / all-NaN set. */
export function computeStats(values: readonly number[]): MetricStats | null {
  const xs = values.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n === 0) return null;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of xs) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / n;
  let sq = 0;
  for (const v of xs) sq += (v - mean) ** 2;
  return { n, mean, stdDev: Math.sqrt(sq / n), min, max };
}

/** Percentile (0–100) with linear interpolation; NaN for an empty set. */
export function percentile(values: readonly number[], p: number): number {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return Number.NaN;
  const f = (clamp(p, 0, 100) / 100) * (xs.length - 1);
  const i = Math.floor(f);
  const t = f - i;
  return i + 1 < xs.length ? xs[i]! + (xs[i + 1]! - xs[i]!) * t : xs[i]!;
}

/** Rounds to `digits` decimals (null/NaN-safe: returns null for non-finite input). */
export function round(x: number | null | undefined, digits = 0): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Formats a number pt-BR style (decimal comma), e.g. fmt(0.6, 1) → "0,6". */
export function fmt(x: number, digits = 0): string {
  const r = round(x, digits) ?? 0;
  return r.toFixed(digits).replace('.', ',');
}
