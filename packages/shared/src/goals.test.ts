import { describe, expect, it } from 'vitest';
import { checkGoal, goalProgress, suggestGoal } from './goals.ts';

describe('checkGoal', () => {
  it('accepts a time between 10 s and 1 hour that beats the best lap', () => {
    expect(checkGoal(105_000, 106_000)).toEqual({ ok: true, targetMs: 105_000 });
    expect(checkGoal(105_000.4, null)).toEqual({ ok: true, targetMs: 105_000 });
  });

  it('refuses zero, huge or non-numeric values', () => {
    expect(checkGoal(0, null)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkGoal(9_999, null)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkGoal(3_600_001, null)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkGoal('1:45', null)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkGoal(Number.NaN, null)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('refuses a goal slower than the best lap unless the driver insists', () => {
    expect(checkGoal(106_000, 106_000)).toEqual({ ok: false, reason: 'slower' });
    expect(checkGoal(107_000, 106_000)).toEqual({ ok: false, reason: 'slower' });
    expect(checkGoal(107_000, 106_000, true)).toEqual({ ok: true, targetMs: 107_000 });
  });
});

describe('suggestGoal', () => {
  it('uses the best lap minus 0.5 % when the ideal lap is further away', () => {
    const s = suggestGoal(100_000, 98_000)!;
    expect(s.basis).toBe('bestLap');
    expect(s.targetMs).toBe(99_500);
    expect(s.idealLapMs).toBe(98_000);
  });

  it('uses the ideal lap when it is slower than the 0.5 % cut (never beyond what was done in parts)', () => {
    const s = suggestGoal(100_000, 99_800)!;
    expect(s.basis).toBe('idealLap');
    expect(s.targetMs).toBe(99_800);
  });

  it('ignores an ideal lap that is not faster than the best lap, and needs a best lap', () => {
    expect(suggestGoal(100_000, 100_000)!.basis).toBe('bestLap');
    expect(suggestGoal(100_000, null)!.targetMs).toBe(99_500);
    expect(suggestGoal(null, 99_000)).toBeNull();
  });
});

describe('goalProgress', () => {
  it('measures the share of the way from the starting lap', () => {
    const p = goalProgress(100_000, 102_000, 104_000);
    expect(p.reached).toBe(false);
    expect(p.remainingMs).toBe(2000);
    expect(p.fraction).toBeCloseTo(0.5, 5);
  });

  it('is complete once the best lap is at or under the goal', () => {
    expect(goalProgress(100_000, 99_900, 104_000)).toEqual({
      remainingMs: 0,
      fraction: 1,
      reached: true,
    });
  });

  it('has no fraction without a starting lap, and never leaves 0–1', () => {
    expect(goalProgress(100_000, 102_000, null).fraction).toBeNull();
    expect(goalProgress(100_000, 106_000, 104_000).fraction).toBe(0);
  });
});
