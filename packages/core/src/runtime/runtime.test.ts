import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encodePacket,
  FakeConsole,
  generateLaps,
  RecordingWriter,
  SyntheticSession,
} from '@gt7/protocol';
import type { LapCompletedEvent, LiveFrame, ServerStatus, Session } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Gt7Runtime, type SessionSavedInfo } from './runtime.ts';

// Ports reserved for this test file (45xxx range).
const CONSOLE_PORT = 45739;
const CLIENT_PORT = 45740;
/** Recording time compression: packets are 60 Hz data streamed 20× faster. */
const SPEEDUP = 20;

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v) {
        clearInterval(iv);
        resolve(v);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error('waitFor timed out'));
      }
    }, 25);
  });
}

describe('Gt7Runtime over UDP (FakeConsole)', () => {
  it('emits frames, sessionChanged and lapCompleted; records the session', {
    timeout: 60_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt7-runtime-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const gen = generateLaps({ profile: 'pro', seed: 41, laps: 1, format: 'B', outLapM: 300 });
    const recFile = join(dir, 'fast.gt7rec');
    const w = await RecordingWriter.open(recFile, {
      format: 'B',
      startTime: 0,
      meta: { source: 'test' },
    });
    gen.packets.forEach((p, i) => {
      w.write(encodePacket(p, 'B'), Math.round((i * 1000) / 60 / SPEEDUP));
    });
    await w.close();

    const fake = new FakeConsole({
      port: CONSOLE_PORT,
      host: '127.0.0.1',
      targetPort: CLIENT_PORT,
      formatLockMs: 300,
      heartbeatTimeoutMs: 2000,
      source: { kind: 'recording', file: recFile, loop: false },
    });
    await fake.start();
    cleanups.push(() => fake.stop());

    const runtime = new Gt7Runtime({
      dataDir: join(dir, 'data'),
      consoleIp: '127.0.0.1',
      liveFormat: 'B',
      formatFallback: null,
      ingestor: {
        bindPort: CLIENT_PORT,
        bindAddress: '127.0.0.1',
        consolePort: CONSOLE_PORT,
        discovery: false,
        heartbeatIntervalMs: 100,
        timeoutMs: 1000,
        statsIntervalMs: 250,
      },
    });
    cleanups.push(() => runtime.close());
    const frames: LiveFrame[] = [];
    const laps: LapCompletedEvent[] = [];
    const sessions: (Session | null)[] = [];
    const statuses: ServerStatus[] = [];
    runtime.on('frame', (f) => frames.push(f));
    runtime.on('lapCompleted', (e) => laps.push(e));
    runtime.on('sessionChanged', (s) => sessions.push(s));
    runtime.on('status', (s) => statuses.push(s));

    await runtime.start();
    expect(runtime.getSettings().consoleIp).toBe('127.0.0.1');
    await waitFor(() => laps.length >= 1, 40_000);

    expect(frames.length).toBeGreaterThan(20);
    expect(frames.some((f) => f.state === 'onTrack')).toBe(true);
    expect(frames.at(-1)!.format).toBe('B');
    expect(sessions.some((s) => s !== null)).toBe(true);
    expect(statuses.some((s) => s.ingestor.state === 'connected')).toBe(true);
    // localhost may drop a packet now and then at 20× speed: time must still be within a frame
    laps.forEach((e, i) => {
      expect(Math.abs(e.timeMs - gen.laps[i]!.timeMs)).toBeLessThanOrEqual(17);
    });
    expect(laps[0]!.trackId).toBeTruthy();
    const lapRows = runtime.store.listLaps(laps[0]!.sessionId);
    expect(lapRows).toHaveLength(1);

    const sessionId = laps[0]!.sessionId;
    await runtime.stop();
    const s = runtime.store.getSession(sessionId)!;
    expect(s.endedAt).not.toBeNull();
    expect(s.recordingFile).toBe(`recordings/${sessionId}.gt7rec`);
    expect(existsSync(join(dir, 'data', s.recordingFile!))).toBe(true);
    expect(existsSync(join(dir, 'data', 'traces', `${laps[0]!.lapId}.bin.gz`))).toBe(true);
    expect(runtime.getStatus().connection).toBe('disconnected');
  });
});

describe('Gt7Runtime settings', () => {
  it('setCaptureFormat persists; persistConsoleIp=false keeps the IP out of the settings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt7-runtime-set-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const rt = new Gt7Runtime({ dataDir: dir, consoleIp: '127.0.0.1', persistConsoleIp: false });
    expect(rt.consoleIp).toBe('127.0.0.1');
    expect(rt.store.getSetting('consoleIp')).toBeUndefined();
    rt.setConsoleIp('127.0.0.2');
    expect(rt.store.getSetting('consoleIp')).toBeUndefined();
    expect(rt.getSettings().captureFormat).toBe('B');
    rt.setCaptureFormat('C');
    expect(rt.getSettings().captureFormat).toBe('C');
    await rt.close();

    const rt2 = new Gt7Runtime({ dataDir: dir, consoleIp: '10.0.0.5' });
    expect(rt2.getSettings().captureFormat).toBe('C');
    expect(rt2.store.getSetting('consoleIp')).toBe('10.0.0.5');
    await rt2.close();
  });
});

describe('Gt7Runtime automatic session capture (FakeConsole)', () => {
  const CAP_CONSOLE_PORT = 45741;
  const CAP_CLIENT_PORT = 45742;

  /** Menu + loading + out lap + `laps` laps, as a compressed-time recording. */
  async function menuToLapRecording(dir: string, laps: number): Promise<string> {
    const file = join(dir, 'menu-to-lap.gt7rec');
    const sim = new SyntheticSession({
      seed: 77,
      format: 'B',
      outLapM: 300,
      menuS: 2,
      loadingS: 1,
    });
    const w = await RecordingWriter.open(file, {
      format: 'B',
      startTime: 0,
      meta: { source: 'test' },
    });
    for (let i = 0; i < 20_000; i++) {
      const p = sim.next();
      w.write(encodePacket(p, 'B'), Math.round((i * 1000) / 60 / SPEEDUP));
      if (p.lapCount > laps) break;
    }
    await w.close();
    return file;
  }

  function capRuntime(dir: string, extra: ConstructorParameters<typeof Gt7Runtime>[0] = {}) {
    return new Gt7Runtime({
      dataDir: join(dir, 'data'),
      consoleIp: '127.0.0.1',
      persistConsoleIp: false,
      liveFormat: 'B',
      formatFallback: null,
      autoDetectCorners: false,
      ingestor: {
        bindPort: CAP_CLIENT_PORT,
        bindAddress: '127.0.0.1',
        consolePort: CAP_CONSOLE_PORT,
        discovery: false,
        heartbeatIntervalMs: 100,
        timeoutMs: 600,
        statsIntervalMs: 200,
      },
      ...extra,
    });
  }

  function fakeConsole(file: string) {
    return new FakeConsole({
      port: CAP_CONSOLE_PORT,
      host: '127.0.0.1',
      targetPort: CAP_CLIENT_PORT,
      formatLockMs: 300,
      heartbeatTimeoutMs: 2000,
      source: { kind: 'recording', file, loop: false },
    });
  }

  it('opens by itself when the car gets on the track, closes when the PS5 goes quiet, and again next time', {
    timeout: 90_000,
  }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt7-runtime-cap-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = await menuToLapRecording(dir, 1);

    // the app is open BEFORE the game: nothing to record, and it says so
    const runtime = capRuntime(dir);
    cleanups.push(() => runtime.close());
    const saved: SessionSavedInfo[] = [];
    runtime.on('sessionSaved', (s) => saved.push(s));
    await runtime.start();
    const waiting = runtime.getStatus().sessionCapture!;
    expect(waiting).toMatchObject({ state: 'waiting', sessionId: null });
    expect(waiting.hint).toMatch(/Aguardando/);
    expect(runtime.store.listSessions()).toHaveLength(0);

    // the console appears (menu first) and the user enters a track: no click anywhere
    const fake1 = fakeConsole(file);
    await fake1.start();
    cleanups.push(() => fake1.stop());
    const rec = await waitFor(() => {
      const c = runtime.getStatus().sessionCapture!;
      return c.state === 'recording' ? c : undefined;
    }, 40_000);
    const firstId = rec.sessionId!;
    expect(rec.hint).toMatch(/^Gravando sessão/);
    expect(runtime.store.getSession(firstId)?.endedAt).toBeNull();
    await waitFor(() => runtime.getStatus().sessionCapture!.lapsDone >= 1, 40_000);
    expect(runtime.getStatus().sessionCapture!.hint).toBe('Gravando sessão — 1 volta até agora');

    // the PS5 goes to rest mode: the stream stops, the session stays open for a while...
    await fake1.stop();
    await waitFor(() => runtime.getStatus().connection === 'disconnected', 10_000);
    const quiet = runtime.getStatus().sessionCapture!;
    expect(quiet).toMatchObject({ state: 'paused', sessionId: firstId });
    expect(quiet.hint).toMatch(/Sem sinal do PS5/);
    expect(saved).toHaveLength(0);
    // ...and is closed cleanly once the quiet period is over (the runtime timer calls tick())
    runtime.engine.tick(Date.now() + 11 * 60_000);
    await runtime.whenAnalysisIdle();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ sessionId: firstId, lapCount: 1 });
    expect(runtime.store.getSession(firstId)?.endedAt).not.toBeNull();
    expect(runtime.store.listLaps(firstId)).toHaveLength(1);
    expect(runtime.getStatus().sessionCapture!.state).toBe('waiting');

    // hours later the console comes back (packet ids start over): a NEW session, runtime alive
    const fake2 = fakeConsole(file);
    await fake2.start();
    cleanups.push(() => fake2.stop());
    const again = await waitFor(() => {
      const c = runtime.getStatus().sessionCapture!;
      return c.state === 'recording' && c.sessionId !== firstId ? c : undefined;
    }, 40_000);
    expect(again.sessionId).not.toBe(firstId);
    await waitFor(() => runtime.getStatus().sessionCapture!.lapsDone >= 1, 40_000);
    expect(runtime.store.listSessions()).toHaveLength(2);
  });

  it('caps the raw recording of a session without losing laps', { timeout: 90_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt7-runtime-cap2-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = await menuToLapRecording(dir, 1);
    const runtime = capRuntime(dir, { maxRecordingBytes: 40_000 });
    cleanups.push(() => runtime.close());
    const notices: string[] = [];
    runtime.on('notice', (n) => notices.push(n.code));
    await runtime.start();
    const fake = fakeConsole(file);
    await fake.start();
    cleanups.push(() => fake.stop());
    await waitFor(() => runtime.getStatus().sessionCapture!.lapsDone >= 1, 60_000);
    expect(notices).toContain('recordingCapped');
    expect(notices.filter((c) => c === 'recordingCapped')).toHaveLength(1);
    const id = runtime.session!.id;
    await runtime.stop();
    const s = runtime.store.getSession(id)!;
    expect(s.lapCount).toBe(1);
    expect(existsSync(join(dir, 'data', s.recordingFile!))).toBe(true);
  });
});
