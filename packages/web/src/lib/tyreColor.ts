import type { TyreTempScale } from '../config.ts';

/** Bands of the panel scale; the radio tyre rules use the same function (@gt7/shared). */
export { type TyreTempBand, tyreTempBand } from '@gt7/shared';

export type Rgb = readonly [number, number, number];

/** Palette anchors of the temperature scale. */
export const TYRE_COLORS = {
  cold: [56, 132, 255] as Rgb,
  ideal: [38, 214, 110] as Rgb,
  hot: [255, 52, 64] as Rgb,
} as const;

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
  if (!Number.isFinite(tempC)) return [90, 98, 110];
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
