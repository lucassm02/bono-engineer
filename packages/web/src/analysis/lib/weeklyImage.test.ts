import type { WeeklySummary, WeeklyTrackRow } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { weeklyImageHeight, weeklyImageModel } from './weeklyImage.ts';

const f = {
  lapTime: (ms: number) =>
    `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`,
  delta: (ms: number) => `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}`,
  date: () => '05/11',
  car: (c: number) => `Carro ${c}`,
  t: (m: string, ...v: unknown[]) => m.replace(/\{(\d+)\}/g, (_, i) => String(v[Number(i)])),
};

const row = (o: Partial<WeeklyTrackRow>): WeeklyTrackRow => ({
  trackId: 'T',
  trackName: 'Trial Mountain',
  carCode: 7,
  sessions: 1,
  laps: 10,
  validLaps: 9,
  bestMs: 123_776,
  previousBestMs: 124_200,
  deltaMs: -424,
  isRecord: true,
  firstTime: false,
  goal: null,
  ...o,
});

const week = (o: Partial<WeeklySummary> = {}): WeeklySummary => ({
  weeksAgo: 0,
  fromMs: 0,
  toMs: 7 * 86_400_000,
  sessions: 3,
  laps: 40,
  validLaps: 36,
  drivingMs: 125 * 60_000,
  tracks: [row({})],
  records: 1,
  goalsReached: [],
  ...o,
});

describe('weeklyImageModel', () => {
  it('shows the stats and one row per track with the change and its tone', () => {
    const m = weeklyImageModel(week(), f);
    expect(m.title).toBe('Minha semana no Bono');
    expect(m.stats).toEqual([
      { label: 'Sessões', value: '3' },
      { label: 'Voltas', value: '40' },
      { label: 'Na pista', value: '2 h 05 min' },
      { label: 'Recordes', value: '1' },
    ]);
    expect(m.rows[0]).toMatchObject({
      name: 'Trial Mountain',
      car: 'Carro 7',
      best: '2:03.776',
      change: '−0.424 vs. recorde',
      tone: 'gain',
      goal: '',
    });
  });

  it('marks first times, slower weeks and the goal state', () => {
    const m = weeklyImageModel(
      week({
        tracks: [
          row({ firstTime: true, deltaMs: null, isRecord: false }),
          row({
            deltaMs: 300,
            isRecord: false,
            goal: { targetMs: 120_000, reached: false, remainingMs: 1500 },
          }),
          row({ deltaMs: 0, goal: { targetMs: 125_000, reached: true, remainingMs: 0 } }),
        ],
      }),
      f,
    );
    expect(m.rows[0]).toMatchObject({ change: 'primeira vez', tone: 'neutral' });
    expect(m.rows[1]).toMatchObject({
      change: '+0.300 do recorde',
      tone: 'loss',
      goal: 'faltam 1.500 para a meta',
    });
    expect(m.rows[2]!.goal).toBe('meta batida');
  });

  it('keeps five tracks and counts the rest; lists the goals reached', () => {
    const many = Array.from({ length: 7 }, (_, i) => row({ trackName: `Pista ${i}` }));
    const m = weeklyImageModel(
      week({
        tracks: many,
        goalsReached: [
          { trackId: 'T', trackName: 'Spa', carCode: null, targetMs: 140_000, achievedAt: 1 },
        ],
      }),
      f,
    );
    expect(m.rows).toHaveLength(5);
    expect(m.more).toBe(2);
    expect(m.goals).toEqual(['Meta batida: 2:20.000 em Spa']);
  });

  it('is empty for a week without sessions, and the card grows with its content', () => {
    const empty = weeklyImageModel(week({ sessions: 0, laps: 0, tracks: [], records: 0 }), f);
    expect(empty.empty).toBe(true);
    const one = weeklyImageModel(week(), f);
    const five = weeklyImageModel(week({ tracks: Array.from({ length: 5 }, () => row({})) }), f);
    expect(weeklyImageHeight(five)).toBeGreaterThan(weeklyImageHeight(one));
    expect(weeklyImageHeight(empty)).toBeLessThan(weeklyImageHeight(one) + 1);
  });
});
