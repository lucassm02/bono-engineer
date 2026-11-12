import type { DailyRace } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  formatRaceMinutes,
  leaderTimeText,
  matchSavedTrack,
  medalStatus,
  raceMinutes,
} from './dailies.ts';
import type { TrackOverview } from './history.ts';

const medals: NonNullable<DailyRace['medals']> = {
  platinum: { timeMs: 119_685, percentPlayers: 0.04 },
  gold: { timeMs: 122_662, percentPlayers: 15.86 },
  silver: { timeMs: 125_044, percentPlayers: 34.41 },
  bronze: { timeMs: 130_998, percentPlayers: 41.97 },
};

function saved(name: string, layout: string | null, laps = 5): TrackOverview {
  return {
    id: name + layout,
    name,
    layout,
    lengthM: 5000,
    source: 'builtin',
    needsName: false,
    createdAt: 1,
    thumb: null,
    sessionCount: 1,
    lapCount: laps,
    validLapCount: laps,
    lastActivityAt: null,
    best: null,
    cars: [],
    referenceCount: 0,
    bestReferenceMs: null,
    trend: { kind: 'none', deltaMs: null, carCode: null },
  };
}

describe('medalStatus', () => {
  it('names the medal reached and the gap to the next one', () => {
    expect(medalStatus(124_856, medals)).toEqual({
      reached: 'silver',
      next: { medal: 'gold', gapMs: 2_194 },
    });
    expect(medalStatus(122_000, medals)).toMatchObject({
      reached: 'gold',
      next: { medal: 'platinum' },
    });
    expect(medalStatus(119_000, medals)).toEqual({ reached: 'platinum', next: null });
  });

  it('points to bronze when slower than every medal', () => {
    expect(medalStatus(140_000, medals)).toEqual({
      reached: null,
      next: { medal: 'bronze', gapMs: 9_002 },
    });
  });
});

describe('race schedule', () => {
  it('lists the minutes past the hour', () => {
    expect(raceMinutes(20, 10)).toEqual([10, 30, 50]);
    expect(raceMinutes(30, 0)).toEqual([0, 30]);
    expect(raceMinutes(30, null)).toEqual([0, 30]);
    expect(raceMinutes(null, null)).toEqual([]);
    expect(formatRaceMinutes([10, 30, 50])).toBe(':10 :30 :50');
  });
});

describe('leaderTimeText', () => {
  it('writes the time the way the capture form reads it', () => {
    expect(leaderTimeText(119_089)).toBe('1:59.089');
    expect(leaderTimeText(59_950)).toBe('0:59.950');
  });
});

describe('matchSavedTrack', () => {
  it('finds the same layout by the catalogue names', () => {
    const race = { trackName: 'Trial Mountain Circuit', trackLayoutId: '802508' };
    const trial = saved('Trial Mountain Circuit', null);
    const suzuka = saved('Suzuka Circuit', 'East Course');
    expect(matchSavedTrack(race, [suzuka, trial])?.id).toBe(trial.id);
  });

  it('does not mix up two layouts of the same circuit', () => {
    const east = { trackName: 'Suzuka Circuit – East Course', trackLayoutId: '4414cb' };
    const full = saved('Suzuka Circuit', 'Full Course', 30);
    const eastSaved = saved('Suzuka Circuit', 'East Course', 3);
    expect(matchSavedTrack(east, [full, eastSaved])?.layout).toBe('East Course');
  });

  it('returns null when the pilot never drove it', () => {
    expect(
      matchSavedTrack({ trackName: 'Dragon Trail – Gardens', trackLayoutId: null }, [
        saved('Suzuka Circuit', 'East Course'),
      ]),
    ).toBeNull();
  });
});
