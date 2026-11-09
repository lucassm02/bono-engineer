import type { Lap, Session, Track } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { carFields, compactLap, compactSession } from './format.ts';

const lap = (carCode: number): Lap =>
  ({
    id: 'l1',
    number: 1,
    timeMs: 90_000,
    sectorTimesMs: [],
    valid: true,
    flags: [],
    isReference: false,
    carCode,
    sessionId: 's1',
    startedAt: 0,
  }) as unknown as Lap;

describe('car fields (catalogue names in MCP results)', () => {
  it('adds car_name and car_maker for catalogue cars and keeps the carCode', () => {
    expect(carFields(3337)).toEqual({ car: 3337, car_name: "A110 '17", car_maker: 'Alpine' });
  });

  it('keeps only the carCode for cars missing from the catalogue', () => {
    expect(carFields(999_999)).toEqual({ car: 999_999 });
  });

  it('is used by compact laps and sessions', () => {
    expect(compactLap(lap(3337))).toMatchObject({ car: 3337, car_name: "A110 '17" });
    expect(compactLap(lap(999_999))).not.toHaveProperty('car_name');
    const s = { id: 's1', startedAt: 0, carCode: 3337, mode: 'live', lapCount: 2, bestLapMs: 1 };
    const track = { id: 't', name: 'T' } as Track;
    expect(compactSession(s as unknown as Session, track)).toMatchObject({
      car: 3337,
      car_maker: 'Alpine',
    });
  });
});
