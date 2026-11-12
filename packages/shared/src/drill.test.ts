import { describe, expect, it } from 'vitest';
import {
  assessDrillPass,
  bestPass,
  DRILL_NOISE_MS,
  drillSummary,
  isCleanDrillPass,
} from './drill.ts';
import type { LiveDrillPass } from './live.ts';

const pass = (n: number, timeMs: number, over: Partial<LiveDrillPass> = {}): LiveDrillPass => ({
  n,
  timeMs,
  entrySpeedKmh: 120,
  minSpeedKmh: 70,
  exitSpeedKmh: 110,
  brakePointM: 90,
  at: n * 1000,
  ...over,
});

describe('assessDrillPass', () => {
  it('has nothing to compare with on the first pass', () => {
    const v = assessDrillPass(pass(1, 3500), []);
    expect(v).toMatchObject({ vsBestMs: null, isBest: true, improved: false, slower: false });
  });

  it('compares with the best earlier pass, not the previous one', () => {
    const earlier = [pass(1, 3600), pass(2, 3400), pass(3, 3700)];
    const v = assessDrillPass(pass(4, 3350, { entrySpeedKmh: 126, exitSpeedKmh: 113 }), earlier);
    expect(v.vsBestMs).toBe(-50);
    expect(v.entrySpeedDeltaKmh).toBe(6);
    expect(v.exitSpeedDeltaKmh).toBe(3);
    expect(v).toMatchObject({ isBest: true, improved: true, slower: false });
  });

  it('treats differences under the noise as the same time', () => {
    const earlier = [pass(1, 3400)];
    const v = assessDrillPass(pass(2, 3400 + DRILL_NOISE_MS - 1), earlier);
    expect(v).toMatchObject({ improved: false, slower: false, isBest: false });
    expect(assessDrillPass(pass(2, 3400 + DRILL_NOISE_MS), earlier).slower).toBe(true);
  });
});

describe('drillSummary', () => {
  it('reports the improvement from the first pass to the best', () => {
    const passes = [pass(1, 3600), pass(2, 3480), pass(3, 3421), pass(4, 3520)];
    expect(drillSummary(passes)).toEqual({
      count: 4,
      bestMs: 3421,
      bestN: 3,
      firstMs: 3600,
      lastMs: 3520,
      averageMs: 3505,
      improvementMs: 179,
    });
    expect(bestPass(passes)!.n).toBe(3);
  });

  it('has no summary without passes, and no negative improvement', () => {
    expect(drillSummary([])).toBeNull();
    expect(drillSummary([pass(1, 3300)])!.improvementMs).toBe(0);
  });
});

describe('isCleanDrillPass', () => {
  it('drops a pass where the car stopped or the time is absurd', () => {
    expect(isCleanDrillPass(70, 3500)).toBe(true);
    expect(isCleanDrillPass(3, 3500)).toBe(false);
    expect(isCleanDrillPass(70, 0)).toBe(false);
    expect(isCleanDrillPass(70, 300_000)).toBe(false);
  });
});
