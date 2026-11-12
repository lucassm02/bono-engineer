import { existsSync, mkdtempSync, readdirSync, rmSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultDeviceProfile, type Lap, type Session, type Track } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Gt7Store } from '../store/store.ts';
import { TraceBuilder } from '../trace/channels.ts';
import { computeFingerprint, lapPolyline } from '../track/fingerprint.ts';
import { createBackup, importBackup, inspectBackup } from './backup.ts';

const META = { appName: 'Bono Engineer', appVersion: '0.0.0-test' };
const dirs: string[] = [];
const stores: Gt7Store[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'bono-backup-test-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function open(dir = tempDir()): Gt7Store {
  const s = Gt7Store.open(dir);
  stores.push(s);
  return s;
}

function circle(radius: number) {
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < 400; i++) {
    xs.push(Math.cos((i / 400) * Math.PI * 2) * radius);
    zs.push(Math.sin((i / 400) * Math.PI * 2) * radius);
  }
  return computeFingerprint(lapPolyline(xs, zs));
}

function track(id: string, name: string, radius = 300): Track {
  return {
    id,
    name,
    layout: null,
    fingerprint: circle(radius),
    lengthM: 2 * Math.PI * radius,
    centerline: null,
    sectorGates: [],
    corners: [],
    source: 'auto',
    createdAt: 1,
    updatedAt: 1,
  };
}

function session(id: string, trackId: string | null, recordingFile: string | null = null): Session {
  return {
    id,
    trackId,
    carCode: 3455,
    startedAt: 1000,
    endedAt: 2000,
    format: '~',
    mode: 'live',
    lapCount: 2,
    bestLapMs: 90_000,
    recordingFile,
    notes: null,
    trackTimeMs: null,
  };
}

function lap(id: string, sessionId: string, trackId: string | null): Lap {
  return {
    id,
    sessionId,
    number: 1,
    timeMs: 90_000,
    sectorTimesMs: [30_000, 30_000, 30_000],
    valid: true,
    flags: [],
    isReference: false,
    referenceMeta: null,
    startedAt: 1000,
    carCode: 3455,
    trackId,
    fuelUsedL: null,
    sampleCount: 0,
    lostPackets: 0,
    traceFile: null,
  };
}

function trace(lapId: string) {
  const b = new TraceBuilder(16);
  for (let i = 0; i < 50; i++) {
    b.push({
      tMs: i * 16.6667,
      distanceM: i * 2.5,
      packetId: 1_000 + i,
      x: i,
      y: 0,
      z: 0,
      speedKmh: 150,
      rpm: 6000,
      gear: 3,
      throttle: 0.5,
      brake: 0,
      clutch: 0,
      steeringRad: 0,
      throttleRaw: 0.5,
      yawRate: 0,
      latG: 0,
      lonG: 0,
      vertG: 0,
      slipFL: 0,
      slipFR: 0,
      slipRL: 0,
      slipRR: 0,
      tyreTempFL: 80,
      tyreTempFR: 80,
      tyreTempRL: 80,
      tyreTempRR: 80,
      suspFL: 0,
      suspFR: 0,
      suspRL: 0,
      suspRR: 0,
      fuelL: 40,
      flags: 1,
    });
  }
  return b.build(lapId);
}

describe('backup .bono', () => {
  it('exports everything and imports it into another install, matching the same circuit', async () => {
    const a = open();
    a.insertTrack(track('trk-a', 'Meu circuito'));
    a.saveSession(session('s1', 'trk-a'));
    a.saveLap(lap('l1', 's1', 'trk-a'), trace('l1'));
    a.setSetting('coach.apiKey', 'sk-ant-SEGREDO');
    a.setSetting('liveFormat', 'B');
    a.setSetting('events.dgEdge.enabled', true);
    a.saveDeviceProfile(createDefaultDeviceProfile('d-1'));
    await a.flush();

    const file = join(tempDir(), 'tudo.bono');
    const info = await createBackup(
      a,
      { laps: true, settings: true, recordings: false },
      file,
      META,
    );
    expect(info.manifest.counts).toMatchObject({
      sessions: 1,
      laps: 1,
      tracks: 1,
      deviceProfiles: 1,
    });
    expect(info.manifest.includes.laps).toBe(true);
    expect((await inspectBackup(file)).manifest.app.version).toBe('0.0.0-test');

    // A second install already knows the same circuit under another id.
    const b = open();
    b.insertTrack(track('trk-b', 'Circuito dele'));
    const result = await importBackup(b, file, { mode: 'merge', settings: true }, META);
    expect(result).toMatchObject({ sessions: 1, laps: 1, tracks: 0, tracksMatched: 1 });
    expect(b.getSession('s1')?.trackId).toBe('trk-b');
    expect(b.getLap('l1')?.trackId).toBe('trk-b');
    expect(existsSync(join(b.dataDir, b.traceFileFor('l1')))).toBe(true);
    expect(b.getSetting('liveFormat')).toBe('B');
    // Secrets never travel.
    expect(b.getSetting('coach.apiKey')).toBeUndefined();
    // The consent to fetch Daily Races is per PC: a restored backup asks again.
    expect(b.getSetting('events.dgEdge.enabled')).toBeUndefined();

    // Importing again changes nothing.
    const again = await importBackup(b, file, { mode: 'merge', settings: true }, META);
    expect(again).toMatchObject({ sessions: 0, laps: 0, tracks: 0 });
    expect(b.listSessions({}).length).toBe(1);
  });

  it('adds a circuit that is new to the destination', async () => {
    const a = open();
    a.insertTrack(track('trk-a', 'Circuito grande', 900));
    a.saveSession(session('s1', 'trk-a'));
    await a.flush();
    const file = join(tempDir(), 'a.bono');
    await createBackup(a, { laps: true, settings: false, recordings: false }, file, META);

    const b = open();
    b.insertTrack(track('trk-b', 'Circuito pequeno', 150));
    const result = await importBackup(b, file, { mode: 'merge', settings: false }, META);
    expect(result.tracks).toBe(1);
    expect(b.getSession('s1')?.trackId).toBe('trk-a');
    expect(b.listTracks().length).toBe(2);
  });

  it('replace mode swaps the data and keeps a safety copy of the old one', async () => {
    const a = open();
    a.insertTrack(track('trk-a', 'A'));
    a.saveSession(session('sa', 'trk-a'));
    await a.flush();
    const file = join(tempDir(), 'a.bono');
    await createBackup(a, { laps: true, settings: false, recordings: false }, file, META);

    const b = open();
    b.insertTrack(track('trk-old', 'Antiga', 700));
    b.saveSession(session('so', 'trk-old'));
    const result = await importBackup(b, file, { mode: 'replace', settings: false }, META);
    expect(b.getSession('so')).toBeNull();
    expect(b.getSession('sa')?.trackId).toBe('trk-a');
    expect(result.safetyBackup).not.toBeNull();
    expect(existsSync(result.safetyBackup!)).toBe(true);
    expect(readdirSync(join(b.dataDir, 'backups')).length).toBe(1);
  });

  it('exports only the settings when asked', async () => {
    const a = open();
    a.insertTrack(track('trk-a', 'A'));
    a.saveSession(session('s1', 'trk-a'));
    a.setSetting('liveFormat', 'A');
    const file = join(tempDir(), 'cfg.bono');
    const info = await createBackup(
      a,
      { laps: false, settings: true, recordings: false },
      file,
      META,
    );
    expect(info.manifest.counts).toMatchObject({ sessions: 0, laps: 0, tracks: 0 });
    expect(info.manifest.counts.settings).toBeGreaterThan(0);
  });

  it('rejects files that are not a backup or are damaged', async () => {
    const dir = tempDir();
    const notZip = join(dir, 'x.bono');
    await (await import('node:fs/promises')).writeFile(notZip, 'isto nao e um zip');
    await expect(inspectBackup(notZip)).rejects.toThrow(/backup do Bono/);

    const a = open();
    a.insertTrack(track('trk-a', 'A'));
    await a.flush();
    const good = join(dir, 'good.bono');
    await createBackup(a, { laps: true, settings: true, recordings: false }, good, META);
    truncateSync(good, 40);
    await expect(inspectBackup(good)).rejects.toThrow();
  });
});
