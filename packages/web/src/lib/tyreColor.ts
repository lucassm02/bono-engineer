import type { TyreTempScale } from '../config.ts';
import { THEME } from './theme.ts';

/** Bands of the panel scale; the radio tyre rules use the same function (@gt7/shared). */
export { type TyreTempBand, tyreTempBand } from '@gt7/shared';

export type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = hex.replace('#', '');
  return [
    Number.parseInt(n.slice(0, 2), 16),
    Number.parseInt(n.slice(2, 4), 16),
    Number.parseInt(n.slice(4, 6), 16),
  ];
}

/** Palette anchors of the temperature scale (race codes: info = cold, gain = ideal, loss = hot). */
export const TYRE_COLORS = {
  cold: hexToRgb(THEME.info),
  ideal: hexToRgb(THEME.gain),
  hot: hexToRgb(THEME.loss),
} as const;

const UNKNOWN: Rgb = hexToRgb(THEME.text3);

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = t < 0 ? 0 : Math.min(t, 1);
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/** Colour for a temperature: blue at/below `cold`, green inside the ideal window, red at/above `hot`. */
export function tyreTempRgb(tempC: number, s: TyreTempScale): Rgb {
  if (!Number.isFinite(tempC)) return UNKNOWN;
  if (tempC <= s.cold) return TYRE_COLORS.cold;
  if (tempC < s.idealMin) {
    return mix(TYRE_COLORS.cold, TYRE_COLORS.ideal, (tempC - s.cold) / (s.idealMin - s.cold));
  }
  if (tempC <= s.idealMax) return TYRE_COLORS.ideal;
  if (tempC < s.hot) {
    return mix(TYRE_COLORS.ideal, TYRE_COLORS.hot, (tempC - s.idealMax) / (s.hot - s.idealMax));
  }
  return TYRE_COLORS.hot;
}

export function tyreTempColor(tempC: number, s: TyreTempScale): string {
  const [r, g, b] = tyreTempRgb(tempC, s);
  return `rgb(${r} ${g} ${b})`;
}
