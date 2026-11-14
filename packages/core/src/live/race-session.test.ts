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
  return { engine, ctx, feed, frames, ended };
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
function racePackets(): TelemetryPacket[] {
  const laps = lapsOf(2, N);
  const hit = laps.findIndex((p) => p.lapCount === 2 && p.speedMps > 40);
  return laps.map((p, i) => {
    const flag = p.lapCount > N; // the game says lap N + 1 and totalLaps 0 at the flag
    const afterHit = i >= hit + 5 && i < hit + 25;
    return {
      ...p,
      totalLaps: flag ? 0 : N,
      preRacePosition: p.lapCount === 2 && i > hit + 600 ? 5 : 4,
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
