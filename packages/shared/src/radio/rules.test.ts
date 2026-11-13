import { describe, expect, it } from 'vitest';
import {
  FUEL_LAPS,
  FUEL_SHORT,
  IMPROVED,
  SAME_TIME,
  TYRES_COLD,
  TYRES_HOT,
  TYRES_OK,
  tenthsSegment,
} from './phrases.ts';
import {
  DEFAULT_RADIO_PREFERENCES,
  normalizeRadioPreferences,
  radioEngineConfig,
} from './settings.ts';
import { radioHarness as harness } from './testing.ts';

describe('preferências do rádio', () => {
  it('defaults to Treino · Essencial · Aprender pista, summary on demand and praise off', () => {
    expect(normalizeRadioPreferences(null)).toEqual({
      mode: 'training',
      level: 'essential',
      trainingProfile: 'learnTrack',
      learningBrakePercent: false,
      summary: 'onDemand',
      praise: false,
      consistencyTargetMs: null,
      tasksEnabled: true,
      taskModes: ['training', 'qualifying'],
      taskMaxPerLap: 2,
    });
  });

  it('migrates the old detail field and drops unknown values', () => {
    expect(normalizeRadioPreferences({ detail: 'full' }).level).toBe('detailed');
    expect(normalizeRadioPreferences({ detail: 'essential' }).level).toBe('essential');
    expect(normalizeRadioPreferences({ detail: 'full', level: 'essential' }).level).toBe(
      'essential',
    );
    expect(
      normalizeRadioPreferences({
        mode: 'race',
        trainingProfile: 'free',
        learningBrakePercent: true,
        summary: 'lap',
        praise: true,
        consistencyTargetMs: 95_000.4,
      }),
    ).toEqual({
      mode: 'race',
      level: 'essential',
      trainingProfile: 'free',
      learningBrakePercent: true,
      summary: 'lap',
      praise: true,
      consistencyTargetMs: 95_000,
      tasksEnabled: true,
      taskModes: ['training', 'qualifying'],
      taskMaxPerLap: 2,
    });
    expect(normalizeRadioPreferences({ consistencyTargetMs: 5 }).consistencyTargetMs).toBeNull();
    expect(normalizeRadioPreferences({ mode: 'drift', summary: 'always', praise: 'yes' })).toEqual(
      DEFAULT_RADIO_PREFERENCES,
    );
  });

  it('Mudo is a separate switch that keeps the chosen level', () => {
    const prefs = { ...DEFAULT_RADIO_PREFERENCES, level: 'detailed' as const };
    expect(radioEngineConfig(prefs, { muted: true }).speechLevel).toBe('mute');
    expect(radioEngineConfig(prefs).speechLevel).toBe('detailed');
  });
});

describe('pneus frios', () => {
  it('warns once after the cold persists, with hysteresis near the limit', () => {
    const h = harness();
    h.sim.temps = [55, 58, 52, 54];
    h.run(2900);
    expect(h.said()).toEqual([]);
    h.run(400);
    expect(h.said()).toEqual([TYRES_COLD]);
    // Oscillating around the bottom of the ideal window (70 °C) never repeats the warning.
    for (let i = 0; i < 10; i++) {
      h.sim.temps = [69, 71, 70, 69];
      h.run(1000);
      h.sim.temps = [72, 71, 73, 71];
      h.run(1000);
    }
    expect(h.said()).toEqual([TYRES_COLD]);
  });

  it('says "Pneus na faixa" only with Detalhado, after the tyres stabilize', () => {
    const essential = harness();
    const detailed = harness({ speechLevel: 'detailed' });
    for (const h of [essential, detailed]) {
      h.sim.temps = [50, 50, 50, 50];
      h.run(4000);
      h.sim.temps = [80, 80, 80, 80];
      h.run(4000);
      expect(h.said()).toEqual([TYRES_COLD]);
      h.run(2000);
    }
    expect(essential.said()).toEqual([TYRES_COLD]);
    expect(detailed.said()).toEqual([TYRES_COLD, TYRES_OK]);
  });

  it('keeps silent when the tyres reach the range before the warning', () => {
    const h = harness();
    h.sim.temps = [60, 60, 60, 60];
    h.run(1000);
    h.sim.temps = [80, 80, 80, 80];
    h.run(3000);
    h.sim.temps = [60, 60, 60, 60];
    h.run(10_000);
    expect(h.said()).toEqual([]);
  });

  it('without a validated range shows the values on the panel only', () => {
    const h = harness({ tyreScaleValidated: false });
    h.sim.temps = [45, 48, 40, 42];
    let label = '';
    h.sim.run(5000, (f) => {
      label = h.engine.step(f, { audio: 'ready' }).panel?.label ?? label;
    });
    expect(h.said()).toEqual([]);
    expect(label).toBe('Pneus 45 · 48 · 40 · 42 °C · faixa não validada');
    expect(h.outcomes('tyresWarmUp')).toEqual([['panel', 'somente painel']]);
  });

  it('re-arms after a long stop (pits) but not after a short one', () => {
    const h = harness();
    h.sim.temps = [50, 50, 50, 50];
    h.run(4000);
    h.sim.speedKmh = 0;
    h.run(5000);
    h.sim.speedKmh = 150;
    h.run(4000);
    expect(h.said()).toEqual([TYRES_COLD]);
    h.sim.speedKmh = 0;
    h.run(16_000);
    h.sim.speedKmh = 150;
    h.run(4000);
    expect(h.said()).toEqual([TYRES_COLD, TYRES_COLD]);
  });

  it('is suppressed without plausible temperatures (menu zeros)', () => {
    const h = harness();
    h.sim.temps = [0, 0, 0, 0];
    h.run(5000);
    expect(h.said()).toEqual([]);
    expect(h.outcomes('tyresWarmUp')).toEqual([['suppressed', 'sem tyreTemps']]);
  });
});

describe('pneus quentes', () => {
  it('warns only when the heat persists, once per episode, with hysteresis and interval', () => {
    const h = harness();
    h.sim.temps = [118, 110, 100, 100];
    h.run(15_000);
    h.sim.temps = [112, 110, 100, 100]; // short dip, still above hot − 8 °C
    h.run(1000);
    h.sim.temps = [118, 110, 100, 100];
    h.run(15_000);
    expect(h.said()).toEqual([]); // the dip reset the persistence
    h.run(6000);
    expect(h.said()).toEqual([TYRES_HOT]);
    h.sim.temps = [109, 105, 100, 100]; // within the hysteresis band: same episode
    h.run(20_000);
    h.sim.temps = [118, 110, 100, 100];
    h.run(30_000);
    expect(h.said()).toEqual([TYRES_HOT]);
    h.sim.temps = [100, 100, 95, 95]; // cools for real: episode over
    h.run(12_000);
    h.sim.temps = [118, 110, 100, 100];
    h.run(25_000);
    expect(h.said()).toEqual([TYRES_HOT]); // new episode, but inside the 3 min interval
    h.run(180_000);
    expect(h.said()).toEqual([TYRES_HOT, TYRES_HOT]);
  });
});

describe('combustível', () => {
  it('with the race length: warns once when the projection goes short', () => {
    const h = harness({ mode: 'race' });
    h.sim.totalLaps = 10;
    h.sim.lap = 5;
    h.sim.fuel.perLapAvg = 3;
    h.sim.fuel.level = 30; // ~6 laps left × 3 L = 18 L: enough
    h.run(5000);
    expect(h.said()).toEqual([]);
    h.sim.fuel.level = 10;
    h.run(2000);
    expect(h.said()).toEqual([]); // confirmation window
    h.run(2000);
    expect(h.said()).toEqual([FUEL_SHORT]);
    h.run(30_000);
    expect(h.said()).toEqual([FUEL_SHORT]);
    const decision = h.spoken[0]!.decision;
    expect(decision.evidence).toMatchObject({
      levelL: 10,
      perLapL: 3,
      neededL: expect.any(Number),
    });
    expect(decision.label).toMatch(/^Combustível: faltam \d+,?\.?\d* L · economize/);
  });

  it('without the race length: autonomy only, at 5, 2, 1 and < 1 lap', () => {
    const h = harness({ mode: 'race' });
    h.sim.fuel.perLapAvg = 3;
    h.sim.fuel.level = 20; // 6.7 laps: nothing yet
    h.run(5000);
    expect(h.said()).toEqual([]);
    h.sim.fuel.level = 16; // 5.3 laps
    h.run(4000);
    h.sim.fuel.level = 11; // 3.7: no call between 5 and 2
    h.run(4000);
    h.sim.fuel.level = 8; // 2.7 laps
    h.run(4000);
    h.sim.fuel.level = 5; // 1.7
    h.run(4000);
    h.sim.fuel.level = 2; // 0.7
    h.run(4000);
    expect(h.said()).toEqual([FUEL_LAPS[5], FUEL_LAPS[2], FUEL_LAPS[1], FUEL_LAPS[0]]);
    expect(h.spoken.map((s) => s.decision.priority)).toEqual([
      'strategy',
      'strategy',
      'strategy',
      'critical',
    ]);
    expect(h.said()).not.toContain(FUEL_SHORT);
  });

  it('does not say "five laps" when the tank starts below five, and says it again after a refuel', () => {
    const h = harness({ mode: 'race' });
    h.sim.fuel.perLapAvg = 3;
    h.sim.fuel.level = 11; // 3.7 laps
    h.run(5000);
    expect(h.said()).toEqual([]);
    h.sim.fuel.level = 5; // 1.7
    h.run(4000);
    h.sim.fuel.level = 40; // refuelled
    h.run(4000);
    h.sim.fuel.level = 16; // 5.3 laps again
    h.run(4000);
    expect(h.said()).toEqual([FUEL_LAPS[1], FUEL_LAPS[5]]);
  });

  it('stays silent without consumption (Sport Mode time trial: 100/100)', () => {
    const h = harness();
    h.sim.fuel = { ...h.sim.fuel, level: 100, capacity: 100, perLapAvg: null };
    h.run(10_000);
    h.sim.fuel.perLapAvg = 0;
    h.run(10_000);
    expect(h.said()).toEqual([]);
    expect(h.outcomes('fuel')).toEqual([['suppressed', 'sem fuel']]);
  });
});

describe('resultado da volta', () => {
  it('announces the gain against the best lap before it', () => {
    const h = harness({ mode: 'qualifying' });
    h.sim.lapValid = true;
    h.sim.bestLapMs = 92_500;
    h.sim.dist = 2800;
    h.sim.nextLapMs = 92_300;
    h.run(5000);
    expect(h.said()).toEqual([[IMPROVED, tenthsSegment(2)]]);
    expect(h.spoken[0]!.decision).toMatchObject({
      ruleId: 'lapResult',
      label: 'Volta 1:32,300 · −0,200 s',
      evidence: { lapMs: 92_300, bestBeforeMs: 92_500, gainMs: 200 },
    });
    h.sim.dist = 2800;
    h.sim.nextLapMs = 92_400;
    h.run(5000);
    expect(h.said()[1]).toEqual(['Perdeu', 'um décimo.']);
    h.sim.dist = 2800;
    h.sim.nextLapMs = 92_300;
    h.run(5000);
    expect(h.said()[2]).toBe(SAME_TIME);
  });

  it('keeps invalid and first laps on the panel', () => {
    const h = harness({ mode: 'qualifying' });
    h.sim.lapValid = false;
    h.sim.bestLapMs = 92_500;
    h.sim.dist = 2800;
    h.sim.nextLapMs = 91_000;
    h.run(5000);
    expect(h.said()).toEqual([]);
    expect(h.engine.log.find((d) => d.ruleId === 'lapResult')).toMatchObject({
      outcome: 'panel',
      label: 'Volta 1:31,000 · inválida',
    });
  });
});
