/**
 * Automatic session capture (Onda 8a): when a session opens and closes without any user action.
 * Everything here is driven by synthetic packets and an explicit clock (no sockets, no sleeping).
 */

import { generateLaps, SyntheticSession } from '@gt7/protocol';
import {
  encodeFlags,
  type Lap,
  type Session,
  SimulatorFlags,
  type TelemetryPacket,
} from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import {
  type CompletedLap,
  type LapDiscardedInfo,
  LiveEngine,
  type SessionEndInfo,
} from './live-engine.ts';

const FRAME_MS = 1000 / 60;
const MIN = 60_000;

interface Rig {
  engine: LiveEngine;
  ctx: MemoryEngineContext;
  laps: CompletedLap[];
  discarded: LapDiscardedInfo[];
  started: Session[];
  ended: { session: Session; info: SessionEndInfo }[];
  /** Epoch ms of the next packet. */
  t: number;
  feed(p: TelemetryPacket, dtMs?: number): void;
  feedAll(ps: TelemetryPacket[]): void;
  /** Moves the clock forward without any packet (the console is silent). */
  wait(ms: number): void;
}

function rig(opts: ConstructorParameters<typeof LiveEngine>[0] = {}): Rig {
  const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
  const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('s'), ...opts });
  const r: Rig = {
    engine,
    ctx,
    laps: [],
    discarded: [],
    started: [],
    ended: [],
    t: 1_700_000_000_000,
    feed(p, dtMs = FRAME_MS) {
      r.t += dtMs;
      engine.push(p, r.t);
    },
    feedAll(ps) {
      for (const p of ps) r.feed(p);
    },
    wait(ms) {
      r.t += ms;
    },
  };
  engine.on('lapCompleted', (l) => r.laps.push(l));
  engine.on('lapDiscarded', (d) => r.discarded.push(d));
  engine.on('sessionStarted', (s) => r.started.push(s));
  engine.on('sessionEnded', (session, info) => r.ended.push({ session, info }));
  return r;
}

/** A menu / garage packet: car not on the track. */
const inMenu = (p: TelemetryPacket): TelemetryPacket => ({
  ...p,
  speedMps: 0,
  flags: encodeFlags({ paused: true, hasTurbo: true }),
});

/** The game's pause menu: the car is still "on track" but the paused flag is set. */
const pausedMenu = (p: TelemetryPacket): TelemetryPacket => ({
  ...p,
  flags: p.flags | SimulatorFlags.Paused,
});

/** The same laps on another track (different shape, length and start line). */
const onOtherTrack = (p: TelemetryPacket): TelemetryPacket => ({
  ...p,
  position: { x: p.position.x * 1.6 + 2500, y: p.position.y, z: p.position.z * 1.6 - 800 },
});

/** Packets of `laps` complete laps after an out lap, ids starting at `firstPacketId`. */
function drive(laps: number, seed: number, firstPacketId: number, carCode?: number) {
  return generateLaps({
    profile: 'pro',
    seed,
    laps,
    format: 'A',
    outLapM: 300,
    firstPacketId,
    ...(carCode !== undefined ? { carCode } : {}),
  });
}

const lastPacketId = (ps: TelemetryPacket[]) => ps[ps.length - 1]!.packetId;

describe('(a) app open before the game', () => {
  it('menu and loading packets open nothing; the first packet on a track opens the session', () => {
    const r = rig();
    const sim = new SyntheticSession({ seed: 3, format: 'A', outLapM: 300, menuS: 2, loadingS: 1 });
    // 3 s of menu + loading at 60 Hz
    for (let i = 0; i < 175; i++) r.feed(sim.next());
    expect(r.started).toHaveLength(0);
    expect(r.engine.session).toBeNull();
    expect(r.engine.state).toBe('menu');
    // the car is put on the track: no click anywhere
    for (let i = 0; i < 10; i++) r.feed(sim.next());
    expect(r.started).toHaveLength(1);
    expect(r.engine.session?.mode).toBe('live');
    expect(r.engine.session?.endedAt).toBeNull();
    expect(r.ctx.sessions.get(r.started[0]!.id)).toBeDefined();
  });

  it('then times the laps normally', () => {
    const r = rig();
    const sim = new SyntheticSession({ seed: 3, format: 'A', outLapM: 300 });
    while (r.laps.length < 2 && sim.elapsedS < 600) r.feed(sim.next());
    expect(r.started).toHaveLength(1);
    expect(r.laps.map((l) => l.lap.number)).toEqual([1, 2]);
    expect(r.laps.every((l) => l.lap.valid)).toBe(true);
  });
});

describe('(b) app opened in the middle of a lap', () => {
  const gen = generateLaps({ profile: 'pro', seed: 12, laps: 4, format: 'A', outLapM: 300 });
  const lapStart = (n: number) => gen.packets.findIndex((p) => p.lapCount === n);

  it('the partial lap is not stored; the following laps are normal', () => {
    const r = rig();
    r.feedAll(gen.packets.slice(lapStart(2) + 2500)); // joins 2500 packets into lap 2
    expect(r.started).toHaveLength(1);
    expect(r.laps.map((l) => l.lap.number)).toEqual([3, 4]);
    // exact game times, valid, nothing marked as broken
    r.laps.forEach((l, i) => {
      expect(l.lap.timeMs).toBe(gen.laps[2 + i]!.timeMs);
      expect(l.lap.valid).toBe(true);
      expect(l.lap.flags).toEqual([]);
    });
    // nothing was stored for lap 2: it cannot reach best lap, averages or consistency
    const stored: Lap[] = [...r.ctx.laps.values()].map((s) => s.lap);
    expect(stored.map((l) => l.number).sort()).toEqual([3, 4]);
    expect(r.engine.session?.lapCount).toBe(2);
    const best = Math.min(gen.laps[2]!.timeMs, gen.laps[3]!.timeMs);
    expect(r.engine.session?.bestLapMs).toBe(best);
  });

  it('a lap joined mid-way does not affect the fuel average', () => {
    const r = rig();
    r.feedAll(gen.packets.slice(lapStart(2) + 2500));
    const frame = r.engine.snapshot();
    expect(frame?.fuel.perLapAvg).not.toBeNull();
    // the average only knows the two full laps
    const used = r.laps.map((l) => l.lap.fuelUsedL!);
    const avg = used.reduce((s, v) => s + v, 0) / used.length;
    expect(frame!.fuel.perLapAvg!).toBeCloseTo(avg, 6);
  });
});

describe('(c) restart / back to the pits: same session or new', () => {
  it('a break shorter than the idle window keeps the session (same car, same track)', () => {
    const r = rig();
    const first = drive(2, 21, 1000);
    r.feedAll(first.packets);
    const sessionId = r.started[0]!.id;
    const trackId = r.engine.track?.id;
    expect(trackId).toBeTruthy();
    // back to the garage: 4 minutes of menu packets
    const menu = inMenu(first.packets.at(-1)!);
    for (let i = 0; i < 4 * 60; i++) r.feed({ ...menu, packetId: menu.packetId + i + 1 }, 1000);
    expect(r.engine.session?.id).toBe(sessionId);
    // out again (new stream from the start of a race: lapCount back to 0)
    const second = drive(2, 22, lastPacketId(first.packets) + 400);
    r.feedAll(second.packets);
    expect(r.started).toHaveLength(1);
    expect(r.ended).toHaveLength(0);
    const ofSession = [...r.ctx.laps.values()].filter((s) => s.lap.sessionId === sessionId);
    expect(ofSession.length).toBeGreaterThanOrEqual(3);
    expect(new Set(ofSession.map((s) => s.lap.trackId))).toEqual(new Set([trackId]));
  });

  it('a restart mid-lap (lap counter back) keeps the session', () => {
    const r = rig();
    const a = drive(2, 23, 1000);
    const cut = a.packets.findIndex((p) => p.lapCount === 2) + 1500;
    r.feedAll(a.packets.slice(0, cut));
    const b = drive(2, 24, a.packets[cut]!.packetId + 1);
    r.feedAll(b.packets);
    expect(r.started).toHaveLength(1);
    expect(r.discarded.some((d) => d.reason === 'restart')).toBe(true);
    expect(r.laps.map((l) => l.lap.number)).toEqual([1, 1, 2]);
  });

  it('a break longer than the idle window closes the session; the next run is a new one', () => {
    const r = rig();
    const first = drive(1, 25, 1000);
    r.feedAll(first.packets);
    const menu = inMenu(first.packets.at(-1)!);
    // 12 minutes in the menu, packets still arriving
    for (let i = 0; i < 12 * 60; i++) r.feed({ ...menu, packetId: menu.packetId + i + 1 }, 1000);
    expect(r.ended).toHaveLength(1);
    expect(r.ended[0]!.info.reason).toBe('offTrack');
    // it ended when the car left the track, not 10 minutes later
    const left = r.ended[0]!.session.endedAt!;
    expect(r.t - left).toBeGreaterThan(10 * MIN);
    const second = drive(1, 26, lastPacketId(first.packets) + 2000);
    r.feedAll(second.packets);
    expect(r.started).toHaveLength(2);
    expect(r.started[1]!.id).not.toBe(r.started[0]!.id);
    expect(r.ended[0]!.session.lapCount).toBe(1);
  });
});

describe('(d) car or track change opens a new session', () => {
  it('a different car is a new session at once', () => {
    const r = rig();
    const a = drive(1, 31, 1000, 111);
    r.feedAll(a.packets);
    const b = drive(1, 32, lastPacketId(a.packets) + 50, 222);
    r.feedAll(b.packets);
    expect(r.started.map((s) => s.carCode)).toEqual([111, 222]);
    expect(r.ended).toHaveLength(1);
    expect(r.ended[0]!.info.reason).toBe('carChange');
    expect(r.ended[0]!.session.lapCount).toBe(1);
    expect(r.laps[1]!.lap.carCode).toBe(222);
    expect(r.laps[1]!.session.id).toBe(r.started[1]!.id);
  });

  it('the same car on another track (found by its geometry) is a new session', () => {
    const r = rig();
    const a = drive(2, 33, 1000);
    r.feedAll(a.packets);
    const trackA = r.engine.track!.id;
    // 90 s later (menu, loading), same car, a different circuit
    r.wait(90_000);
    const b = drive(2, 34, lastPacketId(a.packets) + 900);
    r.feedAll(b.packets.map(onOtherTrack));
    expect(r.started).toHaveLength(2);
    expect(r.ended).toHaveLength(1);
    expect(r.ended[0]!.info.reason).toBe('trackChange');
    // the old session kept only its own laps, ended before the new one began
    const [s1, s2] = r.started;
    const lapsOf = (id: string) =>
      [...r.ctx.laps.values()].map((s) => s.lap).filter((l) => l.sessionId === id);
    expect(lapsOf(s1!.id)).toHaveLength(2);
    expect(lapsOf(s1!.id).every((l) => l.trackId === trackA)).toBe(true);
    const newLaps = lapsOf(s2!.id);
    expect(newLaps).toHaveLength(2);
    expect(newLaps.every((l) => l.trackId !== null && l.trackId !== trackA)).toBe(true);
    expect(r.ended[0]!.session.endedAt!).toBeLessThanOrEqual(newLaps[0]!.startedAt);
    expect(r.engine.session?.trackId).toBe(newLaps[0]!.trackId);
    expect(r.ctx.tracks.size).toBe(2);
  });

  it('coming back to a known track is recognised at the start line (A → B → A)', () => {
    const r = rig();
    const a = drive(2, 35, 1000);
    r.feedAll(a.packets);
    r.wait(60_000);
    const b = drive(2, 36, lastPacketId(a.packets) + 900);
    r.feedAll(b.packets.map(onOtherTrack));
    r.wait(60_000);
    const c = drive(2, 37, lastPacketId(b.packets) + 900);
    r.feedAll(c.packets);
    expect(r.started).toHaveLength(3);
    expect(r.ended.map((e) => e.info.reason)).toEqual(['trackChange', 'trackChange']);
    expect(r.ctx.tracks.size).toBe(2);
    const [s1, , s3] = r.started;
    const trackOf = (sid: string) =>
      [...r.ctx.laps.values()].find((s) => s.lap.sessionId === sid)?.lap.trackId;
    expect(trackOf(s3!.id)).toBe(trackOf(s1!.id));
  });
});

describe('(e) pause', () => {
  it('does not close the session and stops the track-time clock', () => {
    const r = rig();
    const gen = drive(2, 41, 1000);
    const k = gen.packets.findIndex((p) => p.lapCount === 1) + 1200;
    r.feedAll(gen.packets.slice(0, k));
    const sessionId = r.engine.session!.id;
    const before = r.engine.captureInfo.trackTimeMs;
    expect(before).toBeGreaterThan(10_000);
    // 3 minutes in the pause menu (packets still arrive at 60 Hz)
    const p = gen.packets[k]!;
    for (let i = 0; i < 3 * 60 * 60; i++) {
      r.feed(pausedMenu({ ...p, packetId: p.packetId + i }));
    }
    expect(r.engine.session?.id).toBe(sessionId);
    expect(r.engine.captureInfo.paused).toBe(true);
    expect(r.engine.captureInfo.trackTimeMs).toBe(before);
    expect(r.ended).toHaveLength(0);
    // and it runs again afterwards
    const rest = gen.packets.slice(k).map((q) => ({ ...q, packetId: q.packetId + 3 * 60 * 60 }));
    r.feedAll(rest.slice(0, 600));
    expect(r.engine.captureInfo.paused).toBe(false);
    expect(r.engine.captureInfo.trackTimeMs).toBeGreaterThan(before + 9_000);
  });

  it('track time ignores the menu and silences, and is saved with the session', () => {
    const r = rig();
    const gen = drive(1, 42, 1000);
    r.feedAll(gen.packets);
    const drivenMs = r.engine.captureInfo.trackTimeMs;
    expect(drivenMs).toBeGreaterThan(60_000);
    const wall = (gen.packets.length * 1000) / 60;
    expect(Math.abs(drivenMs - wall)).toBeLessThan(1500);
    r.engine.endSession();
    expect(r.ended[0]!.session.trackTimeMs).toBe(drivenMs);
    expect(r.ctx.sessions.get(r.started[0]!.id)?.trackTimeMs).toBe(drivenMs);
  });

  it('a pause longer than the idle window ends the session like any other break', () => {
    const r = rig();
    const gen = drive(1, 43, 1000);
    r.feedAll(gen.packets);
    const p = gen.packets.at(-1)!;
    for (let i = 0; i < 11 * 60; i++)
      r.feed(pausedMenu({ ...p, packetId: p.packetId + i + 1 }), 1000);
    expect(r.ended.map((e) => e.info.reason)).toEqual(['offTrack']);
  });
});

describe('(f) console goes quiet, comes back', () => {
  it('tick() closes the session cleanly at the last packet; laps stay', () => {
    const r = rig();
    const gen = drive(2, 51, 1000);
    r.feedAll(gen.packets);
    const lastAt = r.t;
    const sessionId = r.engine.session!.id;
    r.engine.tick(lastAt + 5 * MIN);
    expect(r.engine.session).not.toBeNull(); // not yet: could be a Wi-Fi blip
    r.engine.tick(lastAt + 10 * MIN + 1000);
    expect(r.engine.session).toBeNull();
    expect(r.ended[0]!.info).toEqual({ reason: 'silence', persisted: true });
    expect(r.ended[0]!.session.endedAt).toBe(lastAt);
    expect(r.ended[0]!.session.lapCount).toBe(2);
    expect([...r.ctx.laps.values()].filter((s) => s.lap.sessionId === sessionId)).toHaveLength(2);
    expect(r.ctx.sessions.get(sessionId)?.endedAt).toBe(lastAt);
  });

  it('hours later, with the packet counter reset, a new session opens without trouble', () => {
    const r = rig();
    const a = drive(1, 52, 500_000);
    r.feedAll(a.packets);
    r.engine.setIngestorState('timeout');
    expect(r.engine.state).toBe('disconnected');
    r.engine.tick(r.t + 11 * MIN);
    r.wait(4 * 60 * MIN);
    // the PS5 was restarted: packet ids start from a small number again
    const b = drive(2, 53, 77);
    r.engine.setIngestorState('connected');
    r.feedAll(b.packets);
    expect(r.started).toHaveLength(2);
    expect(r.engine.session?.id).toBe(r.started[1]!.id);
    expect(r.laps.map((l) => l.lap.number)).toEqual([1, 1, 2]);
    expect(r.laps.every((l) => l.lap.valid)).toBe(true);
  });

  it('without tick(), the first packet after a long silence still closes the old session', () => {
    const r = rig();
    const a = drive(1, 54, 9000);
    r.feedAll(a.packets);
    const lastAt = r.t;
    r.wait(3 * 60 * MIN);
    const b = drive(1, 55, 100);
    r.feedAll(b.packets);
    expect(r.ended).toHaveLength(1);
    expect(r.ended[0]!.info.reason).toBe('silence');
    expect(r.ended[0]!.session.endedAt).toBe(lastAt);
    expect(r.started).toHaveLength(2);
  });

  it('a short silence (Wi-Fi blip) keeps the session', () => {
    const r = rig();
    const gen = drive(2, 56, 1000);
    const k = gen.packets.findIndex((p) => p.lapCount === 1) + 800;
    r.feedAll(gen.packets.slice(0, k));
    r.wait(40_000);
    r.engine.tick(r.t);
    r.feedAll(gen.packets.slice(k).map((p) => ({ ...p, packetId: p.packetId + 2400 })));
    expect(r.started).toHaveLength(1);
    expect(r.ended).toHaveLength(0);
  });
});

describe('(g) replay never makes a driving session', () => {
  it('in replay mode the session is a replayCapture and its laps are flagged and not personal', () => {
    const r = rig();
    r.engine.setReplayMode(true);
    const gen = drive(2, 61, 1000);
    r.feedAll(gen.packets);
    expect(r.started[0]!.mode).toBe('replayCapture');
    expect(r.laps).toHaveLength(2);
    expect(r.laps.every((l) => l.lap.flags.includes('replay'))).toBe(true);
    expect(r.engine.session?.bestLapMs).toBeNull();
    expect(r.laps.every((l) => !l.event.isPersonalBest && !l.event.isSessionBest)).toBe(true);
    const trackId = r.engine.track!.id;
    expect(r.ctx.getTrackRecords(trackId, gen.packets[0]!.carCode, 3).personalBestLapMs).toBeNull();
    // leaving replay mode ends that session; driving afterwards is a live one
    r.engine.setReplayMode(false);
    expect(r.ended[0]!.info.reason).toBe('mode');
    r.feedAll(drive(1, 62, lastPacketId(gen.packets) + 50).packets);
    expect(r.started[1]!.mode).toBe('live');
  });
});

describe('save switch off (live view only)', () => {
  it('shows everything live but writes no session, lap or track', () => {
    const r = rig();
    r.engine.setPersistence(false);
    const gen = drive(2, 71, 1000);
    const frames: number[] = [];
    r.engine.on('frame', (f) => frames.push(f.lap.lap));
    r.feedAll(gen.packets);
    expect(r.engine.persisting).toBe(false);
    expect(r.started).toHaveLength(1);
    expect(r.laps).toHaveLength(2);
    expect(r.engine.trackInfo?.name).toMatch(/Pista desconhecida/);
    expect(r.ctx.sessions.size).toBe(0);
    expect(r.ctx.laps.size).toBe(0);
    expect(r.ctx.tracks.size).toBe(0);
    // the live session still tracks the best lap and a delta against it
    expect(r.engine.session?.bestLapMs).toBe(Math.min(...r.laps.map((l) => l.lap.timeMs)));
    expect(r.laps[1]!.event.deltaMs).not.toBeNull();
    r.engine.endSession();
    expect(r.ended[0]!.info.persisted).toBe(false);
    expect(r.ctx.sessions.size).toBe(0);
  });

  it('turning it back on saves the sessions that follow', () => {
    const r = rig();
    r.engine.setPersistence(false);
    r.feedAll(drive(1, 72, 1000).packets);
    r.engine.setPersistence(true);
    expect(r.ended[0]!.info).toEqual({ reason: 'mode', persisted: false });
    r.feedAll(drive(1, 73, 400_000).packets);
    expect(r.engine.persisting).toBe(true);
    expect(r.ctx.sessions.size).toBe(1);
    expect(r.ctx.laps.size).toBe(1);
  });

  it('a reference capture (replay mode) is saved even with the switch off', () => {
    const r = rig();
    r.engine.setPersistence(false);
    r.engine.setReplayMode(true);
    r.feedAll(drive(1, 74, 1000).packets);
    expect(r.engine.persisting).toBe(true);
    expect(r.ctx.sessions.size).toBe(1);
    expect(r.ctx.laps.size).toBe(1);
  });
});

describe('(j) long sessions stay bounded', () => {
  it('a car parked on the track for hours stores no samples for the never-closing lap', () => {
    const r = rig({ maxLapSamples: 500 });
    const gen = drive(1, 81, 1000);
    // join mid out-lap, then sit still: 2 h of 1 Hz-compressed packets is enough to show growth
    const parked = { ...gen.packets[100]!, speedMps: 0 };
    r.feedAll(gen.packets.slice(0, 100));
    for (let i = 0; i < 40_000; i++) r.feed({ ...parked, packetId: parked.packetId + i }, 180);
    expect(r.engine.session).not.toBeNull();
    // nothing stored, nothing closed, still alive after 2 h
    expect(r.ctx.laps.size).toBe(0);
    expect(r.engine.captureInfo.trackTimeMs).toBeGreaterThan(60 * MIN);
  });

  it('a long run of laps keeps only per-session aggregates in memory', () => {
    const r = rig();
    const gen = drive(6, 82, 1000);
    r.feedAll(gen.packets);
    expect(r.laps).toHaveLength(6);
    // the engine keeps fuel history for the last `fuelAvgLaps` laps only
    const frame = r.engine.snapshot()!;
    const used = r.laps.slice(-3).map((l) => l.lap.fuelUsedL!);
    expect(frame.fuel.perLapAvg!).toBeCloseTo(used.reduce((s, v) => s + v, 0) / 3, 6);
  });
});

describe('(k) frozen stream (real PS5: left the track to a menu, flags still say "on track")', () => {
  /** The same packet again with a fresh id: identical position/speed while the "lap clock" runs. */
  const frozenFrom = (p: TelemetryPacket, i: number): TelemetryPacket => ({
    ...p,
    speedMps: 12,
    packetId: p.packetId + 1 + i,
    currentLapMs: (p.currentLapMs ?? 0) + (i + 1) * 17,
  });

  it('is treated like a pause: no track time, state paused, the lap is not counted', () => {
    const r = rig();
    const gen = drive(2, 31, 1000);
    r.feedAll(gen.packets.slice(0, 6000)); // well into the session, driving
    expect(r.engine.state).toBe('onTrack');
    const base = gen.packets[5999]!;
    for (let i = 0; i < 90; i++) r.feed(frozenFrom(base, i)); // 1.5 s frozen
    expect(r.engine.state).toBe('paused');
    const trackTime = r.engine.captureInfo.trackTimeMs;
    for (let i = 90; i < 600; i++) r.feed(frozenFrom(base, i)); // 8.5 s more
    expect(r.engine.state).toBe('paused');
    expect(r.engine.captureInfo.trackTimeMs - trackTime).toBeLessThan(500);
    expect(r.engine.session).not.toBeNull(); // still inside the 30 s grace
  });

  it('closes the session once the freeze lasts 30 s, and a new one opens when driving resumes', () => {
    const r = rig();
    const gen = drive(2, 32, 1000);
    r.feedAll(gen.packets.slice(0, 6000));
    const first = r.started[0]!.id;
    const base = gen.packets[5999]!;
    for (let i = 0; i < 2200; i++) r.feed(frozenFrom(base, i)); // ~36 s
    expect(r.engine.session).toBeNull();
    expect(r.ended.at(-1)?.session.id).toBe(first);
    expect(r.ended.at(-1)?.info.reason).toBe('offTrack');
    // the car moves again (new position every packet)
    const sim = gen.packets
      .slice(6000, 6200)
      .map((p, i) => ({ ...p, packetId: base.packetId + 5000 + i }));
    r.feedAll(sim);
    expect(r.started.length).toBeGreaterThan(1);
  });

  it('a real stop (speed ~0, same position) is not a freeze', () => {
    const r = rig();
    const gen = drive(2, 33, 1000);
    r.feedAll(gen.packets.slice(0, 6000));
    const base = gen.packets[5999]!;
    for (let i = 0; i < 300; i++) r.feed({ ...base, speedMps: 0, packetId: base.packetId + 1 + i });
    expect(r.engine.state).toBe('onTrack');
  });
});
