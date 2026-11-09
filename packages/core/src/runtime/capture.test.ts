/**
 * Automatic session capture at the runtime level: status for the UI, "session saved", cleaning of
 * empty sessions, the "save sessions" switch and crash recovery. No sockets: packets go straight
 * into the engine.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateLaps } from '@gt7/protocol';
import { encodeFlags, SimulatorFlags, type TelemetryPacket } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Gt7Store } from '../store/store.ts';
import { Gt7Runtime, type SessionSavedInfo } from './runtime.ts';

const dirs: string[] = [];
const runtimes: Gt7Runtime[] = [];
afterEach(async () => {
  for (const r of runtimes.splice(0)) await r.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeRuntime(opts: ConstructorParameters<typeof Gt7Runtime>[0] = {}, dir?: string) {
  const d = dir ?? mkdtempSync(join(tmpdir(), 'gt7-capture-rt-'));
  if (!dir) dirs.push(d);
  const rt = new Gt7Runtime({ dataDir: d, record: true, autoDetectCorners: false, ...opts });
  runtimes.push(rt);
  const saved: SessionSavedInfo[] = [];
  rt.on('sessionSaved', (s) => saved.push(s));
  let t = 1_700_000_000_000;
  const feed = (ps: TelemetryPacket[], dt = 1000 / 60) => {
    for (const p of ps) {
      t += dt;
      rt.engine.push(p, t);
    }
  };
  return { rt, dir: d, saved, feed, now: () => t, wait: (ms: number) => (t += ms) };
}

const settle = (rt: Gt7Runtime) =>
  rt.whenAnalysisIdle().then(() => new Promise((r) => setImmediate(r)));
const gen = (laps: number, seed: number, firstPacketId = 1000) =>
  generateLaps({ profile: 'pro', seed, laps, format: 'A', outLapM: 300, firstPacketId });

describe('sessionCapture status', () => {
  it('follows the car: recording, paused, out of the track, replay and switch off', () => {
    const { rt, feed } = makeRuntime();
    const g = gen(2, 5);
    const one = g.packets;
    const lap1 = one.findIndex((p) => p.lapCount === 1);
    feed(one.slice(0, lap1 - 5));
    let c = rt.getStatus().sessionCapture!;
    expect(c).toMatchObject({ state: 'recording', enabled: true, lapsDone: 0 });
    expect(c.sessionId).toBe(rt.session?.id);
    expect(c.hint).toBe('Gravando sessão — ainda sem volta completa');

    const lap2 = one.findIndex((p) => p.lapCount === 2);
    feed(one.slice(lap1 - 5, lap2 + 200));
    c = rt.getStatus().sessionCapture!;
    expect(c.state).toBe('recording');
    expect(c.lapsDone).toBe(1);
    expect(c.hint).toBe('Gravando sessão — 1 volta até agora');
    expect(c.bestLapMs).toBe(g.laps[0]!.timeMs);
    expect(c.trackName).toMatch(/Pista desconhecida/);
    expect(c.trackTimeMs).toBeGreaterThan(60_000);
    expect(c.since).toBe(rt.session?.startedAt);

    const p = one[lap2 + 200]!;
    feed([{ ...p, flags: p.flags | SimulatorFlags.Paused }]);
    expect(rt.getStatus().sessionCapture).toMatchObject({ state: 'paused', hint: 'Pausado' });
    feed([{ ...p, packetId: p.packetId + 1, flags: encodeFlags({ paused: true }) }]);
    c = rt.getStatus().sessionCapture!;
    expect(c.state).toBe('paused');
    expect(c.hint).toMatch(/^Fora da pista/);
    expect(c.sessionId).toBe(rt.session?.id); // the session is still open

    rt.engine.setReplayMode(true);
    expect(rt.getStatus().sessionCapture).toMatchObject({ state: 'replay' });
    expect(rt.getStatus().sessionCapture!.hint).toMatch(/não conta como sessão/);
    rt.engine.setReplayMode(false);

    rt.setAutoCapture(false);
    expect(rt.getStatus().sessionCapture).toMatchObject({
      state: 'idle',
      enabled: false,
      sessionId: null,
    });
  });
});

describe('replay (Onda 9a)', () => {
  const replayGen = (laps: number, seed: number) =>
    generateLaps({ profile: 'pro', seed, laps, format: '~', replay: true, outLapM: 300 });

  it('shows "replay detectado" without opening a session, and captures a reference by geometry', async () => {
    const { rt, dir, feed } = makeRuntime();
    // the app learns the track from a live lap first
    feed(generateLaps({ profile: 'amateur', seed: 3, laps: 1, format: '~', outLapM: 300 }).packets);
    rt.engine.endSession();
    await settle(rt);
    const sessionsBefore = rt.store.listSessions().length;

    const rep = replayGen(2, 21);
    const states: string[] = [];
    rt.on('status', (st) => states.push(st.connection));
    feed(rep.packets.slice(0, 200)); // a replay playing, nobody asked for a capture
    expect(rt.getStatus().connection).toBe('replay');
    expect(rt.getStatus().sessionCapture).toMatchObject({ state: 'replay', sessionId: null });
    expect(rt.getStatus().sessionCapture!.hint).toBe('Replay detectado — não conta como sessão.');
    expect(rt.session).toBeNull();
    expect(rt.store.listSessions()).toHaveLength(sessionsBefore);

    const notices: string[] = [];
    rt.on('notice', (n) => notices.push(n.code));
    const st0 = await rt.startReferenceCapture({ driverName: 'Top 1', rankingTimeMs: null });
    expect(st0.state).toBe('waitingLapStart');
    expect(rt.getSettings().liveFormat).toBe('~'); // no format switch
    feed(rep.packets.slice(200));
    await settle(rt);
    const st = rt.capture.status;
    expect(st.state).toBe('idle');
    expect(st.lapId).not.toBeNull();
    expect(notices).toContain('captureSaved');
    const lap = rt.store.getLap(st.lapId!)!;
    expect(lap.isReference).toBe(true);
    expect(Math.abs(lap.timeMs - rep.laps[0]!.timeMs)).toBeLessThan(25);
    expect(rt.store.listSessions().filter((x) => x.mode === 'live')).toHaveLength(sessionsBefore);
    void dir;
  });
});

describe('end of a session', () => {
  it('announces a session with laps as saved, with track, laps and best time', async () => {
    const { rt, saved, feed } = makeRuntime();
    const g = gen(2, 6);
    feed(g.packets);
    const id = rt.session!.id;
    rt.engine.endSession();
    await settle(rt);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ sessionId: id, lapCount: 2, carCode: g.packets[0]!.carCode });
    expect(saved[0]!.bestLapMs).toBe(Math.min(...g.laps.map((l) => l.timeMs)));
    expect(saved[0]!.trackName).toMatch(/Pista desconhecida/);
    const s = rt.store.getSession(id)!;
    expect(s.endedAt).not.toBeNull();
    expect(s.lapCount).toBe(2);
    expect(s.trackTimeMs).toBeGreaterThan(100_000);
    expect(rt.getStatus().sessionCapture!.sessionId).toBeNull();
  });

  it('a session that ends without any completed lap leaves nothing behind', async () => {
    const { rt, dir, saved, feed } = makeRuntime();
    const g = gen(1, 7);
    feed(g.packets.slice(0, 1200)); // a few seconds of the out lap
    const id = rt.session!.id;
    const rec = join(dir, 'recordings', `${id}.gt7rec`);
    await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(rec)).toBe(true);
    expect(rt.store.getSession(id)).not.toBeNull();
    rt.engine.endSession();
    await settle(rt);
    await rt.store.flush();
    expect(rt.store.getSession(id)).toBeNull();
    expect(rt.store.listSessions()).toHaveLength(0);
    expect(existsSync(rec)).toBe(false);
    expect(saved).toHaveLength(0);
  });

  it('a track change saves the first session and keeps recording the new one', async () => {
    const { rt, saved, feed, wait } = makeRuntime();
    const a = gen(2, 8);
    feed(a.packets);
    wait(60_000);
    const b = gen(2, 9, a.packets.at(-1)!.packetId + 900);
    feed(
      b.packets.map((p) => ({
        ...p,
        position: { x: p.position.x * 1.6 + 2500, y: p.position.y, z: p.position.z * 1.6 - 800 },
      })),
    );
    await settle(rt);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.lapCount).toBe(2);
    const open = rt.session!;
    expect(open.id).not.toBe(saved[0]!.sessionId);
    expect(open.trackId).not.toBe(saved[0]!.trackId);
    expect(rt.store.listTracks()).toHaveLength(2);
    expect(rt.store.listLaps(open.id)).toHaveLength(2);
    expect(rt.store.listLaps(saved[0]!.sessionId)).toHaveLength(2);
  });
});

describe('"Gravar sessões automaticamente" switch', () => {
  it('is on by default, persists, and off shows live without writing anything', async () => {
    const { rt, dir, saved, feed } = makeRuntime();
    expect(rt.getSettings().autoCapture).toBe(true);
    rt.setAutoCapture(false);
    const frames: number[] = [];
    rt.on('frame', (f) => frames.push(f.lap.lap));
    const laps: number[] = [];
    rt.on('lapCompleted', (e) => laps.push(e.lapNumber));
    feed(gen(2, 10).packets);
    rt.engine.endSession();
    await settle(rt);
    expect(frames.length).toBeGreaterThan(100);
    expect(laps).toEqual([1, 2]);
    expect(rt.store.listSessions()).toHaveLength(0);
    expect(rt.store.listTracks()).toHaveLength(0);
    expect(existsSync(join(dir, 'recordings'))).toBe(true);
    expect(saved).toHaveLength(0);

    // persisted across restarts
    await rt.close();
    runtimes.length = 0;
    const again = makeRuntime({}, dir);
    expect(again.rt.getSettings().autoCapture).toBe(false);
    again.rt.setAutoCapture(true);
    again.feed(gen(1, 11).packets);
    again.rt.engine.endSession();
    await settle(again.rt);
    expect(again.rt.store.listSessions()).toHaveLength(1);
  });

  it('turning it off closes and saves the session that was being recorded', async () => {
    const { rt, saved, feed } = makeRuntime();
    feed(gen(1, 12).packets);
    const id = rt.session!.id;
    rt.setAutoCapture(false);
    await settle(rt);
    expect(saved.map((s) => s.sessionId)).toEqual([id]);
    expect(rt.store.getSession(id)?.endedAt).not.toBeNull();
  });
});

describe('(i) sessions left open by a crash', () => {
  it('closes those with laps at the end of the last lap and removes the empty ones', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt7-orphans-'));
    dirs.push(dir);
    const store = Gt7Store.open(dir);
    const base = {
      trackId: null,
      carCode: 1,
      format: 'A' as const,
      mode: 'live' as const,
      lapCount: 0,
      bestLapMs: null,
      notes: null,
    };
    store.saveSession({
      ...base,
      id: 'zombie-with-laps',
      startedAt: 1000,
      endedAt: null,
      recordingFile: null,
    });
    const rec = store.recordingPath('zombie-empty');
    store.saveSession({
      ...base,
      id: 'zombie-empty',
      startedAt: 2000,
      endedAt: null,
      recordingFile: rec.rel,
    });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(rec.abs, 'x');
    const g = gen(1, 13);
    const lapRow = {
      id: 'lap-1',
      sessionId: 'zombie-with-laps',
      number: 1,
      timeMs: 90_000,
      sectorTimesMs: [30000, 30000, 30000],
      valid: true,
      flags: [],
      isReference: false,
      referenceMeta: null,
      startedAt: 5000,
      carCode: g.packets[0]!.carCode,
      trackId: null,
      fuelUsedL: 2,
      sampleCount: 0,
      lostPackets: 0,
      traceFile: null,
    };
    store.saveLap(lapRow);
    store.saveSession({
      ...base,
      id: 'finished',
      startedAt: 10,
      endedAt: 20,
      recordingFile: null,
    });
    const out = await store.recoverOpenSessions();
    expect(out).toEqual({ closed: ['zombie-with-laps'], removed: ['zombie-empty'] });
    expect(store.getSession('zombie-with-laps')?.endedAt).toBe(95_000);
    expect(store.getSession('zombie-empty')).toBeNull();
    expect(existsSync(rec.abs)).toBe(false);
    expect(store.getSession('finished')?.endedAt).toBe(20);
    expect((await store.recoverOpenSessions()).closed).toEqual([]); // idempotent
    await store.close();
  });

  it('the runtime does it on start, never touching the session it is writing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt7-orphans-rt-'));
    dirs.push(dir);
    const store = Gt7Store.open(dir);
    store.saveSession({
      id: 'old',
      trackId: null,
      carCode: 1,
      startedAt: 1000,
      endedAt: null,
      format: 'A',
      mode: 'live',
      lapCount: 0,
      bestLapMs: null,
      recordingFile: null,
      notes: null,
    });
    await store.close();
    const { rt } = makeRuntime(
      {
        ingestor: { bindPort: 45761, bindAddress: '127.0.0.1', discovery: false },
        consoleIp: '127.0.0.1',
        persistConsoleIp: false,
        formatFallback: null,
      },
      dir,
    );
    await rt.start();
    expect(rt.store.getSession('old')).toBeNull(); // it had no laps
    await rt.stop();
  });
});
