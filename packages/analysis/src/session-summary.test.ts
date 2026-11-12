import type { SummaryBaseline } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  buildSessionSummary,
  lapSlope,
  paceTrend,
  type SessionSummaryInput,
  type SummaryLap,
  topAverage,
} from './session-summary.ts';

const lap = (n: number, timeMs: number, valid = true): SummaryLap => ({
  id: `l${n}`,
  number: n,
  timeMs,
  valid,
});

const baseline = (over: Partial<SummaryBaseline> = {}): SummaryBaseline => ({
  sessionId: 'old',
  startedAt: 1000,
  bestLapMs: 100_500,
  top5AvgMs: 101_000,
  lapCount: 8,
  ...over,
});

function input(laps: SummaryLap[], over: Partial<SessionSummaryInput> = {}): SessionSummaryInput {
  return {
    session: { id: 's1', trackId: 't1', carCode: 42, startedAt: 10_000, endedAt: 70_000 },
    laps,
    previousBestMs: 100_500,
    lastSession: baseline(),
    bestSession: baseline(),
    goalMs: null,
    ...over,
  };
}

const FIVE = [lap(1, 101_200), lap(2, 100_300), lap(3, 100_100), lap(4, 100_400), lap(5, 100_200)];

describe('session summary: numbers', () => {
  it('fills every block for a session with 5 valid laps', () => {
    const s = buildSessionSummary(input(FIVE));
    expect(s.laps).toEqual({ total: 5, valid: 5, invalid: 0 });
    expect(s.reduced).toBe(false);
    expect(s.best).toMatchObject({ lapId: 'l3', timeMs: 100_100, firstTime: false });
    expect(s.best!.deltaMs).toBe(-400);
    expect(s.pace!.fastestMs).toBe(100_100);
    expect(s.pace!.slowestMs).toBe(101_200);
    expect(s.pace!.spreadMs).toBe(1100);
    expect(s.pace!.medianMs).toBe(100_300);
    expect(s.pace!.top5AvgMs).toBe(topAverage(FIVE.map((l) => l.timeMs)));
    expect(s.pace!.histogram.reduce((a, b) => a + b.count, 0)).toBe(5);
    expect(s.consistency!.stdDevMs).toBeGreaterThan(0);
    expect(s.durationMs).toBe(60_000);
  });

  it('says "primeira vez" without a previous record and invents no number', () => {
    const s = buildSessionSummary(
      input(FIVE, { previousBestMs: null, lastSession: null, bestSession: null }),
    );
    expect(s.best).toMatchObject({ firstTime: true, previousBestMs: null, deltaMs: null });
    expect(s.comparisons).toEqual({ lastSession: null, bestSession: null, goal: null });
  });

  it('compares with the last session, the best session and the goal', () => {
    const s = buildSessionSummary(input(FIVE, { goalMs: 99_800 }));
    expect(s.comparisons.lastSession).toMatchObject({ baselineMs: 100_500, bestDeltaMs: -400 });
    expect(s.comparisons.lastSession!.paceDeltaMs).toBe(s.pace!.top5AvgMs - 101_000);
    expect(s.comparisons.goal).toMatchObject({ baselineMs: 99_800, bestDeltaMs: 300 });
    expect(s.comparisons.goal!.sessionId).toBeNull();
  });

  it('prefers the time driven over the session span for the duration', () => {
    const i = input(FIVE);
    i.session.trackTimeMs = 42_000;
    expect(buildSessionSummary(i).durationMs).toBe(42_000);
  });
});

describe('session summary: short and messy sessions', () => {
  it('is reduced below 3 clean laps: no spread, trend or consistency tips', () => {
    const s = buildSessionSummary(input([lap(1, 101_000), lap(2, 100_000)]));
    expect(s.reduced).toBe(true);
    expect(s.pace!.histogram).toEqual([]);
    expect(s.consistency).toBeNull();
    expect(s.suggestions.find((t) => t.code === 'inconsistent')).toBeUndefined();
    expect(s.best!.timeMs).toBe(100_000);
  });

  it('has no best and no pace without a valid lap', () => {
    const s = buildSessionSummary(input([lap(1, 101_000, false)]));
    expect(s.best).toBeNull();
    expect(s.pace).toBeNull();
    expect(s.comparisons.lastSession).toBeNull();
    expect(s.laps).toEqual({ total: 1, valid: 0, invalid: 1 });
  });

  it('leaves a slow valid cool-down lap out of pace and consistency (107 % rule)', () => {
    const withCooldown = buildSessionSummary(input([...FIVE, lap(6, 130_000)]));
    const without = buildSessionSummary(input(FIVE));
    expect(withCooldown.pace!.slowestMs).toBe(without.pace!.slowestMs);
    expect(withCooldown.consistency!.stdDevMs).toBe(without.consistency!.stdDevMs);
    // ...but it still counts as a valid lap of the session
    expect(withCooldown.laps.valid).toBe(6);
  });
});

describe('pace trend', () => {
  it('slope is exact for a straight line', () => {
    expect(lapSlope([100_000, 100_100, 100_200, 100_300])).toBeCloseTo(100, 6);
    expect(lapSlope([100_000])).toBeNull();
  });

  it('calls improving, worsening and steady', () => {
    expect(paceTrend([102_000, 101_400, 100_900, 100_400, 100_000])!.trend).toBe('improving');
    expect(paceTrend([100_000, 100_500, 100_900, 101_500, 102_000])!.trend).toBe('worsening');
    expect(paceTrend([100_000, 100_040, 99_980, 100_020, 100_000])!.trend).toBe('steady');
    expect(paceTrend([100_000, 101_000])).toBeNull();
  });
});

describe('session summary: suggestions', () => {
  it('warns about many invalid laps', () => {
    const laps = [lap(1, 100_000), lap(2, 100_200, false), lap(3, 100_100, false), lap(4, 100_300)];
    const tips = buildSessionSummary(input(laps)).suggestions;
    expect(tips[0]).toMatchObject({ code: 'invalidLaps', values: [2, 4] });
  });

  it('names the corner that lost the most, only above the noise', () => {
    const big = buildSessionSummary(
      input(FIVE, {
        cornerChanges: [
          { cornerId: 'T7', name: null, deltaMs: 310 },
          { cornerId: 'T2', name: 'Hairpin', deltaMs: 60 },
          { cornerId: 'T4', name: null, deltaMs: -150 },
          { cornerId: 'T5', name: null, deltaMs: 10 },
        ],
      }),
    );
    expect(big.corners!.losses.map((c) => c.cornerId)).toEqual(['T7', 'T2']);
    expect(big.corners!.gains.map((c) => c.cornerId)).toEqual(['T4']);
    expect(big.suggestions[0]).toMatchObject({ code: 'cornerLoss', values: ['T7', '0,31'] });

    const small = buildSessionSummary(
      input(FIVE, { cornerChanges: [{ cornerId: 'T2', name: null, deltaMs: 60 }] }),
    );
    expect(small.suggestions.find((t) => t.code === 'cornerLoss')).toBeUndefined();
  });

  it('flags a repeatable-pace gap and a worsening session, at most 3 tips', () => {
    const laps = [
      lap(1, 100_000),
      lap(2, 100_800),
      lap(3, 101_400),
      lap(4, 102_200),
      lap(5, 102_900),
      lap(6, 103_600),
    ];
    const s = buildSessionSummary(
      input(laps, {
        consistencyHighlights: ['Retomada do acelerador na T7 varia 12 m entre as voltas'],
        cornerChanges: [{ cornerId: 'T3', name: 'Curva 3', deltaMs: 200 }],
      }),
    );
    expect(s.suggestions.length).toBeLessThanOrEqual(3);
    expect(s.suggestions.map((t) => t.code)).toEqual(['cornerLoss', 'inconsistent', 'paceGap']);
  });
});
