import { describe, expect, it } from 'vitest';
import { GOAL_RESULT_MAX_AGE_MS, goalLapResult, goalRule } from './goal.ts';
import { GOOD_LAP, TO_GOAL, tenthsAmount } from './phrases.ts';

describe('goalLapResult', () => {
  it('says the distance to the goal in tenths', () => {
    const c = goalLapResult(4, 105_300, true, 105_000)!;
    expect(c.utterance).toEqual([TO_GOAL, tenthsAmount(3)]);
    expect(c.label).toContain('0,300');
    expect(c.panelOnly).toBeUndefined();
  });

  it('praises a lap at or under the goal', () => {
    expect(goalLapResult(5, 104_900, true, 105_000)!.utterance).toBe(GOOD_LAP);
    expect(goalLapResult(5, 105_000, true, 105_000)!.utterance).toBe(GOOD_LAP);
  });

  it('says nothing about an invalid lap', () => {
    expect(goalLapResult(6, 104_000, false, 105_000)).toBeNull();
  });

  it('caps long gaps with the existing second phrases', () => {
    expect(goalLapResult(7, 108_000, true, 105_000)!.utterance).toEqual([
      TO_GOAL,
      tenthsAmount(30),
    ]);
  });
});

describe('goalRule', () => {
  it('is a feedback rule for Treino and Classificação, with a bounded age', () => {
    expect(goalRule.id).toBe('goal');
    expect(goalRule.priority).toBe('feedback');
    expect(goalRule.modes).toEqual(['training', 'qualifying']);
    expect(GOAL_RESULT_MAX_AGE_MS).toBeGreaterThan(0);
  });
});
