/**
 * Tyre pace (spec 16). The game does not send tyre wear, so wear is ESTIMATED from the lap times:
 * when the clean laps of the stint keep getting slower, the tyres are probably going away. The
 * result is always shown as an estimate and the thresholds are conservative.
 */

export type TyrePaceState = 'unknown' | 'steady' | 'dropping';

export interface TyrePaceTrend {
  state: TyrePaceState;
  /** Change of lap time per lap (ms) over the window; null when unknown. */
  slopeMsPerLap: number | null;
  /** Clean laps the estimate used. */
  laps: number;
}

/** Slower than this per lap, over the window, counts as the pace dropping (ms). */
export const TYRE_DROP_MS_PER_LAP = 150;
/** Laps of the window (the most recent clean laps of the stint). */
export const TYRE_PACE_WINDOW = 5;
/** Fewer clean laps than this and nothing is said. */
export const TYRE_PACE_MIN_LAPS = 4;
/** A lap slower than this share of the stint's best is not a clean lap (traffic, mistake). */
export const TYRE_CLEAN_RATIO = 1.04;

function slope(times: readonly number[]): number {
  const n = times.length;
  const mx = (n - 1) / 2;
  const my = times.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (times[i]! - my);
    den += (i - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * `laps` are the valid lap times of the current stint in driving order (ms). Laps more than 4 %
 * slower than the stint's best are left out. Dropping needs the straight line through the last
 * clean laps to climb by 0.15 s per lap AND the last lap to be slower than the first of the
 * window, so one slow lap in the middle does not trigger it.
 */
export function tyrePaceTrend(laps: readonly number[]): TyrePaceTrend {
  if (laps.length === 0) return { state: 'unknown', slopeMsPerLap: null, laps: 0 };
  const best = Math.min(...laps);
  const clean = laps.filter((t) => t <= best * TYRE_CLEAN_RATIO);
  if (clean.length < TYRE_PACE_MIN_LAPS) {
    return { state: 'unknown', slopeMsPerLap: null, laps: clean.length };
  }
  const window = clean.slice(-TYRE_PACE_WINDOW);
  const s = slope(window);
  const dropping = s >= TYRE_DROP_MS_PER_LAP && window.at(-1)! > window[0]!;
  return {
    state: dropping ? 'dropping' : 'steady',
    slopeMsPerLap: Math.round(s),
    laps: window.length,
  };
}
