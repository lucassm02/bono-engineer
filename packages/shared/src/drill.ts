/** Corner drill maths (spec 18): how a pass compares with the best one, and the drill summary. */

import type { LiveDrillPass } from './live.ts';

/** A pass counts as faster/slower only beyond this (ms): below it is measurement noise. */
export const DRILL_NOISE_MS = 30;

export interface DrillPassVerdict {
  /** This pass − the best earlier pass (ms; negative = faster). Null on the first pass. */
  vsBestMs: number | null;
  /** Entry speed − the best earlier pass's (km/h). */
  entrySpeedDeltaKmh: number | null;
  /** Exit speed − the best earlier pass's (km/h). */
  exitSpeedDeltaKmh: number | null;
  /** Fastest of the drill so far, this one included. */
  isBest: boolean;
  /** Clearly faster than the best earlier pass (beyond the noise). */
  improved: boolean;
  /** Clearly slower than the best earlier pass. */
  slower: boolean;
}

/** The fastest pass of a list, null when empty. */
export function bestPass(passes: readonly LiveDrillPass[]): LiveDrillPass | null {
  return passes.length ? passes.reduce((a, b) => (b.timeMs < a.timeMs ? b : a)) : null;
}

/** Compares a pass with the best of the passes before it. */
export function assessDrillPass(
  pass: LiveDrillPass,
  earlier: readonly LiveDrillPass[],
): DrillPassVerdict {
  const best = bestPass(earlier);
  if (!best) {
    return {
      vsBestMs: null,
      entrySpeedDeltaKmh: null,
      exitSpeedDeltaKmh: null,
      isBest: true,
      improved: false,
      slower: false,
    };
  }
  const vsBestMs = pass.timeMs - best.timeMs;
  return {
    vsBestMs,
    entrySpeedDeltaKmh: pass.entrySpeedKmh - best.entrySpeedKmh,
    exitSpeedDeltaKmh: pass.exitSpeedKmh - best.exitSpeedKmh,
    isBest: vsBestMs < 0,
    improved: vsBestMs <= -DRILL_NOISE_MS,
    slower: vsBestMs >= DRILL_NOISE_MS,
  };
}

export interface DrillSummary {
  count: number;
  bestMs: number;
  /** Pass number of the best one. */
  bestN: number;
  firstMs: number;
  lastMs: number;
  averageMs: number;
  /** First pass − best pass (ms, ≥ 0): how much the driver improved. */
  improvementMs: number;
}

/** "12 passes; best 3.421 s; 0.18 s better than the first." Null without passes. */
export function drillSummary(passes: readonly LiveDrillPass[]): DrillSummary | null {
  const best = bestPass(passes);
  const first = passes[0];
  const last = passes.at(-1);
  if (!best || !first || !last) return null;
  return {
    count: passes.length,
    bestMs: best.timeMs,
    bestN: best.n,
    firstMs: first.timeMs,
    lastMs: last.timeMs,
    averageMs: Math.round(passes.reduce((a, p) => a + p.timeMs, 0) / passes.length),
    improvementMs: Math.max(0, first.timeMs - best.timeMs),
  };
}

/** Whether a pass is worth keeping: the car did not stop or spin in the corner. */
export function isCleanDrillPass(minSpeedKmh: number, timeMs: number): boolean {
  return minSpeedKmh >= 8 && timeMs > 0 && timeMs < 120_000;
}
