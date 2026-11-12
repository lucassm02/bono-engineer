import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiTrackGoal, Goal, Lap, Session, Track } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function makeApp(): Promise<Gt7Server> {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-goal-'));
  const server = await createApp({
    port: 46892,
    host: '127.0.0.1',
    webDist: null,
    firewall: { platform: 'linux' },
    hub: { keepAliveMs: 0 },
    runtime: { dataDir: join(dir, 'data'), record: false, persistConsoleIp: false },
  });
  cleanups.push(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return server;
}

const TRACK: Track = {
  id: 'trk-1',
  name: 'Meu circuito',
  layout: null,
  fingerprint: {} as never,
  lengthM: 3000,
  centerline: null,
  sectorGates: [],
  corners: [],
  source: 'auto',
  createdAt: 1,
  updatedAt: 1,
};

const SESSION: Session = {
  id: 's-1',
  trackId: 'trk-1',
  carCode: 3455,
  startedAt: 1000,
  endedAt: 2000,
  format: '~',
  mode: 'live',
  lapCount: 0,
  bestLapMs: null,
  recordingFile: null,
  notes: null,
  trackTimeMs: null,
};

function lap(id: string, timeMs: number, startedAt: number): Lap {
  return {
    id,
    sessionId: 's-1',
    number: 1,
    timeMs,
    sectorTimesMs: [],
    valid: true,
    flags: [],
    isReference: false,
    referenceMeta: null,
    startedAt,
    carCode: 3455,
    trackId: 'trk-1',
    fuelUsedL: null,
    sampleCount: 0,
    lostPackets: 0,
    traceFile: null,
  };
}

describe('/api/tracks/:id/goal', () => {
  it('sets, reads, suggests and removes a goal', async () => {
    const server = await makeApp();
    const store = server.runtime.store;
    store.insertTrack(TRACK);
    store.saveSession(SESSION);
    store.saveLap(lap('l1', 106_000, 1500));
    store.saveLap(lap('l2', 104_000, 1600));

    const empty = await server.app.inject({ method: 'GET', url: '/api/tracks/trk-1/goal' });
    expect(empty.statusCode).toBe(200);
    const before = empty.json<ApiTrackGoal>();
    expect(before.active).toBeNull();
    expect(before.bestLapMs).toBe(104_000);
    // two laps but no track line: no ideal lap, so 0.5 % under the best lap
    expect(before.suggestion).toMatchObject({ basis: 'bestLap', targetMs: 103_480 });

    const put = await server.app.inject({
      method: 'PUT',
      url: '/api/tracks/trk-1/goal',
      payload: { targetMs: 103_000 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json<Goal>()).toMatchObject({ trackId: 'trk-1', targetMs: 103_000, carCode: null });

    const after = (
      await server.app.inject({ method: 'GET', url: '/api/tracks/trk-1/goal?carCode=3455' })
    ).json<ApiTrackGoal>();
    expect(after.active?.targetMs).toBe(103_000);
    expect(after.baselineMs).toBe(104_000);

    const del = await server.app.inject({ method: 'DELETE', url: '/api/tracks/trk-1/goal' });
    expect(del.statusCode).toBe(200);
    const gone = (
      await server.app.inject({ method: 'GET', url: '/api/tracks/trk-1/goal' })
    ).json<ApiTrackGoal>();
    expect(gone.active).toBeNull();
  });

  it('refuses invalid goals and asks before accepting one slower than the best lap', async () => {
    const server = await makeApp();
    const store = server.runtime.store;
    store.insertTrack(TRACK);
    store.saveSession(SESSION);
    store.saveLap(lap('l1', 104_000, 1500));

    const zero = await server.app.inject({
      method: 'PUT',
      url: '/api/tracks/trk-1/goal',
      payload: { targetMs: 0 },
    });
    expect(zero.statusCode).toBe(400);
    expect(zero.json().error.code).toBe('goalInvalid');

    const slower = await server.app.inject({
      method: 'PUT',
      url: '/api/tracks/trk-1/goal',
      payload: { targetMs: 110_000 },
    });
    expect(slower.statusCode).toBe(400);
    expect(slower.json().error.code).toBe('goalSlower');

    const forced = await server.app.inject({
      method: 'PUT',
      url: '/api/tracks/trk-1/goal',
      payload: { targetMs: 110_000, allowSlower: true },
    });
    expect(forced.statusCode).toBe(200);

    const missing = await server.app.inject({ method: 'GET', url: '/api/tracks/nope/goal' });
    expect(missing.statusCode).toBe(404);
  });
});
