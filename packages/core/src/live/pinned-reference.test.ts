/**
 * A lap chosen as the delta reference belongs to one track. Seen on 2026-11-13 (Laguna Seca,
 * Interlagos, Tokyo Expressway, all driven for the first time with a Trial Mountain lap pinned):
 * the engine took the pinned lap's track as "the track", projected every lap on its line (all laps
 * invalid, saved under the wrong track) and the delta compared different circuits.
 */

import { generateLaps } from '@gt7/protocol';
import type { LiveFrame, TelemetryPacket } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { LiveEngine } from './live-engine.ts';

const MS = 1000 / 60;

function feed(engine: LiveEngine, packets: TelemetryPacket[], t0: number, id0: number) {
  let t = t0;
  let id = id0;
  for (const p of packets) {
    t += MS;
    engine.push({ ...p, packetId: id++ }, t);
  }
  return { t, id };
}

describe('a delta reference lap of another track', () => {
  it('neither decides the track nor spoils the laps; the best lap of the session takes over', () => {
    const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
    // laps of "this" circuit: the first session makes the track and its personal best
    const first = new LiveEngine({ context: ctx, idFactory: sequentialIds('a') });
    const end = feed(
      first,
      generateLaps({ profile: 'pro', seed: 1, laps: 3, format: '~' }).packets,
      1_700_000_000_000,
      1,
    );
    first.endSession('manual');
    const here = [...ctx.tracks.values()][0]!;
    const own = [...ctx.laps.values()].find((l) => l.lap.valid)!;

    // a lap of ANOTHER circuit that the driver pinned as the reference
    ctx.tracks.set('other', {
      ...here,
      id: 'other',
      name: 'Outro circuito',
      fingerprint: { ...here.fingerprint, start: { x: 9000, z: 9000 } },
    });
    ctx.laps.set('pinned', {
      lap: { ...own.lap, id: 'pinned', trackId: 'other' },
      trace: own.trace,
    });

    const engine = new LiveEngine({
      context: ctx,
      idFactory: sequentialIds('b'),
      deltaReference: 'reference',
      deltaReferenceLapId: 'pinned',
    });
    engine.setDeltaReference('reference', 'pinned');
    const frames: LiveFrame[] = [];
    engine.on('frame', (f) => frames.push(f));
    feed(
      engine,
      generateLaps({ profile: 'pro', seed: 2, laps: 3, format: '~' }).packets,
      end.t + 60_000,
      end.id + 10,
    );

    // the pinned lap's track never became the track of the session
    expect(frames.some((f) => f.trackContext?.trackId === 'other')).toBe(false);
    expect(engine.trackContext.trackId).toBe(here.id);
    // the laps of this circuit were not thrown away
    const session = [...ctx.sessions.values()].find((s) => s.id !== [...ctx.sessions.keys()][0]);
    const mine = [...ctx.laps.values()]
      .map((l) => l.lap)
      .filter((l) => l.sessionId === session?.id);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.every((l) => l.valid && l.trackId === here.id)).toBe(true);
    // the delta is never against the pinned lap, and says what it is against
    const withDelta = frames.filter((f) => f.lap.delta.ms !== null);
    const firstDeltaAt = frames.findIndex((f) => f.lap.delta.ms !== null);
    expect(withDelta.length).toBeGreaterThan(0);
    expect(withDelta.every((f) => f.lap.delta.referenceLapId !== 'pinned')).toBe(true);
    expect(withDelta.every((f) => f.lap.delta.reference === 'sessionBest')).toBe(true);
    // first lap of the session: no reference, so no delta (not one against a stranger)
    expect(frames[0]!.lap.delta.ms).toBeNull();
    expect(firstDeltaAt).toBeGreaterThan(0);
    expect(frames.slice(0, firstDeltaAt).every((f) => f.lap.delta.ms === null)).toBe(true);
    expect(Math.max(...withDelta.map((f) => Math.abs(f.lap.delta.ms!)))).toBeLessThan(15_000);
  });

  it('is still the reference on its own track', () => {
    const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
    const first = new LiveEngine({ context: ctx, idFactory: sequentialIds('a') });
    const end = feed(
      first,
      generateLaps({ profile: 'pro', seed: 1, laps: 3, format: '~' }).packets,
      1_700_000_000_000,
      1,
    );
    first.endSession('manual');
    const own = [...ctx.laps.values()].find((l) => l.lap.valid)!;
    const engine = new LiveEngine({
      context: ctx,
      idFactory: sequentialIds('b'),
      deltaReference: 'reference',
      deltaReferenceLapId: own.lap.id,
    });
    engine.setDeltaReference('reference', own.lap.id);
    const frames: LiveFrame[] = [];
    engine.on('frame', (f) => frames.push(f));
    feed(
      engine,
      generateLaps({ profile: 'pro', seed: 2, laps: 3, format: '~' }).packets,
      end.t + 60_000,
      end.id + 10,
    );
    const withDelta = frames.filter((f) => f.lap.delta.ms !== null);
    expect(withDelta.length).toBeGreaterThan(0);
    expect(withDelta.some((f) => f.lap.delta.referenceLapId === own.lap.id)).toBe(true);
    expect(withDelta.every((f) => f.lap.delta.reference === 'reference')).toBe(true);
  });
});
