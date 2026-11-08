/** Number formatting for the dashboard (pt-BR decimal comma, tabular-friendly fixed widths). */

const DASH = '–';

/** Lap time `m:ss,mmm` (or `ss,mmm` under a minute when `compact`). Null → placeholder. */
export function formatLapTime(ms: number | null | undefined, compact = false): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0)
    return `${DASH}:${DASH}${DASH},${DASH}${DASH}${DASH}`;
  const total = Math.round(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  const frac = String(milli).padStart(3, '0');
  if (compact && m === 0) return `${s},${frac}`;
  return `${m}:${String(s).padStart(2, '0')},${frac}`;
}

/** Sector time `ss,mmm` (minutes only when needed). */
export function formatSectorTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms))
    return `${DASH}${DASH},${DASH}${DASH}${DASH}`;
  return formatLapTime(ms, true);
}

/**
 * Delta in seconds with sign: `+0,384` / `−1,207`. Positive = slower.
 * Uses the true minus sign (U+2212) so + and − have the same width in tabular fonts.
 * `digits` = decimals (3 default; 2 for the big view).
 */
export function formatDelta(ms: number | null | undefined, digits = 3): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms))
    return `${DASH}${DASH},${DASH.repeat(digits)}`;
  const factor = 10 ** digits;
  const rounded = Math.round(Math.abs(ms) / (1000 / factor));
  const sign = rounded === 0 ? '±' : ms > 0 ? '+' : '−';
  const int = Math.floor(rounded / factor);
  const frac = String(rounded % factor).padStart(digits, '0');
  return `${sign}${int},${frac}`;
}

/** Sign class of a delta for colouring: gain (faster), loss (slower) or neutral. */
export function deltaTone(
  ms: number | null | undefined,
  deadbandMs = 5,
): 'gain' | 'loss' | 'neutral' {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || Math.abs(ms) < deadbandMs) {
    return 'neutral';
  }
  return ms < 0 ? 'gain' : 'loss';
}

/**
 * Gear label: 0 → N. TODO(primeiro teste com o PS5): the game's encoding of reverse vs neutral is
 * unverified (both may arrive as gear <= 0); until then reverse also shows as N. No behaviour change.
 */
export function formatGear(gear: number | null | undefined): string {
  if (gear === null || gear === undefined || !Number.isFinite(gear)) return DASH;
  return gear <= 0 ? 'N' : String(gear);
}

export function formatInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return String(Math.round(v));
}

export function formatFixed(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return v.toFixed(digits).replace('.', ',');
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : Math.min(v, max);
}

/** Delta bar position −1..1 (− = gaining, drawn to the left/green). */
export function deltaBarFraction(ms: number | null | undefined, rangeMs: number): number {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 0;
  return clamp(ms / rangeMs, -1, 1);
}
