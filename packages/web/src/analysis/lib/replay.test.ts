import { describe, expect, it } from 'vitest';
import { parseRoute, routes } from '../../lib/route.ts';
import {
  advancePlayback,
  barFraction,
  buildClock,
  distanceAtTime,
  followRange,
  frameAt,
  ghostPoint,
  type LapClock,
  liveGap,
  MAX_FRAME_MS,
  pointAtDistance,
  pointAtTime,
  ReplayPlayer,
  sampleAt,
  shiftSpeed,
  stepTime,
  timeAtDistance,
} from './replay.ts';

// 0, 100, 200, 300, 400 m: the car accelerates, so each 100 m takes less time.
const grid = [0, 100, 200, 300, 400];
const slow = buildClock(grid, [0, 10, 18, 25, 31])!;
// A faster lap on the same track.
const fast = buildClock(grid, [0, 9, 16, 22, 27])!;

describe('buildClock', () => {
  it('starts at zero and keeps the duration', () => {
    expect(slow.durationS).toBe(31);
    expect(slow.timeS[0]).toBe(0);
    const shifted = buildClock(grid, [5, 15, 23, 30, 36])!;
    expect(shifted.timeS[0]).toBe(0);
    expect(shifted.durationS).toBe(31);
  });

  it('carries gaps forward, fills a leading gap and never goes back', () => {
    const c = buildClock(grid, [null, 4, null, 3, 9])!;
    expect(Array.from(c.timeS)).toEqual([0, 0, 0, 0, 5]);
    // Time never decreases even when a sample does.
    const m = buildClock(grid, [0, 10, 8, 20, 30])!;
    expect(Array.from(m.timeS)).toEqual([0, 10, 10, 20, 30]);
  });

  it('is null without a usable time channel', () => {
    expect(buildClock(grid, [null, null, null, null, null])).toBeNull();
    expect(buildClock([0], [0])).toBeNull();
    expect(buildClock(grid, [3, 3, 3, 3, 3])).toBeNull();
  });
});

describe('time ↔ distance', () => {
  it('interpolates between grid points', () => {
    expect(timeAtDistance(slow, 150)).toBeCloseTo(14);
    expect(distanceAtTime(slow, 14)).toBeCloseTo(150);
    expect(distanceAtTime(slow, 25)).toBeCloseTo(300);
  });

  it('is its own inverse over the lap', () => {
    for (const d of [0, 12.5, 100, 187, 399.9, 400]) {
      expect(distanceAtTime(slow, timeAtDistance(slow, d))).toBeCloseTo(d, 6);
    }
  });

  it('clamps outside the lap', () => {
    expect(timeAtDistance(slow, -20)).toBe(0);
    expect(timeAtDistance(slow, 999)).toBe(31);
    expect(distanceAtTime(slow, -1)).toBe(0);
    expect(distanceAtTime(slow, 99)).toBe(400);
  });

  it('stays on the line across flat clock segments (a data gap)', () => {
    const flat = buildClock([0, 10, 20, 30], [0, 1, 1, 2])!;
    const at = distanceAtTime(flat, 1);
    expect(at).toBeGreaterThanOrEqual(10);
    expect(at).toBeLessThanOrEqual(20);
    expect(distanceAtTime(flat, 1.5)).toBeCloseTo(25);
  });

  it('builds points from either side', () => {
    expect(pointAtTime(slow, 40)).toEqual({ timeS: 31, distanceM: 400 });
    const p = pointAtDistance(slow, 150);
    expect(p.distanceM).toBe(150);
    expect(p.timeS).toBeCloseTo(14);
  });
});

describe('ghost of the reference', () => {
  const at = pointAtDistance(slow, 200); // t = 18 s

  it('by distance: the reference is at the same distance', () => {
    const g = ghostPoint('distance', fast, at);
    expect(g.distanceM).toBe(200);
    expect(g.timeS).toBeCloseTo(16);
  });

  it('by time: the reference is where it was at the same lap clock', () => {
    const g = ghostPoint('time', fast, at);
    expect(g.timeS).toBe(18);
    // fast reaches 200 m at 16 s and 300 m at 22 s: at 18 s it is a third of the way.
    expect(g.distanceM).toBeCloseTo(200 + 100 / 3);
  });

  it('by time: the reference waits at the finish line when it ends first', () => {
    const late = pointAtTime(slow, 30);
    expect(ghostPoint('time', fast, late).distanceM).toBe(400);
  });

  it('live gap: delta by distance and the distance between the two cars', () => {
    const d = liveGap(slow, fast, 'distance', at);
    expect(d.deltaS).toBeCloseTo(2); // 18 − 16: slower
    expect(d.gapM).toBe(0);
    const t = liveGap(slow, fast, 'time', at);
    expect(t.deltaS).toBeCloseTo(2);
    expect(t.gapM).toBeLessThan(0); // the reference is ahead on the track
    expect(t.gapM).toBeCloseTo(-100 / 3);
  });

  it('live gap is negative when the subject is faster', () => {
    const p = pointAtDistance(fast, 300);
    expect(liveGap(fast, slow, 'distance', p).deltaS).toBeCloseTo(-3);
  });
});

describe('advancePlayback', () => {
  it('moves at the chosen speed', () => {
    expect(advancePlayback(10, 100, 1, 31).t).toBeCloseTo(10.1);
    expect(advancePlayback(10, 100, 0.25, 31).t).toBeCloseTo(10.025);
    expect(advancePlayback(10, 100, 2, 31).t).toBeCloseTo(10.2);
  });

  it('stops at the end of the lap', () => {
    expect(advancePlayback(30.95, 100, 1, 31)).toEqual({ t: 31, ended: true });
  });

  it('wraps around when looping', () => {
    const r = advancePlayback(30.95, 100, 1, 31, true);
    expect(r.ended).toBe(false);
    expect(r.t).toBeCloseTo(0.05);
  });

  it('a long frame does not make the car jump', () => {
    const r = advancePlayback(10, 60_000, 1, 31);
    expect(r.t).toBeCloseTo(10 + MAX_FRAME_MS / 1000);
    expect(advancePlayback(10, -50, 1, 31).t).toBe(10);
  });
});

describe('stepping and speed', () => {
  it('steps and clamps to the lap', () => {
    expect(stepTime(5, 0.1, 31)).toBeCloseTo(5.1);
    expect(stepTime(0.05, -0.1, 31)).toBe(0);
    expect(stepTime(30.99, 1, 31)).toBe(31);
  });

  it('shifts through the list of speeds', () => {
    expect(shiftSpeed(1, 1)).toBe(2);
    expect(shiftSpeed(1, -1)).toBe(0.5);
    expect(shiftSpeed(2, 1)).toBe(2);
    expect(shiftSpeed(0.25, -1)).toBe(0.25);
    expect(shiftSpeed(3, 1)).toBe(2);
  });
});

describe('sampleAt', () => {
  const brake = [0, 0.2, 1, 0.5, 0];
  it('interpolates a channel and keeps gaps as null', () => {
    expect(sampleAt(grid, brake, 150)).toBeCloseTo(0.6);
    expect(sampleAt(grid, [0, null, 1, 0.5, 0], 150)).toBeNull();
  });

  it('keeps the grid value for a stepped channel (gear)', () => {
    const gear = [2, 3, 3, 4, 4];
    expect(sampleAt(grid, gear, 99, true)).toBe(2);
    expect(sampleAt(grid, gear, 100, true)).toBe(3);
    expect(sampleAt(grid, gear, -5, true)).toBeNull();
  });
});

describe('followRange', () => {
  it('leaves the range alone while the car is inside', () => {
    const r: [number, number] = [100, 300];
    expect(followRange(r, 200, 5000)).toBe(r);
    expect(followRange(null, 200, 5000)).toBeNull();
  });

  it('keeps the width and moves the window to the car', () => {
    const r = followRange([100, 300], 900, 5000)!;
    expect(r[1] - r[0]).toBeCloseTo(200);
    expect(900).toBeGreaterThanOrEqual(r[0]);
    expect(900).toBeLessThanOrEqual(r[1]);
  });

  it('stays inside the lap and gives up when the window is the whole lap', () => {
    const r = followRange([100, 300], 4990, 5000)!;
    expect(r[1]).toBeLessThanOrEqual(5000);
    expect(followRange([0, 5000], 6000, 5000)).toBeNull();
  });
});

describe('barFraction', () => {
  it('scales to the full travel and clamps', () => {
    expect(barFraction(0.5, 1)).toBe(0.5);
    expect(barFraction(-90, 180)).toBe(0.5);
    expect(barFraction(400, 180)).toBe(1);
    expect(barFraction(null, 1)).toBeNull();
    expect(barFraction(Number.NaN, 1)).toBeNull();
  });
});

describe('a clock built from the real grid shape', () => {
  it('handles a 2.14 m grid like the traces endpoint returns', () => {
    const n = 2500;
    const d = Array.from({ length: n }, (_, i) => (i * 5344) / (n - 1));
    const t = d.map((x) => (x / 5344) * 119);
    const c: LapClock = buildClock(d, t)!;
    expect(c.durationS).toBeCloseTo(119);
    expect(distanceAtTime(c, 59.5)).toBeCloseTo(2672, 0);
  });
});

describe('frameAt', () => {
  const lapData = (clock: LapClock, offset = 0) => ({
    clock,
    series: {
      speed: grid.map((d) => 100 + d / 10 + offset),
      brake: [0, 0, 1, 0, 0],
      gear: [2, 3, 3, 4, 4],
      x: grid.map((d) => d),
      z: grid.map(() => 0),
    },
  });
  const a = lapData(slow);
  const b = lapData(fast, 5);

  it('samples the subject at the lap clock', () => {
    const f = frameAt(grid, a, null, 'distance', 14);
    expect(f.ghost).toBeNull();
    expect(f.gap).toBeNull();
    expect(f.subject.distanceM).toBeCloseTo(150);
    expect(f.subject.values.speed).toBeCloseTo(115);
    expect(f.subject.values.brake).toBeCloseTo(0.5);
    expect(f.subject.values.gear).toBe(3);
    expect(f.subject.values.x).toBeCloseTo(150);
  });

  it('puts the ghost at the same distance and reports the delta', () => {
    const f = frameAt(grid, a, b, 'distance', 18);
    expect(f.ghost!.distanceM).toBeCloseTo(200);
    expect(f.ghost!.values.speed).toBeCloseTo(125);
    expect(f.gap!.deltaS).toBeCloseTo(2);
  });

  it('puts the ghost where it was at the same lap clock', () => {
    const f = frameAt(grid, a, b, 'time', 18);
    expect(f.ghost!.timeS).toBe(18);
    expect(f.ghost!.distanceM).toBeGreaterThan(f.subject.distanceM);
    expect(f.gap!.gapM).toBeLessThan(0);
  });

  it('clamps the instant to the lap', () => {
    const f = frameAt(grid, a, null, 'distance', 999);
    expect(f.subject.distanceM).toBe(400);
    expect(f.subject.timeS).toBe(31);
  });
});

describe('ReplayPlayer', () => {
  /** A manual animation-frame scheduler: `flush(ms)` runs the next frame at that time. */
  function fakeScheduler() {
    let cb: ((now: number) => void) | null = null;
    return {
      scheduler: {
        request: (fn: (now: number) => void) => {
          cb = fn;
          return 1;
        },
        cancel: () => {
          cb = null;
        },
      },
      flush(now: number) {
        const fn = cb;
        cb = null;
        fn?.(now);
      },
      pending: () => cb !== null,
    };
  }

  it('plays in real time at the chosen speed', () => {
    const s = fakeScheduler();
    const p = new ReplayPlayer(31, s.scheduler);
    p.play();
    s.flush(1000); // first frame only sets the origin
    s.flush(1100);
    expect(p.state.timeS).toBeCloseTo(0.1);
    p.setSpeed(0.5);
    s.flush(1200);
    expect(p.state.timeS).toBeCloseTo(0.15);
    p.setSpeed(2);
    s.flush(1300);
    expect(p.state.timeS).toBeCloseTo(0.35);
  });

  it('pauses and stops asking for frames', () => {
    const s = fakeScheduler();
    const p = new ReplayPlayer(31, s.scheduler);
    p.play();
    s.flush(0);
    s.flush(100);
    p.pause();
    expect(p.state.playing).toBe(false);
    expect(s.pending()).toBe(false);
    const t = p.state.timeS;
    s.flush(500);
    expect(p.state.timeS).toBe(t);
  });

  it('seeks and steps inside the lap', () => {
    const p = new ReplayPlayer(31, fakeScheduler().scheduler);
    p.seek(12.34);
    expect(p.state.timeS).toBe(12.34);
    p.step(0.1);
    expect(p.state.timeS).toBeCloseTo(12.44);
    p.seek(-5);
    expect(p.state.timeS).toBe(0);
    p.seek(100);
    expect(p.state.timeS).toBe(31);
  });

  it('pauses at the end of the lap and starts over when played again', () => {
    const s = fakeScheduler();
    const p = new ReplayPlayer(31, s.scheduler);
    p.seek(30.95);
    p.play();
    s.flush(0);
    s.flush(100);
    expect(p.state).toMatchObject({ timeS: 31, playing: false });
    expect(s.pending()).toBe(false);
    p.play();
    expect(p.state.timeS).toBe(0);
    expect(p.state.playing).toBe(true);
  });

  it('notifies subscribers only when something changed, with a new state object', () => {
    const p = new ReplayPlayer(31, fakeScheduler().scheduler);
    let n = 0;
    const off = p.subscribe(() => n++);
    const before = p.state;
    p.seek(0);
    expect(n).toBe(0);
    p.seek(5);
    p.setSpeed(2);
    expect(n).toBe(2);
    expect(p.state).not.toBe(before);
    off();
    p.seek(6);
    expect(n).toBe(2);
  });

  it('a frame after a long pause does not jump', () => {
    const s = fakeScheduler();
    const p = new ReplayPlayer(31, s.scheduler);
    p.play();
    s.flush(0);
    s.flush(60_000);
    expect(p.state.timeS).toBeLessThan(0.3);
  });
});

describe('replay route', () => {
  it('builds and parses #/analysis/lap/:id with the reference, the ghost mode and a corner', () => {
    expect(routes.replay('L 1')).toBe('#/analysis/lap/L%201');
    const href = routes.replay('abc', { ref: 'bestReference', mode: 'time', corner: 'T4' });
    expect(href).toBe('#/analysis/lap/abc?ref=bestReference&mode=time&corner=T4');
    const r = parseRoute(href);
    expect(r.name).toBe('replay');
    expect(r.params.id).toBe('abc');
    expect(r.query).toMatchObject({ ref: 'bestReference', mode: 'time', corner: 'T4' });
    // distance is the default: no param
    expect(routes.replay('abc', { mode: 'distance' })).toBe('#/analysis/lap/abc');
  });

  it('does not match a missing id or extra segments', () => {
    expect(parseRoute('#/analysis/lap').name).toBe('notFound');
    expect(parseRoute('#/analysis/lap/a/b').name).toBe('notFound');
  });
});
