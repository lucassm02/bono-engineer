import type { LapCompletedEvent, LiveFrame } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { assessPass, type CornerPass, CornerPassTracker } from '../lib/cornerPass.ts';
import { buildTrack, cumulativeTime, MockSession, speedProfile } from './mock.ts';

function run(session: MockSession, seconds: number, dtMs = 1000 / 60) {
  const frames: LiveFrame[] = [];
  const laps: LapCompletedEvent[] = [];
  const steps = Math.round((seconds * 1000) / dtMs);
  for (let i = 0; i < steps; i++) {
    const { frame, lapCompleted } = session.step(dtMs);
    if (i % 6 === 0) frames.push(frame);
    if (lapCompleted) laps.push(lapCompleted);
  }
  return { frames, laps };
}

describe('mock track', () => {
  it('has a plausible length and lap time', () => {
    const t = buildTrack();
    expect(t.lengthM).toBeGreaterThan(3000);
    expect(t.lengthM).toBeLessThan(5000);
    const cum = cumulativeTime(speedProfile(t, [1, 1, 1], null));
    const lapS = cum[t.lengthM]! / 1000;
    expect(lapS).toBeGreaterThan(70);
    expect(lapS).toBeLessThan(110);
  });
});

describe('MockSession', () => {
  it('starts in the menu and then drives', () => {
    const s = new MockSession({ seed: 1 });
    expect(s.step(16).frame.state).toBe('menu');
    const { frames } = run(s, 3);
    expect(frames.at(-1)!.state).toBe('onTrack');
  });

  it('produces frames within physical ranges', () => {
    const s = new MockSession({ seed: 2, skipMenu: true });
    const { frames } = run(s, 120);
    for (const f of frames) {
      expect(f.car.speedKmh).toBeGreaterThanOrEqual(0);
      expect(f.car.speedKmh).toBeLessThan(330);
      expect(f.car.rpm).toBeLessThanOrEqual(8500);
      expect(f.car.gear).toBeGreaterThanOrEqual(1);
      expect(f.car.gear).toBeLessThanOrEqual(7);
      for (const p of [f.car.throttle, f.car.brake, f.car.clutch]) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      for (const t of f.tyres.tempC) {
        expect(t).toBeGreaterThan(20);
        expect(t).toBeLessThan(140);
      }
      expect(f.lapFraction).toBeGreaterThanOrEqual(0);
      expect(f.lapFraction).toBeLessThanOrEqual(1);
    }
    // Every widget input is exercised.
    expect(frames.some((f) => f.car.brake > 0.8)).toBe(true);
    expect(frames.some((f) => f.car.throttle > 0.95)).toBe(true);
    expect(frames.some((f) => f.flags.tcsActive)).toBe(true);
    expect(frames.some((f) => f.tyres.slip.some((x) => x < -0.1))).toBe(true);
    expect(frames.some((f) => f.tyres.surface?.includes('C'))).toBe(true);
    expect(new Set(frames.map((f) => f.car.gear)).size).toBeGreaterThanOrEqual(5);
    expect(frames.some((f) => f.car.rpm >= f.car.rpmAlert.min)).toBe(true);
    expect(frames.some((f) => f.lap.delta.ms !== null && Number.isFinite(f.lap.delta.ms))).toBe(
      true,
    );
  });

  it('completes laps with sectors, delta and fuel', () => {
    const s = new MockSession({ seed: 3, skipMenu: true });
    const { frames, laps } = run(s, 280);
    expect(laps.length).toBeGreaterThanOrEqual(2);
    const lap = laps[0]!;
    expect(lap.lapNumber).toBe(1);
    expect(lap.timeMs).toBeGreaterThan(70_000);
    expect(lap.timeMs).toBeLessThan(110_000);
    expect(lap.sectorTimesMs.every((t) => t !== null && t > 0)).toBe(true);
    const sum = lap.sectorTimesMs.reduce<number>((a, b) => a + (b ?? 0), 0);
    expect(Math.abs(sum - lap.timeMs)).toBeLessThan(100);
    expect(lap.sectorStatus.every((st) => st !== 'pending')).toBe(true);
    expect(lap.deltaMs).not.toBeNull();
    const last = frames.at(-1)!;
    expect(last.lap.lap).toBeGreaterThanOrEqual(3);
    expect(last.lap.lastLapMs).not.toBeNull();
    expect(last.fuel.perLapAvg).toBeGreaterThan(1);
    expect(last.fuel.lapsRemaining).toBeGreaterThan(0);
    // Tyres warm into a plausible window after a few laps.
    for (const t of last.tyres.tempC) {
      expect(t).toBeGreaterThan(55);
      expect(t).toBeLessThan(125);
    }
  });

  it('follows the selected delta reference', () => {
    const s = new MockSession({ seed: 4, skipMenu: true });
    s.setReference('reference');
    const { frames } = run(s, 30);
    const f = frames.at(-1)!;
    expect(f.lap.delta.reference).toBe('reference');
    // The captured "top" lap is faster: delta grows positive.
    expect(f.lap.delta.ms!).toBeGreaterThan(0);
  });
});

describe('MockSession extras (wave 4a views)', () => {
  it('closes the circuit and exposes the map geometry with corners', () => {
    const s = new MockSession({ seed: 5, skipMenu: true });
    const g = s.geometry();
    const n = g.x.length;
    expect(Math.hypot(g.x[0]! - g.x[n - 1]!, g.z[0]! - g.z[n - 1]!)).toBeLessThan(3);
    expect(g.corners.length).toBe(9);
    expect(g.corners.find((c) => c.name === 'Grampo')).toBeDefined();
  });

  it('emits next-corner hints with reference targets, energy and core fuel semantics', () => {
    const s = new MockSession({ seed: 6, skipMenu: true });
    const { frames } = run(s, 200);
    const hinted = frames.filter((f) => f.nextCorner);
    expect(hinted.length).toBeGreaterThan(frames.length * 0.9);
    const h = hinted.find((f) => f.nextCorner!.cornerId === 'T3')!.nextCorner!;
    expect(h.referenceBrakePointM).not.toBeNull();
    expect(h.referenceMinSpeedKmh).toBeGreaterThan(40);
    expect(h.referenceMinSpeedKmh).toBeLessThan(120);
    expect(frames.some((f) => f.nextCorner?.lastPassDeltaMs !== null)).toBe(true);
    expect(frames.some((f) => (f.fuel.energyRecovery ?? 0) > 5)).toBe(true);
    const last = frames.at(-1)!;
    // Total needed to the flag (core semantics), not the amount to add.
    expect(last.fuel.neededToFinish!).toBeGreaterThan(last.fuel.perLapAvg!);
  });
});

describe('corner pass tracker on mock frames', () => {
  it('measures every corner close to the reference targets', () => {
    const s = new MockSession({ seed: 8, skipMenu: true });
    const tr = new CornerPassTracker();
    const passes: CornerPass[] = [];
    for (let i = 0; i < 60 * 190; i++) {
      const { frame: f } = s.step(1000 / 60);
      if (i % 2) continue; // ~30 Hz like the server
      const p = tr.push({
        t: f.t,
        onTrack: f.state === 'onTrack',
        distanceM: f.distanceM,
        lengthM: f.track?.lengthM ?? null,
        speedKmh: f.car.speedKmh,
        brake: f.car.brake,
        throttle: f.car.throttle,
        gear: f.car.gear,
        hint: f.nextCorner,
      });
      if (p) passes.push(p);
    }
    expect(new Set(passes.map((p) => p.cornerId)).size).toBeGreaterThanOrEqual(8);
    const braked = passes.filter((p) => p.brakeM !== null && p.ref.brakeM !== null);
    expect(braked.length).toBeGreaterThan(5);
    // Mistake laps (random slow zone) brake far off; the clean passes are close to the target.
    const close = braked.filter((p) => {
      const d = Math.abs(p.brakeM! - p.ref.brakeM!);
      return Math.min(d, s.track.lengthM - d) < 25 && Math.abs(p.vminKmh - p.ref.vminKmh!) < 15;
    });
    expect(close.length / braked.length).toBeGreaterThan(0.75);
    expect(passes.every((p) => assessPass(p, null).items.length === 3)).toBe(true);
  });
});
