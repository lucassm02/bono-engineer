/** Lap time typed by the driver ("1:30.960", "1:30,96", "90.960", "1:02:03.5") ↔ ms. */

/**
 * Parses `[h:]m:ss[.mmm]` or `ss[.mmm]` (dot or comma decimals, 1–3 fraction digits).
 * Returns null for anything invalid (seconds ≥ 60 when minutes are given, empty, negative…).
 */
export function parseLapTime(input: string): number | null {
  const s = input.trim().replace(',', '.');
  if (!s) return null;
  const m = /^(?:(?:(\d{1,2}):)?(\d{1,3}):)?(\d{1,4})(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const hasMin = m[2] !== undefined;
  const h = m[1] ? Number(m[1]) : 0;
  const min = hasMin ? Number(m[2]) : 0;
  const sec = Number(m[3]);
  const frac = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  if (hasMin && sec >= 60) return null;
  if (m[1] !== undefined && min >= 60) return null;
  const ms = ((h * 60 + min) * 60 + sec) * 1000 + frac;
  return ms > 0 ? ms : null;
}

/** ms → "m:ss.mmm" (input format, dot decimals). */
export function formatLapTimeInput(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms <= 0) return '';
  const t = Math.round(ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(t % 1000).padStart(3, '0')}`;
}
