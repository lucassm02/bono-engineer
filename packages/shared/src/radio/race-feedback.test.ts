import { describe, expect, it } from 'vitest';
import { cornerSegment, PACE_FASTER, PACE_SLOWER, RACE_CORNER_FOCUS } from './phrases.ts';
import { raceFeedbackRule } from './race-feedback.ts';
import { radioHarness } from './testing.ts';

function stint() {
  const h = radioHarness({ mode: 'race' }, { rules: [raceFeedbackRule] });
  h.sim.lap = 2;
  h.sim.lengthM = 1000;
  h.sim.speedKmh = 180;
  const lap = (ms: number) => {
    h.sim.nextLapMs = ms;
    h.run(20_000);
  };
  return { ...h, lap };
}

describe('feedback de corrida', () => {
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
    expect(h.said()).toEqual([PACE_SLOWER, PACE_FASTER]);
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
    expect(h.said()).toEqual([[cornerSegment(3), RACE_CORNER_FOCUS]]);
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
