/**
 * Map overlay maths (spec 17): where two laps part ways on the track, and how to scale a channel
 * into a colour. Pure; the canvas and the theme colours live in the web package.
 */

/** What the colour of the lap on the map shows. */
export const MAP_COLOR_MODES = ['time', 'lines', 'speed', 'brake', 'throttle', 'diff'] as const;
export type MapColorMode = (typeof MAP_COLOR_MODES)[number];

type Series = ArrayLike<number | null | undefined>;

const finite = (v: number | null | undefined): v is number =>
  v !== null && v !== undefined && Number.isFinite(v);

/**
 * Lateral difference (m) of lap A from lap B at every sample: both offsets are measured from the
 * same track line (+ = left of it), so A − B is how far A runs to the left of B (negative = to the
 * right). Null where either lap has no offset.
 */
export function lateralDifference(a: Series, b: Series): (number | null)[] {
  const n = Math.min(a.length, b.length);
  const out: (number | null)[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    out[i] = finite(x) && finite(y) ? x - y : null;
  }
  return out;
}

export interface LateralMarker {
  distanceM: number;
  /** Signed difference (m), + = lap A is to the left of lap B. */
  diffM: number;
}

/**
 * The places where the two laps are furthest apart: local peaks of |difference| above `minM`,
 * strongest first, at least `minGapM` apart, at most `max` of them. These get a text label on the
 * map so the difference does not rely on colour alone.
 */
export function lateralMarkers(
  distanceM: ArrayLike<number>,
  diff: Series,
  opts: { minM?: number; minGapM?: number; max?: number } = {},
): LateralMarker[] {
  const minM = opts.minM ?? 2;
  const minGapM = opts.minGapM ?? 60;
  const max = opts.max ?? 6;
  const peaks: LateralMarker[] = [];
  for (let i = 0; i < diff.length; i++) {
    const v = diff[i];
    if (!finite(v) || Math.abs(v) < minM) continue;
    const prev = diff[i - 1];
    const next = diff[i + 1];
    const a = Math.abs(v);
    if (
      (finite(prev) && Math.abs(prev) > a) ||
      (finite(next) && Math.abs(next) >= a && next !== v)
    ) {
      continue;
    }
    peaks.push({ distanceM: distanceM[i]!, diffM: v });
  }
  peaks.sort((p, q) => Math.abs(q.diffM) - Math.abs(p.diffM));
  const out: LateralMarker[] = [];
  for (const p of peaks) {
    if (out.length >= max) break;
    if (out.every((q) => Math.abs(q.distanceM - p.distanceM) >= minGapM)) out.push(p);
  }
  return out.sort((p, q) => p.distanceM - q.distanceM);
}

/** Side and size of a signed lateral difference: "3,2 m to the left". */
export function lateralSide(diffM: number): { meters: number; side: 'left' | 'right' } {
  return { meters: Math.round(Math.abs(diffM) * 10) / 10, side: diffM >= 0 ? 'left' : 'right' };
}

/** `v` as 0–1 between `lo` and `hi` (clamped); null for a missing value or an empty range. */
export function rampFraction(v: number | null | undefined, lo: number, hi: number): number | null {
  if (!finite(v) || !(hi > lo)) return null;
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

/** Low/high percentile of a series (default 2 % and 98 %), to scale a colour ramp. */
export function seriesRange(values: Series, low = 2, high = 98): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (finite(v)) xs.push(v);
  }
  if (xs.length === 0) return null;
  xs.sort((a, b) => a - b);
  const at = (p: number) =>
    xs[Math.min(xs.length - 1, Math.max(0, Math.round((p / 100) * (xs.length - 1))))]!;
  return [at(low), at(high)];
}
