/**
 * Live corner pass review (Ganhar tempo) on slices of real laps: Trial Mountain, Lamborghini
 * Huracán Gr.4, PS5. The reference is the 1:59,089 replay capture; each subject slice ends ~80 m
 * after the T4 exit, where the live engine reviews the pass.
 */

import type { PreparedLap } from '@gt7/analysis';
import type { Corner, DrivingEventModel, LapSampleChannel, LapTrace } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { reviewCornerPass } from './corner-pass-review.ts';
import pass04856 from './fixtures/corner-pass/tm-huracan-2m04856-t4.json';
import pass04918 from './fixtures/corner-pass/tm-huracan-2m04918-t4.json';
import pass06778 from './fixtures/corner-pass/tm-huracan-2m06778-t4.json';
import replayT4 from './fixtures/corner-pass/tm-huracan-replay-t4.json';
import oversteer07667 from './fixtures/driving-events/tm-huracan-2m07667-t4.json';

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

/** A slice as a prepared lap; the time-at-distance grid is rebuilt from the slice samples. */
function load(raw: unknown, isReplay?: boolean) {
  const fx = raw as Fixture;
  const n = fx.s.length;
  const channels = {} as LapTrace['channels'];
  for (const [k, v] of Object.entries(fx.channels)) channels[k as LapSampleChannel] = toF64(v);
  const s = toF64(fx.s);
  const t = toF64(fx.t);
  const L = fx.lap.lengthM;
  const v0 = Math.max(1, channels.speedKmh[0]! / 3.6);
  const v1 = Math.max(1, channels.speedKmh[n - 1]! / 3.6);
  const timeS = new Float64Array(Math.ceil(L) + 1);
  let j = 0;
  for (let k = 0; k < timeS.length; k++) {
    const d = Math.min(k, L);
    if (d <= s[0]!) timeS[k] = t[0]! - (s[0]! - d) / v0;
    else if (d >= s[n - 1]!) timeS[k] = t[n - 1]! + (d - s[n - 1]!) / v1;
    else {
      while (s[j + 1]! < d) j++;
      const u = s[j + 1]! > s[j]! ? (d - s[j]!) / (s[j + 1]! - s[j]!) : 0;
      timeS[k] = t[j]! + (t[j + 1]! - t[j]!) * u;
    }
  }
  const lap: PreparedLap = {
    lapId: fx.lapId,
    trace: { lapId: fx.lapId, sampleRateHz: 60, length: n, channels },
    isReplay: isReplay ?? fx.lap.isReplay,
    lengthM: L,
    lapTimeS: t[n - 1]!,
    n,
    s,
    sRaw: s,
    t,
    lateral: toF64(fx.lateral),
    distToLine: toF64(fx.distToLine),
    hasSteering: fx.lap.hasSteering,
    timeGrid: { stepM: L / (timeS.length - 1), timeS },
    sampleLapTimeS: t[n - 1]!,
    warnings: [],
  };
  return { lap, corners: fx.corners as Corner[], model: fx.model };
}

const reference = load(replayT4);

function review(raw: unknown, ref: PreparedLap | null = reference.lap) {
  const { lap, corners, model } = load(raw);
  return reviewCornerPass(lap, ref, corners, 'T4', { model })!;
}

describe('revisão da passagem pela T4 (Trial Mountain, Huracán Gr.4)', () => {
  it('2:04,856: the late brake release is the cause, with its effect in the zone', () => {
    const r = review(pass04856);
    expect(r.timeLostMs).toBeGreaterThan(800);
    expect(r.timeLostMs).toBeLessThan(930);
    expect(r.cause).toMatchObject({ kind: 'heldBrake', confidence: 'medium' });
    expect(r.cause!.costMs).toBeGreaterThan(700);
    expect(r.cause!.evidence.brakeReleaseM).toBeCloseTo(1133, -1);
    expect(r.cause!.evidence.referenceBrakeReleaseM).toBeCloseTo(1100, -1);
    expect(r.cause!.evidence.trailBrakingS).toBeCloseTo(2.28, 1);
    expect(r.cause!.evidence.referenceTrailBrakingS).toBeCloseTo(0.67, 1);
    expect(r.cause!.message).toMatch(/^Na T4 você segurou o freio/);
    // Not a car event (same control case as driving-events.test.ts).
    expect(r.event).toBeNull();
    expect(r.referenceIsReplay).toBe(true);
  });

  it('replay reference: the distance tolerance keeps it at medium; an own-lap reference is high', () => {
    expect(review(pass04856).cause?.confidence).toBe('medium');
    const own = load(replayT4, false).lap;
    expect(review(pass04856, own).cause?.confidence).toBe('high');
  });

  it('2:04,918: the same pattern again (recurring cause)', () => {
    expect(review(pass04918).cause).toMatchObject({ kind: 'heldBrake', confidence: 'medium' });
  });

  it('2:06,778: loses time but no cause is sustained → nothing to correct', () => {
    const r = review(pass06778);
    expect(r.timeLostMs).toBeGreaterThan(500);
    expect(r.cause).toBeNull();
    expect(r.incomparable).toBeUndefined();
  });

  it('the reference against itself is a clean pass', () => {
    const r = review(replayT4);
    expect(r.timeLostMs).toBe(0);
    expect(r.cause).toBeNull();
  });

  it('without a compatible reference only the driving event is judged', () => {
    const r = review(pass04856, null);
    expect(r).toMatchObject({ incomparable: 'sem referência compatível', cause: null });
    expect(r.timeLostMs).toBeNull();
    const o = review(oversteer07667, null);
    expect(o.event).toMatchObject({ kind: 'oversteer', phase: 'entry' });
    // The slice ends before the car straightens (1241 m on the full lap): not yet speakable.
    expect(o.event!.settledM).toBeNull();
  });

  it('is deterministic', () => {
    expect(review(pass04856)).toEqual(review(pass04856));
  });
});
