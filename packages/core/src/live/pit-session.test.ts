/**
 * Visits to the pits and sessions with traffic through the engine (specs 09 and 21), shaped like
 * the real Civic free practice (Tokyo Expressway, 16-17 cars around, one visit to the pits).
 */

import { generateLaps } from '@gt7/protocol';
import { deriveStints, encodeFlags, type LiveFrame, type TelemetryPacket } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { LiveEngine } from './live-engine.ts';

const MS = 1000 / 60;

function make() {
  const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
  const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('x') });
  let t = 1_700_000_000_000;
  let id = 1;
  const frames: LiveFrame[] = [];
  engine.on('frame', (f) => frames.push(f));
  const feed = (ps: TelemetryPacket[]) => {
    for (const p of ps) {
      t += MS;
      engine.push({ ...p, packetId: id++ }, t);
    }
  };
  return { engine, ctx, feed, frames };
}

/** Laps of a practice with traffic: no `totalLaps`, 17 cars, the driver ranked 4th. */
const traffic = (seed: number, laps: number): TelemetryPacket[] =>
  generateLaps({ profile: 'pro', seed, laps, format: '~' }).packets.map((p) => ({
    ...p,
    totalLaps: 0,
    preRacePosition: 4,
    numCarsPreRace: 17,
  }));

describe('a practice with other cars on the track', () => {
  it('is suggested as a practice, once, and the driver keeps the last word', () => {
    const w = make();
    const ps = traffic(1, 2);
    w.feed(ps.slice(0, 2000)); // 30 s
    const s = w.engine.session!;
    expect(s.kind).toBe('practice');
    expect(s.kindSource).toBe('auto');
    expect(w.frames.at(-1)!.ranking).toEqual({ position: 4, cars: 17 });
    expect(w.frames.at(-1)!.race).toBeUndefined();

    w.engine.annotateSession({ kind: 'qualifying', kindSource: 'user' });
    w.feed(ps.slice(2000, 4000));
    expect(w.engine.session!.kind).toBe('qualifying');
    expect(w.engine.session!.kindSource).toBe('user');
  });

  it('is not suggested alone on the track (a time trial) nor in a short passage', () => {
    const alone = make();
    alone.feed(
      generateLaps({ profile: 'pro', seed: 1, laps: 1, format: '~' }).packets.slice(0, 2000),
    );
    expect(alone.engine.session!.kind ?? null).toBeNull();
    expect(alone.frames.at(-1)!.ranking).toBeUndefined();

    const brief = make();
    brief.feed(traffic(1, 1).slice(0, 300)); // 5 s
    expect(brief.engine.session!.kind ?? null).toBeNull();
  });
});

describe('a visit to the pits', () => {
  /** The real sequence: pause, loading, the car stopped in its box for 13 s, then away. */
  function visit(from: TelemetryPacket): TelemetryPacket[] {
    const box = { ...from.position, x: from.position.x + 260, z: from.position.z + 30 };
    const keep = { ...from, totalLaps: 0 };
    const moving = encodeFlags({ carOnTrack: true });
    return [
      ...Array.from({ length: 130 }, () => ({
        ...keep,
        flags: encodeFlags({ carOnTrack: true, paused: true }),
      })),
      {
        ...keep,
        flags: encodeFlags({ carOnTrack: true, loadingOrProcessing: true }),
        speedMps: 0,
        position: box,
      },
      ...Array.from({ length: 780 }, () => ({
        ...keep,
        flags: moving,
        speedMps: 0,
        velocity: { x: 0, y: 0, z: 0 },
        position: box,
      })),
    ];
  }

  it('closes the stint and starts the next; the laps fall in their stints', () => {
    const w = make();
    const ps = traffic(2, 4);
    const at = ps.findIndex((p) => p.lapCount === 3 && p.speedMps > 40) + 600;
    w.feed(ps.slice(0, at));
    w.feed(visit(ps[at - 1]!));
    expect(w.frames.at(-1)!.stint).toEqual({ number: 1, inPits: true });
    w.feed(ps.slice(at)); // the car drives off and the practice goes on
    const f = w.frames.at(-1)!;
    expect(f.stint).toEqual({ number: 2, inPits: false });

    const pits = w.ctx.sessionEvents.filter((e) => e.kind === 'pit');
    expect(pits).toHaveLength(1);
    expect(pits[0]!.lap).toBe(3);
    expect(Number(pits[0]!.data.exitAt)).toBeGreaterThan(pits[0]!.at + 13_000);

    w.engine.endSession('manual');
    const session = [...w.ctx.sessions.values()][0]!;
    const laps = [...w.ctx.laps.values()].map((l) => l.lap);
    const stints = deriveStints(session.startedAt, laps, w.ctx.sessionEvents);
    expect(stints.map((s) => s.number)).toEqual([1, 2]);
    expect(stints[0]!.lapCount).toBeGreaterThanOrEqual(2);
    expect(stints[1]!.lapCount).toBeGreaterThanOrEqual(1);
    expect(stints[0]!.lapCount + stints[1]!.lapCount).toBe(laps.length);
  });

  it('the first lap after the box is an out lap when the game does not count it', () => {
    const run = (gameCounts: boolean) => {
      const w = make();
      const ps = traffic(2, 5);
      const at = ps.findIndex((p) => p.lapCount === 2 && p.speedMps > 40) + 600;
      w.feed(ps.slice(0, at));
      w.feed(visit(ps[at - 1]!));
      // after the box the game leaves its best lap as it was (a huge one here) unless it counts the lap
      w.feed(ps.slice(at).map((p) => (gameCounts ? p : { ...p, bestLapMs: 400_000 })));
      w.engine.endSession('manual');
      return [...w.ctx.laps.values()].map((l) => l.lap).sort((a, b) => a.number - b.number);
    };
    const notCounted = run(false);
    const out = notCounted.filter((l) => l.flags.includes('outLap'));
    expect(out).toHaveLength(1);
    expect(out[0]!.valid).toBe(false);
    expect(notCounted.filter((l) => l.number < out[0]!.number).every((l) => l.valid)).toBe(true);
    expect(run(true).some((l) => l.flags.includes('outLap'))).toBe(false);
  });

  it('a menu in the box is not a visit', () => {
    const w = make();
    const ps = traffic(2, 3);
    const at = ps.findIndex((p) => p.lapCount === 2 && p.speedMps > 40) + 600;
    w.feed(ps.slice(0, at));
    const v = visit(ps[at - 1]!);
    w.feed(v.slice(0, 400));
    w.feed(Array.from({ length: 200 }, () => ({ ...ps[at - 1]!, flags: 0 })));
    expect(w.ctx.sessionEvents.filter((e) => e.kind === 'pit')).toHaveLength(0);
    expect(w.frames.at(-1)!.stint).toBeUndefined();
  });
});
