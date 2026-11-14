import { describe, expect, it } from 'vitest';
import type { Lap, SessionEvent } from './domain.ts';
import { deriveStints, pitVisits, stintOfLaps } from './stints.ts';

const lap = (n: number, startedAt: number, timeMs: number, valid = true): Lap =>
  ({ id: `l${n}`, number: n, startedAt, timeMs, valid }) as Lap;

const pit = (at: number, exitAt: number, lapNo = 3): SessionEvent => ({
  id: `p${at}`,
  sessionId: 's',
  at,
  kind: 'pit',
  lap: lapNo,
  distanceM: null,
  data: { exitAt },
});

describe('deriveStints', () => {
  it('a session without a visit is one stint', () => {
    const s = deriveStints(0, [lap(1, 0, 90_000), lap(2, 90_000, 88_000)], []);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ number: 1, lapCount: 2, bestLapMs: 88_000, endedAt: null });
  });

  it('a visit splits the laps by where they started', () => {
    const laps = [
      lap(1, 0, 90_000),
      lap(2, 90_000, 89_000),
      lap(4, 300_000, 91_000),
      lap(5, 391_000, 90_500),
    ];
    const s = deriveStints(0, laps, [pit(200_000, 260_000)]);
    expect(s.map((x) => x.lapIds)).toEqual([
      ['l1', 'l2'],
      ['l4', 'l5'],
    ]);
    expect(s[0]).toMatchObject({ endedAt: 200_000, pitMs: null });
    expect(s[1]).toMatchObject({ startedAt: 260_000, pitMs: 60_000, bestLapMs: 90_500 });
    expect([...stintOfLaps(s)]).toEqual([
      ['l1', 1],
      ['l2', 1],
      ['l4', 2],
      ['l5', 2],
    ]);
  });

  it('invalid laps do not enter the averages', () => {
    const s = deriveStints(0, [lap(1, 0, 90_000), lap(2, 1, 60_000, false), lap(3, 2, 92_000)], []);
    expect(s[0]).toMatchObject({
      lapCount: 3,
      validLapCount: 2,
      bestLapMs: 90_000,
      avgLapMs: 91_000,
    });
    expect(s[0]!.spreadMs).toBeNull();
  });

  it('a stint without laps is left out and the numbers stay consecutive', () => {
    const laps = [lap(1, 100_000, 90_000)];
    const s = deriveStints(0, laps, [pit(0, 50_000, 0), pit(300_000, 320_000)]);
    expect(s.map((x) => x.number)).toEqual([1]);
    expect(s[0]!.lapIds).toEqual(['l1']);
  });

  it('ignores malformed pit events', () => {
    const bad = { ...pit(10, 5) };
    expect(pitVisits([bad, { ...pit(1, 2), data: {} }])).toEqual([]);
  });
});
