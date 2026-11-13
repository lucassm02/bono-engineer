import { describe, expect, it } from 'vitest';
import type { WeeklySummary, WeeklyTrackRow } from './analysis.ts';
import { formatDriving, weeklyToText } from './weekly-text.ts';

const iso = (ms: number) => new Date(ms).toISOString();
const fmt = {
  lapTime: (ms: number) =>
    `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`,
  delta: (ms: number) => `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)}`,
  date: (ms: number) => `${iso(ms).slice(8, 10)}/${iso(ms).slice(5, 7)}`,
  car: (c: number) => `Carro ${c}`,
};

const row = (o: Partial<WeeklyTrackRow>): WeeklyTrackRow => ({
  trackId: 'T',
  trackName: 'Trial Mountain',
  carCode: 7,
  sessions: 2,
  laps: 20,
  validLaps: 18,
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
  fromMs: Date.UTC(2026, 10, 5),
  toMs: Date.UTC(2026, 10, 12),
  sessions: 3,
  laps: 40,
  validLaps: 36,
  drivingMs: 125 * 60_000,
  tracks: [row({})],
  records: 1,
  goalsReached: [],
  ...o,
});

describe('weeklyToText', () => {
  it('writes the header, the totals, the record and one line per track', () => {
    const text = weeklyToText(week(), fmt);
    expect(text.split('\n')).toEqual([
      'Minha semana no Bono · 05/11 a 11/11',
      '3 sessões · 40 voltas (36 válidas) · 2 h 05 min na pista',
      '1 recorde pessoal',
      '',
      '• Trial Mountain (Carro 7): 2:03.776 (−0.424 contra o recorde anterior)',
    ]);
  });

  it('says first time, slower, the goal and the goals reached', () => {
    const text = weeklyToText(
      week({
        records: 0,
        goalsReached: [
          {
            trackId: 'T',
            trackName: 'Trial Mountain',
            carCode: null,
            targetMs: 124_000,
            achievedAt: 1,
          },
        ],
        tracks: [
          row({
            trackName: 'Spa',
            firstTime: true,
            deltaMs: null,
            isRecord: false,
            previousBestMs: null,
          }),
          row({
            trackName: 'Suzuka',
            deltaMs: 300,
            isRecord: false,
            goal: { targetMs: 120_000, reached: false, remainingMs: 1500 },
          }),
        ],
      }),
      fmt,
    );
    expect(text).toContain('• Meta batida: 2:04.000 em Trial Mountain');
    expect(text).toContain('• Spa (Carro 7): 2:03.776 (primeira vez)');
    expect(text).toContain(
      '• Suzuka (Carro 7): 2:03.776 (+0.300 do recorde anterior) · faltam 1.500 para a meta',
    );
    expect(text).not.toContain('recorde pessoal');
  });

  it('handles an empty week and uses the translator', () => {
    expect(weeklyToText(week({ sessions: 0, laps: 0, tracks: [], records: 0 }), fmt)).toBe(
      'Minha semana no Bono · 05/11 a 11/11\nNenhuma volta nesta semana.',
    );
    const en = weeklyToText(week(), {
      ...fmt,
      translate: (m, ...v) =>
        m
          .replace('Minha semana no Bono', 'My week in Bono')
          .replace(/\{(\d+)\}/g, (_, i) => String(v[Number(i)])),
    });
    expect(en.startsWith('My week in Bono · 05/11 a 11/11')).toBe(true);
  });

  it('formats the time on track', () => {
    expect(formatDriving(35 * 60_000)).toBe('35 min');
    expect(formatDriving(125 * 60_000)).toBe('2 h 05 min');
  });
});
