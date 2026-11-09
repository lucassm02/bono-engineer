/**
 * "Carro" filter of the history screens: pick a maker (all its cars) or one specific car.
 * Pure helpers (matching, usage by maker, persistence) so they can be tested without the DOM.
 */

import {
  type CarUsage,
  getCar,
  getMaker,
  groupUsageByMaker,
  type MakerUsage,
  makerOfCar,
} from '@gt7/shared';
import { loadJson, saveJson } from '../../lib/storage.ts';

/** `makerId` of the pseudo-maker "cars that are not in the catalogue". */
export const UNKNOWN_MAKER_ID = -1;

export interface CarFilter {
  /** Catalogue maker id, `UNKNOWN_MAKER_ID` or null (any). */
  makerId: number | null;
  /** One specific car (null = every car of the maker). */
  carCode: number | null;
}

export const NO_CAR_FILTER: CarFilter = { makerId: null, carCode: null };

export function isCarFiltering(f: CarFilter): boolean {
  return f.makerId !== null || f.carCode !== null;
}

/** Does a car (by `carCode`) pass the filter? */
export function carMatchesFilter(f: CarFilter, carCode: number): boolean {
  if (f.carCode !== null) return f.carCode === carCode;
  if (f.makerId === null) return true;
  const maker = makerOfCar(carCode);
  return f.makerId === UNKNOWN_MAKER_ID ? !maker : maker?.id === f.makerId;
}

/** Does any of the cars pass the filter? */
export function anyCarMatches(f: CarFilter, carCodes: Iterable<number>): boolean {
  if (!isCarFiltering(f)) return true;
  for (const c of carCodes) if (carMatchesFilter(f, c)) return true;
  return false;
}

/** Same filter for a maker pick: a new maker clears the previous specific car. */
export function pickMaker(makerId: number | null): CarFilter {
  return { makerId, carCode: null };
}

/** Picking a car also records its maker (so the maker chip/breadcrumb stays coherent). */
export function pickCar(carCode: number): CarFilter {
  return { makerId: makerOfCar(carCode)?.id ?? UNKNOWN_MAKER_ID, carCode };
}

/** Plain-text description ("Toyota", "GR Supra RZ '20", "Fora do catálogo"). */
export function describeCarFilter(f: CarFilter): string {
  if (f.carCode !== null) return getCar(f.carCode)?.name ?? `Carro #${f.carCode}`;
  if (f.makerId === UNKNOWN_MAKER_ID) return 'Fora do catálogo';
  if (f.makerId !== null) return getMaker(f.makerId)?.name ?? 'Marca';
  return 'Todos';
}

/** Usage (laps per car) grouped by maker, most laps first. */
export function usageByMaker(usage: Iterable<CarUsage>): MakerUsage[] {
  return groupUsageByMaker(usage);
}

/** Laps per car code from any list of rows that carry a `carCode`. */
export function lapsPerCar(rows: Iterable<{ carCode: number; laps?: number }>): CarUsage[] {
  const m = new Map<number, number>();
  for (const r of rows) m.set(r.carCode, (m.get(r.carCode) ?? 0) + (r.laps ?? 1));
  return [...m.entries()].map(([carCode, laps]) => ({ carCode, laps }));
}

// ---------------------------------------------------------------------------------------------
// Persistence (last filter, localStorage; never throws)
// ---------------------------------------------------------------------------------------------

export const CAR_FILTER_KEY = 'gt7.carFilter';

/** Validates anything read from storage. */
export function parseStoredFilter(v: unknown): CarFilter {
  if (!v || typeof v !== 'object') return NO_CAR_FILTER;
  const o = v as Record<string, unknown>;
  const makerId = typeof o.makerId === 'number' && Number.isInteger(o.makerId) ? o.makerId : null;
  const carCode = typeof o.carCode === 'number' && Number.isInteger(o.carCode) ? o.carCode : null;
  if (carCode !== null) return pickCar(carCode);
  if (makerId !== null && (makerId === UNKNOWN_MAKER_ID || getMaker(makerId))) {
    return { makerId, carCode: null };
  }
  return NO_CAR_FILTER;
}

export function loadCarFilter(): CarFilter {
  return parseStoredFilter(loadJson<unknown>(CAR_FILTER_KEY));
}

export function saveCarFilter(f: CarFilter): void {
  saveJson(CAR_FILTER_KEY, f);
}
