import { describe, expect, it } from 'vitest';
import {
  CARS_SOURCE,
  carLabel,
  carName,
  carsOfMaker,
  describeCar,
  getCar,
  getMaker,
  groupLabel,
  groupUsageByMaker,
  listCars,
  listMakers,
  makerOfCar,
  normalizeSearch,
  searchCars,
  searchMakers,
} from './index.ts';

describe('catalog integrity', () => {
  const cars = listCars();
  const makers = listMakers();

  it('is a plausible, complete list', () => {
    expect(cars.length).toBeGreaterThanOrEqual(400);
    expect(makers.length).toBeGreaterThanOrEqual(50);
  });

  it('has unique ids and slugs', () => {
    expect(new Set(cars.map((c) => c.id)).size).toBe(cars.length);
    expect(new Set(makers.map((m) => m.id)).size).toBe(makers.length);
    expect(new Set(makers.map((m) => m.slug)).size).toBe(makers.length);
  });

  it('every car has a name and an existing maker', () => {
    for (const c of cars) {
      expect(c.name.trim().length, `car ${c.id}`).toBeGreaterThan(0);
      expect(c.baseName.trim().length, `car ${c.id}`).toBeGreaterThan(0);
      expect(getMaker(c.makerId), `car ${c.id} maker ${c.makerId}`).toBeDefined();
    }
  });

  it('every maker has a name, a slug and at least one car', () => {
    for (const m of makers) {
      expect(m.name.trim()).not.toBe('');
      expect(m.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(m.carCount, m.name).toBeGreaterThan(0);
      expect(carsOfMaker(m.id)).toHaveLength(m.carCount);
    }
  });

  it('groups and years are well-formed', () => {
    for (const c of cars) {
      if (c.year !== null) expect(c.year).toBeGreaterThanOrEqual(1925);
      if (c.year !== null) expect(c.year).toBeLessThanOrEqual(2030);
    }
    expect(groupLabel('3')).toBe('Gr.3');
    expect(groupLabel(null)).toBe('');
  });

  it('records where the data came from', () => {
    expect(CARS_SOURCE.license).toBe('MIT-0');
    expect(CARS_SOURCE.repo).toContain('gt7info');
  });

  it('matches known ids of the game', () => {
    // 3337 is the id the demo/mock uses (Alpine A110 '17).
    expect(getCar(3337)?.name).toBe("A110 '17");
    expect(getCar(3337)?.year).toBe(2017);
    expect(getCar(3337)?.baseName).toBe('A110');
    expect(makerOfCar(3337)?.name).toBe('Alpine');
  });

  it('sorts makers A–Z ignoring accents and case', () => {
    const names = makers.map((m) => normalizeSearch(m.name));
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  });

  it('shows Citroën with its diaeresis but searches without it', () => {
    expect(makers.some((m) => m.name === 'Citroën')).toBe(true);
    expect(searchMakers('citroen').map((m) => m.name)).toEqual(['Citroën']);
  });
});

describe('lookups and unknown cars', () => {
  it('falls back to "Carro #id" for ids that are not in the catalogue', () => {
    expect(carName(999_999)).toBeNull();
    expect(carLabel(999_999)).toBe('Carro #999999');
    expect(carLabel(null)).toBe('—');
    expect(describeCar(999_999)).toEqual({
      carCode: 999_999,
      carName: null,
      makerId: null,
      makerName: null,
    });
  });

  it('describes known cars with name and maker', () => {
    const d = describeCar(3337);
    expect(d).toMatchObject({ carCode: 3337, carName: "A110 '17", makerName: 'Alpine' });
    expect(d.makerId).toBe(makerOfCar(3337)?.id);
    expect(carLabel(3337)).toBe("A110 '17");
  });
});

describe('search', () => {
  it('ignores accents, case and punctuation', () => {
    expect(normalizeSearch('  CITROËN   DS-3 ')).toBe('citroen ds 3');
    const a = searchCars('citroen').map((c) => c.id);
    const b = searchCars('CITROËN').map((c) => c.id);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('requires every word and finds across maker + name', () => {
    const r = searchCars('nissan gt-r');
    expect(r.length).toBeGreaterThan(0);
    for (const c of r) {
      expect(getMaker(c.makerId)?.name).toBe('Nissan');
      expect(normalizeSearch(c.name)).toMatch(/gt.* r/);
    }
  });

  it('finds by chassis code in parentheses', () => {
    expect(searchCars('ae86').some((c) => c.name.includes('AE86'))).toBe(true);
  });

  it('restricts to a maker and respects the limit', () => {
    const toyota = listMakers().find((m) => m.name === 'Toyota')!;
    const all = searchCars('', { makerId: toyota.id });
    expect(all).toHaveLength(toyota.carCount);
    expect(searchCars('', { makerId: toyota.id, limit: 3 })).toHaveLength(3);
    expect(searchCars('zzzz-no-such-car')).toEqual([]);
  });

  it('puts names that start with the query first', () => {
    const r = searchCars('supra');
    expect(r.length).toBeGreaterThan(0);
    expect(normalizeSearch(r[0]!.baseName).startsWith('supra')).toBe(true);
  });

  it('searches makers', () => {
    expect(searchMakers('')).toHaveLength(listMakers().length);
    expect(searchMakers('merc').map((m) => m.name)).toContain('Mercedes-Benz');
    expect(searchMakers('xx-nada')).toEqual([]);
  });
});

describe('groupUsageByMaker', () => {
  const supra = searchCars('supra')[0]!.id;
  const gtr = searchCars('nissan gt-r')[0]!.id;
  const gtr2 = searchCars('nissan gt-r')[1]!.id;

  it('sums laps per maker, merges repeated cars and orders by laps', () => {
    const groups = groupUsageByMaker([
      { carCode: supra, laps: 4 },
      { carCode: gtr, laps: 3 },
      { carCode: gtr2, laps: 2 },
      { carCode: supra, laps: 1 },
    ]);
    expect(groups.map((g) => [g.maker?.name, g.laps])).toEqual([
      ['Nissan', 5],
      ['Toyota', 5],
    ]);
    const toyota = groups.find((g) => g.maker?.name === 'Toyota')!;
    expect(toyota.cars).toEqual([{ carCode: supra, laps: 5 }]);
    const nissan = groups.find((g) => g.maker?.name === 'Nissan')!;
    expect(nissan.cars.map((c) => c.laps)).toEqual([3, 2]);
  });

  it('puts cars outside the catalogue in one last bucket', () => {
    const groups = groupUsageByMaker([
      { carCode: 123_456, laps: 50 },
      { carCode: 123_457, laps: 10 },
      { carCode: supra, laps: 1 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.maker?.name).toBe('Toyota');
    expect(groups[1]?.maker).toBeNull();
    expect(groups[1]?.laps).toBe(60);
    expect(groups[1]?.cars.map((c) => c.carCode)).toEqual([123_456, 123_457]);
  });

  it('is empty for no usage', () => {
    expect(groupUsageByMaker([])).toEqual([]);
  });
});
