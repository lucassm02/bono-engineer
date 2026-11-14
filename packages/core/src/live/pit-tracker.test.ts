import { describe, expect, it } from 'vitest';
import { PIT_MIN_STOP_MS, type PitInput, type PitSignal, PitTracker } from './pit-tracker.ts';

const base: PitInput = {
  at: 0,
  carOnTrack: true,
  loading: false,
  paused: false,
  handBrake: false,
  speedMps: 50,
  lapCount: 5,
  totalLaps: 0,
  x: -98,
  z: 818,
};

/** Feeds `inputs` (each one a patch of the previous) and returns the signals. */
function run(inputs: Partial<PitInput>[]): PitSignal[] {
  const t = new PitTracker();
  const out: PitSignal[] = [];
  let cur = { ...base };
  for (const p of inputs) {
    cur = { ...cur, ...p };
    const s = t.update(cur);
    if (s) out.push(s);
  }
  return out;
}

/** The sequence of the real capture: driving, pause, loading, the car in its box, then away. */
const visit = (standMs: number): Partial<PitInput>[] => [
  { at: 1000 },
  { at: 2000, paused: true },
  { at: 4000, paused: false, loading: true, speedMps: 0, x: 163, z: 845 },
  { at: 4100, loading: false },
  { at: 4000 + standMs, speedMps: 0 },
  { at: 4100 + standMs, speedMps: 21, x: 113 },
];

describe('PitTracker', () => {
  it('sees the visit when the car leaves the box, dated at the arrival', () => {
    const out = run(visit(13_000));
    expect(out).toEqual([{ at: 4000, exitAt: 17_100, lap: 5 }]);
  });

  it('is not a visit when the car stood only a moment (a reset of the car)', () => {
    expect(run(visit(PIT_MIN_STOP_MS - 1000))).toEqual([]);
  });

  it('is not a visit when the lap counter fell (a restart)', () => {
    const v = visit(13_000);
    v[2] = { ...v[2]!, lapCount: 0 };
    expect(run(v)).toEqual([]);
  });

  it('is not a visit at a rolling start (the car moves) or on the grid (handbrake)', () => {
    const rolling = visit(13_000);
    rolling[2] = { ...rolling[2]!, speedMps: 22 };
    expect(run(rolling)).toEqual([]);
    const grid = visit(13_000);
    grid[2] = { ...grid[2]!, handBrake: true };
    expect(run(grid)).toEqual([]);
  });

  it('is not a visit when the car does not move far (a pause that loads)', () => {
    const v = visit(13_000);
    v[2] = { ...v[2]!, x: -90, z: 818 };
    expect(run(v)).toEqual([]);
  });

  it('a menu in between cancels it (back to the garage from the box)', () => {
    const v = visit(13_000);
    v.splice(4, 0, { at: 9000, carOnTrack: false });
    expect(run(v)).toEqual([]);
  });

  it('two visits are two signals', () => {
    const second = visit(8000).map((p) => ({ ...p, at: (p.at ?? 0) + 100_000 }));
    const out = run([...visit(13_000), ...second]);
    expect(out).toHaveLength(2);
    expect(out[1]!.at).toBe(104_000);
  });

  it('a pause inside the box does not end the visit', () => {
    const v = visit(13_000);
    v.splice(4, 0, { at: 8000, paused: true }, { at: 9000, paused: false });
    expect(run(v)).toHaveLength(1);
  });
});
