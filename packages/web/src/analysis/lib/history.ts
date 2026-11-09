/**
 * Pure helpers of the history home: types of `GET /api/tracks/overview` (mirror of
 * server/src/tracks-catalog.ts), search/filter, grouping of sessions by day and small formatters.
 */

import type { Session } from '@gt7/shared';

// ---------------------------------------------------------------------------------------------
// API types (kept in sync by hand with packages/server/src/tracks-catalog.ts)
// ---------------------------------------------------------------------------------------------

export interface OverviewBest {
  timeMs: number;
  lapId: string;
  sessionId: string;
  carCode: number;
  at: number;
}

export interface OverviewCar {
  carCode: number;
  laps: number;
  sessions: number;
  bestMs: number | null;
  bestLapId: string | null;
  lastAt: number;
}

export type TrendKind = 'improved' | 'worsened' | 'same' | 'none';

export interface TrackOverview {
  id: string;
  name: string;
  layout: string | null;
  lengthM: number;
  source: 'auto' | 'user' | 'builtin';
  needsName: boolean;
  createdAt: number;
  thumb: { x: number[]; z: number[] } | null;
  sessionCount: number;
  lapCount: number;
  validLapCount: number;
  lastActivityAt: number | null;
  best: OverviewBest | null;
  cars: OverviewCar[];
  referenceCount: number;
  bestReferenceMs: number | null;
  trend: { kind: TrendKind; deltaMs: number | null; carCode: number | null };
}

export interface TracksOverview {
  simulator: boolean;
  tracks: TrackOverview[];
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

/** "Name · Layout" as a card title. */
export function fullTrackName(t: { name: string; layout?: string | null }): string {
  return t.layout ? `${t.name} · ${t.layout}` : t.name;
}

/** Lower-case, accent-free text for searching. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------------------------

export interface HomeFilter {
  /** Free text: matches the track name/layout. */
  query: string;
  /** Only tracks driven with this car (null = all). */
  carCode: number | null;
  /** Hide tracks coming from the demo console. */
  hideDemo: boolean;
}

/** Cars used across the given tracks, most used first. */
export function carsOf(tracks: readonly TrackOverview[]): { carCode: number; laps: number }[] {
  const m = new Map<number, number>();
  for (const t of tracks)
    for (const c of t.cars) m.set(c.carCode, (m.get(c.carCode) ?? 0) + c.laps);
  return [...m.entries()]
    .map(([carCode, laps]) => ({ carCode, laps }))
    .sort((a, b) => b.laps - a.laps || a.carCode - b.carCode);
}

export function filterTracks(
  tracks: readonly TrackOverview[],
  f: HomeFilter,
  isDemo: boolean,
): TrackOverview[] {
  if (isDemo && f.hideDemo) return [];
  const q = normalizeText(f.query);
  return tracks.filter((t) => {
    if (f.carCode !== null && !t.cars.some((c) => c.carCode === f.carCode)) return false;
    if (q && !normalizeText(fullTrackName(t)).includes(q)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Sessions grouped by day
// ---------------------------------------------------------------------------------------------

export interface DayGroup<T> {
  /** Local date `YYYY-MM-DD`. */
  day: string;
  items: T[];
}

/** Local-time `YYYY-MM-DD` key of an epoch. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Groups by local day, newest day first; items keep their order within the day (newest first). */
export function groupByDay<T>(items: readonly T[], at: (item: T) => number): DayGroup<T>[] {
  const sorted = [...items].sort((a, b) => at(b) - at(a));
  const groups: DayGroup<T>[] = [];
  for (const it of sorted) {
    const key = dayKey(at(it));
    const last = groups[groups.length - 1];
    if (last && last.day === key) last.items.push(it);
    else groups.push({ day: key, items: [it] });
  }
  return groups;
}

export function groupSessionsByDay(sessions: readonly Session[]): DayGroup<Session>[] {
  return groupByDay(sessions, (s) => s.startedAt);
}

const weekdayDate = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
});
const weekdayDateYear = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

/** "Hoje", "Ontem" or "sábado, 08 de novembro" for a `YYYY-MM-DD` key. */
export function dayHeading(key: string, now = Date.now()): string {
  if (key === dayKey(now)) return 'Hoje';
  if (key === dayKey(now - 86_400_000)) return 'Ontem';
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  const date = new Date(y, m - 1, d);
  const same = y === new Date(now).getFullYear();
  const text = (same ? weekdayDate : weekdayDateYear).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Local "14:32". */
export function formatClock(ms: number): string {
  return timeFmt.format(new Date(ms));
}

/** Session duration "42 min" / "1 h 05" (null while running or unknown). */
export function formatDuration(startedAt: number, endedAt: number | null): string | null {
  if (endedAt === null || endedAt <= startedAt) return null;
  const min = Math.max(1, Math.round((endedAt - startedAt) / 60_000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------
// Texts
// ---------------------------------------------------------------------------------------------

/** "5,79 km". */
export function formatKm(lengthM: number, digits = 2): string {
  return `${(lengthM / 1000).toFixed(digits).replace('.', ',')} km`;
}

/** "1 volta" / "12 voltas". */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Relative moment of the best lap: "hoje", "ontem", "há 5 dias", "em 12/03/2026". */
export function whenLabel(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return '';
  const days = Math.floor(
    (new Date(dayKey(now)).getTime() - new Date(dayKey(ms)).getTime()) / 86_400_000,
  );
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  if (days < 365)
    return `há ${Math.round(days / 30)} ${Math.round(days / 30) === 1 ? 'mês' : 'meses'}`;
  return new Date(ms).toLocaleDateString('pt-BR');
}

export function trendLabel(
  t: TrackOverview['trend'],
): { text: string; tone: 'gain' | 'loss' | 'flat' } | null {
  if (t.kind === 'none' || t.deltaMs === null) return null;
  const abs = (Math.abs(t.deltaMs) / 1000).toFixed(3).replace('.', ',');
  if (t.kind === 'improved') return { text: `Melhorou ${abs} s`, tone: 'gain' };
  if (t.kind === 'worsened') return { text: `Piorou ${abs} s`, tone: 'loss' };
  return { text: 'Estável', tone: 'flat' };
}
