import { describe, expect, it } from 'vitest';
import type { LiveDrill, LiveDrillPass, LiveFrame } from '../live.ts';
import { DRILL_RESULT_MAX_AGE_MS, drillPassCandidate, drillRule } from './drill.ts';
import {
  cornerSegment,
  IMPROVED,
  LOST,
  tenthsAmount,
  utteranceKeys,
  YOU_IMPROVED_HERE,
} from './phrases.ts';
import { radioHarness } from './testing.ts';
import type { RadioRuleContext } from './types.ts';

const pass = (n: number, timeMs: number): LiveDrillPass => ({
  n,
  timeMs,
  entrySpeedKmh: 120,
  minSpeedKmh: 70,
  exitSpeedKmh: 110,
  brakePointM: 90,
  at: n * 1000,
});

describe('drillPassCandidate', () => {
  it('keeps the first pass on the panel (nothing to compare with)', () => {
    const c = drillPassCandidate('T7', pass(1, 3600), null);
    expect(c.panelOnly).toBe(true);
    expect(c.utterance).toEqual([]);
    expect(c.label).toContain('passagem 1');
  });

  it('says the gain in tenths after a clearly better pass', () => {
    const c = drillPassCandidate('T7', pass(3, 3180), pass(2, 3421));
    expect(utteranceKeys(c.utterance)).toEqual([cornerSegment(7), IMPROVED, tenthsAmount(2)]);
    expect(c.needsFreeWindow).toBe(true);
  });

  it('says "você melhorou" when the gain is under a tenth but beyond the noise', () => {
    const c = drillPassCandidate('T7', pass(3, 3385), pass(2, 3421));
    expect(utteranceKeys(c.utterance)).toEqual([cornerSegment(7), YOU_IMPROVED_HERE]);
  });

  it('says what was lost after a clearly worse pass, but only from a tenth up', () => {
    const worse = drillPassCandidate('T7', pass(3, 3750), pass(2, 3421));
    expect(utteranceKeys(worse.utterance)).toEqual([cornerSegment(7), LOST, tenthsAmount(3)]);
    const barely = drillPassCandidate('T7', pass(3, 3455), pass(2, 3421));
    expect(barely.panelOnly).toBe(true);
  });

  it('stays quiet on the same time, and drops the corner name when it has no clip', () => {
    expect(drillPassCandidate('T7', pass(3, 3425), pass(2, 3421)).panelOnly).toBe(true);
    const odd = drillPassCandidate('Chicane', pass(3, 3100), pass(2, 3421));
    expect(utteranceKeys(odd.utterance)).toEqual([IMPROVED, tenthsAmount(3)]);
  });
});

describe('the engine during a corner drill', () => {
  const drillOf = (passes: LiveDrillPass[]): LiveDrill => ({
    cornerId: 'T7',
    cornerName: null,
    startedAt: 100,
    phase: 'away',
    distanceToEntryM: 500,
    passes,
    count: passes.length,
    best: null,
    targetMs: null,
    referenceBrakeM: null,
  });

  it('speaks the pass result in Corrida too, because the drill is a mode of its own', () => {
    const h = radioHarness({ mode: 'race' });
    h.sim.corners = [2800]; // the next corner is far: the radio has a free window
    h.sim.drill = drillOf([pass(1, 3600)]);
    h.run(2000, { drill: true });
    expect(h.said()).toEqual([]); // the first pass has nothing to compare with
    h.sim.drill = drillOf([pass(1, 3600), pass(2, 3380)]);
    h.run(3000, { drill: true });
    expect(h.said().map((u) => utteranceKeys(u))).toEqual([
      [cornerSegment(7), IMPROVED, tenthsAmount(2)],
    ]);
  });

  it('stays silent about the drill when it is not on', () => {
    const h = radioHarness({ mode: 'race' });
    h.sim.drill = drillOf([pass(1, 3600), pass(2, 3380)]);
    h.run(3000);
    expect(h.said()).toEqual([]);
  });

  it('does not say the lap results of the mode while drilling', () => {
    const h = radioHarness({ mode: 'training', trainingProfile: 'gainTime', summary: 'lap' });
    h.sim.lengthM = 600;
    h.sim.speedKmh = 200;
    h.sim.drill = drillOf([pass(1, 3600)]);
    h.run(60_000, { drill: true });
    expect(h.said()).toEqual([]);
  });
});

describe('drillRule', () => {
  const drillOf = (passes: LiveDrillPass[], startedAt = 100): LiveDrill => ({
    cornerId: 'T7',
    cornerName: null,
    startedAt,
    phase: 'away',
    distanceToEntryM: 500,
    passes,
    count: passes.length,
    best: null,
    targetMs: null,
    referenceBrakeM: null,
  });
  const ctx = (drill: LiveDrill | undefined, t: number): RadioRuleContext =>
    ({ frame: { drill } as LiveFrame, t }) as RadioRuleContext;

  it('declares itself as a Treino rule that runs during a drill', () => {
    expect(drillRule.drill).toBe(true);
    expect(drillRule.modes).toEqual(['training']);
  });

  it('talks once per new pass, comparing with the best pass before it', () => {
    const s = drillRule.init();
    expect(drillRule.evaluate(ctx(undefined, 0), s)).toEqual([]);
    const first = drillRule.evaluate(ctx(drillOf([pass(1, 3600)]), 10), s);
    expect(first[0]!.panelOnly).toBe(true);
    drillRule.delivered?.(first[0]!, s, ctx(undefined, 10));
    expect(drillRule.evaluate(ctx(drillOf([pass(1, 3600)]), 20), s)).toEqual([]);

    const second = drillRule.evaluate(ctx(drillOf([pass(1, 3600), pass(2, 3400)]), 30), s);
    expect(utteranceKeys(second[0]!.utterance)).toEqual([
      cornerSegment(7),
      IMPROVED,
      tenthsAmount(2),
    ]);
    drillRule.delivered?.(second[0]!, s, ctx(undefined, 30));

    // slower than the best (3400), not just than the previous one
    const third = drillRule.evaluate(
      ctx(drillOf([pass(1, 3600), pass(2, 3400), pass(3, 3700)]), 40),
      s,
    );
    expect(utteranceKeys(third[0]!.utterance)).toEqual([cornerSegment(7), LOST, tenthsAmount(3)]);
  });

  it('drops a result that waited too long for a free window', () => {
    const s = drillRule.init();
    const d = drillOf([pass(1, 3600), pass(2, 3300)]);
    expect(drillRule.evaluate(ctx(d, 0), s)).toHaveLength(1);
    expect(drillRule.evaluate(ctx(d, DRILL_RESULT_MAX_AGE_MS + 1), s)).toEqual([]);
  });

  it('starts over with a new drill and when the drill ends', () => {
    const s = drillRule.init();
    drillRule.evaluate(ctx(drillOf([pass(1, 3000), pass(2, 2900)]), 0), s);
    // a new drill (other startedAt) begins at pass 1 with no best: the first pass is panel-only
    const again = drillRule.evaluate(ctx(drillOf([pass(1, 3600)], 999), 5), s);
    expect(again[0]!.panelOnly).toBe(true);
    expect(drillRule.evaluate(ctx(undefined, 6), s)).toEqual([]);
  });
});
