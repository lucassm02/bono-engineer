import { describe, expect, it } from 'vitest';
import real from '../../../shared/src/tracks/fixtures/real-replay-paths.json';
import { PATH_JUMP_M, ReplayPathTracker } from './replay-path.ts';

type Path = { x: number[]; z: number[] };
const atlanta: Path = real.roadAtlanta;
const suzuka: Path = real.suzukaEast;
const trial: Path = real.trialMountain;

/** Feeds the tracker with a path; returns the guess after each sample. */
function feed(t: ReplayPathTracker, p: Path, car: number, until = p.x.length) {
  const seen: (string | null)[] = [];
  for (let i = 0; i < until; i++) {
    t.add(p.x[i]!, p.z[i]!, car);
    seen.push(t.guess ? `${t.guess.level}:${t.guess.venue}` : null);
  }
  return seen;
}

describe('ReplayPathTracker', () => {
  it('has no guess before 100 m and names the circuit shortly after', () => {
    const t = new ReplayPathTracker();
    feed(t, atlanta, 3352, 10); // ~72 m
    expect(t.guess).toBeNull();
    const t2 = new ReplayPathTracker();
    feed(t2, atlanta, 3352, 40); // ~310 m
    expect(t2.guess?.venue).toMatch(/Road Atlanta/);
    expect(t2.guess?.level).toBe('layout');
  });

  it('starts as the circuit and settles on the layout when the loop closes (Suzuka)', () => {
    const t = new ReplayPathTracker();
    const seen = feed(t, suzuka, 688);
    expect(seen.find((s) => s !== null)).toBe('venue:Suzuka Circuit');
    expect(t.guess?.level).toBe('layout');
    expect(t.guess?.layoutId).not.toBeNull();
    expect(t.guess?.closed).toBe(true);
  });

  it('forgets the path when the car changes', () => {
    const t = new ReplayPathTracker();
    feed(t, atlanta, 3352, 60);
    expect(t.guess).not.toBeNull();
    t.add(atlanta.x[61]!, atlanta.z[61]!, 999);
    expect(t.guess).toBeNull();
    expect(t.pathM).toBe(0);
  });

  it('after a jump keeps the guess for the same car, but drops it once the new path fits nothing', () => {
    const t = new ReplayPathTracker();
    feed(t, atlanta, 3352, 60);
    const venue = t.guess?.venue;
    expect(venue).toBeTruthy();
    t.add(atlanta.x[59]! + PATH_JUMP_M * 2, atlanta.z[59]!, 3352);
    expect(t.pathM).toBe(0);
    expect(t.guess?.venue).toBe(venue);
    // the new path is nowhere near a known track
    for (let i = 1; i < 40; i++) t.add(1e5 + i * 8, 1e5, 3352);
    expect(t.guess).toBeNull();
  });

  it('reset() clears everything and reports changes', () => {
    const t = new ReplayPathTracker();
    let changed = 0;
    for (let i = 0; i < 60; i++) if (t.add(trial.x[i]!, trial.z[i]!, 3253)) changed++;
    expect(changed).toBeGreaterThan(0);
    t.reset();
    expect(t.guess).toBeNull();
    expect(t.pathM).toBe(0);
  });

  it('ignores non-finite positions', () => {
    const t = new ReplayPathTracker();
    expect(t.add(Number.NaN, 0, 1)).toBe(false);
    expect(t.pathM).toBe(0);
  });
});

describe('ReplayPathTracker after the clip restarts', () => {
  it('keeps the layout of the same car/circuit across the restart, drops it for another circuit', () => {
    const t = new ReplayPathTracker();
    feed(t, suzuka, 688);
    const layoutId = t.guess?.layoutId;
    expect(layoutId).toBeTruthy();
    // the clip restarts at the same place: a jump, the same car
    t.add(suzuka.x[0]! + 500, suzuka.z[0]!, 688);
    expect(t.guess?.layoutId).toBe(layoutId);
    // a short new path (venue-level) of the same circuit keeps the layout
    for (let i = 0; i < 20; i++) t.add(suzuka.x[i]!, suzuka.z[i]!, 688);
    expect(t.guess?.layoutId).toBe(layoutId);
    // another car on another circuit: the old guess is gone
    const t2 = new ReplayPathTracker();
    feed(t2, suzuka, 688);
    for (let i = 0; i < 30; i++) t2.add(atlanta.x[i]!, atlanta.z[i]!, 3352);
    expect(t2.guess?.venue).toMatch(/Road Atlanta/);
  });
});
