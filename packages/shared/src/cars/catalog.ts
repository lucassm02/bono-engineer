/**
 * Gran Turismo 7 car catalogue: the telemetry packet only carries the internal car id
 * (`carCode`); this module turns it into a name, a maker and a group, and offers the pure
 * helpers the UI/MCP need (search without accents, grouping by maker with lap counts).
 *
 * Data: ./data.ts (generated from the community database ddm999/gt7info, MIT-0). Unknown ids
 * (new DLC cars) keep working everywhere: `carLabel` falls back to "Carro #1234".
 */

import { CARS_DATA, MAKERS_DATA } from './data.ts';

/** In-game group of a car as listed by the source: Gr.1–4, Gr.B, N (road) or X (specials). */
export type CarGroup = '1' | '2' | '3' | '4' | 'B' | 'N' | 'X';

export interface CarMaker {
  id: number;
  /** Display name (as in the game; "Citroen" is shown with its diaeresis). */
  name: string;
  /** URL/file-safe slug, unique. */
  slug: string;
  /** Country code of the source ("jp", "us"…; "pdi" = Polyphony/others). */
  country: string;
  /** Country name in pt-BR. */
  countryName: string;
  /** Number of cars in the catalogue. */
  carCount: number;
}

export interface CarEntry {
  /** Game car id = telemetry `carCode`. */
  id: number;
  /** Official name as in the game, year suffix included ("A110 '17"). */
  name: string;
  /** Name without the trailing year suffix ("A110"). */
  baseName: string;
  makerId: number;
  group: CarGroup | null;
  year: number | null;
}

/** What the server/MCP report about a car. */
export interface CarDescription {
  carCode: number;
  /** Catalogue name (null when the car is not in the catalogue). */
  carName: string | null;
  makerId: number | null;
  makerName: string | null;
}

const GROUPS: ReadonlySet<string> = new Set(['1', '2', '3', '4', 'B', 'N', 'X']);

const COUNTRY_NAMES_PT: Record<string, string> = {
  pdi: 'Outros',
  jp: 'Japão',
  us: 'Estados Unidos',
  gb: 'Reino Unido',
  de: 'Alemanha',
  fr: 'França',
  it: 'Itália',
  au: 'Austrália',
  kr: 'Coreia do Sul',
  be: 'Bélgica',
  se: 'Suécia',
  es: 'Espanha',
  ca: 'Canadá',
  at: 'Áustria',
  ch: 'Suíça',
  br: 'Brasil',
  hr: 'Croácia',
  cz: 'Tchéquia',
  cn: 'China',
  ae: 'Emirados Árabes',
};

/** Display fixes over the source spelling (ASCII-only in the database). */
const MAKER_DISPLAY: Record<string, string> = { Citroen: 'Citroën' };

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

/** Lower-case, accent-free, punctuation-free text for searching. */
export function normalizeSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripYear(name: string): string {
  return name.replace(/ '\d\d$/, '');
}

const carCounts = new Map<number, number>();
for (const c of CARS_DATA) carCounts.set(c[2], (carCounts.get(c[2]) ?? 0) + 1);

const MAKERS: readonly CarMaker[] = MAKERS_DATA.map(([id, name, country, slug]) => ({
  id,
  name: MAKER_DISPLAY[name] ?? name,
  slug,
  country,
  countryName: COUNTRY_NAMES_PT[country] ?? country.toUpperCase(),
  carCount: carCounts.get(id) ?? 0,
}))
  // Makers of the source database without any car (DLC placeholders) are not listed.
  .filter((m) => m.carCount > 0)
  .sort((a, b) => collator.compare(a.name, b.name));

const CARS: readonly CarEntry[] = CARS_DATA.map(([id, name, makerId, group, year]) => ({
  id,
  name,
  baseName: stripYear(name),
  makerId,
  group: group !== null && GROUPS.has(group) ? (group as CarGroup) : null,
  year,
}));

const makerById = new Map(MAKERS.map((m) => [m.id, m]));
const carById = new Map(CARS.map((c) => [c.id, c]));
const carsByMaker = new Map<number, CarEntry[]>();
for (const c of CARS) {
  const list = carsByMaker.get(c.makerId);
  if (list) list.push(c);
  else carsByMaker.set(c.makerId, [c]);
}
for (const list of carsByMaker.values()) {
  list.sort((a, b) => collator.compare(a.baseName, b.baseName) || (a.year ?? 0) - (b.year ?? 0));
}
const searchText = new Map<number, string>(
  CARS.map((c) => [c.id, normalizeSearch(`${makerById.get(c.makerId)?.name ?? ''} ${c.name}`)]),
);
const makerSearchText = new Map(MAKERS.map((m) => [m.id, normalizeSearch(m.name)]));

// ---------------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------------

/** Every maker, A–Z (pt-BR collation). */
export function listMakers(): readonly CarMaker[] {
  return MAKERS;
}

/** Every car of the catalogue, in id order. */
export function listCars(): readonly CarEntry[] {
  return CARS;
}

export function getMaker(id: number): CarMaker | undefined {
  return makerById.get(id);
}

export function getCar(carCode: number | null | undefined): CarEntry | undefined {
  return carCode === null || carCode === undefined ? undefined : carById.get(carCode);
}

/** Cars of a maker, A–Z then by year. */
export function carsOfMaker(makerId: number): readonly CarEntry[] {
  return carsByMaker.get(makerId) ?? [];
}

export function makerOfCar(carCode: number | null | undefined): CarMaker | undefined {
  const car = getCar(carCode);
  return car ? makerById.get(car.makerId) : undefined;
}

/** Official catalogue name or null when unknown. */
export function carName(carCode: number | null | undefined): string | null {
  return getCar(carCode)?.name ?? null;
}

/** Name for display: the catalogue name, or "Carro #1234" for ids not in the catalogue. */
export function carLabel(carCode: number | null | undefined): string {
  if (carCode === null || carCode === undefined) return '—';
  return carName(carCode) ?? `Carro #${carCode}`;
}

/** `carName`/`makerName` for API payloads (keep `carCode` next to it). */
export function describeCar(carCode: number): CarDescription {
  const car = getCar(carCode);
  const maker = car ? makerById.get(car.makerId) : undefined;
  return {
    carCode,
    carName: car?.name ?? null,
    makerId: maker?.id ?? null,
    makerName: maker?.name ?? null,
  };
}

/** "Gr.3", "Gr.B", "Gr.N"… */
export function groupLabel(group: CarGroup | null | undefined): string {
  return group ? `Gr.${group}` : '';
}

// ---------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------

function tokens(query: string): string[] {
  const n = normalizeSearch(query);
  return n === '' ? [] : n.split(' ');
}

/**
 * Cars matching the query (accent/case/punctuation-insensitive; every word must appear in
 * "maker + name"). Names starting with the query come first. Empty query = all cars (of the
 * maker, when given).
 */
export function searchCars(
  query: string,
  opts: { makerId?: number | null; limit?: number } = {},
): CarEntry[] {
  const pool = opts.makerId != null ? carsOfMaker(opts.makerId) : CARS;
  const words = tokens(query);
  let out: CarEntry[];
  if (words.length === 0) {
    out = [...pool];
  } else {
    const first = words[0]!;
    const scored: { car: CarEntry; rank: number }[] = [];
    for (const car of pool) {
      const hay = searchText.get(car.id) ?? '';
      if (!words.every((w) => hay.includes(w))) continue;
      const base = normalizeSearch(car.baseName);
      scored.push({ car, rank: base.startsWith(first) ? 0 : hay.startsWith(first) ? 1 : 2 });
    }
    out = scored.sort((a, b) => a.rank - b.rank).map((s) => s.car);
  }
  return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
}

/** Makers whose name matches the query (empty query = all). */
export function searchMakers(query: string): CarMaker[] {
  const words = tokens(query);
  if (words.length === 0) return [...MAKERS];
  return MAKERS.filter((m) => words.every((w) => (makerSearchText.get(m.id) ?? '').includes(w)));
}

// ---------------------------------------------------------------------------------------------
// Grouping by maker with lap counts
// ---------------------------------------------------------------------------------------------

export interface CarUsage {
  carCode: number;
  laps: number;
}

export interface MakerUsage {
  /** Null = cars that are not in the catalogue. */
  maker: CarMaker | null;
  laps: number;
  /** Used cars of this maker, most laps first. */
  cars: CarUsage[];
}

/**
 * Groups used cars by maker, summing laps (repeated carCodes are merged). Most laps first;
 * cars missing from the catalogue go into a single entry with `maker: null`, always last.
 */
export function groupUsageByMaker(usage: Iterable<CarUsage>): MakerUsage[] {
  const perCar = new Map<number, number>();
  for (const u of usage) perCar.set(u.carCode, (perCar.get(u.carCode) ?? 0) + u.laps);
  const byMaker = new Map<number | null, MakerUsage>();
  for (const [carCode, laps] of perCar) {
    const maker = makerOfCar(carCode) ?? null;
    const key = maker?.id ?? null;
    let g = byMaker.get(key);
    if (!g) {
      g = { maker, laps: 0, cars: [] };
      byMaker.set(key, g);
    }
    g.laps += laps;
    g.cars.push({ carCode, laps });
  }
  for (const g of byMaker.values()) g.cars.sort((a, b) => b.laps - a.laps || a.carCode - b.carCode);
  return [...byMaker.values()].sort((a, b) => {
    if ((a.maker === null) !== (b.maker === null)) return a.maker === null ? 1 : -1;
    return b.laps - a.laps || collator.compare(a.maker?.name ?? '', b.maker?.name ?? '');
  });
}
