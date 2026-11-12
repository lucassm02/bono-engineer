import { describe, expect, it } from 'vitest';
import { CornerDrillTracker, type DrillSample } from './corner-drill.ts';

const L = 3000;
const DT = 1000 / 60;
const KMH = 100;

/** Drives from `from` to `to` (m, may wrap) at constant speed; calls `each` for every sample. */
const POS = new WeakMap<object, number>();

function drive(
  t: CornerDrillTracker,
  from: number,
  to: number,
  opts: {
    jump?: boolean;
    kmh?: number;
    brake?: (toEntry: number) => number;
    at?: number;
    entry?: number;
  } = {},
) {
  const mps = (opts.kmh ?? KMH) / 3.6;
  // continues from where the car is, unless the test moves it (jump)
  const start = opts.jump ? from : (POS.get(t) ?? from);
  const total = (((to - start) % L) + L) % L || L;
  const passes = [];
  let d = start;
  let travelled = 0;
  const step = mps * (DT / 1000);
  while (travelled < total) {
    d += step;
    travelled += step;
    const toEntry = ((((opts.entry ?? 1000) - d) % L) + L) % L;
    const s: DrillSample = {
      distanceM: d,
      dtMs: DT,
      speedKmh: opts.kmh ?? KMH,
      brake: opts.brake?.(toEntry) ?? 0,
      at: (opts.at ?? 0) + Math.round((travelled / mps) * 1000),
    };
    const p = t.step(s);
    if (p) passes.push(p);
  }
  POS.set(t, d);
  return passes;
}

const tracker = (entryM = 1000, exitM = 1100, extra = {}) =>
  new CornerDrillTracker({
    corner: { id: 'T7', name: 'Hairpin', entryM, exitM },
    lengthM: L,
    startedAt: 1,
    ...extra,
  });

describe('CornerDrillTracker', () => {
  it('measures the stretch between entry and exit by position', () => {
    const t = tracker();
    const passes = drive(t, 800, 1300);
    expect(passes).toHaveLength(1);
    // 100 m at 100 km/h = 3.6 s
    expect(passes[0]!.timeMs).toBeGreaterThan(3590);
    expect(passes[0]!.timeMs).toBeLessThan(3610);
    expect(passes[0]).toMatchObject({
      n: 1,
      entrySpeedKmh: 100,
      minSpeedKmh: 100,
      exitSpeedKmh: 100,
    });
  });

  it('measures the same region on every pass, lap after lap', () => {
    const t = tracker();
    const first = drive(t, 800, 1300);
    drive(t, 1300, 800 + L); // the rest of the lap
    const second = drive(t, 800, 1300);
    expect(second[0]!.n).toBe(2);
    expect(Math.abs(second[0]!.timeMs - first[0]!.timeMs)).toBeLessThan(20);
    expect(t.passes).toHaveLength(2);
  });

  it('measures a corner that straddles the start line', () => {
    const t = tracker(2950, 50, {});
    const passes = drive(t, 2700, 300, { entry: 2950 });
    expect(passes).toHaveLength(1);
    // 100 m (2950 → 3050) at 100 km/h
    expect(passes[0]!.timeMs).toBeGreaterThan(3590);
    expect(passes[0]!.timeMs).toBeLessThan(3610);
  });

  it('records where braking started, in metres before the entry', () => {
    const t = tracker();
    // brakes from 120 m before the entry until the entry
    const passes = drive(t, 700, 1300, { brake: (toEntry) => (toEntry <= 120 ? 0.8 : 0) });
    expect(passes[0]!.brakePointM).toBeGreaterThan(112);
    expect(passes[0]!.brakePointM).toBeLessThan(122);
  });

  it('reports no brake point when the corner is taken without braking', () => {
    const t = tracker();
    expect(drive(t, 700, 1300)[0]!.brakePointM).toBeNull();
  });

  it('forgets an early brake that was released long before the corner', () => {
    const t = tracker();
    const brake = (toEntry: number) => (toEntry > 250 && toEntry < 300 ? 0.6 : 0);
    expect(drive(t, 600, 1300, { brake })[0]!.brakePointM).toBeNull();
  });

  it('keeps the slowest speed of the corner and the exit speed', () => {
    const t = tracker();
    drive(t, 800, 1020); // fast into the corner
    drive(t, 1020, 1060, { kmh: 60 }); // slow in the middle
    const passes = drive(t, 1060, 1300, { kmh: 90 });
    expect(passes).toHaveLength(1);
    expect(passes[0]!.minSpeedKmh).toBe(60);
    expect(passes[0]!.entrySpeedKmh).toBe(100);
  });

  it('drops a pass where the car nearly stopped', () => {
    const t = tracker();
    drive(t, 800, 1040);
    drive(t, 1040, 1050, { kmh: 3 });
    expect(drive(t, 1050, 1300)).toEqual([]);
    expect(t.passes).toHaveLength(0);
  });

  it('gives up a half-measured pass after a jump, and keeps the finished ones', () => {
    const t = tracker();
    drive(t, 800, 1300);
    drive(t, 1300, 1500);
    // on the next lap the car is inside the corner and teleports away (a restart)
    drive(t, 1500, 1040 + L);
    drive(t, 2200, 800 + L, { jump: true });
    expect(drive(t, 800, 1300)).toHaveLength(1);
    expect(t.passes.map((p) => p.n)).toEqual([1, 2]);
  });

  it('describes the drill for the frame: phase, last 10 passes and the best', () => {
    const t = tracker(1000, 1100, { targetMs: 3400, referenceBrakeM: 110 });
    drive(t, 0, 700);
    expect(t.frame()).toMatchObject({ phase: 'approach', count: 0, best: null, targetMs: 3400 });
    expect(t.frame().distanceToEntryM).toBeGreaterThan(290);
    for (let i = 0; i < 12; i++) {
      drive(t, 700, 1300, { kmh: 100 - i });
      drive(t, 1300, 700 + L);
    }
    const f = t.frame();
    expect(f.count).toBe(12);
    expect(f.passes).toHaveLength(10);
    expect(f.passes.at(-1)!.n).toBe(12);
    expect(f.best!.n).toBe(1); // the fastest was the first (the highest speed)
    expect(f.referenceBrakeM).toBe(110);
  });
});
