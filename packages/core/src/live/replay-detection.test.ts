/**
 * Replay detection in the live engine (Onda 9a). A real console replays the lap with car data but
 * `carOnTrack` false, no lap clock and a lapCount stuck at 1: that is "replay", not "menu", and it is
 * not a driving session. A real menu (zeroed packets) stays "menu"; a frozen "on track" stream
 * keeps its old handling (paused).
 */

import { generateLaps } from '@gt7/protocol';
import { encodeFlags, type LiveFrame, type TelemetryPacket } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { LiveEngine } from './live-engine.ts';

const MS = 1000 / 60;

function make() {
  const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
  const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('x') });
  let t = 1_700_000_000_000;
  const states: string[] = [];
  const frames: LiveFrame[] = [];
  const started: string[] = [];
  engine.on('stateChanged', (s) => states.push(s));
  engine.on('frame', (f) => frames.push(f));
  engine.on('sessionStarted', (s) => started.push(s.id));
  const feed = (ps: TelemetryPacket[], step = MS) => {
    for (const p of ps) {
      t += step;
      engine.push(p, t);
    }
  };
  return { engine, ctx, feed, states, frames, started, now: () => t };
}

const replay = (seed = 1, laps = 1, extra: Record<string, unknown> = {}) =>
  generateLaps({ profile: 'pro', seed, laps, format: '~', replay: true, ...extra });

describe('replay detection', () => {
  it('a replay playing is state "replay": no session, no track time, nothing in the driver laps', () => {
    const { engine, ctx, feed, frames, started } = make();
    const laps: unknown[] = [];
    engine.on('lapCompleted', (l) => laps.push(l));
    feed(replay(1, 2).packets);
    expect(engine.state).toBe('replay');
    expect(engine.session).toBeNull();
    expect(started).toEqual([]);
    expect(laps).toEqual([]);
    expect(ctx.sessions.size).toBe(0);
    expect(ctx.laps.size).toBe(0);
    expect(engine.captureInfo.trackTimeMs).toBe(0);
    expect(engine.captureInfo.replay).toBe(true);
    expect(engine.replayDetected).toBe(true);
    // the live panel keeps getting frames: speed, pedals, position
    const moving = frames.filter((f) => f.state === 'replay' && f.car.speedKmh > 50);
    expect(moving.length).toBeGreaterThan(1000);
    expect(moving[10]!.position.x).not.toBe(0);
    expect(moving.some((f) => f.car.throttle > 0.5)).toBe(true);
  });

  it('the frame of a real PS5 replay (measured) is classified as replay', () => {
    const { engine, feed } = make();
    const base = replay(2, 1).packets.find((p) => p.speedMps > 20)!;
    const real: TelemetryPacket = {
      ...base,
      flags: encodeFlags({ inGear: true }),
      lapCount: 1,
      currentLapMs: 0,
      lastLapMs: -1,
      bestLapMs: -1,
      speedMps: 104.4 / 3.6,
      carCode: 3253,
    };
    const ps = Array.from({ length: 30 }, (_, i) => ({
      ...real,
      packetId: real.packetId + i,
      position: { x: 702.2 + i * 0.5, y: 24.3, z: 85.7 + i * 0.1 },
    }));
    feed(ps);
    expect(engine.state).toBe('replay');
    expect(engine.session).toBeNull();
  });

  it('a real menu (zeroed packets) stays "menu"', () => {
    const { engine, feed, states } = make();
    const g = replay(3, 1, { includeMenu: true, menuS: 2, loadingS: 1 });
    feed(g.packets.slice(0, 150)); // menu + loading, all zero
    expect(engine.state).toBe('menu');
    expect(engine.replayDetected).toBe(false);
    feed(g.packets.slice(150, 400));
    expect(engine.state).toBe('replay');
    expect(states).toContain('replay');
  });

  it('a car standing still before the replay starts (speed 0, constant position) is not "replay"', () => {
    const { engine, feed } = make();
    const p = replay(4, 1).packets[300]!;
    const idle: TelemetryPacket[] = Array.from({ length: 120 }, (_, i) => ({
      ...p,
      speedMps: 0,
      packetId: p.packetId + i,
    }));
    feed(idle);
    expect(engine.state).toBe('menu');
    expect(engine.session).toBeNull();
  });

  it('a frozen "on track" stream is still a pause, never a replay', () => {
    const { engine, feed } = make();
    const base = generateLaps({ profile: 'pro', seed: 5, laps: 1, format: '~' }).packets[600]!;
    feed(
      Array.from({ length: 200 }, (_, i) => ({ ...base, packetId: base.packetId + i })),
      MS,
    );
    expect(engine.state).toBe('paused');
    expect(engine.replayDetected).toBe(false);
  });

  it('a stalled replay (paused/rewinding) stays "replay" for a few seconds, then falls back to the menu', () => {
    const { engine, feed } = make();
    const g = replay(6, 1);
    feed(g.packets.slice(0, 1500));
    expect(engine.state).toBe('replay');
    const last = g.packets[1499]!;
    const stalled = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ ...last, packetId: last.packetId + from + i }));
    feed(stalled(60, 1)); // 1 s paused
    expect(engine.state).toBe('replay');
    expect(engine.session).toBeNull();
    feed(stalled(300, 61)); // 5 s more
    expect(engine.state).toBe('menu');
  });

  it('a replay after a live drive does not touch the driver session; driving again goes on', () => {
    const { engine, ctx, feed } = make();
    const live = generateLaps({ profile: 'amateur', seed: 7, laps: 2, format: '~' });
    const cut = live.packets.findIndex((p) => p.lapCount === 2) + 200;
    feed(live.packets.slice(0, cut));
    const session = engine.session!;
    expect(session).not.toBeNull();
    const lapsBefore = ctx.laps.size;
    const timeBefore = engine.captureInfo.trackTimeMs;
    feed(replay(8, 2).packets);
    expect(engine.state).toBe('replay');
    expect(engine.session?.id).toBe(session.id); // still the same open session
    expect(ctx.laps.size).toBe(lapsBefore); // nothing of the replay is a driver lap
    expect(engine.captureInfo.trackTimeMs).toBe(timeBefore); // the replay adds no track time
    // back on the track: a normal state again
    feed(live.packets.slice(cut, cut + 300));
    expect(engine.state).toBe('onTrack');
  });

  it('the packet event reports replay packets to followers', () => {
    const { engine, feed } = make();
    const kinds = new Set<string>();
    let carData = 0;
    engine.on('packet', (i) => {
      kinds.add(i.replay);
      if (i.carData) carData++;
    });
    feed(replay(9, 1).packets.slice(0, 600));
    expect(kinds.has('playing')).toBe(true);
    expect(carData).toBeGreaterThan(500);
  });
});
