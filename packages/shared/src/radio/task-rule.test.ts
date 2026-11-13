import { describe, expect, it } from 'vitest';
import type { LiveTask } from '../tasks.ts';
import { REACTION_MS } from './cues.ts';
import { planTasks, TASK_MIN_GAP_M } from './task-rule.ts';
import { radioHarness } from './testing.ts';

const task = (id: string, atM: number[], keys = ['Foco.', 'Na T1, entrada.']): LiveTask => ({
  id,
  keys,
  atM,
  text: keys.join(' '),
  note: null,
});

/** A harness already on a timed lap (the out lap is over). */
function timedHarness(config: Parameters<typeof radioHarness>[0] = {}) {
  const h = radioHarness(config);
  h.sim.lap = 2;
  h.sim.lapValid = true;
  h.sim.dist = 100;
  return h;
}

describe('taskRule', () => {
  it('finishes the sentence at the point (speed, latency and reaction time included)', () => {
    const h = timedHarness();
    h.sim.tasks = [task('a', [1500])];
    let startDist = -1;
    let endDist = -1;
    h.sim.run(40_000, (frame) => {
      const out = h.engine.step(frame, { audio: 'ready' });
      if (out.speak) {
        startDist = frame.distanceM ?? -1;
        // the test clock says 1 s per key + 600 ms per extra key: 1.6 s for two keys
        endDist = startDist + (h.sim.speedKmh / 3.6) * 1.6;
        h.spoken.push(out.speak);
      }
    });
    expect(h.spoken).toHaveLength(1);
    const reactionM = (h.sim.speedKmh / 3.6) * (REACTION_MS / 1000);
    expect(endDist).toBeLessThanOrEqual(1500 - reactionM + 4);
    expect(endDist).toBeGreaterThan(1500 - reactionM - 120);
    expect(h.spoken[0]?.decision.evidence?.taskId).toBe('a');
  });

  it('says a task once per lap, and again on the next lap', () => {
    const h = timedHarness();
    h.sim.lengthM = 1200;
    h.sim.tasks = [task('a', [800])];
    h.run(60_000);
    const laps = new Set(h.spoken.map((s) => s.decision.lap));
    expect(h.spoken.length).toBe(laps.size);
    expect(laps.size).toBeGreaterThanOrEqual(3);
  });

  it('keeps the extras on the panel after the limit per lap', () => {
    const h = timedHarness({ tasks: { enabled: true, modes: ['training'], maxPerLap: 2 } });
    h.sim.tasks = [task('a', [700]), task('b', [1100]), task('c', [1700])];
    h.run(30_000);
    expect(h.spoken.map((s) => s.decision.evidence?.taskId)).toEqual(['a', 'b']);
    const panel = h.engine.log.filter((d) => d.ruleId === 'tasks' && d.outcome === 'panel');
    expect(panel.map((d) => d.evidence?.taskId)).toEqual(['c']);
  });

  it('does not say two tasks closer than the minimum gap: the older wins', () => {
    const plan = planTasks([task('old', [1000]), task('new', [1000 + TASK_MIN_GAP_M - 10])], 3000);
    expect(plan.map((p) => [p.taskId, p.speak])).toEqual([
      ['old', true],
      ['new', false],
    ]);
    expect(planTasks([task('a', [10]), task('b', [2990])], 3000).map((p) => p.speak)).toEqual([
      true,
      false,
    ]);
  });

  it('is silent on the out lap, when off, and in a mode without tasks', () => {
    const out = radioHarness();
    out.sim.dist = 100;
    out.sim.lap = 1;
    out.sim.lapValid = undefined;
    out.sim.tasks = [task('a', [1500])];
    out.run(30_000);
    expect(out.spoken).toHaveLength(0);

    const off = timedHarness({ tasks: { enabled: false, modes: ['training'], maxPerLap: 2 } });
    off.sim.tasks = [task('a', [1500])];
    off.run(30_000);
    expect(off.spoken).toHaveLength(0);

    const race = timedHarness({ mode: 'race' });
    race.sim.tasks = [task('a', [1500])];
    race.run(30_000);
    expect(race.spoken).toHaveLength(0);
  });

  it('also speaks on the timed lap of Classificação, because the driver approved it', () => {
    const h = timedHarness({ mode: 'qualifying' });
    h.sim.tasks = [task('a', [1500])];
    h.run(30_000);
    expect(h.spoken.length).toBeGreaterThanOrEqual(1);
  });

  it('never starts while braking or cornering', () => {
    const h = timedHarness();
    h.sim.tasks = [task('a', [1500])];
    h.sim.brake = 1;
    h.run(30_000);
    expect(h.spoken).toHaveLength(0);
  });

  it('only shows on the panel while the radio is muted', () => {
    const h = timedHarness({ speechLevel: 'mute' });
    h.sim.tasks = [task('a', [1500])];
    h.run(30_000);
    expect(h.spoken).toHaveLength(0);
    expect(h.engine.log.some((d) => d.ruleId === 'tasks' && d.outcome === 'panel')).toBe(true);
  });
});
