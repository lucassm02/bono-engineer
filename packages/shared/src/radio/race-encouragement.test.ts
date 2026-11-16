import { expect, it } from 'vitest';
import { RACE_POSITION_RECOVERY } from './phrases.ts';
import { raceEncouragementRule } from './race-encouragement.ts';
import { radioHarness } from './testing.ts';

function race(raceEncouragement = true) {
  const h = radioHarness({ mode: 'race', raceEncouragement }, { rules: [raceEncouragementRule] });
  h.sim.lap = 2;
  h.sim.lengthM = 20_000;
  h.sim.speedKmh = 90;
  h.sim.race = {
    state: 'racing',
    startedAt: h.sim.t - 60_000,
    totalLaps: 10,
    position: 4,
    startPosition: 4,
    cars: 12,
    gained: 0,
    impacts: 0,
    lastChange: null,
  };
  h.run(100);
  const impact = () => {
    h.sim.race = { ...h.sim.race!, lastImpactAt: h.sim.t };
    h.run(100);
  };
  const losePosition = () => {
    const from = h.sim.race!.position!;
    h.sim.race = {
      ...h.sim.race!,
      position: from + 1,
      lastChange: { at: h.sim.t, from, to: from + 1 },
    };
    h.run(100);
  };
  return { ...h, impact, losePosition };
}

it('handles a confirmed loss after an impact only when there is a safe window', () => {
  const h = race();
  h.losePosition();
  expect(h.said()).toEqual([]);
  h.impact(); // an impact after the last loss is not evidence for it
  expect(h.said()).toEqual([]);
  h.sim.brake = 0.8;
  h.losePosition();
  expect(h.said()).toEqual([]);
  h.sim.brake = 0;
  h.run(200);
  expect(h.said()).toEqual([RACE_POSITION_RECOVERY]);
});

it('uses a high-confidence traction event from the same lap', () => {
  const h = race();
  h.sim.publish('T3', {
    reviewedAt: h.sim.t,
    event: {
      id: 'traction',
      kind: 'exitTraction',
      phase: 'exit',
      settledM: 800,
      startM: 750,
      endM: 790,
      throttle: 0.9,
      message: '',
      action: '',
    },
  });
  h.run(100);
  h.losePosition();
  expect(h.said()).toEqual([RACE_POSITION_RECOVERY]);
  expect(h.spoken[0]?.decision.evidence?.error).toBe('exitTraction');
});

it('respects the option, a minute between calls and two calls per attempt across mode changes', () => {
  const h = race(false);
  h.impact();
  h.losePosition();
  expect(h.said()).toEqual([]);
  h.engine.configure({ ...h.engine.config, raceEncouragement: true });
  h.impact();
  h.losePosition();
  h.impact();
  h.losePosition();
  expect(h.said()).toEqual([RACE_POSITION_RECOVERY]);
  h.run(60_000);
  h.impact();
  h.losePosition();
  expect(h.said()).toHaveLength(2);
  h.engine.configure({ ...h.engine.config, mode: 'training' });
  h.run(200);
  h.engine.configure({ ...h.engine.config, mode: 'race' });
  h.run(60_000);
  h.impact();
  h.losePosition();
  expect(h.said()).toHaveLength(2);
});
