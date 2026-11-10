import { describe, expect, it } from 'vitest';
import type { LiveFrame } from '../live.ts';
import { RadioEngine } from './engine.ts';
import {
  brakePhrase,
  FUEL_LAPS,
  FUEL_SHORT,
  IMPROVED,
  TYRES_COLD,
  tenthsSegment,
} from './phrases.ts';
import { DEFAULT_RADIO_PREFERENCES, radioEngineConfig } from './settings.ts';
import { radioHarness as harness, RadioSim, simUtteranceMs } from './testing.ts';
import type { RadioStepEnv } from './types.ts';

const ENV: RadioStepEnv = { audio: 'ready' };

describe('seleção e prioridade', () => {
  it('speaks one utterance at a time: strategy before instruction, the other when free', () => {
    const h = harness({ mode: 'race' });
    h.sim.temps = [50, 50, 50, 50];
    h.sim.totalLaps = 10;
    h.sim.lap = 5;
    h.sim.fuel.perLapAvg = 3;
    h.sim.fuel.level = 10;
    h.run(5000);
    expect(h.said()).toEqual([FUEL_SHORT, TYRES_COLD]);
    const [fuel, tyres] = h.spoken.map((s) => s.decision);
    expect(fuel!.priority).toBe('strategy');
    expect(tyres!.priority).toBe('instruction');
    // The second one waited for the radio, then for its own utterance to fit.
    expect(tyres!.t - fuel!.t).toBeGreaterThanOrEqual(simUtteranceMs(FUEL_SHORT));
  });

  it('a critical alert goes first and needs no free window', () => {
    const h = harness({ mode: 'race' });
    h.sim.corners = [100, 400, 700, 1000, 1300, 1600, 1900, 2200, 2500, 2800];
    h.sim.temps = [50, 50, 50, 50];
    h.sim.fuel.perLapAvg = 3;
    h.sim.fuel.level = 2; // < 1 lap
    h.run(4000);
    expect(h.said()).toEqual([FUEL_LAPS[0]]);
    expect(h.outcomes('tyresWarmUp')).toEqual([]); // still pending: no free window
  });

  it('keeps a stable order for ties (registry order, then key)', () => {
    const run = () => {
      const h = harness({ mode: 'race' });
      h.sim.temps = [50, 50, 50, 50];
      h.sim.fuel.perLapAvg = 3;
      h.sim.fuel.level = 8;
      h.run(8000);
      return h.said();
    };
    expect(run()).toEqual([FUEL_LAPS[2], TYRES_COLD]);
    expect(run()).toEqual(run());
  });
});

describe('janela de fala', () => {
  it('waits for a free window before an alert and drops it if the condition ends', () => {
    const h = harness();
    h.sim.speedKmh = 200;
    h.sim.corners = [400];
    h.sim.temps = [50, 50, 50, 50];
    h.run(3200); // ~178 m: T1 braking zone is near → no window
    expect(h.said()).toEqual([]);
    h.run(9000); // through T1 (lateral load) and out onto the straight
    expect(h.said()).toEqual([TYRES_COLD]);
    const at = h.spoken[0]!.decision.distanceM!;
    expect(at).toBeGreaterThan(400 + 150);
  });

  it('braking or cornering blocks the alert; it is discarded when it expires', () => {
    const h = harness();
    h.sim.temps = [50, 50, 50, 50];
    h.sim.brake = 0.4;
    h.run(4000);
    h.sim.temps = [80, 80, 80, 80]; // warmed up while braking: nothing left to say
    h.run(1000);
    expect(h.said()).toEqual([]);
    expect(h.outcomes('tyresWarmUp')).toEqual([['discarded', 'sem janela livre']]);
  });

  it('a call that would end after its point is not spoken', () => {
    const h = harness({}, { utteranceMs: (u) => (u === TYRES_COLD ? 1000 : 4000) });
    h.sim.speedKmh = 250;
    h.sim.marks = [{ id: 'b1', cornerId: 'T1', kind: 'brakeHard', atM: 900 }];
    h.run(15_000);
    expect(h.said().some((u) => typeof u === 'string' && u.startsWith('Freada forte'))).toBe(false);
  });

  it('an urgent braking call replaces a tip that is still playing', () => {
    const h = harness({}, { utteranceMs: (u) => (u === TYRES_COLD ? 1800 : 1000) });
    h.sim.speedKmh = 250;
    h.sim.temps = [50, 50, 50, 50];
    h.sim.marks = [{ id: 'b1', cornerId: 'T1', kind: 'brakeHard', atM: 412 }];
    h.run(6000);
    expect(h.said()).toEqual([TYRES_COLD, brakePhrase('brakeHard', 100)]);
    expect(h.spoken[1]).toMatchObject({
      interrupt: true,
      decision: { reason: 'substituiu tyresWarmUp' },
    });
  });

  it('without local playback, Mudo or a missing clip, the decision stays on the panel', () => {
    for (const [config, env, reason] of [
      [{ speechLevel: 'mute' }, ENV, 'mudo'],
      [{}, { audio: 'off' }, 'sem áudio local'],
    ] as const) {
      const h = harness(config);
      h.sim.temps = [50, 50, 50, 50];
      let panel: string | undefined;
      h.sim.run(4000, (f) => {
        panel = h.engine.step(f, env).panel?.label ?? panel;
      });
      expect(h.said()).toEqual([]);
      expect(h.outcomes('tyresWarmUp')).toEqual([['panel', reason]]);
      expect(panel).toBe('Pneus frios · 50 · 50 · 50 · 50 °C');
    }
    const h = harness({}, { utteranceMs: () => null });
    h.sim.temps = [50, 50, 50, 50];
    h.run(4000);
    expect(h.outcomes('tyresWarmUp')).toEqual([['panel', 'sem clipe de áudio']]);
  });

  it('holds speech while audio waits (menu open) and speaks when it is ready', () => {
    const h = harness();
    h.sim.temps = [50, 50, 50, 50];
    h.run(5000, { audio: 'wait' });
    expect(h.said()).toEqual([]);
    h.run(200, { audio: 'ready' });
    expect(h.said()).toEqual([TYRES_COLD]);
  });
});

describe('validação e contexto', () => {
  it('suspends on a stale sample, drops pending items and resumes', () => {
    const h = harness();
    h.sim.temps = [50, 50, 50, 50];
    h.sim.brake = 0.5;
    h.run(4000);
    const out = h.engine.step(h.sim.tick(), { audio: 'ready', sampleAgeMs: 900 });
    expect(out.suspended).toBe('amostra velha');
    expect(h.outcomes('tyresWarmUp')).toEqual([['discarded', 'amostra velha']]);
    h.sim.brake = 0;
    h.run(2000, { sampleAgeMs: 0 });
    expect(h.said()).toEqual([]); // the persistence window restarted
    h.run(2000);
    expect(h.said()).toEqual([TYRES_COLD]);
  });

  it('pause or a frame gap stops the call and clears pending items', () => {
    const h = harness({}, { utteranceMs: () => 1500 });
    h.sim.temps = [50, 50, 50, 50];
    h.run(3100);
    expect(h.said()).toEqual([TYRES_COLD]);
    h.sim.state = 'paused';
    const paused = h.engine.step(h.sim.tick(), ENV);
    expect(paused).toMatchObject({ stop: true, suspended: 'pausa', speak: null });
    h.sim.state = 'onTrack';
    h.run(1000);
    h.sim.t += 2000; // signal lost for 2 s
    const gap = h.engine.step(h.sim.tick(), ENV);
    expect(gap.speak).toBeNull();
    expect(h.said()).toEqual([TYRES_COLD]); // what was said is kept
  });

  it('a context change (session, car, mode) resets the rules and discards pending items', () => {
    const h = harness();
    h.sim.temps = [50, 50, 50, 50];
    h.run(4000);
    expect(h.said()).toEqual([TYRES_COLD]);
    h.sim.brake = 0.5;
    h.sim.sessionId = 's2';
    h.run(4000);
    expect(h.said()).toEqual([TYRES_COLD]); // pending: braking
    h.sim.carCode = 7;
    h.run(100);
    expect(h.outcomes('tyresWarmUp').at(-1)).toEqual(['discarded', 'mudança de contexto']);
    h.sim.brake = 0;
    h.run(4000);
    expect(h.said()).toEqual([TYRES_COLD, TYRES_COLD]);
    h.engine.configure(radioEngineConfig({ ...DEFAULT_RADIO_PREFERENCES, mode: 'race' }));
    h.run(4000);
    expect(h.said()).toEqual([TYRES_COLD, TYRES_COLD, TYRES_COLD]);
  });

  it('a track or session id that appears mid-run is not a context change', () => {
    const h = harness();
    h.sim.trackId = null;
    h.sim.sessionId = null;
    h.sim.temps = [50, 50, 50, 50];
    h.run(4000);
    h.sim.trackId = 'trk';
    h.sim.sessionId = 's1';
    h.run(4000);
    expect(h.said()).toEqual([TYRES_COLD]);
  });

  it('unknown phase → quietest: only critical alerts', () => {
    const h = harness({ mode: 'race' });
    h.sim.lapValid = undefined;
    h.sim.temps = [50, 50, 50, 50];
    h.sim.fuel.perLapAvg = 3;
    h.sim.fuel.level = 5;
    h.run(5000);
    expect(h.said()).toEqual([]);
    h.sim.fuel.level = 2;
    h.run(5000);
    expect(h.said()).toEqual([FUEL_LAPS[0]]);
  });
});

describe('Treino', () => {
  const brakeRun = (
    level: 'essential' | 'detailed',
    profile = DEFAULT_RADIO_PREFERENCES.trainingProfile,
  ) => {
    const h = harness({ speechLevel: level, trainingProfile: profile });
    h.sim.speedKmh = 250;
    h.sim.throttle = 0; // lifted: the coast call applies
    h.sim.marks = [
      { id: 'b1', cornerId: 'T1', kind: 'brakeHard', atM: 600 },
      { id: 'c1', cornerId: 'T1', kind: 'coast', atM: 700, untilM: 800 },
    ];
    h.run(12_000);
    return h;
  };

  it('keeps the corner calls as the default profile (Aprender pista)', () => {
    const h = brakeRun('essential');
    // The closest braking mark that still fits (current behaviour of engineerCall).
    expect(h.said()).toEqual([brakePhrase('brakeHard', 100)]);
    expect(h.spoken[0]).toMatchObject({
      cueId: expect.stringMatching(/^b1@/),
      decision: { cornerId: 'T1', priority: 'instruction' },
    });
  });

  it('Detalhado adds the pedal calls; Essencial keeps one call per corner', () => {
    expect(brakeRun('detailed').said()).toEqual([brakePhrase('brakeHard', 100), 'Deixa rolar.']);
  });

  it('limits the calls per corner pass by level', () => {
    const run = (level: 'essential' | 'detailed') => {
      const h = harness({ speechLevel: level });
      h.sim.speedKmh = 250;
      h.sim.marks = [
        { id: 'b1', cornerId: 'T1', kind: 'brakeHard', atM: 600 },
        { id: 'b2', cornerId: 'T1', kind: 'brake', atM: 1000 },
      ];
      h.run(18_000);
      return h.outcomes('cornerCues').filter(([outcome]) => outcome === 'spoken').length;
    };
    expect(run('essential')).toBe(1);
    expect(run('detailed')).toBe(2);
  });

  it('Livre plays only the essential car alerts', () => {
    const h = harness({ speechLevel: 'detailed', trainingProfile: 'free' });
    h.sim.speedKmh = 250;
    h.sim.temps = [50, 50, 50, 50];
    h.sim.marks = [{ id: 'b1', cornerId: 'T1', kind: 'brakeHard', atM: 1200 }];
    h.run(12_000);
    expect(h.said()).toEqual([TYRES_COLD]);
    expect(h.engine.log.some((d) => d.ruleId === 'cornerCues')).toBe(false);
  });

  it('the focused corners filter the calls (corner training)', () => {
    const h = harness();
    h.sim.speedKmh = 250;
    h.sim.marks = [{ id: 'b1', cornerId: 'T1', kind: 'brakeHard', atM: 600 }];
    h.run(12_000, { focusCornerIds: ['T2'] });
    expect(h.said()).toEqual([]);
  });
});

describe('Classificação', () => {
  /** Out lap with cold tyres, then flying laps; T1 starts 150 m after the line. */
  function qualifying() {
    const h = harness({ mode: 'qualifying' });
    h.sim.lengthM = 3000;
    h.sim.corners = [150, 1500];
    h.sim.speedKmh = 180;
    h.sim.lap = 0;
    h.sim.lapValid = false;
    h.sim.dist = 1700;
    h.sim.nextLapValid = true;
    h.sim.temps = [52, 55, 50, 53];
    return h;
  }

  it('warns about cold tyres on the out lap', () => {
    const h = qualifying();
    h.run(9000);
    expect(h.said()).toEqual([TYRES_COLD]);
    expect(h.spoken[0]!.decision).toMatchObject({ phase: 'outLap', lap: 0 });
  });

  it('keeps silent on the fast lap except critical alerts', () => {
    const h = harness({ mode: 'qualifying' });
    h.sim.lapValid = true; // joined on a timed lap
    h.sim.lap = 2;
    h.sim.temps = [50, 50, 50, 50];
    h.sim.fuel.perLapAvg = 3;
    h.sim.fuel.level = 5;
    h.run(10_000);
    expect(h.said()).toEqual([]);
    h.sim.fuel.level = 2;
    h.run(5000);
    expect(h.said()).toEqual([FUEL_LAPS[0]]);
    h.sim.temps = [80, 80, 80, 80];
    h.run(1000);
    expect(h.outcomes('tyresWarmUp')).toEqual([['discarded', 'volta rápida']]);
  });

  it('gives the result after the line in the first free window, even with a corner right after it', () => {
    const h = qualifying();
    h.sim.temps = [80, 80, 80, 80];
    h.run(30_000); // out lap → first timed lap starts at the line
    h.sim.bestLapMs = 92_500;
    h.sim.dist = 2950;
    h.sim.nextLapMs = 92_300;
    const before = h.spoken.length;
    let crossedAt: number | null = null;
    h.sim.run(12_000, (f) => {
      if (crossedAt === null && f.lap.lap === 2) crossedAt = f.t;
      const out = h.engine.step(f, ENV);
      if (out.speak) h.spoken.push(out.speak);
    });
    const result = h.spoken.slice(before);
    expect(result.map((s) => s.utterance)).toEqual([[IMPROVED, tenthsSegment(2)]]);
    // Not in the braking zone or inside T1: after T1 (150 m + 150 m of cornering).
    expect(result[0]!.decision.distanceM).toBeGreaterThanOrEqual(300);
    expect(result[0]!.decision.phase).toBe('timedLap');
    expect(result[0]!.decision.t - crossedAt!).toBeLessThan(20_000);
  });

  it('drops the result when no free window comes in time', () => {
    const h = qualifying();
    h.sim.temps = [80, 80, 80, 80];
    h.run(30_000);
    h.sim.bestLapMs = 92_500;
    h.sim.dist = 2950;
    h.sim.nextLapMs = 92_300;
    h.sim.brake = 0.3; // braking the whole time
    h.run(25_000);
    expect(h.outcomes('lapResult')).toEqual([['discarded', 'sem janela livre']]);
  });
});

describe('Corrida sem referência', () => {
  it('works without a reference lap or opponent data: autonomy and tyres only', () => {
    const h = harness({ mode: 'race' });
    h.sim.engineerStatus = 'waitingReference';
    h.sim.totalLaps = null; // race length unknown
    h.sim.temps = [50, 50, 50, 50];
    h.sim.fuel.perLapAvg = 2.5;
    h.sim.fuel.level = 6;
    h.run(10_000);
    expect(h.said()).toEqual([FUEL_LAPS[2], TYRES_COLD]);
    expect(new Set(h.engine.log.map((d) => d.ruleId))).toEqual(new Set(['fuel', 'tyresWarmUp']));
    expect(h.engine.log.every((d) => d.referenceLapId === null)).toBe(true);
  });

  it('suppresses the fuel call with an old sample and announces the change once it is fresh', () => {
    const h = harness({ mode: 'race' });
    h.sim.fuel.perLapAvg = 3;
    h.sim.fuel.level = 5;
    h.run(10_000, { sampleAgeMs: 600 });
    expect(h.said()).toEqual([]);
    h.run(5000, { sampleAgeMs: 30 });
    expect(h.said()).toEqual([FUEL_LAPS[1]]);
  });
});

describe('determinismo', () => {
  function scenario(): LiveFrame[] {
    const sim = new RadioSim();
    const frames: LiveFrame[] = [];
    const take = (ms: number) => sim.run(ms, (f) => frames.push(f));
    sim.corners = [150, 900, 1800];
    sim.marks = [
      { id: 'b1', cornerId: 'T2', kind: 'brakeHard', atM: 800 },
      { id: 'r1', cornerId: 'T2', kind: 'releaseSmooth', atM: 860 },
    ];
    sim.lap = 0;
    sim.lapValid = false;
    sim.nextLapValid = true;
    sim.temps = [50, 52, 49, 51];
    sim.fuel.perLapAvg = 3;
    sim.fuel.level = 9;
    take(20_000);
    sim.temps = [85, 85, 85, 85];
    sim.fuel.level = 4;
    take(70_000);
    sim.state = 'paused';
    take(1000);
    sim.state = 'onTrack';
    take(30_000);
    return frames;
  }

  it('replaying the same frames with the same config gives the same decision log', () => {
    const frames = scenario();
    const replay = (mode: 'training' | 'qualifying' | 'race') => {
      const engine = new RadioEngine({
        utteranceMs: simUtteranceMs,
        config: radioEngineConfig({ ...DEFAULT_RADIO_PREFERENCES, mode, level: 'detailed' }),
      });
      for (const frame of frames) engine.step(frame, ENV);
      return engine.log;
    };
    for (const mode of ['training', 'qualifying', 'race'] as const) {
      const first = replay(mode);
      expect(first.length).toBeGreaterThan(1);
      expect(replay(mode)).toEqual(first);
    }
  });
});
