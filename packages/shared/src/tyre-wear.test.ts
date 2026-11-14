import { describe, expect, it } from 'vitest';
import {
  compoundInfo,
  isTyreCompound,
  TYRE_COMPOUNDS,
  type TyreWearStep,
  TyreWearTracker,
  tempWearFactor,
  WEAR_LIMIT,
  wheelLoadFactors,
} from './tyre-wear.ts';

const step = (over: Partial<TyreWearStep> = {}): TyreWearStep => ({
  distM: 100,
  speedMps: 50,
  tempC: [85, 85, 85, 85],
  slip: [0, 0, 0, 0],
  gLat: 0.6,
  brake: 0,
  ...over,
});

function drive(compound: Parameters<TyreWearTracker['add']>[0], n: number, s = step()) {
  const t = new TyreWearTracker();
  for (let i = 0; i < n; i++) t.add(compound, s);
  return t;
}

describe('compounds', () => {
  it('knows its ids and a harder compound lasts longer inside a family', () => {
    expect(TYRE_COMPOUNDS).toHaveLength(12);
    expect(isTyreCompound('racingSoft')).toBe(true);
    expect(isTyreCompound('slick')).toBe(false);
    expect(isTyreCompound(null)).toBe(false);
    for (const f of ['comfort', 'sport', 'racing'] as const) {
      const [h, m, s] = ['Hard', 'Medium', 'Soft'].map((k) => compoundInfo(`${f}${k}` as never));
      expect(h!.lifeKm).toBeGreaterThan(m!.lifeKm);
      expect(m!.lifeKm).toBeGreaterThan(s!.lifeKm);
    }
  });
});

describe('tempWearFactor', () => {
  const ideal = [70, 95] as const;
  it('is 1 inside the range, a little more cold, much more hot', () => {
    expect(tempWearFactor(80, ideal)).toBe(1);
    expect(tempWearFactor(50, ideal)).toBeGreaterThan(1);
    expect(tempWearFactor(50, ideal)).toBeLessThanOrEqual(1.4);
    expect(tempWearFactor(110, ideal)).toBeGreaterThan(tempWearFactor(100, ideal));
    expect(tempWearFactor(110, ideal)).toBeGreaterThan(2);
    expect(tempWearFactor(500, ideal)).toBe(3.5);
    expect(tempWearFactor(Number.NaN, ideal)).toBe(1);
  });
});

describe('wheelLoadFactors', () => {
  it('loads the outer wheels in a corner (left turn: the right side) and the front ones when braking', () => {
    const left = wheelLoadFactors({ gLat: 1.5, brake: 0, slip: [0, 0, 0, 0] });
    expect(left[1]).toBeGreaterThan(left[0]);
    expect(left[3]).toBeGreaterThan(left[2]);
    const right = wheelLoadFactors({ gLat: -1.5, brake: 0, slip: [0, 0, 0, 0] });
    expect(right[0]).toBeGreaterThan(right[1]);
    const braking = wheelLoadFactors({ gLat: 0, brake: 1, slip: [0, 0, 0, 0] });
    expect(braking[0]).toBeGreaterThan(braking[2]);
    expect(wheelLoadFactors({ gLat: 0, brake: 0, slip: [0, 0, 0, 0] })).toEqual([1, 1, 1, 1]);
  });
  it('a sliding wheel carries more', () => {
    const f = wheelLoadFactors({ gLat: 0, brake: 0, slip: [0.5, 0, 0, -0.5] });
    expect(f[0]).toBeGreaterThan(f[1]);
    expect(f[3]).toBeGreaterThan(f[2]);
  });
});

describe('TyreWearTracker', () => {
  it('starts new and wears with the distance', () => {
    const t = new TyreWearTracker();
    expect(t.snapshot(null, 4000).worst).toBe(0);
    const a = drive('sportMedium', 100).snapshot('sportMedium', 4000);
    const b = drive('sportMedium', 200).snapshot('sportMedium', 4000);
    expect(a.distKm).toBeCloseTo(10, 6);
    expect(b.worst).toBeCloseTo(a.worst * 2, 6);
  });

  it('a soft compound wears faster than a hard one', () => {
    const soft = drive('racingSoft', 100).snapshot('racingSoft', null).worst;
    const hard = drive('racingHard', 100).snapshot('racingHard', null).worst;
    expect(soft).toBeGreaterThan(hard * 2);
  });

  it('overheated tyres wear faster than tyres in their range', () => {
    const ok = drive('sportMedium', 100).snapshot('sportMedium', null).worst;
    const hot = drive('sportMedium', 100, step({ tempC: [112, 112, 112, 112] })).snapshot(
      'sportMedium',
      null,
    ).worst;
    expect(hot).toBeGreaterThan(ok * 1.8);
  });

  it('a car standing still or without distance wears nothing', () => {
    const t = new TyreWearTracker();
    t.add(null, step({ speedMps: 0.2 }));
    t.add(null, step({ distM: 0 }));
    expect(t.snapshot(null, null).worst).toBe(0);
  });

  it('wears the outer tyres more in a corner', () => {
    const t = drive('sportMedium', 50, step({ gLat: 1.8 })).snapshot('sportMedium', null);
    expect(t.wear[1]).toBeGreaterThan(t.wear[0]);
    expect(t.wear[3]).toBeGreaterThan(t.wear[2]);
  });

  it('estimates the laps left from the pace so far, only after enough distance', () => {
    expect(drive('sportMedium', 5).snapshot('sportMedium', 4000).perLap).toBeNull();
    const s = drive('sportMedium', 80).snapshot('sportMedium', 4000);
    expect(s.perLap).not.toBeNull();
    expect(s.lapsLeft).toBeCloseTo((WEAR_LIMIT - s.worst) / s.perLap!, 6);
    expect(drive('sportMedium', 80).snapshot('sportMedium', null).lapsLeft).toBeNull();
  });

  it('never goes past 1 and starts again on reset', () => {
    const t = drive('racingSoft', 2000);
    expect(t.snapshot('racingSoft', null).worst).toBe(1);
    t.reset();
    expect(t.snapshot('racingSoft', null)).toMatchObject({ worst: 0, distKm: 0 });
  });
});
