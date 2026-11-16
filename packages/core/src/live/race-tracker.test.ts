import { describe, expect, it } from 'vitest';
import real from './fixtures/two-online-races.json';
import { type RaceInput, type RaceSignal, RaceTracker } from './race-tracker.ts';

const T0 = 1_700_000_000_000;

/** Runs the tracker over the reduced real recording (two Sport Mode races at Trial Mountain). */
function runReal(untilS = Number.POSITIVE_INFINITY): {
  signals: RaceSignal[];
  tracker: RaceTracker;
  atS: (s: RaceSignal) => number;
} {
  const tracker = new RaceTracker();
  const signals: RaceSignal[] = [];
  let prevT = real.rows[0]![0]!;
  for (const r of real.rows) {
    if (r[0]! / 1000 > untilS) break;
    const [tMs, totalLaps, lapCount, position, cars, flags, speedMps, vx, vy, vz] = r as number[];
    const dt = (tMs! - prevT) / 1000;
    prevT = tMs!;
    signals.push(
      ...tracker.update({
        at: T0 + tMs!,
        dtS: dt <= 0.05 ? 1 / 60 : dt,
        totalLaps: totalLaps!,
        lapCount: lapCount!,
        position: position!,
        cars: cars!,
        speedMps: speedMps!,
        velocity: { x: vx!, y: vy!, z: vz! },
        onTrack: (flags! & 1) === 1 && (flags! & 4) === 0,
        loading: (flags! & 4) !== 0,
        paused: (flags! & 2) !== 0,
        distanceM: null,
      }),
    );
  }
  return { signals, tracker, atS: (s) => (s.at - T0) / 1000 };
}

describe('RaceTracker on two real online races', () => {
  const { signals, tracker, atS } = runReal();
  const of = <K extends RaceSignal['type']>(type: K) =>
    signals.filter((s): s is Extract<RaceSignal, { type: K }> => s.type === type);

  it('starts each race when totalLaps appears (0 → 4), not at the grid', () => {
    const starts = of('start');
    expect(starts).toHaveLength(2);
    expect(starts.map((s) => Math.round(atS(s)))).toEqual([208, 1375]);
    for (const s of starts) {
      expect(s.totalLaps).toBe(4);
      expect(s.midRace).toBe(false);
      expect(s.lobby.cars).toBe(15);
    }
  });

  it('reads the start position once the cars move: 4th and 3rd of 15', () => {
    expect(of('startPosition').map((s) => [s.position, s.cars])).toEqual([
      [4, 15],
      [3, 15],
    ]);
  });

  it('the chequered flag: 5th of 15 and 6th of 12, once each', () => {
    const f = of('finish');
    expect(f.map((s) => [s.position, s.cars, s.totalLaps])).toEqual([
      [5, 15, 4],
      [6, 12, 4],
    ]);
    // the lap counter passed lap 4 at 766 s (race 1) and 1940 s (race 2); the results began 22 s and
    // 11 s later (totalLaps back to 0), and the position can still move in between
    expect(f.map((s) => Math.round((s.flagAt - T0) / 1000))).toEqual([766, 1940]);
  });

  it('follows the stable position of race 2: P3 → P10 on lap 1, then back to P6', () => {
    const second = of('position').filter((s) => s.stable && atS(s) > 1375);
    expect(second[0]).toMatchObject({ from: 3, to: 4, lap: 1 });
    expect(second.some((s) => s.to === 10 && s.lap === 1)).toBe(true);
    // the last position held during the race is P7; the P6 of the result comes after the flag
    expect(second.at(-1)!.to).toBe(7);
  });

  it('counts the cars that left the race (15 → 12 in race 2)', () => {
    const c = of('cars').filter((s) => atS(s) > 1375);
    expect(c.map((s) => [s.from, s.to])).toEqual([
      [15, 14],
      [14, 13],
      [13, 12],
    ]);
  });

  it('finds the impacts: 2 in race 1 (lap 3) and 5 in race 2, none at the start', () => {
    const imp = of('impact');
    const r1 = imp.filter((s) => atS(s) < 1000);
    const r2 = imp.filter((s) => atS(s) > 1000);
    expect(r1.map((s) => s.lap)).toEqual([3, 3]);
    expect(r2.map((s) => s.lap)).toEqual([1, 2, 3, 4, 4]);
    for (const s of imp) {
      expect(s.dvMs2).toBeGreaterThan(80);
      expect(s.speedBeforeKmh - s.speedAfterKmh).toBeGreaterThanOrEqual(6);
    }
  });

  it('latches after the flag (the results screen looks like a grid) and releases off the track', () => {
    // 8 s after the first flag the car is still on the track, on the results "grid"
    const after = runReal(796);
    expect(after.tracker.state).toBe('finished');
    expect(after.tracker.latched).toBe(true);
    expect(after.tracker.totalLaps).toBe(4);
    expect(after.tracker.displayLap(5)).toBe(4);
    expect(after.signals.filter((s) => s.type === 'start')).toHaveLength(1);
    // the full recording goes on to the menu: released, and no phantom race in between
    expect(tracker.state).toBe('idle');
    expect(tracker.latched).toBe(false);
  });
});

function input(patch: Partial<RaceInput>): RaceInput {
  return {
    at: T0,
    dtS: 1 / 60,
    totalLaps: 0,
    lapCount: 0,
    position: 0,
    cars: 0,
    speedMps: 0,
    velocity: { x: 0, y: 0, z: 0 },
    onTrack: true,
    loading: false,
    paused: false,
    distanceM: null,
    ...patch,
  };
}

describe('RaceTracker rules', () => {
  it('detects the grid when the race length arrived before the car was on track', () => {
    const t = new RaceTracker();
    expect(t.update(input({ totalLaps: 4, onTrack: false }))).toEqual([]);
    const start = t.update(input({ at: T0 + 50, totalLaps: 4, position: 3, cars: 10 }));
    expect(start[0]).toMatchObject({ type: 'start', at: T0 + 50, midRace: false });
    expect(t.live?.startedAt).toBe(T0 + 50);
  });

  it('never opens a race from a grid-looking packet without totalLaps', () => {
    const t = new RaceTracker();
    for (let i = 0; i < 100; i++) {
      expect(t.update(input({ at: T0 + i * 16, position: 2, cars: 15, lapCount: 0 }))).toEqual([]);
    }
    expect(t.state).toBe('idle');
    expect(t.live).toBeNull();
  });

  it('holds the lap counter at the total once the flag falls (never N + 1)', () => {
    const t = new RaceTracker();
    t.update(input({ at: T0, totalLaps: 4, lapCount: 0, position: 3, cars: 10 }));
    expect(t.displayLap(1)).toBe(1);
    expect(t.displayLap(5)).toBe(4);
    const out = t.update(
      input({ at: T0 + 1000, totalLaps: 0, lapCount: 5, position: 3, cars: 10 }),
    );
    expect(out.map((s) => s.type)).toEqual(['finish']);
    expect(t.live?.state).toBe('finished');
    expect(t.displayLap(5)).toBe(4);
  });

  it('against the AI the flag keeps totalLaps: the counter is held at once, the result is fixed when the car leaves the track', () => {
    // measured: lap 6 of 5 with totalLaps still 5 until the menu, 9 s later
    const t = new RaceTracker();
    t.update(input({ at: T0, totalLaps: 5, lapCount: 0, position: 16, cars: 16 }));
    t.update(
      input({ at: T0 + 1000, totalLaps: 5, lapCount: 1, position: 16, cars: 16, speedMps: 40 }),
    );
    const flag = t.update(
      input({ at: T0 + 60_000, totalLaps: 5, lapCount: 6, position: 2, cars: 16, speedMps: 45 }),
    );
    expect(flag).toEqual([]); // nothing is final yet
    expect(t.latched).toBe(true);
    expect(t.displayLap(6)).toBe(5);
    expect(t.live?.chequered).toEqual({ at: T0 + 60_000, position: 2 });
    // the others cross the line: the position moves
    t.update(
      input({ at: T0 + 62_000, totalLaps: 5, lapCount: 6, position: 3, cars: 16, speedMps: 45 }),
    );
    // the results screen / the replay: off the track, with the grid-looking values
    const end = t.update(
      input({ at: T0 + 69_000, totalLaps: 5, lapCount: 0, position: 16, cars: 16, onTrack: false }),
    );
    expect(end).toHaveLength(1);
    expect(end[0]).toMatchObject({ type: 'finish', position: 3, cars: 16, totalLaps: 5 });
    expect(t.live?.result).toEqual({ at: T0 + 69_000, position: 3 });
    expect(t.live?.chequered).toEqual({ at: T0 + 60_000, position: 2 });
    expect((end[0] as { flagAt: number }).flagAt).toBe(T0 + 60_000);
  });

  it('the grid-looking packets of the results screen are not the result', () => {
    const t = new RaceTracker();
    t.update(input({ at: T0, totalLaps: 4, lapCount: 1, position: 4, cars: 15, speedMps: 40 }));
    t.update(
      input({ at: T0 + 1000, totalLaps: 4, lapCount: 5, position: 5, cars: 15, speedMps: 40 }),
    );
    // totalLaps back to 0 with the position of the results grid
    const out = t.update(
      input({ at: T0 + 15_000, totalLaps: 0, lapCount: 5, position: 2, cars: 14 }),
    );
    expect(out[0]).toMatchObject({ type: 'finish', position: 5, cars: 15 });
    expect(t.live?.result).toEqual({ at: T0 + 15_000, position: 5 });
  });

  it('a restart (lap counter back to 0, same totalLaps) begins a new attempt', () => {
    // measured: lap 5 → 0, P3 → P16, totalLaps 5 → 5, a loading flicker and the car back at 80 km/h
    const t = new RaceTracker();
    t.update(input({ at: T0, totalLaps: 5, lapCount: 0, position: 16, cars: 16 }));
    for (const [ms, lap, pos] of [
      [1000, 1, 16],
      [60_000, 3, 5],
      [200_000, 5, 3],
    ] as const) {
      t.update(
        input({ at: T0 + ms, totalLaps: 5, lapCount: lap, position: pos, cars: 16, speedMps: 40 }),
      );
    }
    // the loading packet comes first: on the track but loading (no signal yet)
    t.update(
      input({
        at: T0 + 209_900,
        totalLaps: 5,
        lapCount: 0,
        position: 16,
        cars: 16,
        onTrack: false,
        loading: true,
        speedMps: 22,
      }),
    );
    const out = t.update(
      input({ at: T0 + 210_000, totalLaps: 5, lapCount: 0, position: 16, cars: 16, speedMps: 22 }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: 'start',
      restartedFromLap: 5,
      midRace: false,
      totalLaps: 5,
    });
    expect(t.state).toBe('racing');
    expect(t.live?.startPosition).toBeNull(); // read again once the car moves
    const after = t.update(
      input({ at: T0 + 211_000, totalLaps: 5, lapCount: 0, position: 16, cars: 16, speedMps: 22 }),
    );
    expect(after[0]).toMatchObject({ type: 'startPosition', position: 16 });
  });

  it('a restart before the first crossing of the line (the counter stays 0) is seen by the loading flicker', () => {
    const t = new RaceTracker();
    t.update(input({ at: T0, totalLaps: 5, lapCount: 0, position: 16, cars: 16, speedMps: 22 }));
    t.update(
      input({ at: T0 + 3000, totalLaps: 5, lapCount: 0, position: 14, cars: 16, speedMps: 40 }),
    );
    // 9 s into the rolling start, before the line: the driver restarts
    t.update(
      input({
        at: T0 + 9000,
        totalLaps: 5,
        lapCount: 0,
        position: 16,
        cars: 16,
        onTrack: false,
        loading: true,
        speedMps: 22,
      }),
    );
    const out = t.update(
      input({ at: T0 + 9500, totalLaps: 5, lapCount: 0, position: 16, cars: 16, speedMps: 22 }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'start', restartedFromLap: 0, totalLaps: 5 });
    // and the same flicker never restarts it again
    const next = t.update(
      input({ at: T0 + 9600, totalLaps: 5, lapCount: 0, position: 16, cars: 16, speedMps: 22 }),
    );
    expect(next.some((s) => s.type === 'start')).toBe(false);
  });

  it('the loading flicker of the start itself is not a restart', () => {
    const t = new RaceTracker();
    t.update(input({ at: T0, totalLaps: 5, lapCount: 0, position: 1, cars: 16, speedMps: 36 }));
    t.update(
      input({
        at: T0 + 300,
        totalLaps: 5,
        lapCount: 0,
        position: 16,
        cars: 16,
        onTrack: false,
        loading: true,
      }),
    );
    const out = t.update(
      input({ at: T0 + 800, totalLaps: 5, lapCount: 0, position: 16, cars: 16, speedMps: 22 }),
    );
    expect(out.some((s) => s.type === 'start')).toBe(false);
  });

  it('reads the grid slot after the loading flicker, not the stale position before it', () => {
    // measured: the first packets said P1 (the lobby) for a second, then the real slot P16
    const t = new RaceTracker();
    t.update(input({ at: T0, totalLaps: 5, lapCount: 0, position: 1, cars: 16, speedMps: 36 }));
    expect(t.live?.startPosition).toBeNull();
    t.update(
      input({
        at: T0 + 20,
        totalLaps: 5,
        lapCount: 0,
        position: 16,
        cars: 16,
        onTrack: false,
        loading: true,
        speedMps: 22,
      }),
    );
    const out = t.update(
      input({ at: T0 + 600, totalLaps: 5, lapCount: 0, position: 16, cars: 16, speedMps: 22 }),
    );
    expect(out.find((s) => s.type === 'startPosition')).toMatchObject({ position: 16 });
  });

  it('stale race packets after the flag, interleaved with the menu, never start another race', () => {
    // measured: totalLaps flips between -1 (menu) and 5 (the old stream, lap 6) for several seconds
    const t = new RaceTracker();
    t.update(input({ at: T0, totalLaps: 5, lapCount: 1, position: 2, cars: 16, speedMps: 40 }));
    t.update(
      input({ at: T0 + 1000, totalLaps: 5, lapCount: 6, position: 2, cars: 16, speedMps: 40 }),
    );
    const sig: RaceSignal[] = [];
    for (let k = 0; k < 6; k++) {
      sig.push(
        ...t.update(
          input({
            at: T0 + 9000 + k * 100,
            totalLaps: -1,
            lapCount: -1,
            onTrack: false,
            position: -1,
            cars: -1,
          }),
        ),
      );
      sig.push(
        ...t.update(
          input({ at: T0 + 9050 + k * 100, totalLaps: 5, lapCount: 6, position: 2, cars: 16 }),
        ),
      );
    }
    expect(sig.filter((s) => s.type === 'start')).toEqual([]);
    expect(sig.filter((s) => s.type === 'finish')).toHaveLength(1);
    expect(t.latched).toBe(true);
  });

  it('a lap counter that is 0 in a replay of the race (not on the track) is not a restart', () => {
    const t = new RaceTracker();
    t.update(input({ at: T0, totalLaps: 5, lapCount: 3, position: 4, cars: 16, speedMps: 40 }));
    const out = t.update(
      input({ at: T0 + 100, totalLaps: 5, lapCount: 0, position: 16, cars: 16, onTrack: false }),
    );
    expect(out).toEqual([]);
    expect(t.state).toBe('racing');
  });

  it('a race left through the menu is not a finish', () => {
    const t = new RaceTracker();
    t.update(input({ at: T0, totalLaps: 4, lapCount: 1, position: 3, cars: 10 }));
    const out = t.update(input({ at: T0 + 100, totalLaps: -1, lapCount: -1, onTrack: false }));
    expect(out).toEqual([]);
    expect(t.state).toBe('idle');
  });

  it('joining a race that is already running is a start without a start position', () => {
    const t = new RaceTracker();
    const out = t.update(input({ at: T0, totalLaps: 6, lapCount: 3, position: 5, cars: 12 }));
    expect(out[0]).toMatchObject({ type: 'start', midRace: true });
    t.update(
      input({ at: T0 + 500, totalLaps: 6, lapCount: 3, position: 5, cars: 12, speedMps: 40 }),
    );
    expect(t.live?.startPosition).toBeNull();
    expect(t.live?.gained).toBeNull();
  });

  it('a position that flips for a second is not a change; one held for 2 s is', () => {
    const t = new RaceTracker();
    const sig: RaceSignal[] = [];
    const run = (ms: number, position: number) => {
      sig.push(
        ...t.update(
          input({ at: T0 + ms, totalLaps: 4, lapCount: 1, position, cars: 10, speedMps: 30 }),
        ),
      );
    };
    run(0, 5);
    run(100, 5);
    for (let ms = 200; ms <= 4000; ms += 100) run(ms, 5); // settles the start position at 5
    for (let ms = 4100; ms <= 4900; ms += 100) run(ms, 6); // 0.8 s at 6…
    for (let ms = 5000; ms <= 6000; ms += 100) run(ms, 5); // …and back
    expect(sig.filter((s) => s.type === 'position' && s.stable)).toEqual([]);
    for (let ms = 6100; ms <= 9000; ms += 100) run(ms, 4); // held: a real change
    const changes = sig.filter((s) => s.type === 'position' && s.stable);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ from: 5, to: 4 });
    expect(t.live?.gained).toBe(1);
  });

  it('a jump of acceleration without a loss of speed is not an impact', () => {
    const t = new RaceTracker();
    const sig: RaceSignal[] = [];
    let at = T0;
    const step = (v: number, speed: number) => {
      at += 16;
      sig.push(
        ...t.update(
          input({
            at,
            totalLaps: 4,
            lapCount: 1,
            position: 3,
            cars: 10,
            speedMps: speed,
            velocity: { x: v, y: 0, z: 0 },
          }),
        ),
      );
    };
    for (let i = 0; i < 400; i++) step(40, 40); // 3 s of quiet start + cruising
    step(45, 40); // 5 m/s in one packet = 300 m/s², but the speed holds
    for (let i = 0; i < 40; i++) step(45, 40);
    expect(sig.filter((s) => s.type === 'impact')).toEqual([]);
  });
});
