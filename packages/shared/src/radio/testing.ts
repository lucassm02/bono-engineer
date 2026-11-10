/**
 * Minimal deterministic frame source for radio engine tests and offline replays: a car running
 * at constant speed around a track with corner entries and optional engineer marks.
 */

import type {
  ConnectionState,
  EngineerCue,
  EngineerCueKind,
  LiveCornerPass,
  LiveEngineerFrame,
  LiveFrame,
} from '../live.ts';
import type { Wheels } from '../telemetry.ts';
import { RadioEngine, type RadioEngineOptions } from './engine.ts';
import type { RadioUtterance } from './phrases.ts';
import {
  DEFAULT_RADIO_PREFERENCES,
  type RadioEngineConfig,
  radioEngineConfig,
} from './settings.ts';
import type { RadioSpeech, RadioStepEnv } from './types.ts';

export interface SimMark {
  id: string;
  cornerId: string;
  kind: EngineerCueKind;
  atM: number;
  brakePeak?: number;
  untilM?: number;
}

/** Test duration: 1 s per phrase key, sequences add 600 ms per extra key. */
export const simUtteranceMs = (u: RadioUtterance): number =>
  typeof u === 'string' ? 1000 : u.length ? 1000 + 600 * (u.length - 1) : 0;

export class RadioSim {
  t = 1_700_000_000_000;
  seq = 0;
  lengthM = 3000;
  dist = 0;
  lap = 1;
  totalLaps: number | null = null;
  lapValid: boolean | undefined = true;
  lapStartT = this.t;
  lastLapMs: number | null = null;
  bestLapMs: number | null = null;
  /** Lap time recorded at the next line crossing (default: elapsed time). */
  nextLapMs: number | null = null;
  /** Validity of the lap that starts at the next crossing (default: unchanged). */
  nextLapValid: boolean | undefined = undefined;
  speedKmh = 200;
  brake = 0;
  throttle = 1;
  lateralG = 0;
  temps: Wheels = [80, 80, 80, 80];
  fuel = {
    level: 50,
    capacity: 100,
    perLapAvg: null as number | null,
    lapsRemaining: null as number | null,
    neededToFinish: null as number | null,
    energyRecovery: null,
  };
  sessionId: string | null = 's1';
  trackId: string | null = 'trk';
  carCode = 42;
  state: ConnectionState = 'onTrack';
  /** Corner entries (lap distance, m). Cornering lasts `cornerM` after each entry. */
  corners: number[] = [];
  cornerM = 150;
  marks: SimMark[] = [];
  /** Corner pass reviews published so far (the frame carries the last 2, like the core). */
  passes: LiveCornerPass[] = [];
  /**
   * Reviews published when the car reaches `atM` in the lap (like the core, ~80 m after the exit).
   * `make` gets the lap number and returns the pass (or null for no review).
   */
  reviews: {
    cornerId: string;
    atM: number;
    make: (lap: number) => Partial<LiveCornerPass> | null;
  }[] = [];
  /** Engineer status when there are no marks. */
  engineerStatus: Exclude<LiveEngineerFrame['status'], 'ready'> = 'waitingReference';
  dtMs = 50;

  #wrap(m: number): number {
    return ((m % this.lengthM) + this.lengthM) % this.lengthM;
  }

  /** Advance one tick and return the frame. */
  tick(dtMs = this.dtMs): LiveFrame {
    this.t += dtMs;
    if (this.state === 'onTrack') {
      const before = this.dist;
      this.dist += (this.speedKmh / 3.6) * (dtMs / 1000);
      for (const r of this.reviews) {
        if (before < r.atM && this.dist >= r.atM) {
          const made = r.make(this.lap);
          if (made) this.publish(r.cornerId, made);
        }
      }
      if (this.dist >= this.lengthM) {
        this.dist -= this.lengthM;
        const lapMs = this.nextLapMs ?? this.t - this.lapStartT;
        this.lastLapMs = lapMs;
        if (this.lapValid && this.lap >= 1)
          this.bestLapMs = this.bestLapMs === null ? lapMs : Math.min(this.bestLapMs, lapMs);
        this.nextLapMs = null;
        this.lap++;
        this.lapStartT = this.t;
        if (this.nextLapValid !== undefined) this.lapValid = this.nextLapValid;
        this.nextLapValid = undefined;
      }
    }
    return this.frame();
  }

  /** Publishes a corner pass review of the current lap (defaults: clean pass vs reference). */
  publish(cornerId: string, pass: Partial<LiveCornerPass> = {}): LiveCornerPass {
    const full: LiveCornerPass = {
      id: `${this.lapStartT}|${cornerId}`,
      cornerId,
      lap: this.lap,
      lapStartedAt: this.lapStartT,
      referenceLapId: 'ref',
      referenceIsReplay: false,
      atM: this.dist,
      timeLostMs: 0,
      brakePointM: 500,
      referenceBrakePointM: 500,
      gearAtApex: 3,
      referenceGearAtApex: 3,
      cause: null,
      event: null,
      ...pass,
    };
    this.passes.push(full);
    return full;
  }

  /** Run for `ms`, calling `each` with every frame. */
  run(ms: number, each: (frame: LiveFrame) => void): void {
    const end = this.t + ms;
    while (this.t < end) each(this.tick());
  }

  frame(): LiveFrame {
    const inCorner = this.corners.some((entry) => this.#wrap(this.dist - entry) < this.cornerM);
    const sorted = [...this.corners].sort((a, b) => a - b);
    const nextEntry = sorted.find((e) => e >= this.dist) ?? sorted[0];
    const cues: EngineerCue[] = [];
    for (const mark of this.marks) {
      const offset = mark.atM - this.dist;
      const aheadM = offset - Math.round(offset / this.lengthM) * this.lengthM;
      const span = mark.untilM === undefined ? 0 : mark.untilM - mark.atM;
      if (aheadM > 310 || aheadM + span < -18) continue;
      cues.push({
        id: `${mark.id}@${this.lapStartT}`,
        cornerId: mark.cornerId,
        kind: mark.kind,
        aheadM,
        ...(mark.brakePeak !== undefined ? { brakePeak: mark.brakePeak } : {}),
        ...(mark.untilM !== undefined ? { endAheadM: aheadM + span } : {}),
      });
    }
    const engineer: LiveEngineerFrame =
      this.state !== 'onTrack'
        ? { status: 'suspended' }
        : this.marks.length
          ? {
              status: 'ready',
              referenceLapId: 'ref',
              referenceLapMs: 90_000,
              pendingReference: false,
              cues,
            }
          : { status: this.engineerStatus };
    return {
      sessionId: this.sessionId,
      seq: ++this.seq,
      t: this.t,
      packetId: this.seq,
      format: '~',
      state: this.state,
      car: {
        speedKmh: this.speedKmh,
        rpm: 7000,
        gear: 4,
        suggestedGear: null,
        throttle: this.throttle,
        brake: this.brake,
        clutch: 0,
        throttleRaw: null,
        brakeRaw: null,
        steeringRad: null,
        boostBar: 0,
        oilPressureBar: 4,
        rpmAlert: { min: 7500, max: 8000 },
        maxSpeedKmh: 300,
        carCode: this.carCode,
      },
      tyres: {
        tempC: [...this.temps],
        slip: [0, 0, 0, 0],
        suspensionM: [0.08, 0.08, 0.08, 0.08],
        surface: null,
      },
      fuel: { ...this.fuel },
      g: {
        lateral: inCorner ? Math.max(1.2, this.lateralG) : this.lateralG,
        longitudinal: 0,
        vertical: null,
      },
      flags: {
        carOnTrack: this.state === 'onTrack',
        paused: this.state === 'paused',
        loadingOrProcessing: false,
        inGear: true,
        hasTurbo: false,
        revLimiterAlert: false,
        handBrake: false,
        lights: false,
        highBeam: false,
        lowBeam: false,
        asmActive: false,
        tcsActive: false,
      },
      position: { x: this.dist, y: 0, z: 0 },
      headingRad: 0,
      lap: {
        lap: this.lap,
        totalLaps: this.totalLaps,
        currentLapMs: this.t - this.lapStartT,
        lastLapMs: this.lastLapMs,
        bestLapMs: this.bestLapMs,
        predictedLapMs: null,
        delta: { ms: null, reference: 'sessionBest', referenceLapId: null, rateMsPerS: null },
        referenceLapMs: null,
        ...(this.lapValid === undefined ? {} : { currentLapValid: this.lapValid }),
        startedAt: this.lapStartT,
      },
      sectors: [],
      distanceM: this.dist,
      lapFraction: this.dist / this.lengthM,
      track: this.trackId
        ? { id: this.trackId, name: 'Pista', lengthM: this.lengthM, confidence: 'confirmed' }
        : null,
      nextCorner:
        nextEntry === undefined
          ? null
          : {
              cornerId: `T${sorted.indexOf(nextEntry) + 1}`,
              name: null,
              direction: 'left',
              distanceToEntryM: this.#wrap(nextEntry - this.dist),
              referenceBrakePointM: null,
              referenceMinSpeedKmh: null,
              referenceGearAtApex: null,
              lastPassDeltaMs: null,
            },
      engineer,
      ...(this.passes.length ? { cornerPasses: this.passes.slice(-2) } : {}),
      link: { rateHz: 60, lossPct: 0, lost: 0, received: this.seq, lastPacketAt: this.t },
    };
  }
}

/** Engine + sim + collected speech, for tests. */
export function radioHarness(
  config: Partial<RadioEngineConfig> = {},
  options: Partial<RadioEngineOptions> = {},
) {
  const engine = new RadioEngine({
    utteranceMs: simUtteranceMs,
    ...options,
    config: { ...radioEngineConfig(DEFAULT_RADIO_PREFERENCES), ...config },
  });
  const sim = new RadioSim();
  const spoken: RadioSpeech[] = [];
  let env: RadioStepEnv = { audio: 'ready' };
  const run = (ms: number, change: Partial<RadioStepEnv> = {}) => {
    env = { ...env, ...change };
    sim.run(ms, (frame) => {
      const out = engine.step(frame, env);
      if (out.speak) spoken.push(out.speak);
    });
  };
  const said = () => spoken.map((s) => s.utterance);
  const outcomes = (ruleId: string) =>
    engine.log.filter((d) => d.ruleId === ruleId).map((d) => [d.outcome, d.reason ?? '']);
  return { engine, sim, spoken, run, said, outcomes };
}
