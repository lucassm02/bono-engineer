/**
 * Colour ramps of the comparison map (spec 17): speed, brake, throttle and lateral difference,
 * built only from theme tokens so the map follows the app's palette.
 */

import { type MapColorMode, rampFraction } from '@gt7/shared';
import { THEME } from '../../lib/theme.ts';

export type RampMode = Exclude<MapColorMode, 'time' | 'lines'>;

export interface MapRamp {
  mode: RampMode;
  lo: number;
  hi: number;
}

function rgb(hex: string): [number, number, number] {
  const n = hex.replace('#', '');
  return [
    Number.parseInt(n.slice(0, 2), 16),
    Number.parseInt(n.slice(2, 4), 16),
    Number.parseInt(n.slice(4, 6), 16),
  ];
}

/** `a` → `b` by `t` (0–1), as `rgb(...)`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const k = Math.min(1, Math.max(0, t));
  const m = (x: number, y: number) => Math.round(x + (y - x) * k);
  return `rgb(${m(ar, br)}, ${m(ag, bg)}, ${m(ab, bb)})`;
}

/** Piecewise ramp through the stops. */
function through(stops: readonly string[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mixHex(stops[i]!, stops[i + 1]!, x - i);
}

const STOPS: Record<RampMode, readonly string[]> = {
  // cold = slow, hot = fast
  speed: [THEME.info, THEME.warn, THEME.loss],
  brake: [THEME.text3, THEME.warn, THEME.loss],
  throttle: [THEME.text3, THEME.gain],
  // neutral → noticeable → far from the other lap
  diff: [THEME.text2, THEME.warn, THEME.loss],
};

/** Colour of `value` on the ramp; null (no data) draws dimmed by the caller. */
export function rampColor(ramp: MapRamp, value: number | null | undefined): string | null {
  const v = ramp.mode === 'diff' && typeof value === 'number' ? Math.abs(value) : value;
  const t = rampFraction(v, ramp.lo, ramp.hi);
  return t === null ? null : through(STOPS[ramp.mode], t);
}

/** Legend stops (CSS gradient) of a ramp mode. */
export function rampGradient(mode: RampMode): string {
  return `linear-gradient(90deg, ${STOPS[mode].join(', ')})`;
}
