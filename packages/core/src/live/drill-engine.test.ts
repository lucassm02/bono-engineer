import { generateLaps } from '@gt7/protocol';
import type { Corner, LiveDrill, LiveFrame, TelemetryPacket, Track } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { type CompletedLap, LiveEngine } from './live-engine.ts';

const FRAME_MS = 1000 / 60;
const T0 = 1_700_000_000_000;

function corner(track: Track): Corner {
  const L = track.lengthM;
  return {
    id: 'T1',
    index: 0,
    name: 'Primeira',
    entryM: L * 0.3,
    apexM: L * 0.32,
    exitM: L * 0.34,
    direction: 'left',
  };
}

describe('corner drill in the live engine', () => {
  const gen = generateLaps({ profile: 'pro', seed: 11, laps: 4, format: 'A' });

  function run(
    packets: TelemetryPacket[],
    onFirstLap: (e: LiveEngine, c: MemoryEngineContext) => void,
  ) {
    const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
    const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('x') });
    const laps: CompletedLap[] = [];
    const frames: LiveFrame[] = [];
    const ended: unknown[] = [];
    engine.on('frame', (f) => frames.push(f));
    engine.on('drillEnded', (d) => ended.push(d));
    engine.on('lapCompleted', (l) => {
      laps.push(l);
      if (laps.length === 1) onFirstLap(engine, ctx);
    });
    for (const [i, p] of packets.entries()) engine.push(p, T0 + i * FRAME_MS);
    return { ctx, engine, laps, frames, ended };
  }

  it('measures one pass per lap, keeps them in the frame and stores them when stopped', () => {
    let started: LiveDrill | null = null;
    const r = run(gen.packets, (engine, ctx) => {
      const track = [...ctx.tracks.values()][0]!;
      ctx.tracks.set(track.id, { ...track, corners: [corner(track)] });
      engine.refreshTrack();
      started = engine.startCornerDrill('T1', { targetMs: 3000 });
    });
    expect(started).not.toBeNull();
    const drilling = r.frames.filter((f) => f.drill);
    expect(drilling.length).toBeGreaterThan(100);
    const last = drilling.at(-1)!.drill!;
    // laps 2, 3 and the start of 4 pass the corner
    expect(last.count).toBeGreaterThanOrEqual(2);
    expect(last.cornerId).toBe('T1');
    expect(last.targetMs).toBe(3000);
    expect(last.best).not.toBeNull();
    for (const p of last.passes) {
      expect(p.timeMs).toBeGreaterThan(300);
      expect(p.minSpeedKmh).toBeGreaterThan(8);
    }
    // all passes measure the same stretch, so they are in the same ballpark
    const times = last.passes.map((p) => p.timeMs);
    expect(Math.max(...times) / Math.min(...times)).toBeLessThan(1.35);

    const dropped = r.engine.stopCornerDrill();
    expect(dropped!.passes.length).toBe(last.count);
    expect(r.ctx.drills).toHaveLength(1);
    expect(r.ctx.drills[0]).toMatchObject({ cornerId: 'T1', targetMs: 3000 });
    expect(r.engine.drill).toBeNull();
    expect(r.ended).toHaveLength(1);
    expect(r.engine.stopCornerDrill()).toBeNull();
  });

  it('refuses an unknown corner and a missing track', () => {
    const engine = new LiveEngine({ context: new MemoryEngineContext() });
    expect(engine.startCornerDrill('T1')).toBeNull();
    let result: LiveDrill | null | undefined;
    run(gen.packets, (e) => {
      result = e.startCornerDrill('T99');
    });
    expect(result).toBeNull();
  });

  it('stores nothing when the drill had no passes', () => {
    const r = run(gen.packets.slice(0, 600), () => {});
    expect(r.engine.stopCornerDrill()).toBeNull();
    expect(r.ctx.drills).toHaveLength(0);
  });

  it('ends the drill when the session ends', () => {
    const r = run(gen.packets, (engine, ctx) => {
      const track = [...ctx.tracks.values()][0]!;
      ctx.tracks.set(track.id, { ...track, corners: [corner(track)] });
      engine.refreshTrack();
      engine.startCornerDrill('T1');
    });
    r.engine.endSession('manual');
    expect(r.engine.drill).toBeNull();
    expect(r.ctx.drills).toHaveLength(1);
    expect(r.ctx.drills[0]!.sessionId).not.toBeNull();
  });
});
