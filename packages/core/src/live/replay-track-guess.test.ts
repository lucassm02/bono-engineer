/**
 * The track is named from the car that runs in the background of the pre-race screen: real
 * positions of that car (PS5, 2026-11-13) are replayed through the engine as `replay` packets.
 */

import { generateLaps } from '@gt7/protocol';
import { encodeFlags, type TelemetryPacket } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import real from '../../../shared/src/tracks/fixtures/real-replay-paths.json';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { LiveEngine } from './live-engine.ts';

const MS = 1000 / 60;
const STEP_M = 0.5; // 30 m/s at 60 Hz

function make() {
  const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
  const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('x') });
  let t = 1_700_000_000_000;
  let id = 1000;
  const base = generateLaps({ profile: 'pro', seed: 1, laps: 1, format: '~', replay: true })
    .packets[0]!;
  const packet = (patch: Partial<TelemetryPacket>): TelemetryPacket => ({
    ...base,
    packetId: id++,
    ...patch,
  });
  const push = (p: TelemetryPacket) => {
    t += MS;
    engine.push(p, t);
  };
  /** Drives the background car along `path` for at most `meters`, one packet per half metre. */
  const drive = (path: { x: number[]; z: number[] }, car: number, meters: number) => {
    let acc = 0;
    for (let i = 1; i < path.x.length && acc < meters; i++) {
      const dx = path.x[i]! - path.x[i - 1]!;
      const dz = path.z[i]! - path.z[i - 1]!;
      const len = Math.hypot(dx, dz);
      const k = Math.max(1, Math.round(len / STEP_M));
      for (let s = 0; s < k; s++) {
        push(
          packet({
            flags: encodeFlags({ inGear: true }),
            carCode: car,
            lapCount: 1,
            currentLapMs: 0,
            speedMps: 30,
            position: {
              x: path.x[i - 1]! + (dx * s) / k,
              y: 20,
              z: path.z[i - 1]! + (dz * s) / k,
            },
          }),
        );
      }
      acc += len;
    }
  };
  const menu = (n = 60) => {
    for (let i = 0; i < n; i++) {
      push(packet({ flags: 0, carCode: 0, speedMps: 0, position: { x: 0, y: 0, z: 0 } }));
    }
  };
  return { engine, ctx, drive, menu };
}

describe('track named from the pre-race screen', () => {
  it('names Road Atlanta a few seconds into the clip, before any lap', () => {
    const { engine, ctx, drive } = make();
    expect(engine.trackContext.name).toBeNull();
    drive(real.roadAtlanta, 3352, 250);
    expect(engine.state).toBe('replay');
    expect(engine.session).toBeNull();
    const c = engine.trackContext;
    expect(c.name).toMatch(/Road Atlanta/);
    expect(c.basis).toBe('path');
    expect(c.confidence).toBe('probable');
    expect(c.trackId).toBeNull();
    // nothing is stored from a guess
    expect(ctx.sessions.size).toBe(0);
    expect(ctx.laps.size).toBe(0);
  });

  it('names the circuit of Suzuka first and the layout when the loop closes', () => {
    const { engine, drive } = make();
    drive(real.suzukaEast, 688, 300);
    expect(engine.trackContext.name).toBe('Suzuka Circuit');
    expect(engine.trackContext.layout).toBeNull();
    drive(real.suzukaEast, 688, 1e9);
    expect(engine.trackContext.name).toBe('Suzuka Circuit');
    expect(engine.trackContext.layout).toMatch(/East/);
  });

  it('follows a change of track (new car, another circuit) and forgets it in the menu', () => {
    const { engine, drive, menu } = make();
    drive(real.roadAtlanta, 3352, 250);
    expect(engine.trackContext.name).toMatch(/Road Atlanta/);
    menu();
    expect(engine.state).toBe('menu');
    expect(engine.trackContext.basis).not.toBe('path');
    expect(engine.trackContext.name).toBeNull();
    drive(real.trialMountain, 3253, 250);
    expect(engine.trackContext.name).toBe('Trial Mountain Circuit');
  });
});
