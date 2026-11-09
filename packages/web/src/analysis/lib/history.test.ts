import { makerOfCar, type Session } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { GT7_TRACKS, trackDisplayName } from '../../data/gt7Tracks.ts';
import { bootTarget, openedWithoutRoute } from '../../lib/boot.ts';
import { parseRoute, routes } from '../../lib/route.ts';
import { UNKNOWN_MAKER_ID } from './carFilter.ts';
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
import { LENGTH_WINDOW, resolveTyped, searchCatalog, suggestByLength } from './trackSuggest.ts';

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

  it('filters tracks by maker (catalogue) and by cars outside the catalogue', () => {
    const car = (carCode: number, laps: number) => ({
      carCode,
      laps,
      sessions: 1,
      bestMs: 1,
      bestLapId: null,
      lastAt: 1,
    });
    const a = overview({ id: 'a', name: 'A', cars: [car(3337, 2)] }); // Alpine A110 '17
    const b = overview({ id: 'b', name: 'B', cars: [car(987654, 1)] }); // not in the catalogue
    const alpine = makerOfCar(3337)!.id;
    const f = { query: '', carCode: null, hideDemo: false };
    expect(filterTracks([a, b], { ...f, makerId: alpine }, false).map((t) => t.id)).toEqual(['a']);
    expect(
      filterTracks([a, b], { ...f, makerId: UNKNOWN_MAKER_ID }, false).map((t) => t.id),
    ).toEqual(['b']);
    expect(filterTracks([a, b], { ...f, carCode: 3337, makerId: alpine }, false)).toHaveLength(1);
    expect(filterTracks([a, b], { ...f, makerId: null }, false)).toHaveLength(2);
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
  it('suggests by length in the asymmetric window and orders by the typical −0.95 %', () => {
    const s = suggestByLength(5807 * 0.99);
    expect(s[0]!.track.name).toBe('Suzuka Circuit');
    expect(
      s.every((x) => x.errorRel >= LENGTH_WINDOW.minRel && x.errorRel <= LENGTH_WINDOW.maxRel),
    ).toBe(true);
    // Monza (5793) and Suzuka (5807) are 0.24 % apart: both are candidates
    const both = suggestByLength(5800, GT7_TRACKS, LENGTH_WINDOW, 10);
    expect(both.map((x) => x.track.name)).toEqual(
      expect.arrayContaining(['Autodromo Nazionale Monza', 'Suzuka Circuit']),
    );
  });

  it('respects the window edges (−4 % … +1.5 %), not ±1.5 %', () => {
    const inter = (m: number) =>
      suggestByLength(m, GT7_TRACKS, LENGTH_WINDOW, 500).some((x) =>
        x.track.name.includes('Interlagos'),
      );
    expect(inter(4309 * 1.016)).toBe(false);
    expect(inter(4309 * 1.014)).toBe(true);
    // a lap measured 2.8 % short (p10 of the survey) used to be rejected by ±1.5 %
    expect(inter(4309 * (1 - 0.028))).toBe(true);
    expect(inter(4309 * (1 - 0.041))).toBe(false);
    expect(suggestByLength(0)).toEqual([]);
    expect(suggestByLength(Number.NaN)).toEqual([]);
    expect(suggestByLength(300)).toEqual([]);
  });

  it('the real Trial Mountain lap (5361 m, −1.3 %) is suggested', () => {
    // by length alone several layouts compete (Alsace Village 5423 m, Watkins Glen Long 5423 m…)
    const names = suggestByLength(5361, GT7_TRACKS, LENGTH_WINDOW, 12).map((s) => s.track.name);
    expect(names).toContain('Trial Mountain Circuit');
  });

  it('autocomplete matches every word, accent-insensitive', () => {
    expect(searchCatalog('nurb nord')[0]).toMatchObject({ name: 'Nürburgring' });
    expect(searchCatalog('nurb nord')[0]!.layout).toMatch(/Nordschleife/);
    expect(searchCatalog('monza').length).toBe(2);
    expect(searchCatalog('zzzz')).toEqual([]);
    expect(searchCatalog('')).toHaveLength(8);
    expect(searchCatalog('sugo')[0]?.name).toBe('Sportsland SUGO');
  });

  it('prefers the entry closest in length when ranking equals', () => {
    const r = searchCatalog('suzuka', 2250);
    expect(r[0]!.layout).toBe('East Course');
  });

  it('resolves a typed display name back to name + layout', () => {
    expect(
      resolveTyped(trackDisplayName({ name: 'Suzuka Circuit', layout: 'East Course' })),
    ).toEqual({ name: 'Suzuka Circuit', layout: 'East Course' });
    expect(resolveTyped('  Meu autódromo ')).toEqual({ name: 'Meu autódromo', layout: null });
  });

  it('is derived from the official catalogue: 122 layouts, unique names, plausible lengths', () => {
    expect(GT7_TRACKS).toHaveLength(122);
    const names = GT7_TRACKS.map(trackDisplayName);
    expect(new Set(names).size).toBe(names.length);
    for (const t of GT7_TRACKS) {
      expect(t.lengthM).toBeGreaterThan(500);
      expect(t.lengthM).toBeLessThan(40_000);
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
