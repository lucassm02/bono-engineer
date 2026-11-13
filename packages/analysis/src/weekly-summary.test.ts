import type { WeeklyGoalReached } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  buildWeeklySummary,
  DAY_MS,
  type WeeklyInput,
  type WeeklySessionInput,
  weekWindow,
} from './weekly-summary.ts';

const NOW = Date.UTC(2026, 10, 12, 20, 0, 0);
const day = (n: number) => NOW - n * DAY_MS;

const lap = (timeMs: number, valid = true) => ({ timeMs, valid });
const session = (
  o: Partial<WeeklySessionInput> & { laps: WeeklySessionInput['laps'] },
): WeeklySessionInput => ({
  trackId: 'T1',
  carCode: 7,
  startedAt: day(1),
  endedAt: day(1) + 30 * 60_000,
  ...o,
});

const base = (sessions: WeeklySessionInput[], over: Partial<WeeklyInput> = {}) =>
  buildWeeklySummary({
    weeksAgo: 0,
    now: NOW,
    sessions,
    previousBestMs: () => null,
    goalMs: () => null,
    trackName: (id) => `Pista ${id}`,
    goalsReached: [],
    ...over,
  });

describe('weekWindow', () => {
  it('is the 7 days ending now, and the 7 before for weeksAgo 1', () => {
    expect(weekWindow(0, NOW)).toEqual({ fromMs: NOW - 7 * DAY_MS, toMs: NOW });
    expect(weekWindow(1, NOW)).toEqual({ fromMs: NOW - 14 * DAY_MS, toMs: NOW - 7 * DAY_MS });
  });
});

describe('buildWeeklySummary', () => {
  it('counts the sessions, laps and time on track of the window only', () => {
    const s = base([
      session({ laps: [lap(124_000), lap(125_000, false), lap(123_500)] }),
      session({ startedAt: day(3), endedAt: day(3) + 20 * 60_000, laps: [lap(124_200)] }),
      session({ startedAt: day(9), laps: [lap(120_000)] }), // last week: out
    ]);
    expect(s.sessions).toBe(2);
    expect(s.laps).toBe(4);
    expect(s.validLaps).toBe(3);
    expect(s.drivingMs).toBe(50 * 60_000);
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0]).toMatchObject({
      trackName: 'Pista T1',
      sessions: 2,
      laps: 4,
      bestMs: 123_500,
    });
  });

  it('compares the best lap with the best before the window: record, slower and first time', () => {
    const rows = base(
      [
        session({ trackId: 'A', laps: [lap(100_000)] }),
        session({ trackId: 'B', laps: [lap(101_500)] }),
        session({ trackId: 'C', laps: [lap(99_000)] }),
      ],
      { previousBestMs: (id) => ({ A: 100_400, B: 101_000, C: null })[id] ?? null },
    );
    const by = Object.fromEntries(rows.tracks.map((t) => [t.trackId, t]));
    expect(by.A).toMatchObject({ deltaMs: -400, isRecord: true, firstTime: false });
    expect(by.B).toMatchObject({ deltaMs: 500, isRecord: false, firstTime: false });
    expect(by.C).toMatchObject({ deltaMs: null, isRecord: false, firstTime: true });
    expect(rows.records).toBe(1);
  });

  it('keeps one row per track and car, most laps first', () => {
    const s = base([
      session({ carCode: 1, laps: [lap(100_000)] }),
      session({ carCode: 2, laps: [lap(101_000), lap(101_100), lap(101_200)] }),
    ]);
    expect(s.tracks.map((t) => t.carCode)).toEqual([2, 1]);
  });

  it('measures the active goal against the best lap overall', () => {
    const s = base([session({ laps: [lap(102_000)] })], {
      previousBestMs: () => 101_000,
      goalMs: () => 100_500,
    });
    expect(s.tracks[0]!.goal).toEqual({ targetMs: 100_500, reached: false, remainingMs: 500 });
    const reached = base([session({ laps: [lap(100_000)] })], { goalMs: () => 100_500 });
    expect(reached.tracks[0]!.goal).toEqual({ targetMs: 100_500, reached: true, remainingMs: 0 });
  });

  it('lists only the goals reached inside the window, newest first', () => {
    const g = (achievedAt: number): WeeklyGoalReached => ({
      trackId: 'T1',
      trackName: 'Pista T1',
      carCode: null,
      targetMs: 100_000,
      achievedAt,
    });
    const s = base([], { goalsReached: [g(day(10)), g(day(2)), g(day(5))] });
    expect(s.goalsReached.map((x) => x.achievedAt)).toEqual([day(2), day(5)]);
  });

  it('ignores sessions without a known track and tolerates an empty week', () => {
    const s = base([session({ trackId: null, laps: [lap(100_000)] })]);
    expect(s.tracks).toEqual([]);
    expect(s.sessions).toBe(1);
    const empty = base([]);
    expect(empty).toMatchObject({ sessions: 0, laps: 0, drivingMs: 0, records: 0 });
  });
});
