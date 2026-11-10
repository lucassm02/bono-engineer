/**
 * Acceptance of the Treino profiles (spec do engenheiro de rádio): Aprender pista, Ganhar tempo,
 * Consistência, driving events on the radio and "Resumo e elogios", with the deterministic sim.
 */

import { describe, expect, it } from 'vitest';
import type { LiveCornerCause, LiveCornerPass, LiveDrivingEventCall } from '../live.ts';
import { REACTION_MS } from './cues.ts';
import {
  ADHERENCE,
  brakePhrase,
  CAUSE_ACTIONS,
  CAUSE_FOCUS,
  CAUSE_WORDS,
  cornerSegment,
  EVENT_ACTIONS,
  EVENT_WORDS,
  fromCornerSegment,
  GOOD_LAP,
  gearSegment,
  LIFT_THROTTLE,
  ONE_SECOND,
  tenthsSegment,
  toCornerSegment,
  VARIATION,
  YOU_IMPROVED,
} from './phrases.ts';
import { learnPassRight } from './rules.ts';
import type { RadioEngineConfig } from './settings.ts';
import { radioHarness } from './testing.ts';
import type { RadioStepEnv } from './types.ts';

type Harness = ReturnType<typeof radioHarness>;

/** Steps the engine until the sim reaches lap `lap` (+ `extraMs`), with the given env. */
function runToLap(h: Harness, lap: number, env: RadioStepEnv = { audio: 'ready' }, extraMs = 0) {
  while (h.sim.lap < lap) step(h, env);
  const end = h.sim.t + extraMs;
  while (h.sim.t < end) step(h, env);
}

function step(h: Harness, env: RadioStepEnv) {
  const out = h.engine.step(h.sim.tick(), env);
  if (out.speak) h.spoken.push(out.speak);
}

const spokenBy = (h: Harness, ruleId: string) =>
  h.engine.log.filter((d) => d.ruleId === ruleId && d.outcome === 'spoken');

const cause = (kind: LiveCornerCause['kind'], extra: Partial<LiveCornerCause> = {}) =>
  ({
    kind,
    confidence: 'medium',
    costMs: 400,
    message: `Na causa ${kind}`,
    evidence: {},
    ...extra,
  }) satisfies LiveCornerCause;

const event = (extra: Partial<LiveDrivingEventCall> = {}): LiveDrivingEventCall => ({
  id: 'frontLock:T4:1000',
  kind: 'frontLock',
  phase: 'braking',
  settledM: 1180,
  startM: 980,
  endM: 1020,
  throttle: 0,
  message: 'Travamento dianteiro na T4',
  action: 'Alivie o pico do freio e solte aos poucos enquanto vira.',
  ...extra,
});

/** 3000 m lap at 200 km/h (54 s), corners T1–T4; reviews ~80 m after each exit. */
function training(
  profile: RadioEngineConfig['trainingProfile'],
  config: Partial<RadioEngineConfig> = {},
) {
  const h = radioHarness({ trainingProfile: profile, ...config });
  h.sim.speedKmh = 200;
  h.sim.corners = [400, 1000, 1600, 2200];
  h.sim.cornerM = 120;
  return h;
}

describe('Aprender pista', () => {
  /** T1 brake mark at 600 m, 250 km/h; each pass of T1 reviewed at 830 m. */
  function learn(make: (lap: number) => Partial<LiveCornerPass> | null = () => ({})) {
    const h = radioHarness();
    h.sim.speedKmh = 250;
    h.sim.corners = [600];
    h.sim.marks = [{ id: 'b1', cornerId: 'T1', kind: 'brakeHard', atM: 600 }];
    h.sim.reviews = [{ cornerId: 'T1', atM: 830, make }];
    return h;
  }
  const callsByLap = (h: Harness) => {
    const laps = new Map<number, number>();
    for (const d of spokenBy(h, 'cornerCues')) laps.set(d.lap, (laps.get(d.lap) ?? 0) + 1);
    return laps;
  };

  it.each([false, true])('uses the selected brake format in Essencial (percent=%s)', (percent) => {
    const h = learn();
    h.sim.speedKmh = 150;
    h.sim.marks = [{ id: 'b1', cornerId: 'T1', kind: 'brakeLight', atM: 600, brakePeak: 0.3 }];
    h.engine.configure({ ...h.engine.config, learningBrakePercent: percent });
    runToLap(h, 2);
    expect(spokenBy(h, 'cornerCues').map((call) => call.utterance)).toEqual([
      percent ? ['trinta por cento de freio', 'em cem metros.'] : brakePhrase('brakeLight', 100),
    ]);
  });

  it('warns ahead of the brake point: the call ends a reaction time before it', () => {
    const h = learn();
    runToLap(h, 2);
    const call = spokenBy(h, 'cornerCues')[0]!;
    expect(call.utterance).toBe(brakePhrase('brakeHard', 100));
    const speed = 250 / 3.6;
    const atPointT = call.t + ((600 - call.distanceM!) / speed) * 1000;
    expect(call.t + call.durationMs! + REACTION_MS).toBeLessThanOrEqual(atPointT + 1);
  });

  it('reduces the calls at a corner done right repeatedly, and a miss brings them back', () => {
    const miss = 6;
    const h = learn((lap) => (lap === miss ? { brakePointM: 540 } : {}));
    runToLap(h, 9);
    const laps = callsByLap(h);
    // Laps 1–3 right → mastered: called on every third pass (lap 6); the miss on lap 6 → lap 7, 8.
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((lap) => laps.get(lap) ?? 0)).toEqual([
      1, 1, 1, 0, 0, 1, 1, 1,
    ]);
    const note = h.engine.log.find((d) => d.key.startsWith('mastered:'))!;
    expect(note).toMatchObject({ outcome: 'panel', lap: 3 });
    expect(note.label).toMatch(/T1 acertada 3 vezes/);
  });

  it('keeps the help on the corners where the driver re-enabled it', () => {
    const h = learn();
    runToLap(h, 7, { audio: 'ready', assistCornerIds: ['T1'] });
    expect([1, 2, 3, 4, 5, 6].map((lap) => callsByLap(h).get(lap) ?? 0)).toEqual([
      1, 1, 1, 1, 1, 1,
    ]);
  });

  it('discards a late warning: the point passed while the audio was held', () => {
    const h = learn();
    h.sim.dist = 300;
    runToLap(h, 1, { audio: 'wait' }, 6000); // passes the brake point with the audio held
    runToLap(h, 1, { audio: 'ready' }, 3000);
    expect(spokenBy(h, 'cornerCues')).toEqual([]);
    expect(h.outcomes('cornerCues')).toContainEqual(['discarded', 'áudio em espera']);
  });

  it('calls the gear when the last pass missed only the gear, one instruction per pass', () => {
    const h = learn((lap) => (lap === 1 ? { gearAtApex: 2 } : {}));
    runToLap(h, 3);
    const lap2 = h.spoken.filter((s) => s.decision.lap === 2);
    expect(lap2.map((s) => s.utterance)).toEqual([[cornerSegment(1), gearSegment(3)]]);
    expect(h.outcomes('cornerCues')).toContainEqual(['discarded', 'limite da curva']);
  });

  it('without a compatible reference: no brake point, the panel asks for a first valid lap', () => {
    for (const status of ['waitingReference', 'incompatible'] as const) {
      const h = learn();
      h.sim.marks = [];
      h.sim.engineerStatus = status;
      runToLap(h, 3);
      expect(h.said()).toEqual([]);
      const notes = h.engine.log.filter((d) => d.ruleId === 'learnReference');
      expect(notes.map((d) => d.outcome)).toEqual(['panel']);
      expect(notes[0]!.label).toMatch(/primeira volta válida/);
    }
  });

  it('judges a pass right by the brake point (replay tolerance) and the gear', () => {
    const pass = {
      referenceBrakePointM: 500,
      timeLostMs: 300,
      brakePointM: 512,
      gearAtApex: 3,
      referenceGearAtApex: 3,
      referenceIsReplay: false,
    } as LiveCornerPass;
    expect(learnPassRight(pass)).toBe(false);
    expect(learnPassRight({ ...pass, referenceIsReplay: true })).toBe(true);
    expect(learnPassRight({ ...pass, brakePointM: 505, gearAtApex: 2 })).toBe(false);
    expect(learnPassRight({ ...pass, referenceBrakePointM: null })).toBeNull();
  });
});

describe('Ganhar tempo', () => {
  const T4_CORRECTION = [cornerSegment(4), CAUSE_WORDS.heldBrake, CAUSE_ACTIONS.heldBrake];

  /**
   * T4 per lap: 1 clean, 2 isolated (minor), 3–6 the same held brake (recurring). T2 on lap 3: a
   * clear isolated cause (high), on the same lap as the T4 correction.
   */
  function gainTime(config: Partial<RadioEngineConfig> = {}, isolated = true) {
    const h = training('gainTime', config);
    h.sim.reviews = [
      {
        cornerId: 'T2',
        atM: 1200,
        make: (lap) =>
          isolated && lap === 3
            ? { timeLostMs: 450, cause: cause('brakeEarly', { confidence: 'high' }) }
            : {},
      },
      {
        cornerId: 'T4',
        atM: 2400,
        make: (lap) =>
          lap === 1 ? {} : { timeLostMs: 860, cause: cause('heldBrake', { costMs: 837 }) },
      },
    ];
    return h;
  }

  it('silence on the clean pass and on a minor one; the recurring cause gets one action', () => {
    const h = gainTime({}, false);
    runToLap(h, 3);
    expect(h.said()).toEqual([]);
    const review = h.engine.log.filter((d) => d.ruleId === 'cornerCorrection');
    expect(review.map((d) => [d.lap, d.outcome, d.evidence?.review])).toEqual([
      [2, 'panel', 'ocorrência menor'],
    ]);
    runToLap(h, 4);
    expect(spokenBy(h, 'cornerCorrection').map((d) => d.utterance)).toEqual([T4_CORRECTION]);
  });

  it('one action at a time: one correction per lap, not repeated on the next lap', () => {
    const h = gainTime();
    runToLap(h, 7);
    const spoken = spokenBy(h, 'cornerCorrection');
    // Lap 3: T2 (isolated, clear) speaks first; T4 waits for the next allowed lap.
    expect(spoken.map((d) => [d.lap, d.cornerId])).toEqual([
      [3, 'T2'],
      [4, 'T4'],
      [6, 'T4'],
    ]);
    const lap3T4 = h.engine.log.find(
      (d) => d.ruleId === 'cornerCorrection' && d.lap === 3 && d.cornerId === 'T4',
    );
    expect(lap3T4?.evidence?.review).toBe('uma ação por volta');
    const lap5 = h.engine.log.find(
      (d) => d.ruleId === 'cornerCorrection' && d.lap === 5 && d.cornerId === 'T4',
    );
    expect(lap5?.evidence?.review).toBe('falado na volta anterior');
    // Spoken after the corner, on the straight (free window), never in braking or cornering.
    for (const d of spoken) {
      const entry = h.sim.corners[Number(d.cornerId!.slice(1)) - 1]!;
      expect(d.distanceM!).toBeGreaterThan(entry + h.sim.cornerM);
      expect(d.distanceM!).toBeLessThan(entry + 600);
    }
  });

  it('the lap summary never repeats the correction spoken that lap', () => {
    const h = gainTime({ summary: 'lap' });
    runToLap(h, 6, { audio: 'ready' }, 15_000);
    const summaries = spokenBy(h, 'lapSummary');
    expect(summaries.length).toBeGreaterThan(0);
    for (const s of summaries) {
      const corrected = spokenBy(h, 'cornerCorrection').filter(
        (d) => d.evidence?.lap === s.evidence?.lap,
      );
      for (const c of corrected)
        expect(
          s.evidence?.actionCorner === c.cornerId && s.evidence?.actionKind === c.evidence?.kind,
        ).toBe(false);
    }
    // Lap 4: T4 corrected on the radio → no next action left, nothing else relevant → silence.
    expect(summaries.some((s) => s.evidence?.lap === 4)).toBe(false);
    // Lap 5: T4 was not spoken (consecutive lap) → the summary carries it as the next action.
    const lap5 = summaries.find((s) => s.evidence?.lap === 5)!;
    expect(lap5.utterance).toEqual([cornerSegment(4), CAUSE_FOCUS.heldBrake]);
  });

  it('focus on up to two corners: the others stay silent', () => {
    const h = gainTime();
    runToLap(h, 7, { audio: 'ready', focusCornerIds: ['T2'] });
    expect(spokenBy(h, 'cornerCorrection').map((d) => d.cornerId)).toEqual(['T2']);
  });

  it('a car event takes the pass: one call, after the car straightens', () => {
    const h = training('gainTime');
    h.sim.reviews = [
      {
        cornerId: 'T4',
        atM: 2400,
        make: () => ({
          cause: cause('heldBrake', { confidence: 'high' }),
          event: event({ settledM: 2380 }),
        }),
      },
    ];
    runToLap(h, 2);
    expect(h.said()).toEqual([
      [cornerSegment(4), EVENT_WORDS.frontLock, EVENT_ACTIONS.easeBrakePeak],
    ]);
    const d = spokenBy(h, 'drivingEvent')[0]!;
    expect(d.distanceM).toBeGreaterThanOrEqual(2380);
    expect(h.engine.log.some((x) => x.ruleId === 'cornerCorrection')).toBe(false);
  });

  it('immediate "Alivia o acelerador" only after two passes with an entry event, still in time', () => {
    const h = training('gainTime');
    h.sim.marks = [{ id: 'b4', cornerId: 'T4', kind: 'brake', atM: 2150 }];
    h.sim.reviews = [
      {
        cornerId: 'T4',
        atM: 2400,
        make: () => ({ event: event({ kind: 'understeer', phase: 'entry', settledM: 2390 }) }),
      },
    ];
    runToLap(h, 4);
    const lifts = spokenBy(h, 'liftThrottle');
    expect(lifts.map((d) => d.lap)).toEqual([3]);
    const d = lifts[0]!;
    expect(d.utterance).toBe(LIFT_THROTTLE);
    const atPointT = d.t + ((2150 - d.distanceM!) / (200 / 3.6)) * 1000;
    expect(d.t + d.durationMs! + REACTION_MS).toBeLessThanOrEqual(atPointT + 1);
    // Not while the driver already lifted.
    const lifted = training('gainTime');
    lifted.sim.marks = h.sim.marks;
    lifted.sim.reviews = h.sim.reviews;
    lifted.sim.throttle = 0.5;
    runToLap(lifted, 4);
    expect(spokenBy(lifted, 'liftThrottle')).toEqual([]);
  });
});

describe('Eventos de pilotagem no rádio', () => {
  it('speaks only a settled high-confidence event, at most one call per pass', () => {
    const h = training('learnTrack');
    h.sim.reviews = [
      {
        cornerId: 'T2',
        atM: 1200,
        make: (lap) => (lap === 1 ? { event: event({ settledM: null }) } : {}),
      },
      {
        cornerId: 'T4',
        atM: 2400,
        make: (lap) => (lap === 1 ? { event: event({ settledM: 2390 }) } : {}),
      },
    ];
    runToLap(h, 3);
    const events = spokenBy(h, 'drivingEvent');
    expect(events.map((d) => d.cornerId)).toEqual(['T4']);
    expect(
      h.engine.log.filter((d) => d.ruleId === 'drivingEvent' && d.cornerId === 'T4'),
    ).toHaveLength(1);
  });

  it('drops the event when no free window comes in time', () => {
    const h = training('gainTime');
    h.sim.reviews = [
      {
        cornerId: 'T4',
        atM: 2400,
        make: (lap) => (lap === 1 ? { event: event({ settledM: 2390 }) } : {}),
      },
    ];
    runToLap(h, 1, { audio: 'ready' }, 0);
    h.sim.dist = 2350;
    h.sim.brake = 0.4; // braking the whole time: no free window
    runToLap(h, 2, { audio: 'ready' }, 2000);
    expect(spokenBy(h, 'drivingEvent')).toEqual([]);
    expect(h.outcomes('drivingEvent')).toEqual([['discarded', 'sem janela livre']]);
  });
});

describe('Resumo e elogios', () => {
  /** Zone losses per lap for T1–T3: lap 1 is the block baseline. */
  function summary(
    losses: Record<number, [number, number, number]>,
    config: Partial<RadioEngineConfig> = {},
  ) {
    const h = training('gainTime', { summary: 'lap', ...config });
    h.sim.reviews = (['T1', 'T2', 'T3'] as const).map((cornerId, i) => ({
      cornerId,
      atM: [400, 1000, 1600][i]! + 200,
      make: (lap: number) => ({ timeLostMs: (losses[lap] ?? losses[1]!)[i]! }),
    }));
    return h;
  }

  it('after the line: one relevant gain against the block baseline', () => {
    const h = summary({ 1: [300, 300, 300], 2: [200, 150, 220] });
    h.sim.nextLapMs = 54_400;
    runToLap(h, 2);
    h.sim.nextLapMs = 54_050;
    runToLap(h, 3, { audio: 'ready' }, 15_000);
    const s = spokenBy(h, 'lapSummary');
    expect(s.map((d) => d.utterance)).toEqual([
      [YOU_IMPROVED, fromCornerSegment(1), toCornerSegment(3)],
    ]);
    expect(s[0]!.lap).toBe(3);
    expect(s[0]!.distanceM!).toBeLessThan(400); // first free window after the line, before T1
  });

  it('no relevant change → silence; praise is off by default', () => {
    const h = summary({ 1: [300, 300, 300], 2: [290, 280, 300] });
    runToLap(h, 3, { audio: 'ready' }, 15_000);
    expect(spokenBy(h, 'lapSummary')).toEqual([]);
    expect(h.said().flat()).not.toContain(GOOD_LAP);
  });

  it('"Boa volta" accompanies an improvement when enabled, with an interval', () => {
    const h = summary(
      { 1: [300, 300, 300], 2: [200, 150, 220], 3: [150, 100, 150] },
      { praise: true },
    );
    h.sim.nextLapMs = 92_000;
    runToLap(h, 2);
    h.sim.nextLapMs = 91_500;
    runToLap(h, 3);
    h.sim.nextLapMs = 91_000;
    runToLap(h, 4, { audio: 'ready' }, 15_000);
    const s = spokenBy(h, 'lapSummary').map((d) => d.utterance as string[]);
    expect(s[0]).toEqual([GOOD_LAP, YOU_IMPROVED, fromCornerSegment(1), toCornerSegment(3)]);
    expect(s[1]![0]).not.toBe(GOOD_LAP); // within PRAISE_INTERVAL_MS
  });

  it('per block: summarizes when the driver ends the block', () => {
    const h = summary({ 1: [300, 300, 300] }, { summary: 'block' });
    h.sim.nextLapMs = 92_000;
    runToLap(h, 2, { audio: 'ready', blockId: 'b1' });
    h.sim.nextLapMs = 91_700;
    runToLap(h, 3, { audio: 'ready', blockId: 'b1' });
    runToLap(h, 3, { audio: 'ready', blockId: 'b1' }, 1000);
    expect(spokenBy(h, 'lapSummary')).toEqual([]);
    runToLap(h, 3, { audio: 'ready', blockId: null }, 10_000);
    const s = spokenBy(h, 'lapSummary');
    expect(s.map((d) => d.utterance)).toEqual([['Melhorou', tenthsSegment(3)]]);
    expect(s[0]!.evidence).toMatchObject({ laps: 2, baselineMs: 92_000, bestMs: 91_700 });
  });

  it('on demand: waits for a lap with the same time, then uses the next free window', () => {
    const h = summary({ 1: [300, 300, 300], 2: [100, 300, 300] }, { summary: 'onDemand' });
    h.sim.nextLapMs = 54_000;
    runToLap(h, 2);
    h.sim.nextLapMs = 54_000;
    runToLap(h, 3, { audio: 'ready' }, 1000);
    expect(spokenBy(h, 'lapSummary')).toEqual([]);
    h.engine.requestSummary();
    runToLap(h, 3, { audio: 'ready' }, 12_000);
    expect(spokenBy(h, 'lapSummary').map((d) => d.utterance)).toEqual([
      [cornerSegment(1), 'você melhorou.'],
    ]);
  });
});

describe('Consistência', () => {
  it.each(['block', 'onDemand'] as const)(
    'summarizes spread and adherence in %s mode',
    (summary) => {
      const h = training('consistency', { consistencyTargetMs: 90_300, summary });
      h.sim.reviews = [
        {
          cornerId: 'T4',
          atM: 2400,
          make: () => ({
            timeLostMs: 900,
            cause: cause('heldBrake', { confidence: 'high' }),
            event: event(),
          }),
        },
      ];
      const times = [90_000, 90_400, 90_200, 91_000, 90_100];
      for (const [i, ms] of times.entries()) {
        h.sim.nextLapMs = ms;
        runToLap(h, i + 2);
      }
      runToLap(h, 6, { audio: 'ready' }, 10_000);
      if (summary === 'onDemand') {
        expect(h.said()).toEqual([]);
        h.engine.requestSummary();
        runToLap(h, 6, { audio: 'ready' }, 10_000);
      }
      const spoken = h.engine.log.filter((d) => d.outcome === 'spoken');
      expect(spoken.map((d) => d.ruleId)).toEqual(['consistency']);
      expect(spoken[0]!.utterance).toEqual([VARIATION, ONE_SECOND, ADHERENCE.most]);
      expect(spoken[0]!.evidence).toMatchObject({
        laps: 5,
        spreadMs: 1000,
        within: 4,
        targetMs: 90_300,
      });
    },
  );
});
