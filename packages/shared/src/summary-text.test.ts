import { describe, expect, it } from 'vitest';
import type { SessionSummary } from './analysis.ts';
import { suggestionText, summaryToText } from './summary-text.ts';

const SUMMARY: SessionSummary = {
  sessionId: 's1',
  trackId: 't1',
  carCode: 1,
  startedAt: 0,
  endedAt: 60_000,
  durationMs: 60_000,
  laps: { total: 6, valid: 5, invalid: 1 },
  reduced: false,
  best: {
    lapId: 'l3',
    lapNumber: 3,
    timeMs: 100_100,
    previousBestMs: 100_500,
    deltaMs: -400,
    firstTime: false,
  },
  pace: {
    top5AvgMs: 100_440,
    medianMs: 100_300,
    fastestMs: 100_100,
    slowestMs: 101_200,
    spreadMs: 1100,
    histogram: [],
  },
  consistency: { stdDevMs: 420, trend: 'steady', slopeMsPerLap: 10 },
  comparisons: { lastSession: null, bestSession: null, goal: null },
  corners: null,
  suggestions: [
    {
      code: 'cornerLoss',
      text: 'A {0} perdeu {1} s contra a sua melhor volta anterior: comece por ela.',
      values: ['T7', '0,31'],
    },
  ],
};

const FORMAT = { lapTime: (ms: number) => `T${ms}`, delta: (ms: number) => `D${ms}` };

describe('summaryToText', () => {
  it('writes the facts of the summary as plain text', () => {
    const text = summaryToText(SUMMARY, { ...FORMAT, trackName: 'Suzuka' });
    expect(text.split('\n')).toEqual([
      'Sessão · Suzuka',
      'Voltas: 6 (5 válidas, 1 inválidas)',
      'Melhor volta: T100100 (D-400 vs. recorde anterior)',
      'Ritmo: média das 5 melhores T100440, mediana T100300',
      'Regularidade: desvio de 0,420 s',
      '• A T7 perdeu 0,31 s contra a sua melhor volta anterior: comece por ela.',
    ]);
  });

  it('says it is the first time on the track instead of inventing a delta', () => {
    const first = { ...SUMMARY, best: { ...SUMMARY.best!, deltaMs: null, firstTime: true } };
    expect(summaryToText(first, FORMAT)).toContain(
      'Melhor volta: T100100 (primeira vez nesta pista)',
    );
  });

  it('goes through the translator when one is given', () => {
    const seen: string[] = [];
    const text = summaryToText(SUMMARY, {
      ...FORMAT,
      translate: (m, ...v) => {
        seen.push(m);
        return `[${m.replace(/\{(\d+)\}/g, (_, i) => String(v[Number(i)]))}]`;
      },
    });
    expect(seen).toContain('Voltas: {0} ({1} válidas, {2} inválidas)');
    expect(text).toContain('[Voltas: 6 (5 válidas, 1 inválidas)]');
  });
});

describe('suggestionText', () => {
  it('fills the placeholders', () => {
    expect(suggestionText(SUMMARY.suggestions[0]!)).toBe(
      'A T7 perdeu 0,31 s contra a sua melhor volta anterior: comece por ela.',
    );
  });
});
