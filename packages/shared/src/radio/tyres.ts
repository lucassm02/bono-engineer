/** Tyre temperature bands on the panel scale (shared by the web panel and the radio rules). */

import type { Wheels } from '../telemetry.ts';
import type { RadioTyreScale } from './settings.ts';

export type TyreTempBand = 'cold' | 'warming' | 'ideal' | 'overheating' | 'hot';

export function tyreTempBand(tempC: number, s: RadioTyreScale): TyreTempBand {
  if (tempC <= s.cold) return 'cold';
  if (tempC < s.idealMin) return 'warming';
  if (tempC <= s.idealMax) return 'ideal';
  if (tempC < s.hot) return 'overheating';
  return 'hot';
}

/** A usable range: finite and ordered cold < idealMin ≤ idealMax < hot. */
export function isTyreScaleUsable(s: RadioTyreScale): boolean {
  return (
    [s.cold, s.idealMin, s.idealMax, s.hot].every(Number.isFinite) &&
    s.cold < s.idealMin &&
    s.idealMin <= s.idealMax &&
    s.idealMax < s.hot
  );
}

/**
 * Plausible per-wheel temperatures: four finite readings within -30…250 °C and not the all-zero
 * pattern of menu/garage packets.
 */
export function plausibleTyreTemps(temps: Wheels | null | undefined): temps is Wheels {
  if (temps?.length !== 4) return false;
  if (!temps.every((t) => Number.isFinite(t) && t > -30 && t < 250)) return false;
  return temps.some((t) => t !== 0);
}

/** "45 · 48 · 40 · 42 °C" (FL · FR · RL · RR). */
export function tyreTempsLabel(temps: Wheels): string {
  return `${temps.map((t) => Math.round(t)).join(' · ')} °C`;
}
