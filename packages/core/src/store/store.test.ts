import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateLaps } from '@gt7/protocol';
import { createDefaultDeviceProfile, type Lap, type Session } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveEngine } from '../live/live-engine.ts';
import { TraceBuilder } from '../trace/channels.ts';
import { sequentialIds } from '../util/ids.ts';
import { SCHEMA_VERSION } from './schema.ts';
import { Gt7Store } from './store.ts';
import { StoreEngineContext } from './store-context.ts';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'gt7-store-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function sampleTrace(lapId: string, n = 500) {
  const b = new TraceBuilder(16);
  for (let i = 0; i < n; i++) {
    b.push({
      tMs: i * 16.6667,
      distanceM: i * 2.5,
      packetId: 2_000_000_000 + i,
      x: Math.sin(i / 50) * 300,
      y: 1.25,
      z: Math.cos(i / 50) * 300,
      speedKmh: 180 + (i % 7),
      rpm: 7000,
      gear: 4,
      throttle: 0.5,
      brake: 0,
      clutch: 0,
      steeringRad: Number.NaN,
      throttleRaw: 0.25,
      yawRate: 0.1,
      latG: 0.4,
      lonG: -0.2,
      vertG: Number.NaN,
      slipFL: 0.01,
      slipFR: 0.01,
      slipRL: 0.03,
      slipRR: 0.03,
      tyreTempFL: 80,
      tyreTempFR: 81,
      tyreTempRL: 78,
      tyreTempRR: 79,
      suspFL: 0.08,
      suspFR: 0.08,
      suspRL: 0.085,
      suspRR: 0.085,
      fuelL: 50 - i * 0.001,
      flags: 9,
    });
  }
  return b.build(lapId);
}

describe('Gt7Store', () => {
  it('round-trips sessions, laps, traces, references, profiles and settings', async () => {
    const dir = tempDir();
    const store = Gt7Store.open(dir);
    expect(store.schemaVersion).toBe(SCHEMA_VERSION);
    const session: Session = {
      id: 's1',
      trackId: null,
      carCode: 3455,
      startedAt: 1000,
      endedAt: null,
      format: '~',
      mode: 'live',
      lapCount: 0,
      bestLapMs: null,
      recordingFile: 'recordings/s1.gt7rec',
      notes: 'nota',
    };
    store.saveSession(session);
    const lap: Lap = {
      id: 'l1',
      sessionId: 's1',
      number: 1,
      timeMs: 91234,
      sectorTimesMs: [30000, 31000, 30234],
      valid: true,
      flags: [],
      isReference: false,
      referenceMeta: null,
      startedAt: 2000,
      carCode: 3455,
      trackId: 't1',
      fuelUsedL: 2.5,
      sampleCount: 0,
      lostPackets: 0,
      traceFile: null,
    };
    const trace = sampleTrace('l1');
    const saved = store.saveLap(lap, trace);
    expect(saved.traceFile).toBe('traces/l1.bin.gz');
    // readable from memory before the write completes
    expect((await store.loadTrace('l1'))?.length).toBe(500);
    await store.flush();
    store.saveLap({ ...lap, id: 'l2', number: 2, timeMs: 90000, valid: false, flags: ['paused'] });
    store.saveSession({ ...session, endedAt: 5000 });

    const s = store.getSession('s1')!;
    expect(s).toMatchObject({ endedAt: 5000, lapCount: 2, bestLapMs: 91234, notes: 'nota' });
    expect(store.listSessions()).toHaveLength(1);
    expect(store.listLaps('s1').map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(store.getLap('l1')).toMatchObject({
      sectorTimesMs: [30000, 31000, 30234],
      valid: true,
      sampleCount: 500,
    });
    expect(store.getLap('l2')!.flags).toEqual(['paused']);

    store.setReference('l1', {
      driverName: 'Top 1',
      source: 'replayCapture',
      rankingTimeMs: 91200,
      capturedAt: 9,
    });
    expect(store.listReferenceLaps('t1').map((l) => l.id)).toEqual(['l1']);
    expect(store.getLap('l1')!.referenceMeta).toMatchObject({
      driverName: 'Top 1',
      rankingTimeMs: 91200,
    });
    expect(store.getBestLaps('t1').map((l) => l.id)).toEqual(['l1']);
    expect(store.getPersonalBestLap('t1', 3455)).toBeNull(); // only valid lap is a reference
    store.setReference('l1', null);
    expect(store.getPersonalBestLap('t1', 3455)?.id).toBe('l1');

    const profile = { ...createDefaultDeviceProfile('dev-1', 'Celular'), locked: true };
    store.saveDeviceProfile(profile);
    expect(store.getDeviceProfile('dev-1')).toMatchObject({ name: 'Celular', locked: true });
    expect(store.listDeviceProfiles()).toHaveLength(1);

    store.setSetting('consoleIp', '192.168.0.10');
    store.setSetting('obj', { a: [1, 2] });
    expect(store.getSetting('consoleIp')).toBe('192.168.0.10');
    expect(store.getSetting('missing', 42)).toBe(42);
    expect(store.getSettings()).toMatchObject({ obj: { a: [1, 2] } });
    await store.close();

    // reopen: data persisted, trace file decodes, migrations idempotent
    const again = Gt7Store.open(dir);
    expect(again.migrate()).toBe(0);
    expect(again.schemaVersion).toBe(SCHEMA_VERSION);
    expect(again.getSession('s1')!.lapCount).toBe(2);
    const t2 = (await again.loadTrace('l1'))!;
    expect(t2.length).toBe(500);
    expect(t2.lapId).toBe('l1');
    expect(t2.channels.packetId[499]).toBe(2_000_000_499);
    expect(t2.channels.tMs[10]).toBeCloseTo(166.667, 6);
    expect(t2.channels.speedKmh[3]).toBe(183);
    expect(Number.isNaN(t2.channels.steeringRad[0])).toBe(true);
    expect(t2.channels.throttleRaw[0]).toBe(0.25);
    expect(again.loadTraceSync('l1')?.length).toBe(500);

    expect(await again.deleteSession('s1')).toBe(true);
    expect(again.getLap('l1')).toBeNull();
    expect(await again.loadTrace('l1')).toBeNull();
    await again.close();
  });

  it('engine + store: track recognized across sessions, unknown track created once', async () => {
    const dir = tempDir();
    const store = Gt7Store.open(dir);
    const ctx = new StoreEngineContext(store, { idFactory: sequentialIds('trk') });
    const feed = (profile: 'pro' | 'amateur', seed: number) => {
      const engine = new LiveEngine({ context: ctx });
      const gen = generateLaps({ profile, seed, laps: 2, format: 'B' });
      gen.packets.forEach((p, i) => {
        engine.push(p, 1_700_000_000_000 + seed * 1e7 + i * 16.67);
      });
      engine.endSession();
    };
    feed('pro', 1);
    feed('amateur', 2);
    feed('pro', 3);
    const tracks = store.listTracks();
    expect(tracks).toHaveLength(1);
    const track = tracks[0]!;
    expect(track.name).toBe('Pista desconhecida 1');
    const cl = store.getCenterline(track.id)!;
    expect(cl.stepM).toBe(2);
    expect(cl.x.length).toBeGreaterThan(2000);
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(3);
    for (const s of sessions) {
      expect(s.trackId).toBe(track.id);
      expect(s.endedAt).not.toBeNull();
      expect(s.lapCount).toBe(2);
    }
    expect(store.listLapsForTrack(track.id)).toHaveLength(6);
    // renames
    store.renameTrack(track.id, 'Synthetic Ring');
    store.setTrackCorners(track.id, [
      { id: 'T1', index: 0, name: null, entryM: 767, apexM: 795, exitM: 822, direction: 'left' },
    ]);
    store.renameCorner(track.id, 'T1', 'Hairpin');
    expect(store.getTrack(track.id)).toMatchObject({ name: 'Synthetic Ring', source: 'user' });
    expect(store.getTrack(track.id)!.corners[0]!.name).toBe('Hairpin');
    // fourth session: matched to the renamed track, nothing new created
    feed('amateur', 4);
    expect(store.listTracks()).toHaveLength(1);
    await store.close();
  });
});
