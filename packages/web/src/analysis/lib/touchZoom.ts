/**
 * Two-finger pinch/pan zoom for the synced uPlot charts (uPlot itself only drags with a mouse).
 * Pure math, kept apart from the component so it can be tested.
 */

/** Smallest visible span (m) when pinching in. */
export const MIN_ZOOM_SPAN_M = 20;

/**
 * New x range for a pinch. `start` = range when the gesture began, `startFrac0` = where the
 * midpoint of the two fingers was inside the plot (0..1) at that moment, `scale` = current finger
 * distance / start distance (> 1 zooms in) and `frac1` = where the midpoint is now. The data point
 * that was under the fingers stays under them; the result is clamped to `full`.
 */
export function pinchRange(
  start: [number, number],
  startFrac0: number,
  scale: number,
  frac1: number,
  full: [number, number],
  minSpan = MIN_ZOOM_SPAN_M,
): [number, number] {
  const fullSpan = Math.max(1, full[1] - full[0]);
  const span0 = Math.max(1e-6, start[1] - start[0]);
  const anchor = start[0] + startFrac0 * span0;
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const span = Math.min(fullSpan, Math.max(Math.min(minSpan, fullSpan), span0 / k));
  let min = anchor - frac1 * span;
  let max = min + span;
  if (min < full[0]) {
    max += full[0] - min;
    min = full[0];
  }
  if (max > full[1]) {
    min -= max - full[1];
    max = full[1];
  }
  return [Math.max(min, full[0]), max];
}

/** Two taps closer than this (ms) reset the zoom. */
export const DOUBLE_TAP_MS = 320;
