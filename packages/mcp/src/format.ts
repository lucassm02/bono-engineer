/** Compact, LLM-friendly formatting helpers for MCP tool results. */

import { formatLapTime } from '@gt7/analysis';
import type { Gt7Store } from '@gt7/core';
import type { Lap, MetricStats, Session, Track } from '@gt7/shared';

/** Most recent session with laps, preferring live driving over replay captures. */
export function latestDrivingSession(store: Gt7Store): Session | null {
  const recent = store.listSessions({ limit: 50 }).filter((s) => s.lapCount > 0);
  return recent.find((s) => s.mode === 'live') ?? recent[0] ?? null;
}

/** Default maximum size (chars) of one text block returned by a tool. */
export const MAX_TEXT_CHARS = 24_000;

export function r(x: number | null | undefined, digits = 0): number | null {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}

export const lapTime = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? null : formatLapTime(ms);

/** Local date-time "YYYY-MM-DD HH:mm". */
export function dateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function compactLap(l: Lap, opts: { session?: boolean } = {}) {
  return {
    id: l.id,
    n: l.number,
    time: lapTime(l.timeMs),
    time_ms: l.timeMs,
    sectors_ms: l.sectorTimesMs,
    valid: l.valid,
    ...(l.flags.length ? { flags: l.flags } : {}),
    ...(l.isReference ? { reference: true, driver: l.referenceMeta?.driverName ?? null } : {}),
    car: l.carCode,
    ...(opts.session ? { session: l.sessionId } : {}),
    date: dateTime(l.startedAt),
  };
}

export function compactSession(s: Session, track: Track | null) {
  return {
    id: s.id,
    date: dateTime(s.startedAt),
    track: track ? { id: track.id, name: track.name } : s.trackId,
    car: s.carCode,
    mode: s.mode,
    laps: s.lapCount,
    best: lapTime(s.bestLapMs),
    best_ms: s.bestLapMs,
    ...(s.endedAt === null ? { inProgress: true } : {}),
  };
}

export function compactStats(s: MetricStats | undefined, digits = 1) {
  if (!s) return null;
  return {
    mean: r(s.mean, digits),
    sd: r(s.stdDev, digits + 1),
    min: r(s.min, digits),
    max: r(s.max, digits),
  };
}

/** Rounds every number of a value recursively (arrays of numbers included). */
export function roundDeep<T>(v: T, digits = 2): T {
  if (typeof v === 'number') return (Number.isFinite(v) ? r(v, digits) : null) as T;
  if (Array.isArray(v)) return v.map((x) => roundDeep(x, digits)) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = roundDeep(x, digits);
    return out as T;
  }
  return v;
}

/** JSON text, truncated with an explicit note when larger than `max`. */
export function jsonText(value: unknown, max = MAX_TEXT_CHARS): string {
  const s = JSON.stringify(value);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [truncado: ${s.length} caracteres; refine o filtro/intervalo]`;
}
