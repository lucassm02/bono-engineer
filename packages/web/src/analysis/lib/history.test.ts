import type { Session } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { GT7_TRACKS, trackDisplayName } from '../../data/gt7Tracks.ts';
import { bootTarget, openedWithoutRoute } from '../../lib/boot.ts';
import { parseRoute, routes } from '../../lib/route.ts';
import {
  carsOf,
  dayHeading,
  dayKey,
  filterTracks,
  formatDuration,
  formatKm,
  fullTrackName,
  groupByDay,
  groupSessionsByDay,
  normalizeText,
  plural,
  type TrackOverview,
  trendLabel,
  whenLabel,
} from './history.ts';
import { LENGTH_TOLERANCE, resolveTyped, searchCatalog, suggestByLength } from './trackSuggest.ts';

const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

const overview = (over: Partial<TrackOverview> = {}): TrackOverview => ({
  id: 't',
  name: 'Autodromo Nazionale Monza',
  layout: null,
  lengthM: 5793,
  source: 'user',
  needsName: false,
  createdAt: 0,
  thumb: null,
  sessionCount: 1,
  lapCount: 3,
  validLapCount: 3,
  lastActivityAt: 1,
  best: null,
  cars: [{ carCode: 7, laps: 3, sessions: 1, bestMs: 90000, bestLapId: 'l', lastAt: 1 }],
  referenceCount: 0,
  bestReferenceMs: null,
  trend: { kind: 'none', deltaMs: null, carCode: null },
  ...over,
});

describe('history: text and filters', () => {
  it('normalizes accents and punctuation', () => {
    expect(normalizeText('Nürburgring – Nordschleife')).toBe('nurburgring nordschleife');
    expect(normalizeText('  Autódromo  de Interlagos ')).toBe('autodromo de interlagos');
  });

  it('filters by text (accent-insensitive), car and demo flag', () => {
    const monza = overview();
    const nur = overview({
      id: 'n',
      name: 'Nürburgring',
      layout: 'Nordschleife',
      cars: [{ carCode: 9, laps: 1, sessions: 1, bestMs: 1, bestLapId: null, lastAt: 1 }],
    });
    const all = [monza, nur];
    const f = { query: '', carCode: null, hideDemo: false };
    expect(filterTracks(all, f, false)).toHaveLength(2);
    expect(filterTracks(all, { ...f, query: 'nurburg' }, false).map((t) => t.id)).toEqual(['n']);
    expect(filterTracks(all, { ...f, query: 'nordschleife' }, false)).toHaveLength(1);
    expect(filterTracks(all, { ...f, carCode: 7 }, false).map((t) => t.id)).toEqual(['t']);
    expect(filterTracks(all, { ...f, hideDemo: true }, true)).toEqual([]);
    expect(filterTracks(all, { ...f, hideDemo: true }, false)).toHaveLength(2);
  });

  it('lists cars by number of laps', () => {
    const a = overview({
      cars: [
        { carCode: 1, laps: 2, sessions: 1, bestMs: 1, bestLapId: null, lastAt: 1 },
        { carCode: 2, laps: 9, sessions: 1, bestMs: 1, bestLapId: null, lastAt: 1 },
      ],
    });
    expect(carsOf([a, overview()]).map((c) => c.carCode)).toEqual([2, 7, 1]);
  });

  it('formats names, lengths, plurals and trend', () => {
    expect(fullTrackName({ name: 'Suzuka Circuit', layout: 'Completo' })).toBe(
      'Suzuka Circuit · Completo',
    );
    expect(fullTrackName({ name: 'Tsukuba Circuit', layout: null })).toBe('Tsukuba Circuit');
    expect(formatKm(5793)).toBe('5,79 km');
    expect(formatKm(20832, 3)).toBe('20,832 km');
    expect(plural(1, 'volta', 'voltas')).toBe('1 volta');
    expect(plural(0, 'volta', 'voltas')).toBe('0 voltas');
    expect(trendLabel({ kind: 'improved', deltaMs: -1234, carCode: 1 })).toEqual({
      text: 'Melhorou 1,234 s',
      tone: 'gain',
    });
    expect(trendLabel({ kind: 'worsened', deltaMs: 500, carCode: 1 })?.tone).toBe('loss');
    expect(trendLabel({ kind: 'same', deltaMs: 10, carCode: 1 })?.text).toBe('Estável');
    expect(trendLabel({ kind: 'none', deltaMs: null, carCode: null })).toBeNull();
  });
});

describe('history: days', () => {
  const now = local(2026, 11, 8, 15);

  it('groups sessions by local day, newest first', () => {
    const mk = (id: string, at: number): Session =>
      ({ id, startedAt: at, trackId: 't', carCode: 1, mode: 'live' }) as Session;
    const groups = groupSessionsByDay([
      mk('a', local(2026, 11, 6, 20)),
      mk('b', local(2026, 11, 8, 9)),
      mk('c', local(2026, 11, 8, 18)),
      mk('d', local(2026, 11, 6, 8)),
    ]);
    expect(groups.map((g) => g.day)).toEqual(['2026-11-08', '2026-11-06']);
    expect(groups[0]!.items.map((s) => s.id)).toEqual(['c', 'b']);
    expect(groups[1]!.items.map((s) => s.id)).toEqual(['a', 'd']);
    expect(groupByDay([], () => 0)).toEqual([]);
  });

  it('day keys use local time (a late session stays on its own day)', () => {
    expect(dayKey(local(2026, 1, 2, 23, 59))).toBe('2026-01-02');
    expect(dayKey(local(2026, 1, 3, 0, 1))).toBe('2026-01-03');
  });

  it('headings: Hoje / Ontem / weekday and date', () => {
    expect(dayHeading('2026-11-08', now)).toBe('Hoje');
    expect(dayHeading('2026-11-07', now)).toBe('Ontem');
    expect(dayHeading('2026-11-05', now)).toMatch(/^Quinta-feira, 05 de novembro$/);
    expect(dayHeading('2025-03-01', now)).toContain('2025');
  });

  it('relative moments and durations', () => {
    expect(whenLabel(local(2026, 11, 8, 8), now)).toBe('hoje');
    expect(whenLabel(local(2026, 11, 7, 23), now)).toBe('ontem');
    expect(whenLabel(local(2026, 11, 3), now)).toBe('há 5 dias');
    expect(whenLabel(local(2026, 8, 8), now)).toBe('há 3 meses');
    expect(whenLabel(null, now)).toBe('');
    expect(formatDuration(0, 42 * 60_000)).toBe('42 min');
    expect(formatDuration(0, 65 * 60_000)).toBe('1 h 05');
    expect(formatDuration(0, null)).toBeNull();
  });
});

describe('track naming suggestions', () => {
  it('suggests by length within 1.5 % and orders by closeness', () => {
    const s = suggestByLength(5807 * 1.004);
    expect(s[0]!.track.name).toBe('Suzuka Circuit');
    expect(s.every((x) => Math.abs(x.errorRel) <= LENGTH_TOLERANCE)).toBe(true);
    // Monza (5793) and Suzuka (5807) are 0.24 % apart: both are candidates, closest first.
    const both = suggestByLength(5800);
    expect(both.map((x) => x.track.name)).toEqual(
      expect.arrayContaining(['Autodromo Nazionale Monza', 'Suzuka Circuit']),
    );
    expect(Math.abs(both[0]!.errorRel)).toBeLessThanOrEqual(Math.abs(both[1]!.errorRel));
  });

  it('respects the tolerance edges and ignores entries without length', () => {
    expect(
      suggestByLength(4309 * 1.016, GT7_TRACKS).some((x) => x.track.name.includes('Interlagos')),
    ).toBe(false);
    expect(suggestByLength(4309 * 1.014).some((x) => x.track.name.includes('Interlagos'))).toBe(
      true,
    );
    expect(suggestByLength(0)).toEqual([]);
    expect(suggestByLength(Number.NaN)).toEqual([]);
    expect(suggestByLength(3000)).toEqual([]);
    for (const s of suggestByLength(5793)) expect(s.track.lengthM).toBeTypeOf('number');
  });

  it('autocomplete matches every word, accent-insensitive', () => {
    expect(searchCatalog('nurb nord')[0]).toMatchObject({
      name: 'Nürburgring',
      layout: 'Nordschleife',
    });
    expect(searchCatalog('monza').length).toBe(2);
    expect(searchCatalog('zzzz')).toEqual([]);
    expect(searchCatalog('')).toHaveLength(8);
  });

  it('prefers the entry closest in length when ranking equals', () => {
    const r = searchCatalog('suzuka', 2250);
    expect(r[0]!.layout).toBe('East Course');
  });

  it('resolves a typed display name back to name + layout', () => {
    expect(resolveTyped(trackDisplayName({ name: 'Suzuka Circuit', layout: 'Completo' }))).toEqual({
      name: 'Suzuka Circuit',
      layout: 'Completo',
    });
    expect(resolveTyped('  Meu autódromo ')).toEqual({ name: 'Meu autódromo', layout: null });
  });

  it('catalogue sanity: unique names and plausible lengths', () => {
    const names = GT7_TRACKS.map(trackDisplayName);
    expect(new Set(names).size).toBe(names.length);
    for (const t of GT7_TRACKS) {
      if (t.lengthM !== undefined) {
        expect(t.lengthM).toBeGreaterThan(1000);
        expect(t.lengthM).toBeLessThan(25_000);
      }
    }
  });
});

describe('boot and routes', () => {
  const base = {
    source: 'server' as const,
    wsStatus: 'open' as const,
    liveState: null,
    serverStatus: null,
    timedOut: false,
  };

  it('opens the live panel only during a race or in demo', () => {
    expect(bootTarget({ ...base, wsStatus: 'connecting' })).toBe('wait');
    expect(bootTarget({ ...base })).toBe('wait');
    expect(bootTarget({ ...base, liveState: 'onTrack' })).toBe('live');
    expect(bootTarget({ ...base, serverStatus: { connection: 'replay' } })).toBe('live');
    expect(bootTarget({ ...base, liveState: 'menu' })).toBe('home');
    expect(bootTarget({ ...base, liveState: 'disconnected' })).toBe('home');
    expect(bootTarget({ ...base, source: 'mock', wsStatus: 'closed' })).toBe('live');
    expect(bootTarget({ ...base, wsStatus: 'closed', timedOut: true })).toBe('home');
    expect(bootTarget({ ...base, timedOut: true })).toBe('home');
  });

  it('only a bare URL goes through the gate', () => {
    expect(openedWithoutRoute('', '')).toBe(true);
    expect(openedWithoutRoute('#', '')).toBe(true);
    expect(openedWithoutRoute('#/', '')).toBe(false);
    expect(openedWithoutRoute('#/painel', '')).toBe(false);
    expect(openedWithoutRoute('', '?mock=1')).toBe(false);
  });

  it('routes: home, track tab, sessions', () => {
    expect(parseRoute('#/inicio').name).toBe('home');
    expect(parseRoute('#/inicio/x').name).toBe('notFound');
    expect(routes.home()).toBe('#/inicio');
    expect(routes.track('abc', { tab: 'sessoes' })).toBe('#/analise/pista/abc?tab=sessoes');
    expect(parseRoute('#/analise/pista/abc?tab=sessoes').query.tab).toBe('sessoes');
    expect(parseRoute('#/analise').name).toBe('sessions');
  });
});
