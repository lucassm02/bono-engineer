import { describe, expect, it } from 'vitest';
import {
  attentionCornerSegment,
  PACE_FASTER,
  PACE_RECOVERED,
  PACE_SLOWER,
  PACE_STABLE,
  RACE_CORNER_FOCUS,
  RACE_FINAL_LAP,
} from './phrases.ts';
import { raceFeedbackRule, raceFinalLapRule } from './race-feedback.ts';
import { radioHarness } from './testing.ts';

function stint() {
  const h = radioHarness({ mode: 'race' }, { rules: [raceFeedbackRule] });
  h.sim.lap = 2;
  h.sim.lengthM = 1000;
  h.sim.speedKmh = 180;
  const lap = (ms: number, splits: number[] = []) => {
    h.sim.nextLapMs = ms;
    h.sim.sectors = splits.length
      ? [...splits, null].map((timeMs, index) => ({
          index,
          timeMs,
          status: timeMs === null ? 'pending' : 'sessionBest',
          deltaMs: null,
        }))
      : [];
    h.run(20_000);
  };
  return { ...h, lap };
}

describe('feedback de corrida', () => {
  it('reports a pace change in a four-lap race when several sectors agree', () => {
    const h = stint();
    h.sim.totalLaps = 4;
    h.lap(129_400, [41_500, 38_000]);
    expect(h.said()).toEqual([]);
    h.lap(124_800, [39_500, 37_100]);
    h.run(200);
    expect(h.said()).toEqual([PACE_FASTER]);
    expect(h.spoken[0]?.decision.evidence).toMatchObject({ lap: 3, supportingSectors: 3 });
  });

  it('keeps a short race quiet about pace when only one sector changed', () => {
    const h = stint();
    h.sim.totalLaps = 4;
    h.lap(90_000, [30_000, 30_000]);
    h.lap(91_000, [31_000, 30_000]);
    h.run(200);
    expect(h.said()).toEqual([]);
  });

  it('confirms two laps of lost pace and two laps of recovery', () => {
    const h = stint();
    for (const ms of [90_100, 89_900, 90_000, 91_000]) h.lap(ms);
    expect(h.said()).toEqual([]);
    h.lap(91_100);
    h.run(200);
    expect(h.said()).toEqual([PACE_SLOWER]);
    h.lap(90_050);
    h.lap(90_000);
    h.run(200);
    expect(h.said()).toEqual([PACE_SLOWER, PACE_RECOVERED]);
  });

  it('calls the repeated loss at one corner even without a reference lap', () => {
    const h = stint();
    h.sim.reviews = [
      {
        cornerId: 'T3',
        atM: 400,
        make: (lap) => ({ referenceLapId: null, zoneTimeMs: lap <= 4 ? 3000 : 3300 }),
      },
    ];
    for (const ms of [90_020, 90_005, 89_985, 90_080, 90_060, 90_050, 90_090]) h.lap(ms);
    h.run(200);
    expect(h.said()).toEqual([[attentionCornerSegment(3), RACE_CORNER_FOCUS]]);
  });

  it('acknowledges three consistent laps once, after halfway in a long race', () => {
    const h = stint();
    h.sim.totalLaps = 12;
    for (const ms of [90_000, 90_050, 89_990, 90_070]) h.lap(ms);
    expect(h.said()).toEqual([]);
    h.lap(90_080);
    h.run(200);
    expect(h.said()).toEqual([PACE_STABLE]);
    for (const ms of [90_100, 89_980, 90_050]) h.lap(ms);
    expect(h.said()).toEqual([PACE_STABLE]);
  });

  it('does not take one slow lap or an invalid lap as a trend', () => {
    const h = stint();
    for (const ms of [90_100, 89_900, 90_000]) h.lap(ms);
    h.sim.nextLapValid = false;
    h.lap(91_000);
    h.sim.nextLapValid = true;
    h.lap(91_100);
    h.lap(91_150);
    h.run(200);
    expect(h.said()).toEqual([]);
  });
});

it('says the final lap once in a clear window of a confirmed race', () => {
  const h = radioHarness({ mode: 'race' }, { rules: [raceFinalLapRule] });
  h.sim.totalLaps = 4;
  h.sim.lap = 4;
  h.run(100);
  expect(h.said()).toEqual([]); // a lap limit alone does not confirm a race
  h.sim.race = {
    state: 'racing',
    totalLaps: 4,
    position: 5,
    cars: 16,
    startPosition: 4,
    gained: -1,
    impacts: 0,
    lastChange: null,
  };
  h.sim.brake = 0.8;
  h.run(2000);
  expect(h.said()).toEqual([]);
  h.sim.brake = 0;
  h.run(5000);
  expect(h.said()).toEqual([RACE_FINAL_LAP]);
});
