import { describe, expect, it } from 'vitest';
import {
  findTrackLayout,
  findTrackLayoutByCourseId,
  getTrackLayout,
  LENGTH_WINDOW,
  lengthCompatible,
  listTrackLayouts,
  lookAlikes,
  searchTrackLayouts,
  suggestLayoutsByLength,
  TRACKS_SOURCES,
  trackLinks,
} from './index.ts';

const find = (name: string) => {
  const l = listTrackLayouts().find((x) => x.officialName === name);
  if (!l) throw new Error(`no layout ${name}`);
  return l;
};

describe('track catalogue integrity', () => {
  const all = listTrackLayouts();

  it('has the 122 official layouts with unique ids and display names', () => {
    expect(all).toHaveLength(122);
    expect(new Set(all.map((l) => l.id)).size).toBe(122);
    expect(new Set(all.map((l) => l.displayName)).size).toBe(122);
    for (const l of all) expect(l.id).toMatch(/^[0-9a-f]{6}$/);
  });

  it('has sane numbers on every layout', () => {
    for (const l of all) {
      expect(l.lengthM, l.displayName).toBeGreaterThan(500);
      expect(l.lengthM, l.displayName).toBeLessThan(40_000);
      expect(l.turns, l.displayName).toBeGreaterThan(0);
      expect(Number.isFinite(l.elevationM), l.displayName).toBe(true);
      expect(l.countryName.length).toBeGreaterThan(1);
    }
  });

  it('keeps gt7info course ids unique and flags the dummy ones', () => {
    const ids = all.filter((l) => l.courseId !== null).map((l) => l.courseId);
    expect(new Set(ids).size).toBe(ids.length);
    const dummy = all.filter((l) => l.courseIdDummy).map((l) => l.venue);
    expect(new Set(dummy)).toEqual(
      new Set(['Eiger Nordwand', 'Yas Marina Circuit', 'Circuit Gilles-Villeneuve']),
    );
    // dummy ids do not identify anything
    expect(findTrackLayoutByCourseId(2003)).toBeUndefined();
    expect(findTrackLayoutByCourseId(1024)?.officialName).toBe('Trial Mountain Circuit');
    expect(findTrackLayoutByCourseId(1034)?.reverse).toBe(true);
  });

  it('reverse layouts share length, corners and venue with their forward layout', () => {
    const reverses = all.filter((l) => l.reverse);
    expect(reverses.length).toBe(36);
    for (const r of reverses) {
      const f = getTrackLayout(r.reverseOf);
      expect(f, r.displayName).toBeDefined();
      expect(f!.reverse).toBe(false);
      expect(r.lengthM).toBe(f!.lengthM);
      expect(r.venue).toBe(f!.venue);
      expect(r.layoutLabel).toMatch(/Reverse/);
    }
  });

  it('includes Sportsland SUGO (game 1.72), absent from gt7info, with cited values', () => {
    const sugo = find('SUGO International Racing Course');
    expect(sugo.lengthM).toBe(3586);
    expect(sugo.turns).toBe(13);
    expect(sugo.courseId).toBe(1340);
    expect(sugo.country).toBe('jp');
    expect(sugo.fictional).toBe(false);
  });

  it('knows fictional vs real, ovals and the headline figures', () => {
    const trial = find('Trial Mountain Circuit');
    expect(trial).toMatchObject({
      courseId: 1024,
      lengthM: 5434,
      turns: 15,
      elevationM: 58,
      longestStraightM: 1340,
      fictional: true,
      oval: false,
      countryName: 'Estados Unidos',
    });
    expect(find('Suzuka Circuit')).toMatchObject({ fictional: false, turns: 20, country: 'jp' });
    expect(find('Daytona Tri-Oval').oval).toBe(true);
  });

  it('records its sources and licences', () => {
    expect(TRACKS_SOURCES.map((s) => s.license).sort()).toEqual(['CC0-1.0', 'MIT', 'MIT-0']);
    for (const s of TRACKS_SOURCES) {
      expect(s.ref).toMatch(/^[0-9a-f]{40}$/);
      expect(s.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('labels layouts without repeating "Full Course" for single-layout venues', () => {
    expect(find('Suzuka Circuit').displayName).toBe('Suzuka Circuit – Full Course');
    expect(find('Trial Mountain Circuit').displayName).toBe('Trial Mountain Circuit');
    expect(find('Trial Mountain Circuit (Reverse)').displayName).toBe(
      'Trial Mountain Circuit – Reverse',
    );
    expect(find('Autodromo Nazionale Monza No Chicane').displayName).toBe(
      'Autodromo Nazionale Monza – No Chicane',
    );
    expect(find('Autodromo Nazionale Monza').displayName).toBe(
      'Autodromo Nazionale Monza – Full Course',
    );
  });
});

describe('length window (asymmetric)', () => {
  it('accepts −4 % … +1.5 % of the official length and nothing outside', () => {
    expect(LENGTH_WINDOW).toEqual({ minRel: -0.04, maxRel: 0.015 });
    expect(lengthCompatible(5434 * 0.96, 5434)).toBe(true);
    expect(lengthCompatible(5434 * 0.959, 5434)).toBe(false);
    expect(lengthCompatible(5434 * 1.015, 5434)).toBe(true);
    expect(lengthCompatible(5434 * 1.016, 5434)).toBe(false);
    expect(lengthCompatible(0, 5434)).toBe(false);
    expect(lengthCompatible(Number.NaN, 5434)).toBe(false);
  });

  it('the app’s Trial Mountain lap (−1.3 %) and the p10 of the survey (−2.8 %) fit', () => {
    expect(lengthCompatible(5361, 5434)).toBe(true);
    expect(lengthCompatible(5434 * (1 - 0.028), 5434)).toBe(true);
  });

  it('suggests a lap 1 % short first, the reverse layout right after the forward one', () => {
    const short = suggestLayoutsByLength(5434 * 0.99, { max: 10 });
    expect(short.slice(0, 2).map((s) => s.layout.displayName)).toEqual([
      'Trial Mountain Circuit',
      'Trial Mountain Circuit – Reverse',
    ]);
    for (const s of short) {
      expect(s.errorRel).toBeGreaterThanOrEqual(LENGTH_WINDOW.minRel);
      expect(s.errorRel).toBeLessThanOrEqual(LENGTH_WINDOW.maxRel);
    }
  });

  it('orders by distance to the typical −0.95 %, not to 0', () => {
    // 5800 m is −0.12 % of Suzuka (5807) and +0.12 % of Monza (5793): both fit, Suzuka is closer to −0.95 %
    const names = suggestLayoutsByLength(5800, { max: 20 }).map((s) => s.layout.officialName);
    expect(names).toEqual(expect.arrayContaining(['Suzuka Circuit', 'Autodromo Nazionale Monza']));
    expect(names.indexOf('Suzuka Circuit')).toBeLessThan(
      names.indexOf('Autodromo Nazionale Monza'),
    );
    // a 4309 m layout (Interlagos) measured 1.6 % long no longer fits, measured 1.4 % long does
    expect(
      suggestLayoutsByLength(4309 * 1.016, { max: 500 }).some((s) =>
        s.layout.venue.includes('Interlagos'),
      ),
    ).toBe(false);
    expect(
      suggestLayoutsByLength(4309 * 1.014, { max: 500 }).some((s) =>
        s.layout.venue.includes('Interlagos'),
      ),
    ).toBe(true);
    // ... and one measured 3.5 % short (the old ±1.5 % rejected it) now does
    expect(
      suggestLayoutsByLength(4309 * 0.965, { max: 500 }).some((s) =>
        s.layout.venue.includes('Interlagos'),
      ),
    ).toBe(true);
  });

  it('covers 74 of the 81 measured layouts (the old ±1.5 % covered 56)', () => {
    // (measured − official) / official of the 81 layouts with a published driving line
    // (gt7-datalogger-track-data signatures.json vs index.json, 2026-11-09)
    const measured: number[] = [
      -0.0058, -0.0054, -0.017, -0.0144, 0.1559, -0.0167, -0.0632, -0.0158, -0.0146, -0.0291,
      -0.0064, -0.0057, -0.0145, -0.0209, 0.0156, 0.0112, -0.0078, 0.0014, -0.0142, -0.0129, -0.011,
      -0.0161, -0.0345, -0.0628, 0, -0.008, -0.0099, -0.006, -0.0094, -0.0194, -0.0047, -0.0092,
      -0.0146, -0.0133, -0.0111, -0.0316, -0.0281, -0.014, 0.0003, -0.0155, -0.014, -0.0002,
      -0.0189, -0.014, -0.013, -0.0081, -0.0085, -0.0052, -0.0095, -0.0077, 0.0833, -0.0156, 0.0069,
      -0.0153, -0.0063, -0.0074, 0, -0.0073, -0.0053, -0.0098, -0.009, -0.0221, -0.1254, 0.0037,
      -0.0112, 0, -0.0027, -0.0023, -0.0047, -0.0031, -0.005, -0.0095, -0.0188, 0.0122, -0.0022,
      -0.0117, -0.0117, -0.0086, -0.0203, -0.068, -0.0343,
    ];
    expect(measured).toHaveLength(81);
    const inside = (min: number, max: number) =>
      measured.filter((e) => e >= min - 1e-9 && e <= max + 1e-9).length;
    expect(inside(-0.015, 0.015)).toBe(56);
    expect(inside(LENGTH_WINDOW.minRel, LENGTH_WINDOW.maxRel)).toBe(74);
    const sorted = [...measured].sort((a, b) => a - b);
    expect(sorted[40]).toBeCloseTo(-0.0095, 3); // median
  });

  it('rejects garbage', () => {
    expect(suggestLayoutsByLength(0)).toEqual([]);
    expect(suggestLayoutsByLength(Number.NaN)).toEqual([]);
    expect(suggestLayoutsByLength(-5)).toEqual([]);
    expect(suggestLayoutsByLength(100)).toEqual([]);
  });

  it('flags the layouts length alone cannot separate', () => {
    const names = (n: string) => lookAlikes(find(n)).map((l) => l.officialName);
    expect(names('Tokyo Expressway - Central Clockwise')).toContain(
      'Tokyo Expressway - Central Counterclockwise',
    );
    expect(names('Autodromo Nazionale Monza')).toContain('Autodromo Nazionale Monza No Chicane');
    expect(names('Nürburgring Nordschleife')).toContain('Nürburgring Nordschleife Tourist');
    expect(names('Trial Mountain Circuit')).toContain('Trial Mountain Circuit (Reverse)');
    expect(names('Tsukuba Circuit')).toEqual([]);
  });
});

describe('name search and lookup', () => {
  it('autocomplete matches every word without accents', () => {
    expect(searchTrackLayouts('nurb nord')[0]?.venue).toBe('Nürburgring');
    expect(searchTrackLayouts('zzzz')).toEqual([]);
    expect(searchTrackLayouts('')).toHaveLength(8);
    expect(searchTrackLayouts('sugo')[0]?.officialName).toBe('SUGO International Racing Course');
    expect(searchTrackLayouts('monza')).toHaveLength(2);
  });

  it('prefers the layout closest in length among equals', () => {
    expect(searchTrackLayouts('suzuka', 2250)[0]?.layout).toBe('East Course');
  });

  it('finds a stored track by name + layout, old names included', () => {
    expect(findTrackLayout('Trial Mountain Circuit')?.id).toBe(find('Trial Mountain Circuit').id);
    expect(findTrackLayout('Trial Mountain Circuit', 'Reverse')?.reverse).toBe(true);
    expect(findTrackLayout('Autodromo Nazionale Monza', 'No Chicane')?.turns).toBe(9);
    // a name saved by the previous list ("Completo"): resolved by the length inside the venue
    expect(findTrackLayout('Autodromo Nazionale Monza', 'Completo', 5740)?.officialName).toBe(
      'Autodromo Nazionale Monza',
    );
    expect(findTrackLayout('Meu autódromo')).toBeUndefined();
    expect(findTrackLayout('Nürburgring', 'Qualquer')).toBeUndefined();
  });

  it('links to the official list and to the DG EDGE page of the venue (links only)', () => {
    const links = trackLinks(find('Trial Mountain Circuit'));
    expect(links[0]!.url).toBe('https://www.gran-turismo.com/gb/gt7/tracklist/');
    expect(links[1]!.url).toBe(
      'https://www.dg-edge.com/database/tracks/trial-mountain-circuit/313',
    );
    for (const l of listTrackLayouts()) {
      for (const k of trackLinks(l)) expect(k.url).toMatch(/^https:\/\//);
    }
  });
});
