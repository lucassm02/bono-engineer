import { describe, expect, it } from 'vitest';
import real from './fixtures/real-replay-paths.json';
import { guessLayoutByPath, PATH_GUESS_THRESHOLDS, pathIsClosed } from './index.ts';

/** Real paths of the car that runs in the background of the pre-race screen (PS5, 2026-11-13). */
type Path = { x: number[]; z: number[] };
const trial: Path = real.trialMountain;
const suzuka: Path = real.suzukaEast;
const atlanta: Path = real.roadAtlanta;

/** The first `meters` of a path. */
function prefix(p: Path, meters: number): Path {
  let acc = 0;
  let n = 1;
  while (n < p.x.length && acc < meters) {
    acc += Math.hypot(p.x[n]! - p.x[n - 1]!, p.z[n]! - p.z[n - 1]!);
    n++;
  }
  return { x: p.x.slice(0, n), z: p.z.slice(0, n) };
}

/** The path up to the point where it first closes on itself (one loop). */
function oneLoop(p: Path): Path {
  for (let n = 10; n <= p.x.length; n++) {
    const cut = { x: p.x.slice(0, n), z: p.z.slice(0, n) };
    if (pathIsClosed(cut)) return cut;
  }
  throw new Error('the path never closes');
}

describe('guessLayoutByPath (real replay paths)', () => {
  it('names Trial Mountain from the first 150 m', () => {
    const g = guessLayoutByPath(prefix(trial, 150));
    expect(g.level).toBe('layout');
    expect(g.venue).toBe('Trial Mountain Circuit');
    expect(g.layoutLabel).toBeNull();
  });

  it('names Road Atlanta from the first 150 m, far ahead of any other circuit', () => {
    const g = guessLayoutByPath(prefix(atlanta, 150));
    expect(g.level).toBe('layout');
    expect(g.venue).toMatch(/Road Atlanta/);
    expect(g.candidates[1]!.cost).toBeGreaterThan(g.candidates[0]!.cost * 5);
  });

  it('names the circuit of Suzuka but not the layout while Full and East share the path', () => {
    for (const m of [100, 150, 300, 800]) {
      const g = guessLayoutByPath(prefix(suzuka, m));
      expect(g.venue, `${m} m`).toBe('Suzuka Circuit');
      expect(g.level, `${m} m`).toBe('venue');
      expect(g.layoutId).toBeNull();
    }
  });

  it('names the layout of Suzuka once the path closes (the length tells East from Full)', () => {
    const loop = oneLoop(suzuka);
    const g = guessLayoutByPath(loop, { closed: true });
    expect(g.level).toBe('layout');
    expect(g.closed).toBe(true);
    expect(g.candidates[0]!.layout.displayName).toBe('Suzuka Circuit – East Course');
    // even without the length filter a whole loop no longer fits inside the Full Course line
    expect(guessLayoutByPath(loop).venue).toBe('Suzuka Circuit');
  });

  it('is not fooled by the reverse direction', () => {
    const p = prefix(atlanta, 800);
    const rev = { x: [...p.x].reverse(), z: [...p.z].reverse() };
    const g = guessLayoutByPath(rev);
    expect(g.layoutId).toBeNull();
    expect(g.venue === null || !/Road Atlanta/.test(g.venue)).toBe(true);
  });

  it('says nothing for a path that is too short or on no known track', () => {
    expect(guessLayoutByPath(prefix(atlanta, PATH_GUESS_THRESHOLDS.minPathM - 40)).level).toBe(
      'none',
    );
    const far = {
      x: Array.from({ length: 80 }, (_, i) => 1e5 + i * 8),
      z: Array.from({ length: 80 }, () => 1e5),
    };
    expect(guessLayoutByPath(far).level).toBe('none');
  });

  it('ignores non-finite samples', () => {
    const p = prefix(trial, 300);
    const x = [...p.x];
    x[5] = Number.NaN;
    expect(guessLayoutByPath({ x, z: p.z }).venue).toBe('Trial Mountain Circuit');
  });
});

describe('pathIsClosed', () => {
  it('is false for a short or open path and true after a full loop', () => {
    expect(pathIsClosed(prefix(suzuka, 300))).toBe(false);
    expect(pathIsClosed(prefix(suzuka, 1500))).toBe(false);
    expect(pathIsClosed(suzuka)).toBe(true);
  });
});
