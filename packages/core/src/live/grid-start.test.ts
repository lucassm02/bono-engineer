/**
 * A session that starts on the grid or at the pit exit (measured on the Power Pack, 2026-11-14):
 * the game's lap counter goes 0 → 1 a few hundred metres from the finish line, so the first lap
 * does not end where it began. It must not teach the track (the line would start in the wrong
 * place: the same circuit became three "unknown tracks" and every later lap jumped), and it is
 * shorter than a real lap, so it is no best lap nor delta reference.
 */

import { generateLaps } from '@gt7/protocol';
import type { TelemetryPacket } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { LiveEngine } from './live-engine.ts';

const MS = 1000 / 60;

/** Laps of a circuit as if the session began 20% into the first lap (the grid), lap counter 0 → 1 there. */
function fromTheGrid(laps: number): TelemetryPacket[] {
  const all = generateLaps({ profile: 'pro', seed: 3, laps, format: '~' }).packets;
  const firstOfLap2 = all.findIndex((p) => p.lapCount >= 2);
  const k = Math.floor(firstOfLap2 * 0.2);
  return all.slice(k).map((p, i) => ({
    ...p,
    // standing for two seconds with the counter at 0, then the start
    lapCount: i < 120 ? 0 : p.lapCount,
  }));
}

function run(packets: TelemetryPacket[]) {
  const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
  const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('x') });
  let t = 1_700_000_000_000;
  let id = 1;
  for (const p of packets) {
    t += MS;
    engine.push({ ...p, packetId: id++ }, t);
  }
  engine.endSession('manual');
  const laps = [...ctx.laps.values()].map((l) => l.lap).sort((a, b) => a.startedAt - b.startedAt);
  return { ctx, laps };
}

describe('a session that starts away from the finish line', () => {
  it('learns one track from the first lap that starts at the line, and no lap jumps', () => {
    const { ctx, laps } = run(fromTheGrid(4));
    expect(ctx.tracks.size).toBe(1);
    expect(laps.length).toBeGreaterThanOrEqual(3);
    for (const l of laps) expect(l.flags).not.toContain('discontinuity');
    // every lap after the first is a normal valid lap on that track
    const track = [...ctx.tracks.values()][0]!;
    for (const l of laps.slice(1)) {
      expect(l.valid).toBe(true);
      expect(l.trackId).toBe(track.id);
    }
  });

  it('the first lap, which began away from the line, is an out lap and never the best', () => {
    const { laps } = run(fromTheGrid(4));
    expect(laps[0]!.flags).toContain('outLap');
    expect(laps[0]!.valid).toBe(false);
    expect(laps.slice(1).some((l) => l.flags.includes('outLap'))).toBe(false);
  });
});
