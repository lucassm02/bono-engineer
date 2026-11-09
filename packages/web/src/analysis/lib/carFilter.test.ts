import { makerOfCar, searchCars } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  anyCarMatches,
  carMatchesFilter,
  describeCarFilter,
  isCarFiltering,
  lapsPerCar,
  NO_CAR_FILTER,
  parseStoredFilter,
  pickCar,
  pickMaker,
  UNKNOWN_MAKER_ID,
  usageByMaker,
} from './carFilter.ts';
import { carLabel } from './labels.ts';

const supra = searchCars('supra')[0]!.id;
const gtr = searchCars('nissan gt-r')[0]!.id;
const UNKNOWN = 987_654;

describe('car filter', () => {
  it('matches by car, by maker and by "outside the catalogue"', () => {
    expect(carMatchesFilter(NO_CAR_FILTER, supra)).toBe(true);
    expect(carMatchesFilter(pickCar(supra), supra)).toBe(true);
    expect(carMatchesFilter(pickCar(supra), gtr)).toBe(false);
    const toyota = pickMaker(makerOfCar(supra)!.id);
    expect(carMatchesFilter(toyota, supra)).toBe(true);
    expect(carMatchesFilter(toyota, gtr)).toBe(false);
    expect(carMatchesFilter(toyota, UNKNOWN)).toBe(false);
    const unknown = pickMaker(UNKNOWN_MAKER_ID);
    expect(carMatchesFilter(unknown, UNKNOWN)).toBe(true);
    expect(carMatchesFilter(unknown, supra)).toBe(false);
  });

  it('picking a car records its maker (unknown cars → the "outside" bucket)', () => {
    expect(pickCar(supra)).toEqual({ makerId: makerOfCar(supra)!.id, carCode: supra });
    expect(pickCar(UNKNOWN)).toEqual({ makerId: UNKNOWN_MAKER_ID, carCode: UNKNOWN });
    expect(pickMaker(3)).toEqual({ makerId: 3, carCode: null });
  });

  it('anyCarMatches / isCarFiltering', () => {
    expect(isCarFiltering(NO_CAR_FILTER)).toBe(false);
    expect(isCarFiltering(pickMaker(3))).toBe(true);
    expect(anyCarMatches(NO_CAR_FILTER, [])).toBe(true);
    expect(anyCarMatches(pickCar(supra), [gtr])).toBe(false);
    expect(anyCarMatches(pickCar(supra), [gtr, supra])).toBe(true);
  });

  it('describes the filter in pt-BR', () => {
    expect(describeCarFilter(NO_CAR_FILTER)).toBe('Todos');
    expect(describeCarFilter(pickMaker(makerOfCar(supra)!.id))).toBe('Toyota');
    expect(describeCarFilter(pickCar(UNKNOWN))).toBe(`Carro #${UNKNOWN}`);
    expect(describeCarFilter(pickMaker(UNKNOWN_MAKER_ID))).toBe('Fora do catálogo');
  });

  it('validates what comes from localStorage', () => {
    expect(parseStoredFilter(null)).toEqual(NO_CAR_FILTER);
    expect(parseStoredFilter('lixo')).toEqual(NO_CAR_FILTER);
    expect(parseStoredFilter({ makerId: 'x', carCode: 'y' })).toEqual(NO_CAR_FILTER);
    expect(parseStoredFilter({ makerId: 99999, carCode: null })).toEqual(NO_CAR_FILTER);
    expect(parseStoredFilter({ makerId: null, carCode: supra })).toEqual(pickCar(supra));
    const id = makerOfCar(supra)!.id;
    expect(parseStoredFilter({ makerId: id, carCode: null })).toEqual(pickMaker(id));
    expect(parseStoredFilter({ makerId: UNKNOWN_MAKER_ID, carCode: null })).toEqual(
      pickMaker(UNKNOWN_MAKER_ID),
    );
  });
});

describe('usage by maker', () => {
  it('sums laps per car and groups by maker with counts', () => {
    const usage = lapsPerCar([
      { carCode: supra, laps: 3 },
      { carCode: supra, laps: 2 },
      { carCode: gtr, laps: 4 },
      { carCode: UNKNOWN },
    ]);
    expect(usage.find((u) => u.carCode === supra)?.laps).toBe(5);
    expect(usage.find((u) => u.carCode === UNKNOWN)?.laps).toBe(1);
    const groups = usageByMaker(usage);
    expect(groups.map((g) => [g.maker?.name ?? null, g.laps])).toEqual([
      ['Toyota', 5],
      ['Nissan', 4],
      [null, 1],
    ]);
  });
});

describe('carLabel (text)', () => {
  it('uses the catalogue, then the given name, then the code', () => {
    expect(carLabel(3337)).toBe("A110 '17");
    expect(carLabel(3337, 'Outro nome')).toBe("A110 '17");
    expect(carLabel(UNKNOWN, 'Nome da referência')).toBe('Nome da referência');
    expect(carLabel(UNKNOWN)).toBe(`Carro #${UNKNOWN}`);
    expect(carLabel(null)).toBe('—');
  });
});
