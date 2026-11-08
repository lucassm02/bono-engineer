/** Tunables of the dashboard (thresholds, timings). Pure data: safe to import from tests. */

/** Tyre temperature scale (°C): cold blue → ideal green → hot red. */
export interface TyreTempScale {
  /** At or below: fully "cold" colour. */
  cold: number;
  /** Start of the ideal window. */
  idealMin: number;
  /** End of the ideal window. */
  idealMax: number;
  /** At or above: fully "hot" colour. */
  hot: number;
}

export const TYRE_TEMP_SCALE: TyreTempScale = {
  cold: 50,
  idealMin: 70,
  idealMax: 95,
  hot: 115,
};

/** |slip ratio| above which a wheel is shown as spinning (+) or locking (−). */
export const SLIP_WARN = 0.08;
export const SLIP_ALERT = 0.18;

/** Suspension travel range used for the bars (m, height as reported by the game). */
export const SUSPENSION_RANGE_M = { min: 0, max: 0.2 };

/** Delta bar full scale (ms). */
export const DELTA_BAR_RANGE_MS = 2000;

/** Number of shift lights. */
export const SHIFT_LIGHT_COUNT = 12;

export const TIMINGS = {
  overlayMs: 3000,
  lapPopupMs: 5000,
  longPressMs: 600,
  doubleTapMs: 280,
  /** Pointer travel (px) that turns a press into a swipe/scroll. */
  moveTolerancePx: 12,
  /** Rolling window of the Inputs chart. */
  inputsWindowS: 10,
  /** Neighbour (off-screen) views refresh rate. */
  backgroundRefreshMs: 500,
} as const;
