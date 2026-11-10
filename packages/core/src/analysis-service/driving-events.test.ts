/**
 * Regression tests of the driving-event rules on slices of real laps (Trial Mountain, Lamborghini
 * Huracán Gr.4, PS5, packet format "~"). Each fixture keeps the projected samples of one stretch
 * and the response model calibrated on the full lap, so a slice is judged exactly like the lap.
 */

import type { PreparedLap } from '@gt7/analysis';
import type { Corner, DrivingEventModel, LapSampleChannel, LapTrace } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  detectCornerPassEvents,
  detectDrivingEvents,
  radioEventForPass,
} from './driving-events.ts';
import lap04856T1T3 from './fixtures/driving-events/tm-huracan-2m04856-t1-t3.json';
import lap04856T4 from './fixtures/driving-events/tm-huracan-2m04856-t4.json';
import lap04856T9 from './fixtures/driving-events/tm-huracan-2m04856-t9.json';
import lap04918T9 from './fixtures/driving-events/tm-huracan-2m04918-t9.json';
import lap07461T5 from './fixtures/driving-events/tm-huracan-2m07461-t5.json';
import lap07667T4 from './fixtures/driving-events/tm-huracan-2m07667-t4.json';
import replayT1T3 from './fixtures/driving-events/tm-huracan-replay-t1-t3.json';

interface Fixture {
  lapId: string;
  lap: { lengthM: number; isReplay: boolean; hasSteering: boolean };
  model: DrivingEventModel;
  corners: unknown[];
  s: (number | null)[];
  t: (number | null)[];
  lateral: (number | null)[];
  distToLine: (number | null)[];
  channels: Record<string, (number | null)[]>;
}

const toF64 = (a: (number | null)[]) => Float64Array.from(a, (v) => (v === null ? Number.NaN : v));

function load(raw: unknown, patch: Partial<Record<LapSampleChannel, number>> = {}) {
  const fx = raw as Fixture;
  const n = fx.s.length;
  const channels = {} as LapTrace['channels'];
  for (const [k, v] of Object.entries(fx.channels)) channels[k as LapSampleChannel] = toF64(v);
  for (const [k, v] of Object.entries(patch)) {
    channels[k as LapSampleChannel] = new Float64Array(n).fill(v as number);
  }
  const s = toF64(fx.s);
  const t = toF64(fx.t);
  const lap: PreparedLap = {
    lapId: fx.lapId,
    trace: { lapId: fx.lapId, sampleRateHz: 60, length: n, channels },
    isReplay: fx.lap.isReplay,
    lengthM: fx.lap.lengthM,
    lapTimeS: t[n - 1]!,
    n,
    s,
    sRaw: s,
    t,
    lateral: toF64(fx.lateral),
    distToLine: toF64(fx.distToLine),
    hasSteering: fx.lap.hasSteering && !('steeringRad' in patch),
    timeGrid: { stepM: 1, timeS: new Float64Array([0, t[n - 1]!]) },
    sampleLapTimeS: t[n - 1]!,
    warnings: [],
  };
  return { lap, corners: fx.corners as Corner[], model: fx.model };
}

function run(raw: unknown) {
  const { lap, corners, model } = load(raw);
  return detectDrivingEvents(lap, corners, { model }).events;
}

describe('driving events on real Trial Mountain laps (Huracán Gr.4)', () => {
  it('2:04,856 T2: probable understeer on the crest, line opening, no rotation events in T1→T3', () => {
    const events = run(lap04856T1T3);
    expect(events.map((e) => `${e.kind}@${e.cornerId}`)).toEqual(['understeer@T2']);
    const u = events[0]!;
    // "Possível saída de frente": real, but the crest (car goes light) keeps it off the radio.
    expect(u.confidence).toBe('medium');
    expect(u.evidence.steeringDeg).toBeGreaterThan(75);
    expect(u.evidence.yawRatio).toBeLessThan(0.2);
    expect(u.evidence.lineOpeningM).toBeGreaterThan(4);
    expect(u.evidence.verticalG).toBeGreaterThan(0.6);
    expect(u.startM).toBeGreaterThan(620);
    expect(u.endM).toBeLessThan(690);
    expect(u.notes.join(' ')).toMatch(/lombada/);
    expect(u.message).toMatch(/^Provável saída de frente na T2/);
    expect(u.action).toMatch(/lombada/);
    expect(radioEventForPass(events)).toBeNull();
  });

  it('2:04,856 T4: clean control pass (late brake release is not a car event)', () => {
    expect(run(lap04856T4)).toEqual([]);
  });

  it('2:04,856 T9: braking-slip signal judged as rotation, not as a front lock', () => {
    const events = run(lap04856T9);
    expect(events.map((e) => `${e.kind}@${e.cornerId}:${e.confidence}`)).toEqual([
      'oversteer@T9:medium',
      'exitTraction@T9:medium',
    ]);
    const o = events[0]!;
    expect(o.phase).toBe('braking');
    expect(o.evidence.slipAngleDeg).toBeGreaterThan(7);
    expect(o.evidence.countersteerS).toBe(0);
    // Fronts only reach the car's normal braking slip; the rears slip a little more.
    expect(o.evidence.frontSlipPeak).toBeGreaterThan(-0.08);
    expect(o.evidence.rearSlipPeak).toBeLessThan(o.evidence.frontSlipPeak!);
    const x = events[1]!;
    expect(x.evidence.rearSlipPeak).toBeGreaterThanOrEqual(0.1);
    expect(x.phase).toBe('exit');
    expect(radioEventForPass(events)).toBeNull();
  });

  it('2:04,918 T9: clear front lock (high) separate from the rotation', () => {
    const events = run(lap04918T9);
    const lock = events.find((e) => e.kind === 'frontLock')!;
    expect(lock.cornerId).toBe('T9');
    expect(lock.confidence).toBe('high');
    expect(lock.evidence.frontSlipPeak).toBeLessThan(-0.18);
    expect(lock.durationS).toBeGreaterThan(0.8);
    expect(events.some((e) => e.kind === 'understeer')).toBe(false);
    expect(radioEventForPass(events)?.id).toBe(lock.id);
  });

  it('2:07,667 T4: oversteer with countersteer (high) absorbs the wheelspin', () => {
    const events = run(lap07667T4);
    const o = events.find((e) => e.kind === 'oversteer')!;
    expect(o.cornerId).toBe('T4');
    expect(o.confidence).toBe('high');
    expect(o.evidence.countersteerS).toBeGreaterThanOrEqual(0.25);
    expect(o.evidence.rearSlipPeak).toBeGreaterThan(0.2);
    expect(events.some((e) => e.kind === 'exitTraction')).toBe(false);
    expect(radioEventForPass(events)?.id).toBe(o.id);
  });

  it('2:07,461 T5: the slip after an impact is not reported as traction loss', () => {
    const events = run(lap07461T5);
    expect(events.filter((e) => e.kind === 'exitTraction' && e.confidence !== 'low')).toEqual([]);
    expect(events.every((e) => e.endM < 1480)).toBe(true);
  });

  it('reference replay T1→T3: clean control, no events', () => {
    expect(run(replayT1T3)).toEqual([]);
  });

  it('is deterministic and the per-pass detection matches the lap detection', () => {
    expect(run(lap07667T4)).toEqual(run(lap07667T4));
    const { lap, corners, model } = load(lap04856T1T3);
    const pass = detectCornerPassEvents(lap, corners, 'T2', { model });
    expect(pass.map((e) => e.id)).toEqual(run(lap04856T1T3).map((e) => e.id));
    expect(detectCornerPassEvents(lap, corners, 'T3', { model })).toEqual([]);
  });

  it('without a steering channel, understeer is not judged and a warning is given', () => {
    const { lap, corners, model } = load(lap04856T1T3, { steeringRad: Number.NaN });
    const r = detectDrivingEvents(lap, corners, { model });
    expect(r.events.some((e) => e.kind === 'understeer')).toBe(false);
    expect(r.warnings[0]).toMatch(/volante/);
  });
});
