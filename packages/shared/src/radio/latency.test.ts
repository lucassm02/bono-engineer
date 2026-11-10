import { describe, expect, it } from 'vitest';
import { radioHarness } from './testing.ts';

function approach() {
  const harness = radioHarness();
  harness.sim.speedKmh = 180;
  harness.sim.corners = [600];
  harness.sim.marks = [{ id: 'brake', cornerId: 'T1', kind: 'brake', atM: 600 }];
  return harness;
}

describe('compensação da saída de áudio', () => {
  it('starts a 100 m call 15 m earlier with a measured 300 ms delay at 180 km/h', () => {
    const local = approach();
    const remote = approach();
    local.run(12_000);
    remote.run(12_000, { outputLatencyMs: 300 });
    expect(local.said()).toEqual(['Freio em cem.']);
    expect(remote.said()).toEqual(local.said());
    const distance = (h: typeof local) =>
      h.engine.log.find((entry) => entry.ruleId === 'cornerCues' && entry.outcome === 'spoken')
        ?.distanceM;
    expect(distance(local)).toBe(500);
    expect(distance(remote)).toBe(485);
  });

  it('drops an instruction when the delay would deliver it after braking', () => {
    const remote = approach();
    remote.sim.dist = 580;
    remote.run(700, { outputLatencyMs: 500 });
    expect(remote.said()).toEqual([]);
  });

  it('stays silent when the driver is already braking', () => {
    const remote = approach();
    remote.sim.brake = 0.3;
    remote.run(12_000, { outputLatencyMs: 300 });
    expect(remote.said()).toEqual([]);
  });
});
