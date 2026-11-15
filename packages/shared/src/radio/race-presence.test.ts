import { expect, it } from 'vitest';
import { positionSegment, RACE_FINISH_RECOVERY, RACE_FLAG, RACE_HELLO } from './phrases.ts';
import { racePresenceRule } from './race-presence.ts';
import { radioHarness } from './testing.ts';

function race(utteranceMs?: () => number) {
  const h = radioHarness(
    { mode: 'race' },
    {
      rules: [racePresenceRule],
      ...(utteranceMs ? { utteranceMs } : {}),
    },
  );
  h.sim.race = {
    state: 'racing',
    startedAt: h.sim.t,
    totalLaps: 4,
    position: 6,
    cars: 12,
    startPosition: 6,
    gained: 0,
    impacts: 0,
    lastChange: null,
  };
  return h;
}

it('greets once on a stationary grid, then cuts the call if the grid is released early', () => {
  const h = race();
  h.sim.lap = 0;
  h.sim.speedKmh = 0;
  h.sim.throttle = 0;
  h.sim.handBrake = true;
  h.run(400);
  expect(h.said()).toEqual([RACE_HELLO]);
  expect(h.spoken[0]?.decision.key).toBe('grid');
  h.sim.handBrake = false;
  expect(h.engine.step(h.sim.tick(), { audio: 'ready' }).stop).toBe(true);
  h.sim.lap = 1;
  h.sim.speedKmh = 100;
  h.run(15_000);
  expect(h.said()).toEqual([RACE_HELLO]);

  h.sim.race!.startedAt = h.sim.t;
  h.sim.lap = 0;
  h.sim.speedKmh = 0;
  h.sim.throttle = 0;
  h.sim.handBrake = true;
  h.run(400);
  expect(h.said()).toEqual([RACE_HELLO, RACE_HELLO]);
});

it('waits for sound, the end of the start phase and a clear straight', () => {
  const h = race();
  h.sim.lap = 0;
  h.sim.speedKmh = 0;
  h.sim.throttle = 0;
  h.sim.handBrake = true;
  h.run(800, { audio: 'wait' });
  h.sim.handBrake = false;
  h.sim.speedKmh = 72;
  h.sim.lap = 1;
  h.sim.lapStartT = h.sim.t;
  h.run(11_000, { audio: 'ready' });
  expect(h.said()).toEqual([]);
  h.sim.brake = 0.5;
  h.run(2000);
  expect(h.said()).toEqual([]);
  h.sim.brake = 0;
  h.run(2000);
  expect(h.said()).toEqual([RACE_HELLO]);
  expect(h.spoken[0]?.decision.key).toBe('driving');
});

it('fits the spoken greeting on a steady unmapped straight and cuts it under braking', () => {
  const h = race(() => 2700);
  h.sim.lap = 1;
  h.sim.lapStartT -= 12_000;
  h.sim.speedKmh = 72;
  h.run(1950);
  expect(h.said()).toEqual([]);
  h.run(150);
  expect(h.said()).toEqual([RACE_HELLO]);
  expect(h.spoken[0]?.decision.key).toBe('unmappedStraight');
  h.sim.brake = 0.5;
  expect(h.engine.step(h.sim.tick(), { audio: 'ready' }).stop).toBe(true);
});

it('calls the confirmed result once after the flag, without speaking in a replay or with stale data', () => {
  const h = race();
  h.sim.lap = 4;
  h.run(300, { audio: 'wait' });
  h.sim.race!.state = 'finished';
  h.sim.race!.position = 3;
  h.run(2000, { audio: 'ready' });
  expect(h.said()).toEqual([]);

  h.sim.race!.result = { at: h.sim.t, position: 5, gainedOnFinalLap: 1 };
  h.sim.state = 'replay';
  h.run(400);
  h.sim.state = 'menu';
  h.run(400, { sampleAgeMs: 500 });
  expect(h.said()).toEqual([]);
  h.run(4000, { sampleAgeMs: 0 });
  expect(h.said()).toEqual([[RACE_FLAG, positionSegment(5), RACE_FINISH_RECOVERY]]);
});
