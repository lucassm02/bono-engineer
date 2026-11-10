/**
 * Reference capture by geometry (Onda 9a). The replay packets come from the synthetic generator in
 * `replay: true` mode, which mimics the real console: `carOnTrack` false, lapCount stuck at 1, no lap
 * clock, no last lap time. The capture must not need any of that.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateLaps } from '@gt7/protocol';
import type { LiveFrame, ReferenceCaptureStatus, TelemetryPacket } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveEngine } from '../live/live-engine.ts';
import { Gt7Store } from '../store/store.ts';
import { StoreEngineContext } from '../store/store-context.ts';
import { ReferenceCapture } from './reference-capture.ts';

const dirs: string[] = [];
const stores: Gt7Store[] = [];
afterEach(async () => {
  for (const st of stores.splice(0)) await st.close().catch(() => {});
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const MS = 1000 / 60;
let clock = 1_700_000_000_000;
function feed(engine: LiveEngine, packets: TelemetryPacket[], stepMs = MS): void {
  for (const p of packets) {
    clock += stepMs;
    engine.push(p, clock);
  }
}
const tick = () => new Promise((r) => setImmediate(r));

function setup(opts: { learnTrack?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-capture-'));
  dirs.push(dir);
  const store = Gt7Store.open(dir);
  stores.push(store);
  const engine = new LiveEngine({ context: new StoreEngineContext(store) });
  const capture = new ReferenceCapture({ engine, store });
  if (opts.learnTrack !== false) {
    // a live session first, so the track is known (the app learns tracks from the driver's laps)
    feed(engine, generateLaps({ profile: 'amateur', seed: 3, laps: 1, format: '~' }).packets);
    engine.endSession();
  }
  return { store, engine, capture };
}

const replayOf = (seed: number, laps = 2) =>
  generateLaps({ profile: 'pro', seed, laps, format: '~', replay: true });

/** Index of the packet where lap 1 starts (same seed without replay: lapCount tells it). */
const lap1Start = (seed: number, laps: number) =>
  generateLaps({ profile: 'pro', seed, laps, format: '~' }).packets.findIndex(
    (p) => p.lapCount === 1,
  );

/** A paused replay: the same car data over and over, with packetIds that keep counting. */
function withPause(packets: TelemetryPacket[], at: number, count: number): TelemetryPacket[] {
  const head = packets.slice(0, at);
  const frozen = Array.from({ length: count }, (_, i) => ({
    ...packets[at]!,
    packetId: packets[at]!.packetId + i,
  }));
  const tail = packets.slice(at).map((p) => ({ ...p, packetId: p.packetId + count }));
  return [...head, ...frozen, ...tail];
}

describe('synthetic replay packets look like the real console', () => {
  it('carOnTrack false, lapCount stuck, no lap clock, zeroed menu packets', () => {
    const g = generateLaps({ profile: 'pro', seed: 1, laps: 1, format: '~', replay: true });
    const moving = g.packets.filter((p) => p.speedMps > 2);
    expect(moving.length).toBeGreaterThan(1000);
    for (const p of moving) {
      expect(p.flags & 1).toBe(0); // carOnTrack flag clear
      expect(p.lapCount).toBe(1);
      expect(p.lastLapMs).toBeLessThanOrEqual(0);
      expect(p.bestLapMs).toBeLessThanOrEqual(0);
      expect(p.currentLapMs ?? 0).toBe(0);
    }
    expect(g.laps).toHaveLength(1);
  });

  it('menu packets of a replay are all zero (like the real console), then the car moves', () => {
    const g = generateLaps({
      profile: 'pro',
      seed: 1,
      laps: 1,
      format: '~',
      replay: true,
      includeMenu: true,
      menuS: 1,
      loadingS: 0.5,
    });
    const first = g.packets[0]!;
    expect(first.carCode).toBe(0);
    expect(first.speedMps).toBe(0);
    expect(first.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(first.flags).toBe(0);
    expect(g.packets[200]!.speedMps).toBeGreaterThan(5);
  });
});

describe('ReferenceCapture by geometry', () => {
  it('captures a full replay lap: time from packets within 25 ms, no pilot session', async () => {
    const { store, engine, capture } = setup();
    const sessionsBefore = store.listSessions().length;
    const statuses: ReferenceCaptureStatus[] = [];
    capture.on('status', (s) => statuses.push(s));
    const replay = replayOf(9);
    const real = replay.laps[0]!.timeMs;
    await capture.start({ driverName: 'Líder Mundial' });
    expect(capture.status.state).toBe('waitingLapStart');
    expect(capture.status.waiting).toBe('replay');
    expect(engine.replayMode).toBe(false); // the capture does not need the legacy replay mode

    const sessionsStarted: string[] = [];
    engine.on('sessionStarted', (s) => sessionsStarted.push(s.id));
    const frames: LiveFrame[] = [];
    engine.on('frame', (f) => frames.push(f));
    feed(engine, replay.packets);
    await tick();

    expect(sessionsStarted).toEqual([]); // no pilot session in a replay
    const st = capture.status;
    expect(st.state).toBe('idle');
    expect(st.issues).toEqual([]);
    expect(st.lapId).not.toBeNull();
    expect(st.timeSource).toBe('packets');
    expect(Math.abs(st.measuredLapMs! - real)).toBeLessThan(25);
    expect(st.trackName).toMatch(/Pista desconhecida/);
    expect(statuses.map((s) => s.state)).toEqual(
      expect.arrayContaining(['waitingLapStart', 'recording', 'validating', 'idle']),
    );
    expect(statuses.some((s) => s.waiting === 'startLine')).toBe(true);
    expect(statuses.some((s) => s.state === 'recording' && (s.recordingMs ?? 0) > 1000)).toBe(true);
    // the live panel kept getting frames in state 'replay'
    expect(frames.some((f) => f.state === 'replay' && f.car.speedKmh > 50)).toBe(true);

    const lap = store.getLap(st.lapId!)!;
    expect(lap.isReference).toBe(true);
    expect(lap.flags).toContain('replay');
    expect(Math.abs(lap.timeMs - real)).toBeLessThan(25);
    expect(lap.fuelUsedL).toBeNull();
    expect(lap.sampleCount).toBeGreaterThan(3000);
    expect(lap.sectorTimesMs).toHaveLength(3);
    expect(lap.sectorTimesMs.reduce((s: number, v) => s + (v ?? 0), 0)).toBe(lap.timeMs);
    expect(lap.referenceMeta).toMatchObject({
      driverName: 'Líder Mundial',
      source: 'replayCapture',
      timeSource: 'packets',
      rankingTimeMs: null,
    });
    // the only new session is the replayCapture one; nothing of the replay is a "live" session
    const sessions = store.listSessions();
    expect(sessions.length).toBe(sessionsBefore + 1);
    expect(store.getSession(lap.sessionId)!.mode).toBe('replayCapture');
    expect(sessions.filter((s) => s.mode === 'live')).toHaveLength(sessionsBefore);
    expect(store.listReferenceLaps(lap.trackId!).map((l) => l.id)).toEqual([lap.id]);
    // replay laps never become personal bests
    expect(store.getPersonalBestLap(lap.trackId!, lap.carCode)?.id).not.toBe(lap.id);

    // same channels as live laps → usable as delta reference (explicit id and "best of the track")
    const trace = store.loadTraceSync(lap.id)!;
    expect(trace.length).toBe(lap.sampleCount);
    expect(trace.channels.tMs[0]).toBe(0);
    expect(trace.channels.distanceM[0]).toBe(0);
    expect(trace.channels.tMs[trace.length - 1]).toBe(lap.timeMs);
    expect(Number(trace.channels.distanceM[trace.length - 1])).toBeGreaterThan(
      store.getTrack(lap.trackId!)!.lengthM * 0.97,
    );
    for (const lapId of [lap.id, null]) {
      engine.setDeltaReference('reference', lapId);
      let refSeen: string | null = null;
      let deltas = 0;
      const onFrame = (f: LiveFrame) => {
        refSeen = f.lap.delta.referenceLapId;
        if (f.lap.delta.ms !== null) deltas++;
      };
      engine.on('frame', onFrame);
      feed(engine, generateLaps({ profile: 'amateur', seed: 4, laps: 1, format: '~' }).packets);
      engine.off('frame', onFrame);
      engine.endSession();
      expect(refSeen).toBe(lap.id);
      expect(deltas).toBeGreaterThan(1000);
    }
  });

  it('accepts the typed ranking time within tolerance, keeps it as the lap time and reports the difference', async () => {
    const { store, capture } = setup();
    const { engine } = { engine: capture.options.engine };
    const replay = replayOf(11);
    const real = replay.laps[0]!.timeMs;
    const typed = real + 90; // a few packets away from the measurement
    await capture.start({ driverName: 'X', rankingTimeMs: typed });
    feed(engine, replay.packets);
    await tick();
    const st = capture.status;
    expect(st.state).toBe('idle');
    expect(st.timeSource).toBe('ranking');
    expect(st.rankingTimeMs).toBe(typed);
    expect(st.diffMs).toBe(st.measuredLapMs! - typed);
    expect(Math.abs(st.diffMs! + 90)).toBeLessThan(25);
    const lap = store.getLap(st.lapId!)!;
    expect(lap.timeMs).toBe(typed);
    const trace = store.loadTraceSync(lap.id)!;
    expect(trace.channels.tMs[trace.length - 1]).toBe(typed);
    expect(lap.referenceMeta).toMatchObject({ timeSource: 'ranking', rankingTimeMs: typed });
    expect(lap.referenceMeta!.measuredTimeMs).toBe(st.measuredLapMs);
  });

  it('rejects a lap whose measured time disagrees with the ranking time and keeps waiting', async () => {
    const { store, engine, capture } = setup();
    const invalid: string[][] = [];
    capture.on('invalid', (issues) => invalid.push(issues));
    const replay = replayOf(10, 3);
    await capture.start({ driverName: 'X', rankingTimeMs: replay.laps[1]!.timeMs + 2000 });
    feed(engine, replay.packets);
    await tick();
    expect(invalid).toHaveLength(2);
    expect(invalid[0]).toContain('timeMismatch');
    const st = capture.status;
    expect(st.state).toBe('recording'); // already on the next lap
    expect(st.issues).toContain('timeMismatch');
    expect(st.measuredLapMs).not.toBeNull();
    expect(st.diffMs).toBeLessThan(-1900); // measured − typed
    expect(store.listReferenceLaps()).toHaveLength(0);
    await capture.stop(false);
    expect(capture.status.state).toBe('idle');
  });

  it('starts in the middle of a lap: ignores the partial lap and captures the next complete one', async () => {
    const { store, engine, capture } = setup();
    const replay = replayOf(12, 3);
    // replay "opened" half way through the first flying lap
    const packets = replay.packets.slice(lap1Start(12, 3) + 2500);
    await capture.start({ driverName: 'Meio', rankingTimeMs: replay.laps[1]!.timeMs });
    feed(engine, packets);
    await tick();
    const st = capture.status;
    expect(st.state).toBe('idle');
    expect(st.issues).toEqual([]);
    const lap = store.getLap(st.lapId!)!;
    // it is lap 2 (typed time matched lap 2), not the partial lap 1
    expect(Math.abs(st.measuredLapMs! - replay.laps[1]!.timeMs)).toBeLessThan(25);
    expect(lap.timeMs).toBe(replay.laps[1]!.timeMs);
  });

  it('a paused replay discards that lap (never valid) and captures the next one', async () => {
    const { engine, capture } = setup();
    const replay = replayOf(13, 3);
    const packets = withPause(replay.packets, lap1Start(13, 3) + 2000, 90); // 1.5 s pause in lap 1
    const invalid: string[][] = [];
    capture.on('invalid', (issues) => invalid.push(issues));
    await capture.start({ driverName: 'Pausa' });
    feed(engine, packets);
    await tick();
    expect(invalid.length).toBeGreaterThanOrEqual(1);
    expect(invalid[0]).toContain('paused');
    const st = capture.status;
    expect(st.state).toBe('idle');
    expect(st.issues).toEqual([]);
    // the lap that was kept is a later, clean one: lap 2 time
    expect(Math.abs(st.measuredLapMs! - replay.laps[1]!.timeMs)).toBeLessThan(25);
  });

  it('a pause is never turned into a valid lap when nothing clean follows', async () => {
    const { store, engine, capture } = setup();
    const replay = replayOf(14, 1);
    const packets = withPause(replay.packets, lap1Start(14, 1) + 2000, 120);
    await capture.start({ driverName: 'Pausa' });
    feed(engine, packets);
    await tick();
    expect(capture.status.state).not.toBe('idle');
    expect(capture.status.lapId).toBeNull();
    expect(capture.status.issues).toContain('paused');
    expect(store.listReferenceLaps()).toHaveLength(0);
    await capture.stop();
  });

  it('a rewind (position jump back) invalidates the lap', async () => {
    const { store, engine, capture } = setup();
    const replay = replayOf(15, 1);
    const at = lap1Start(15, 1) + 2500;
    // jump back 10 s: the next packets continue from 600 packets earlier, ids keep counting
    const jumpBack = replay.packets.slice(at - 600, at + 1);
    const head = replay.packets.slice(0, at);
    const lastId = head[head.length - 1]!.packetId;
    const rest = jumpBack.concat(replay.packets.slice(at + 1));
    const packets = [...head, ...rest.map((p, i) => ({ ...p, packetId: lastId + 1 + i }))];
    const invalid: string[][] = [];
    capture.on('invalid', (issues) => invalid.push(issues));
    await capture.start({ driverName: 'Rewind' });
    feed(engine, packets);
    await tick();
    expect(invalid.flat()).toContain('discontinuity');
    expect(capture.status.lapId).toBeNull();
    expect(store.listReferenceLaps()).toHaveLength(0);
    await capture.stop();
  });

  it('a replay that is not at 1x (packets delivered at half speed) is rejected', async () => {
    const { engine, capture } = setup();
    const replay = replayOf(16, 2);
    await capture.start({ driverName: 'Lento' });
    feed(engine, replay.packets, MS * 2); // wall clock says 0.5x
    await tick();
    expect(capture.status.issues).toContain('notRealtime');
    expect(capture.status.lapId).toBeNull();
    await capture.stop();
  });

  it('unknown track: says to drive it live first and records nothing', async () => {
    const { store, engine, capture } = setup({ learnTrack: false });
    await capture.start({ driverName: 'Desconhecida' });
    feed(engine, replayOf(17, 1).packets);
    await tick();
    const st = capture.status;
    expect(st.state).toBe('waitingLapStart');
    expect(st.waiting).toBe('unknownTrack');
    expect(st.replayDetected).toBe(true);
    expect(st.hint).toMatch(/dirija essa pista ao vivo/i);
    expect(store.listReferenceLaps()).toHaveLength(0);
    expect(store.listSessions()).toHaveLength(0);
    await capture.stop();
  });

  it('a replay on a different known layout is not matched to the wrong track', async () => {
    const { store, engine, capture } = setup();
    await capture.start({ driverName: 'Outra' });
    const moved = replayOf(18, 1).packets.map((p) => ({
      ...p,
      position: { x: p.position.x * 1.6 + 2500, y: p.position.y, z: p.position.z * 1.6 - 800 },
    }));
    feed(engine, moved);
    await tick();
    expect(capture.status.waiting).toBe('unknownTrack');
    expect(store.listReferenceLaps()).toHaveLength(0);
    await capture.stop();
  });

  it('accepts an explicit trackId and locks onto it at once', async () => {
    const { store, engine, capture } = setup();
    const track = store.listTracks()[0]!;
    await capture.start({ driverName: 'Explícita', trackId: track.id });
    expect(capture.status.trackId).toBe(track.id);
    const replay = replayOf(19, 2);
    feed(engine, replay.packets);
    await tick();
    const st = capture.status;
    expect(st.state).toBe('idle');
    expect(store.getLap(st.lapId!)!.trackId).toBe(track.id);
  });

  it('the car in the live session is untouched: a replay after driving writes no driver lap', async () => {
    const { store, engine, capture } = setup({ learnTrack: false });
    // drive 1 lap live (session stays open), then watch a replay of the same track
    const live = generateLaps({ profile: 'amateur', seed: 3, laps: 1, format: '~' });
    feed(engine, live.packets);
    const lapsBefore = store.listSessions().flatMap((s) => store.listLaps(s.id)).length;
    const session = engine.session!;
    await capture.start({ driverName: 'Depois' });
    feed(engine, replayOf(20, 2).packets);
    await tick();
    expect(capture.status.state).toBe('idle');
    const all = store.listSessions().flatMap((s) => store.listLaps(s.id));
    // exactly one new lap (the reference) and it belongs to a replayCapture session
    expect(all.length).toBe(lapsBefore + 1);
    expect(store.getSession(session.id)!.lapCount).toBe(1);
    expect(store.getSession(session.id)!.mode).toBe('live');
  });
});
