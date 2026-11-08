/** Small numeric helpers (pure). */

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** Wraps an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/**
 * Index i of the last element with arr[i] <= v in a non-decreasing array (−1 if v < arr[0]).
 */
export function upperIndex(arr: ArrayLike<number>, v: number, n = arr.length): number {
  let lo = 0;
  let hi = n - 1;
  if (n === 0 || v < arr[0]!) return -1;
  if (v >= arr[hi]!) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Linear interpolation of ys at x over a non-decreasing xs. Outside the range the edge value is
 * returned (no extrapolation).
 */
export function interp(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  x: number,
  n = xs.length,
): number {
  if (n === 0) return Number.NaN;
  const i = upperIndex(xs, x, n);
  if (i < 0) return ys[0]!;
  if (i >= n - 1) return ys[n - 1]!;
  const x0 = xs[i]!;
  const x1 = xs[i + 1]!;
  const y0 = ys[i]!;
  const y1 = ys[i + 1]!;
  return x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y0;
}

/** Exponential smoothing factor for a time constant. */
export function emaAlpha(dtS: number, tauS: number): number {
  if (tauS <= 0) return 1;
  return 1 - Math.exp(-Math.max(0, dtS) / tauS);
}
