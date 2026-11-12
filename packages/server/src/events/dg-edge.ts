/**
 * Reads the Daily Races pages of DG EDGE (https://www.dg-edge.com/events/dailies).
 *
 * The site renders its pages on the server (Nuxt) and ships the page data in a
 * `<script id="__NUXT_DATA__">` block. This module decodes that block and keeps ONLY an allow-list of
 * fields that the page itself shows to every visitor: the rules of the race, the aggregate numbers
 * (players, medal cut-off times, top 100 / top 1000), the most used cars and the first place of the
 * ranking (the only ranking row the page itself carries). It never reads the rest of the ranking
 * (that is a separate service of the site), and ignores everything else in the payload.
 *
 * Pure functions (no network): the fetching, caching and politeness live in `daily-service.ts`.
 */

import {
  type DailyCarUsage,
  type DailyLeader,
  type DailyMedal,
  type DailyPastRace,
  type DailyRace,
  type DailyRaceType,
  type DailyWeek,
  listTrackLayouts,
  normalizeTrackText,
  type TrackLayout,
} from '@gt7/shared';

export const DG_EDGE_ORIGIN = 'https://www.dg-edge.com';
export const DG_EDGE_DAILIES_PATH = '/events/dailies';

export class DailyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyParseError';
  }
}

// ---------------------------------------------------------------------------------------------
// Nuxt payload ("devalue": a flat array whose objects and arrays point to other positions)
// ---------------------------------------------------------------------------------------------

type Json = unknown;

const WRAPPERS = new Set([
  'Reactive',
  'ShallowReactive',
  'Ref',
  'ShallowRef',
  'EmptyRef',
  'EmptyShallowRef',
]);

/** Decodes the `__NUXT_DATA__` block of a page into plain objects. */
export function decodeNuxtPayload(html: string): Json {
  const m = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m?.[1]) throw new DailyParseError('A página não traz os dados esperados.');
  let raw: Json[];
  try {
    raw = JSON.parse(m[1]) as Json[];
  } catch {
    throw new DailyParseError('Os dados da página não puderam ser lidos.');
  }
  if (!Array.isArray(raw)) throw new DailyParseError('Formato de dados inesperado.');
  const memo = new Map<number, Json>();
  const revive = (i: number): Json => {
    if (i === -1) return undefined;
    if (i === -2) return null;
    if (memo.has(i)) return memo.get(i);
    const v = raw[i];
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') {
        if (WRAPPERS.has(v[0])) {
          const r = revive(v[1] as number);
          memo.set(i, r);
          return r;
        }
        if (v[0] === 'Date') return v[1];
      }
      const out: Json[] = [];
      memo.set(i, out);
      for (const x of v) out.push(revive(x as number));
      return out;
    }
    const out: Record<string, Json> = {};
    memo.set(i, out);
    for (const [k, x] of Object.entries(v as Record<string, number>)) out[k] = revive(x);
    return out;
  };
  return revive(0);
}

type Rec = Record<string, Json>;

const isRec = (v: Json): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: Json): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: Json): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The payload of the page entry whose key starts with `prefix` ("events/", "event/"). */
function pagePayload(root: Json, prefix: string): Rec {
  if (!isRec(root) || !isRec(root.data)) throw new DailyParseError('Formato de dados inesperado.');
  const key = Object.keys(root.data).find((k) => k.startsWith(prefix));
  const entry = key ? root.data[key] : undefined;
  const payload = isRec(entry) && isRec(entry.payload) ? entry.payload : entry;
  if (!isRec(payload)) throw new DailyParseError('A página não traz as corridas esperadas.');
  return payload;
}

// ---------------------------------------------------------------------------------------------
// Small converters
// ---------------------------------------------------------------------------------------------

/** "02:00.222" (or "1:59.685") to milliseconds. */
export function parseLapTime(text: string | null): number | null {
  if (!text) return null;
  const m = /^(\d+):(\d{1,2})\.(\d{1,3})$/.exec(text.trim());
  if (!m) return null;
  return (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number(m[3]!.padEnd(3, '0'));
}

/** "2026-11-09 08:00:00" (UTC on the source) to ISO 8601. */
export function toIsoUtc(text: string | null): string | null {
  if (!text || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(text)) return null;
  const d = new Date(`${text.slice(0, 19).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function slugify(text: string): string {
  return normalizeTrackText(text)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tyreCodes(v: Json): string[] {
  const s = str(v);
  return s
    ? s
        .split(/[,\s]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
    : [];
}

function titleCase(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------------------------
// Track names: the source names a layout by its page slug ("suzuka-circuit-east-course"); the Bono
// catalogue knows the official names, so the slug is matched against them.
// ---------------------------------------------------------------------------------------------

export interface ResolvedTrack {
  name: string;
  layoutId: string | null;
}

let catalogSlugs: { layout: TrackLayout; slugs: string[] }[] | null = null;

function slugIndex() {
  catalogSlugs ??= listTrackLayouts().map((layout) => ({
    layout,
    slugs: [
      slugify(layout.officialName),
      slugify(layout.displayName),
      slugify(`${layout.venue} ${layout.layout}`),
      ...(layout.layoutLabel ? [] : [slugify(layout.venue)]),
    ],
  }));
  return catalogSlugs;
}

/** Matches the track part of an event slug against the catalogue (forward layouts first). */
export function resolveTrack(trackSlug: string): ResolvedTrack {
  const hits = slugIndex().filter((c) => c.slugs.includes(trackSlug));
  const best = hits.sort((a, b) => Number(a.layout.reverse) - Number(b.layout.reverse))[0];
  if (best) return { name: best.layout.displayName, layoutId: best.layout.id };
  return { name: titleCase(trackSlug), layoutId: null };
}

/** The track slug inside "/events/dailies/week-46-2026-race-b-trial-mountain-circuit/695". */
function trackSlugOf(path: string): string | null {
  const m = /\/week-\d+-\d{4}-race-[abc]-(.+)\/\d+$/i.exec(path);
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------------------------
// List page
// ---------------------------------------------------------------------------------------------

export interface ParsedDailyList {
  week: DailyWeek | null;
  races: DailyRace[];
  past: DailyPastRace[];
}

const RACE_TYPES = new Set(['A', 'B', 'C']);

/** Paths of the race pages in the HTML, by id: `/events/dailies/<slug>/<id>`. */
function raceLinks(html: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const m of html.matchAll(/href="(\/events\/dailies\/week-[^"#?]+\/(\d+))"/g)) {
    map.set(Number(m[2]), m[1]!);
  }
  return map;
}

function carOf(e: Rec, cars: Map<number, string>): { label: string; cls: string | null } {
  const carId = num(e.carId);
  const cls = str(e.carType);
  if (carId !== null && cars.has(carId)) return { label: cars.get(carId)!, cls: null };
  if (cls) return { label: cls.replace(/^GR\./i, 'Gr.'), cls: cls.replace(/^GR\./i, 'Gr.') };
  return { label: '—', cls: null };
}

/** Reads the first page of the Daily Races list: the current week and the previous ones. */
export function parseDailyList(html: string, now = Date.now()): ParsedDailyList {
  const payload = pagePayload(decodeNuxtPayload(html), 'events/');
  const list = Array.isArray(payload.list) ? payload.list : [];
  const cars = new Map<number, string>();
  if (Array.isArray(payload.cars)) {
    for (const c of payload.cars) {
      if (isRec(c) && num(c.id) !== null && str(c.fullName))
        cars.set(c.id as number, c.fullName as string);
    }
  }
  const links = raceLinks(html);
  const races: DailyRace[] = [];
  const past: DailyPastRace[] = [];
  let week: DailyWeek | null = null;
  let currentKey: string | null = null;

  for (const item of list) {
    if (!isRec(item)) continue;
    const type = str(item.dailyType);
    const id = num(item.id);
    const w = num(item.week);
    const y = num(item.year);
    const from = toIsoUtc(str(item.from));
    const to = toIsoUtc(str(item.to));
    if (!type || !RACE_TYPES.has(type) || id === null || w === null || y === null || !from || !to)
      continue;
    const path = links.get(id);
    const slug = path ? trackSlugOf(path) : null;
    const track = slug ? resolveTrack(slug) : { name: '—', layoutId: null };
    const car = carOf(item, cars);
    const url = path ? `${DG_EDGE_ORIGIN}${path}` : `${DG_EDGE_ORIGIN}${DG_EDGE_DAILIES_PATH}`;
    const isCurrent = Date.parse(from) <= now && now <= Date.parse(to);

    if (isCurrent) {
      currentKey ??= `${y}-${w}`;
      if (currentKey !== `${y}-${w}`) continue;
      week ??= { week: w, year: y, from, to };
      races.push({
        id,
        type: type as DailyRaceType,
        week: w,
        year: y,
        from,
        to,
        trackName: track.name,
        trackLayoutId: track.layoutId,
        carLabel: car.label,
        carClass: car.cls,
        laps: num(item.laps) ?? 0,
        tyres: tyreCodes(item.tyres),
        timeOfDay: str(item.timeOfDay),
        fuelRate: num(item.fuel),
        tyreWear: num(item.wear),
        bop: null,
        damage: null,
        startType: null,
        tuningAllowed: num(item.settings) === null ? null : num(item.settings) === 1,
        slipstream: null,
        everyMinutes: null,
        offsetMinutes: null,
        players: num(item.playersCount),
        top100Ms: num(item.top100Time),
        top1000Ms: num(item.top1000Time),
        medals: null,
        mostUsedCars: [],
        leader: null,
        url,
      });
    } else if (Date.parse(to) < now) {
      past.push({
        id,
        type: type as DailyRaceType,
        week: w,
        year: y,
        trackName: track.name,
        trackLayoutId: track.layoutId,
        carLabel: car.label,
        laps: num(item.laps) ?? 0,
        players: num(item.playersCount),
        url,
      });
    }
  }
  races.sort((a, b) => a.type.localeCompare(b.type));
  if (races.length === 0 && past.length === 0) {
    throw new DailyParseError('Não encontrei corridas na página.');
  }
  return { week, races, past };
}

// ---------------------------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------------------------

export interface ParsedDailyDetail {
  bop: boolean | null;
  damage: string | null;
  startType: 'rolling' | 'grid' | null;
  slipstream: string | null;
  everyMinutes: number | null;
  offsetMinutes: number | null;
  players: number | null;
  top100Ms: number | null;
  top1000Ms: number | null;
  medals: DailyRace['medals'];
  mostUsedCars: DailyCarUsage[];
  leader: DailyLeader | null;
}

function medal(timeText: Json, perc: Json): DailyMedal | null {
  const timeMs = parseLapTime(str(timeText));
  const percentPlayers = num(perc);
  return timeMs === null || percentPlayers === null ? null : { timeMs, percentPlayers };
}

const DAMAGE: Record<string, string> = {
  none: 'none',
  light: 'light',
  middle: 'medium',
  heavy: 'heavy',
};

/** Reads one race page for the numbers the list does not carry. */
export function parseDailyDetail(html: string): ParsedDailyDetail {
  const p = pagePayload(decodeNuxtPayload(html), 'event/');
  const e = isRec(p.event) ? p.event : {};
  const s = isRec(p.stats) ? p.stats : {};
  const platinum = medal(s.top005percentTime, s.top005percentPerc);
  const gold = medal(s.top03percentTime, s.top03percentPerc);
  const silver = medal(s.top05percentTime, s.top05percentPerc);
  const bronze = medal(s.top10percentTime, s.top10percentPerc);
  const start = str(e.startType);
  const damage = str(e.damage);
  const mostUsedCars: DailyCarUsage[] = [];
  if (Array.isArray(p.cars)) {
    for (const c of p.cars.slice(0, 5)) {
      if (!isRec(c) || !str(c.name) || num(c.usagePerc) === null) continue;
      const brand = str(c.brand);
      mostUsedCars.push({
        name: brand && !String(c.name).startsWith(brand) ? `${brand} ${c.name}` : String(c.name),
        percent: num(c.usagePerc)!,
      });
    }
  }
  const l = isRec(p.leader) ? p.leader : null;
  const leaderTime = l ? parseLapTime(str(l.time)) : null;
  const leaderCar = isRec(p.leaderCar) ? str(p.leaderCar.name) : null;
  const leader: DailyLeader | null =
    l && str(l.name) && leaderTime !== null
      ? { name: str(l.name)!, country: str(l.countryCode), timeMs: leaderTime, car: leaderCar }
      : null;
  return {
    bop: num(e.bop) === null ? null : num(e.bop) === 1,
    damage: damage ? (DAMAGE[damage.toLowerCase()] ?? damage.toLowerCase()) : null,
    startType: start ? (/roll/i.test(start) ? 'rolling' : 'grid') : null,
    slipstream: str(e.slipstream)?.toLowerCase() ?? null,
    everyMinutes: num(e.raceEvery),
    // The source leaves the offset out when races start on the hour.
    offsetMinutes: num(e.raceOffset) ?? (num(e.raceEvery) === null ? null : 0),
    players: num(s.total) ?? num(e.playersCount),
    top100Ms: parseLapTime(str(s.top100time)) ?? num(e.top100Time),
    top1000Ms: parseLapTime(str(s.top1000time)) ?? num(e.top1000Time),
    medals: platinum && gold && silver && bronze ? { platinum, gold, silver, bronze } : null,
    mostUsedCars,
    leader,
  };
}

/** Merges the detail numbers into a race of the list. */
export function withDetail(race: DailyRace, d: ParsedDailyDetail): DailyRace {
  return {
    ...race,
    bop: d.bop,
    damage: d.damage,
    startType: d.startType,
    slipstream: d.slipstream,
    everyMinutes: d.everyMinutes,
    offsetMinutes: d.offsetMinutes,
    players: d.players ?? race.players,
    top100Ms: d.top100Ms ?? race.top100Ms,
    top1000Ms: d.top1000Ms ?? race.top1000Ms,
    medals: d.medals,
    mostUsedCars: d.mostUsedCars,
    leader: d.leader,
  };
}

// ---------------------------------------------------------------------------------------------
// robots.txt (the paths we use must be allowed for every robot)
// ---------------------------------------------------------------------------------------------

/** Whether `path` may be fetched according to the `*` group of a robots.txt body. */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  let inStar = false;
  const disallows: string[] = [];
  const allows: string[] = [];
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      inStar = value === '*';
      continue;
    }
    if (!inStar) continue;
    if (field === 'disallow' && value) disallows.push(value);
    if (field === 'allow' && value) allows.push(value);
  }
  const longest = (rules: string[]) =>
    rules.filter((r) => path.startsWith(r)).sort((a, b) => b.length - a.length)[0]?.length ?? -1;
  return longest(allows) >= longest(disallows);
}
