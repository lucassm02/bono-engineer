import { expect, it } from 'vitest';
import {
  positionSegment,
  RACE_FINISH_RECOVERY,
  RACE_FLAG,
  RACE_HELLO,
  RACE_WELL_DONE,
} from './phrases.ts';
import { racePresenceRule } from './race-presence.ts';
import { effectiveRadioMode, normalizeRadioPreferences } from './settings.ts';
import { radioHarness } from './testing.ts';

function race(config: Parameters<typeof radioHarness>[0] = { mode: 'race' }) {
  const h = radioHarness(config, { rules: [racePresenceRule] });
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

it('greets on the first racing frame, including a rolling start', () => {
  const h = race();
  h.sim.lap = 0;
  h.sim.speedKmh = 72;
  h.run(50);
  expect(h.said()).toEqual([RACE_HELLO]);
  h.run(16_000);
  expect(h.said()).toEqual([RACE_HELLO]);

  h.sim.race = { ...h.sim.race!, startedAt: h.sim.t };
  h.sim.lap = 0;
  h.sim.speedKmh = 0;
  h.run(50);
  expect(h.said()).toEqual([RACE_HELLO, RACE_HELLO]);
});

it('can greet on the start line when audio becomes ready at the crossing', () => {
  const h = race();
  h.sim.lap = 0;
  h.sim.dist = h.sim.lengthM - 1;
  h.sim.speedKmh = 0;
  h.run(3000, { audio: 'wait' });
  h.sim.speedKmh = 100;
  h.run(50, { audio: 'ready' });
  expect(h.sim.lap).toBe(1);
  expect(h.said()).toEqual([RACE_HELLO]);
});

it('does not greet late on the first lap or after attaching mid-race', () => {
  const h = race();
  h.sim.lapStartT -= 15_000;
  h.sim.lap = 1;
  h.run(15_000);
  expect(h.said()).toEqual([]);
  h.sim.race = { ...h.sim.race!, startedAt: h.sim.t };
  h.sim.lap = 2;
  h.run(5000);
  expect(h.said()).toEqual([]);
});

it('calls the position at the flag even under braking and ignores a later results change', () => {
  const h = race();
  h.sim.lap = 4;
  h.run(300);
  const at = h.sim.t + h.sim.dtMs;
  h.sim.race = {
    ...h.sim.race!,
    state: 'finished',
    position: 5,
    chequered: { at, position: 5, gainedOnFinalLap: 1 },
  };
  h.sim.brake = 0.8;
  h.run(50);
  expect(h.said()).toEqual([[RACE_FLAG, positionSegment(5), RACE_FINISH_RECOVERY]]);
  expect(h.spoken[0]?.decision.t).toBe(at);
  h.run(4000);
  h.sim.state = 'menu';
  h.sim.race = { ...h.sim.race!, result: { at: h.sim.t, position: 4 } };
  h.run(4000);
  expect(h.said()).toHaveLength(1);
});

it('does not play the result late or in a replay', () => {
  const h = race();
  h.sim.lap = 4;
  h.sim.state = 'replay';
  h.sim.race = {
    ...h.sim.race!,
    state: 'finished',
    chequered: { at: h.sim.t, position: 5 },
  };
  h.run(1500);
  h.sim.state = 'menu';
  h.sim.race = { ...h.sim.race!, result: { at: h.sim.t, position: 5 } };
  h.run(2000);
  expect(h.said()).toEqual([]);
});

it('automatically uses race through the flag and falls back to training without saving over the manual mode', () => {
  const prefs = normalizeRadioPreferences({ mode: 'qualifying', autoMode: true });
  const h = race({ mode: prefs.mode, autoMode: prefs.autoMode });
  h.sim.lap = 0;
  h.run(50);
  expect(h.spoken[0]?.decision.mode).toBe('race');
  h.sim.race = { ...h.sim.race!, state: 'finished', chequered: { at: h.sim.t, position: null } };
  h.run(50);
  expect(h.said()).toEqual([RACE_HELLO, [RACE_FLAG, RACE_WELL_DONE]]);
  expect(effectiveRadioMode(prefs, false)).toBe('training');
  expect(effectiveRadioMode({ ...prefs, autoMode: false }, false)).toBe('qualifying');
  expect(h.engine.config.mode).toBe('qualifying');
});
