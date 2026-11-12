import { describe, expect, it } from 'vitest';
import { TYRE_DROP_MS_PER_LAP, tyrePaceTrend } from './pace-trend.ts';

describe('tyrePaceTrend', () => {
  it('says nothing with fewer than 4 clean laps', () => {
    expect(tyrePaceTrend([])).toEqual({ state: 'unknown', slopeMsPerLap: null, laps: 0 });
    expect(tyrePaceTrend([100_000, 100_300, 100_700]).state).toBe('unknown');
  });

  it('is steady when the laps do not climb', () => {
    const t = tyrePaceTrend([100_000, 100_040, 99_980, 100_020, 100_010]);
    expect(t.state).toBe('steady');
    expect(Math.abs(t.slopeMsPerLap!)).toBeLessThan(TYRE_DROP_MS_PER_LAP);
  });

  it('flags a steady climb of 0.15 s per lap or more', () => {
    const t = tyrePaceTrend([100_000, 100_200, 100_400, 100_600, 100_800]);
    expect(t.state).toBe('dropping');
    expect(t.slopeMsPerLap).toBe(200);
    expect(t.laps).toBe(5);
  });

  it('only looks at the last 5 clean laps', () => {
    const t = tyrePaceTrend([
      103_000, 102_000, 101_000, 100_000, 100_050, 100_020, 100_010, 100_040,
    ]);
    expect(t.state).toBe('steady');
    expect(t.laps).toBe(5);
  });

  it('does not count a slow lap (traffic, a mistake) as the tyres going', () => {
    const t = tyrePaceTrend([100_000, 100_050, 109_000, 100_020, 100_040, 100_030]);
    expect(t.state).toBe('steady');
    expect(t.laps).toBe(5);
  });

  it('does not trigger on one early slow lap followed by recovery', () => {
    // a rising line fitted to a recovering pattern must still end slower than it began
    const t = tyrePaceTrend([100_600, 100_000, 100_100, 100_000, 100_050]);
    expect(t.state).toBe('steady');
  });
});
