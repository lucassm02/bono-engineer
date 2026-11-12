import { describe, expect, it } from 'vitest';
import { DailyRacesService, MANUAL_REFRESH_GAP_MS, REFRESH_INTERVAL_MS } from './daily-service.ts';
import {
  decodeNuxtPayload,
  parseDailyDetail,
  parseDailyList,
  parseLapTime,
  resolveTrack,
  robotsAllows,
  toIsoUtc,
  withDetail,
} from './dg-edge.ts';

/** Encodes plain data the way Nuxt does ("devalue"): a flat array whose entries point to each other. */
function nuxtHtml(data: unknown, links = ''): string {
  const raw: unknown[] = [null];
  const put = (v: unknown): number => {
    const i = raw.length;
    raw.push(null);
    if (Array.isArray(v)) raw[i] = v.map(put);
    else if (v && typeof v === 'object') {
      const o: Record<string, number> = {};
      for (const [k, x] of Object.entries(v)) o[k] = put(x);
      raw[i] = o;
    } else raw[i] = v;
    return i;
  };
  raw[0] = ['Reactive', put(data)];
  return `<html><body>${links}<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(raw)}</script></body></html>`;
}

const NOW = Date.parse('2026-11-12T12:00:00Z');
const FROM = '2026-11-09 08:00:00';
const TO = '2026-11-16 07:59:59';

const item = (id: number, type: string, extra: Record<string, unknown>) => ({
  id,
  dailyType: type,
  week: 46,
  year: 2026,
  from: FROM,
  to: TO,
  laps: 6,
  tyres: 'RM, RS',
  timeOfDay: '17:40',
  fuel: 1,
  wear: 2,
  settings: 1,
  playersCount: 1000 + id,
  top100Time: 120222,
  top1000Time: 121159,
  carId: null,
  carType: null,
  internalNoise: 'never read',
  lastFetchError: 'ignored',
  ...extra,
});

const LIST_LINKS = `
  <a href="/events/dailies/week-46-2026-race-a-suzuka-circuit-east-course/101">A</a>
  <a href="/events/dailies/week-46-2026-race-b-trial-mountain-circuit/102">B</a>
  <a href="/events/dailies/week-46-2026-race-c-some-new-track-2030/103">C</a>
  <a href="/events/dailies/week-45-2026-race-a-dragon-trail-gardens/090">old</a>`;

const LIST_HTML = nuxtHtml(
  {
    data: {
      'events/xyz': {
        payload: {
          cars: [{ id: 604, fullName: "Honda Integra Type R (DC2) '95" }],
          tracks: [{ id: 297, name: 'Suzuka Circuit' }],
          list: [
            item(103, 'C', { carType: 'GR.3', tyres: 'RM, RS' }),
            item(101, 'A', { carId: 604, tyres: 'CS', settings: 0, laps: 7 }),
            item(102, 'B', { carType: 'GR.4' }),
            {
              ...item(90, 'A', { carId: 604 }),
              week: 45,
              from: '2026-11-02 08:00:00',
              to: '2026-11-09 07:59:59',
            },
          ],
        },
      },
    },
  },
  LIST_LINKS,
);

const DETAIL_HTML = nuxtHtml({
  data: {
    'event/102/xyz': {
      payload: {
        event: {
          bop: 1,
          damage: 'Middle',
          startType: 'StartFormationRolling',
          slipstream: 'Custom',
          raceEvery: 20,
          raceOffset: 10,
        },
        stats: {
          total: 34250,
          top100time: '02:00.222',
          top1000time: '02:01.159',
          top005percentTime: '01:59.685',
          top005percentPerc: 0.04,
          top03percentTime: '02:02.662',
          top03percentPerc: 15.86,
          top05percentTime: '02:05.044',
          top05percentPerc: 34.41,
          top10percentTime: '02:10.998',
          top10percentPerc: 41.97,
        },
        cars: [
          { name: "TT Cup '16", brand: 'Audi', usagePerc: 29.37 },
          { name: 'Huracán Gr.4', brand: 'Lamborghini', usagePerc: 25.6 },
        ],
        leader: { name: 'Piloto Teste', countryCode: 'JP', time: '01:59.089', secret: 'x' },
        leaderCar: { name: 'Lamborghini Huracán Gr.4' },
        csrfToken: 'never read',
        thread: { author: { name: 'Fulano' } },
      },
    },
  },
});

describe('Nuxt payload', () => {
  it('decodes the flat array into plain objects', () => {
    const root = decodeNuxtPayload(nuxtHtml({ a: { b: [1, 'x', null] } })) as {
      a: { b: unknown[] };
    };
    expect(root.a.b).toEqual([1, 'x', null]);
  });

  it('fails with a readable error when the block is missing or broken', () => {
    expect(() => decodeNuxtPayload('<html></html>')).toThrow(/dados esperados/);
    expect(() => decodeNuxtPayload('<script id="__NUXT_DATA__">{oops</script>')).toThrow(
      /não puderam ser lidos/,
    );
  });
});

describe('converters', () => {
  it('reads lap times and UTC dates', () => {
    expect(parseLapTime('02:00.222')).toBe(120222);
    expect(parseLapTime('1:59.685')).toBe(119685);
    expect(parseLapTime('x')).toBeNull();
    expect(toIsoUtc('2026-11-09 08:00:00')).toBe('2026-11-09T08:00:00.000Z');
    expect(toIsoUtc('nope')).toBeNull();
  });

  it('matches the source slug to the Bono catalogue, or makes the slug readable', () => {
    const known = resolveTrack('trial-mountain-circuit');
    expect(known.layoutId).not.toBeNull();
    expect(known.name).toMatch(/Trial Mountain/);
    expect(resolveTrack('suzuka-circuit-east-course').name).toMatch(/Suzuka/);
    expect(resolveTrack('some-new-track-2030')).toEqual({
      name: 'Some New Track 2030',
      layoutId: null,
    });
  });
});

describe('parseDailyList', () => {
  const parsed = parseDailyList(LIST_HTML, NOW);

  it('finds the current week and sorts the three races', () => {
    expect(parsed.week).toMatchObject({ week: 46, year: 2026 });
    expect(parsed.races.map((r) => r.type)).toEqual(['A', 'B', 'C']);
  });

  it('keeps the rules and the aggregate numbers, with links to the source', () => {
    const [a, b, c] = parsed.races;
    expect(a).toMatchObject({
      carLabel: "Honda Integra Type R (DC2) '95",
      carClass: null,
      laps: 7,
      tyres: ['CS'],
      tuningAllowed: false,
      players: 1101,
      top100Ms: 120222,
      top1000Ms: 121159,
    });
    expect(a!.url).toBe(
      'https://www.dg-edge.com/events/dailies/week-46-2026-race-a-suzuka-circuit-east-course/101',
    );
    expect(b).toMatchObject({ carLabel: 'Gr.4', carClass: 'Gr.4', tuningAllowed: true });
    expect(b!.trackLayoutId).not.toBeNull();
    expect(c!.trackName).toBe('Some New Track 2030');
    expect(c!.tyres).toEqual(['RM', 'RS']);
  });

  it('keeps past weeks light and never carries internal fields', () => {
    expect(parsed.past).toHaveLength(1);
    expect(parsed.past[0]).toMatchObject({ week: 45, type: 'A' });
    expect(JSON.stringify(parsed)).not.toMatch(/never read|ignored/);
  });

  it('refuses a page without races', () => {
    expect(() =>
      parseDailyList(nuxtHtml({ data: { 'events/x': { payload: { list: [] } } } })),
    ).toThrow(/corridas/);
  });
});

describe('parseDailyDetail', () => {
  const d = parseDailyDetail(DETAIL_HTML);

  it('reads settings, medals, most used cars and the first place only', () => {
    expect(d).toMatchObject({
      bop: true,
      damage: 'medium',
      startType: 'rolling',
      slipstream: 'custom',
      everyMinutes: 20,
      offsetMinutes: 10,
      players: 34250,
      top100Ms: 120222,
    });
    expect(d.medals?.gold).toEqual({ timeMs: 122662, percentPlayers: 15.86 });
    expect(d.mostUsedCars[0]).toEqual({ name: "Audi TT Cup '16", percent: 29.37 });
    expect(d.leader).toEqual({
      name: 'Piloto Teste',
      country: 'JP',
      timeMs: 119089,
      car: 'Lamborghini Huracán Gr.4',
    });
  });

  it('does not keep anything outside the allow-list', () => {
    const text = JSON.stringify(d);
    expect(text).not.toMatch(/never read|Fulano|secret/);
  });

  it('merges into a race of the list', () => {
    const race = parseDailyList(LIST_HTML, NOW).races[1]!;
    const merged = withDetail(race, d);
    expect(merged.medals?.platinum.timeMs).toBe(119685);
    expect(merged.leader?.name).toBe('Piloto Teste');
  });
});

describe('robotsAllows', () => {
  const robots = 'User-agent: *\nDisallow: /search/\nDisallow: /players?\n\nSitemap: x';
  it('follows the * group', () => {
    expect(robotsAllows(robots, '/events/dailies')).toBe(true);
    expect(robotsAllows(robots, '/search/abc')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /', '/events/dailies')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /\nAllow: /events/', '/events/dailies')).toBe(
      true,
    );
    expect(robotsAllows('User-agent: other\nDisallow: /', '/events/dailies')).toBe(true);
  });
});

describe('DailyRacesService', () => {
  function setup(opts: { robots?: string; failList?: boolean; redirect?: boolean } = {}) {
    const calls: { url: string; ua: string }[] = [];
    let now = NOW;
    let enabled = true;
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const ua = String(headers['user-agent']);
      calls.push({ url, ua });
      if (url.endsWith('/robots.txt'))
        return new Response(opts.robots ?? 'User-agent: *\nDisallow: /search/');
      if (opts.failList && url.endsWith('/events/dailies'))
        return new Response('boom', { status: 500 });
      const body = url.endsWith('/events/dailies') ? LIST_HTML : DETAIL_HTML;
      const res = new Response(body);
      if (opts.redirect) Object.defineProperty(res, 'url', { value: 'https://evil.example/x' });
      return res;
    }) as unknown as typeof fetch;
    const service = new DailyRacesService({
      dataDir: null,
      appVersion: '9.9.9',
      enabled: {
        get: () => enabled,
        set: (v) => {
          enabled = v;
        },
      },
      fetchFn,
      now: () => now,
      sleep: async () => {},
      origin: 'https://www.dg-edge.com',
    });
    return {
      service,
      calls,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('fetches once, identifies itself, and serves the cache afterwards', async () => {
    const { service, calls } = setup();
    const first = await service.get();
    expect(first.races).toHaveLength(3);
    expect(first.races[1]!.medals).not.toBeNull();
    expect(first.error).toBeNull();
    expect(first.stale).toBe(false);
    // robots + list + 3 race pages
    expect(calls).toHaveLength(5);
    expect(
      calls.every(
        (c) => c.ua === 'BonoEngineer/9.9.9 (+https://github.com/lucassm02/bono-engineer)',
      ),
    ).toBe(true);
    await service.get();
    expect(calls).toHaveLength(5);
  });

  it('refreshes in the background only after the interval', async () => {
    const { service, calls, advance } = setup();
    await service.get();
    advance(REFRESH_INTERVAL_MS + 1000);
    expect(service.snapshot().stale).toBe(true);
    await service.get();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBeGreaterThan(5);
  });

  it('records a failure, keeps the old data and backs off', async () => {
    const ok = setup();
    await ok.service.get();
    const bad = setup({ failList: true });
    const res = await bad.service.get();
    expect(res.error).toMatch(/respondeu 500/);
    expect(res.races).toHaveLength(0);
    const before = bad.calls.length;
    await bad.service.get();
    expect(bad.calls.length).toBe(before); // no hammering after a failure
  });

  it('limits manual refreshes', async () => {
    const { service, advance } = setup();
    await service.get();
    expect((await service.refresh()).reason).toBe('tooSoon');
    advance(MANUAL_REFRESH_GAP_MS + 1);
    expect((await service.refresh()).ok).toBe(true);
  });

  it('does nothing while turned off', async () => {
    const { service, calls } = setup();
    service.setEnabled(false);
    const res = await service.get();
    expect(res.enabled).toBe(false);
    expect(calls).toHaveLength(0);
    expect((await service.refresh()).reason).toBe('disabled');
  });

  it('stops when robots.txt forbids the page', async () => {
    const { service, calls } = setup({ robots: 'User-agent: *\nDisallow: /events/' });
    const res = await service.get();
    expect(res.error).toMatch(/robots/);
    expect(calls).toHaveLength(1); // only robots.txt
  });

  it('refuses a redirect to another site', async () => {
    const { service } = setup({ redirect: true });
    const res = await service.get();
    expect(res.error).toMatch(/redirecionou|origem/);
    expect(res.races).toHaveLength(0);
  });
});
