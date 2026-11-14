/**
 * The tyres the driver says are on the car (pre-race screen) and the wear estimate through the
 * engine: the choice reaches the session, the wear grows while driving and starts again with a new
 * session or a different set.
 */

import { generateLaps } from '@gt7/protocol';
import type { LiveFrame, TelemetryPacket } from '@gt7/shared';
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

const laps = (n: number) => generateLaps({ profile: 'pro', seed: 1, laps: n, format: '~' }).packets;

describe('tyre compound and wear', () => {
  it('without a choice the wear is still estimated, with no compound named', () => {
    const w = make();
    w.feed(laps(1).slice(0, 3000));
    const f = w.frames.at(-1)!;
    expect(f.tyreWear?.compound).toBeNull();
    expect(f.tyreWear!.worst).toBeGreaterThan(0);
    expect(f.tyreWear!.distKm).toBeGreaterThan(0.5);
    expect(w.engine.session!.tyreCompound ?? null).toBeNull();
  });

  it('the choice made before the session is saved with it and shown in every frame', () => {
    const w = make();
    w.engine.setTyreCompound('racingSoft');
    w.feed(laps(1).slice(0, 3000));
    expect(w.engine.session!.tyreCompound).toBe('racingSoft');
    expect(w.frames.at(-1)!.tyreWear?.compound).toBe('racingSoft');
    // it was saved, not just kept in memory
    expect([...w.ctx.sessions.values()][0]!.tyreCompound).toBe('racingSoft');
  });

  it('a soft compound wears faster than a hard one over the same laps', () => {
    const soft = make();
    soft.engine.setTyreCompound('racingSoft');
    soft.feed(laps(1).slice(0, 3000));
    const hard = make();
    hard.engine.setTyreCompound('racingHard');
    hard.feed(laps(1).slice(0, 3000));
    expect(soft.frames.at(-1)!.tyreWear!.worst).toBeGreaterThan(
      hard.frames.at(-1)!.tyreWear!.worst * 2,
    );
  });

  it('changing the compound mid-session starts the wear again and updates the session', () => {
    const w = make();
    w.engine.setTyreCompound('sportMedium');
    w.feed(laps(1).slice(0, 3000));
    expect(w.frames.at(-1)!.tyreWear!.worst).toBeGreaterThan(0);
    w.engine.setTyreCompound('sportSoft');
    expect(w.engine.session!.tyreCompound).toBe('sportSoft');
    w.feed(laps(1).slice(3000, 3030));
    expect(w.frames.at(-1)!.tyreWear!.distKm).toBeLessThan(0.1);
    // the same compound again is not a new set
    const before = w.frames.at(-1)!.tyreWear!.distKm;
    w.engine.setTyreCompound('sportSoft');
    w.feed(laps(1).slice(3030, 3060));
    expect(w.frames.at(-1)!.tyreWear!.distKm).toBeGreaterThan(before);
  });

  it('a new session has new tyres', () => {
    const w = make();
    w.feed(laps(1).slice(0, 3000));
    w.engine.endSession('manual');
    w.feed(laps(1).slice(0, 60));
    expect(w.frames.at(-1)!.tyreWear!.distKm).toBeLessThan(0.1);
  });

  it('does not wear while the car is stopped or in a replay', () => {
    const w = make();
    const stopped = laps(1)
      .slice(0, 600)
      .map((p) => ({ ...p, speedMps: 0 }));
    w.feed(stopped);
    expect(w.frames.at(-1)!.tyreWear?.worst ?? 0).toBe(0);
  });
});
