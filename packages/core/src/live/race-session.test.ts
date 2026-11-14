/**
 * A race through the engine (spec 21): the laps before it are a session of their own, the race
 * gets one, the lap counter never reads N + 1, and the results screen (which looks like a grid)
 * does not open a phantom session. Built from the synthetic lap generator, shaped like the two
 * real online races (lobby → countdown → laps → flag → results → menu).
 */

import { generateLaps } from '@gt7/protocol';
import { encodeFlags, type LiveFrame, type TelemetryPacket } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { LiveEngine, type SessionEndReason } from './live-engine.ts';

const MS = 1000 / 60;
const N = 2; // laps of the race

function make() {
  const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
  const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('x') });
  let t = 1_700_000_000_000;
  let id = 1;
  const frames: LiveFrame[] = [];
  const ended: SessionEndReason[] = [];
  engine.on('frame', (f) => frames.push(f));
  engine.on('sessionEnded', (_s, info) => ended.push(info.reason));
  const feed = (ps: TelemetryPacket[]) => {
    for (const p of ps) {
      t += MS;
      engine.push({ ...p, packetId: id++ }, t);
    }
  };
  const skip = (ms: number) => {
    t += ms;
  };
  return { engine, ctx, feed, frames, ended, skip, now: () => t };
}

const lapsOf = (seed: number, laps: number) =>
  generateLaps({ profile: 'pro', seed, laps, format: '~' }).packets;

const base = lapsOf(1, 1)[100]!;

function still(patch: Partial<TelemetryPacket>, n: number): TelemetryPacket[] {
  return Array.from({ length: n }, () => ({
    ...base,
    speedMps: 0,
    velocity: { x: 0, y: 0, z: 0 },
    ...patch,
  }));
}

const menu = (n: number) =>
  still(
    {
      flags: 0,
      carCode: 0,
      position: { x: 0, y: 0, z: 0 },
      totalLaps: -1,
      lapCount: -1,
      preRacePosition: -1,
      numCarsPreRace: -1,
    },
    n,
  );

/** The 2-lap race as the game sends it: totalLaps N, position 4 then 5, a hit on lap 2, flag at the end. */
function racePackets(keepTotal = false): TelemetryPacket[] {
  const laps = lapsOf(2, N);
  const hit = laps.findIndex((p) => p.lapCount === 2 && p.speedMps > 40);
  return laps.map((p, i) => {
    const flag = p.lapCount > N; // the game says lap N + 1 and totalLaps 0 at the flag
    const afterHit = i >= hit + 5 && i < hit + 25;
    return {
      ...p,
      // online the game zeroes totalLaps with the flag; against the AI it keeps N until the results
      totalLaps: flag && !keepTotal ? 0 : N,
      preRacePosition: p.lapCount >= 2 && i > hit + 600 ? 5 : 4,
      numCarsPreRace: 15,
      // a wall of 40 % of the speed in one packet at `hit`, held a few packets
      speedMps: i >= hit && i < hit + 25 ? p.speedMps * 0.6 : p.speedMps,
      velocity:
        i >= hit && i < hit + 25
          ? { x: p.velocity.x * 0.6, y: p.velocity.y * 0.6, z: p.velocity.z * 0.6 }
          : p.velocity,
      ...(afterHit ? {} : {}),
    };
  });
}

describe('a race through the engine', () => {
  const run = () => {
    const w = make();
    w.feed(lapsOf(1, 2)); // laps before: a session of their own
    w.feed(menu(120));
    // lobby: the cars arrive (9 → 15), handbrake on, standing
    for (const n of [9, 11, 13, 15]) {
      w.feed(
        still(
          {
            flags: encodeFlags({ carOnTrack: true, handBrake: true }),
            totalLaps: 0,
            lapCount: -1,
            preRacePosition: n,
            numCarsPreRace: n,
          },
          30,
        ),
      );
    }
    // countdown: totalLaps appears, the slot is 4th
    w.feed(
      still(
        {
          flags: encodeFlags({ carOnTrack: true }),
          totalLaps: N,
          lapCount: 0,
          preRacePosition: 4,
          numCarsPreRace: 15,
        },
        90,
      ),
    );
    const race = racePackets();
    w.feed(race);
    const last = race.at(-1)!;
    // the results screen: looks like a grid again (handbrake, standing, lapCount 0, position 2)
    w.feed(
      still(
        {
          flags: encodeFlags({ carOnTrack: true, handBrake: true }),
          totalLaps: 0,
          lapCount: 0,
          preRacePosition: 2,
          numCarsPreRace: 14,
          lastLapMs: last.lastLapMs,
          bestLapMs: last.bestLapMs,
        },
        300,
      ),
    );
    w.feed(menu(600)); // off the track long enough to release the latch
    return w;
  };

  it('opens a session for the laps before, one for the race, and none for the results screen', () => {
    const { ctx, ended, engine } = run();
    expect(ctx.sessions.size).toBe(2);
    expect(ended).toEqual(['raceStart', 'raceFinished']);
    expect(engine.session).toBeNull();
    const [before, race] = [...ctx.sessions.values()];
    expect(before!.kind ?? null).toBeNull();
    expect(race).toMatchObject({
      kind: 'race',
      kindSource: 'auto',
      raceTotalLaps: N,
      fieldSize: 15,
      startPosition: 4,
      finishPosition: 5,
    });
    expect(race!.endedAt).not.toBeNull();
  });

  it('stores the race laps (N of them, no extra lap) apart from the laps before', () => {
    const { ctx } = run();
    const [before, race] = [...ctx.sessions.values()];
    const laps = [...ctx.laps.values()].map((l) => l.lap);
    expect(laps.filter((l) => l.sessionId === race!.id)).toHaveLength(N);
    expect(laps.filter((l) => l.sessionId === before!.id).length).toBeGreaterThan(0);
  });

  it('never shows lap N + 1: the counter is held at N and the frame says finished', () => {
    const { frames } = run();
    const inRace = frames.filter((f) => f.race);
    expect(inRace.length).toBeGreaterThan(1000);
    expect(Math.max(...inRace.map((f) => f.lap.lap))).toBeLessThanOrEqual(N);
    const flag = frames.filter((f) => f.lap.finished);
    expect(flag.length).toBeGreaterThan(0);
    expect(flag.every((f) => f.lap.lap === N && f.lap.totalLaps === N)).toBe(true);
    expect(flag[0]!.race).toMatchObject({ state: 'finished', position: 5, startPosition: 4 });
  });

  it('records the grid, the position change, the impact and the finish', () => {
    const { ctx } = run();
    const kinds = ctx.sessionEvents.map((e) => e.kind);
    expect(kinds).toContain('grid');
    expect(kinds).toContain('position');
    expect(kinds).toContain('impact');
    const finish = ctx.sessionEvents.find((e) => e.kind === 'finish');
    expect(finish?.data).toMatchObject({ position: 5, cars: 15, totalLaps: N });
    const imp = ctx.sessionEvents.find((e) => e.kind === 'impact');
    expect(imp?.lap).toBe(2);
    expect(Number(imp?.data.dvMs2)).toBeGreaterThan(80);
  });
});

const racing = (patch: Partial<TelemetryPacket>) => ({
  flags: encodeFlags({ carOnTrack: true }),
  totalLaps: N,
  preRacePosition: 4,
  numCarsPreRace: 15,
  ...patch,
});

describe('a race restarted by the driver', () => {
  it('ends the attempt in its own session and gives the new one a session of its own', () => {
    const w = make();
    w.feed(still(racing({ lapCount: 0 }), 90));
    const attempt = racePackets();
    const upToLap2 = attempt.findIndex((p) => p.lapCount === 2) + 300;
    w.feed(attempt.slice(0, upToLap2)); // lap 1 done, a bit of lap 2…
    w.feed(racePackets()); // …and the driver restarts: the lap counter falls back to 0, same totalLaps
    w.feed(
      still(
        {
          flags: 0,
          carOnTrack: undefined,
          carCode: 0,
          totalLaps: -1,
          lapCount: -1,
          preRacePosition: -1,
          numCarsPreRace: -1,
        } as Partial<TelemetryPacket>,
        600,
      ),
    );
    expect(w.ended).toEqual(['raceRestart', 'raceFinished']);
    const [first, second] = [...w.ctx.sessions.values()];
    expect(first).toMatchObject({ kind: 'race', raceTotalLaps: N });
    expect(first!.finishPosition ?? null).toBeNull(); // it never finished
    expect(second).toMatchObject({ kind: 'race', raceTotalLaps: N, finishPosition: 5 });
    const ev = w.ctx.sessionEvents.find((e) => e.kind === 'restart');
    expect(ev?.sessionId).toBe(first!.id);
    expect(ev?.data.fromLap).toBe(2);
    // the second attempt has its own laps: N complete ones
    const laps = [...w.ctx.laps.values()].map((l) => l.lap);
    expect(laps.filter((l) => l.sessionId === second!.id)).toHaveLength(N);
  });
});

describe('a race against the AI: the flag keeps totalLaps', () => {
  it('holds N of N at the flag and fixes the result when the car leaves the track', () => {
    const w = make();
    w.feed(still(racing({ lapCount: 0 }), 90));
    const race = racePackets(true);
    w.feed(race);
    // about 9 s on the cool-down lap after the flag: still the race stream (lap N + 1, totalLaps N)
    w.feed(still(racing({ lapCount: N + 1, preRacePosition: 5, speedMps: 40 }), 540));
    // the flag fell: lap N + 1 with totalLaps still N; the counter is already held
    const flag = w.frames.filter((f) => f.lap.finished);
    expect(flag.length).toBeGreaterThan(0);
    expect(flag.every((f) => f.lap.lap === N && f.lap.totalLaps === N)).toBe(true);
    expect(w.ctx.sessions.size).toBe(1);
    expect(w.engine.session).not.toBeNull(); // the result is not fixed yet
    w.feed(menu(120)); // the results screen / menu
    const [s] = [...w.ctx.sessions.values()];
    expect(s).toMatchObject({ kind: 'race', startPosition: 4, finishPosition: 5, fieldSize: 15 });
    expect(w.ended).toEqual(['raceFinished']);
    expect(w.ctx.sessions.size).toBe(1); // no phantom session from the results screen
  });
});

describe('a race that is paused for a long time', () => {
  const paused = (n: number) =>
    still(racing({ flags: encodeFlags({ carOnTrack: true, paused: true }), lapCount: 2 }), n);

  it('keeps its session (a race is not over because the driver went away)', () => {
    const w = make();
    w.feed(still(racing({ lapCount: 0 }), 90));
    const race = racePackets();
    const mid = race.findIndex((p) => p.lapCount === 2) + 300;
    w.feed(race.slice(0, mid));
    const id = w.engine.session!.id;
    // 25 minutes paused, as measured: the game keeps sending (frozen) packets
    for (let m = 0; m < 25; m++) {
      w.feed(paused(5));
      w.skip(60_000);
    }
    w.feed(paused(5));
    w.engine.tick(w.now());
    expect(w.ended).toEqual([]);
    expect(w.engine.session?.id).toBe(id);
    w.feed(race.slice(mid)); // the race goes on, and ends, in the same session
    expect(w.ended).toEqual(['raceFinished']);
    expect(w.ctx.sessions.size).toBe(1);
    expect(w.ctx.sessions.has(id)).toBe(true);
  });

  it('still closes a session that is not a race after the usual time', () => {
    const w = make();
    w.feed(lapsOf(1, 1));
    for (let m = 0; m < 25; m++) {
      w.feed(still({ flags: encodeFlags({ carOnTrack: true, paused: true }), lapCount: 1 }, 5));
      w.skip(60_000);
    }
    w.engine.tick(w.now());
    expect(w.ended).toEqual(['offTrack']);
  });
});
