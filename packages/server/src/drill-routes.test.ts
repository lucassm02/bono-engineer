import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiDrillState, ApiDrillStop, CornerDrill, Session, Track } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function makeApp(): Promise<Gt7Server> {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-drill-'));
  const server = await createApp({
    port: 46893,
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

const drill = (id: string, startedAt: number): CornerDrill => ({
  id,
  sessionId: 's-1',
  trackId: 'trk-1',
  cornerId: 'T7',
  startedAt,
  endedAt: startedAt + 60_000,
  targetMs: null,
  passes: [
    {
      n: 1,
      timeMs: 3600,
      entrySpeedKmh: 120,
      minSpeedKmh: 70,
      exitSpeedKmh: 110,
      brakePointM: 90,
      at: 1,
    },
    {
      n: 2,
      timeMs: 3421,
      entrySpeedKmh: 124,
      minSpeedKmh: 72,
      exitSpeedKmh: 113,
      brakePointM: 85,
      at: 2,
    },
  ],
});

describe('/api/drill', () => {
  it('has no drill by default, and cannot start one without a track with corners', async () => {
    const server = await makeApp();
    const state = await server.app.inject({ method: 'GET', url: '/api/drill' });
    expect(state.statusCode).toBe(200);
    expect(state.json<ApiDrillState>().drill).toBeNull();

    const start = await server.app.inject({
      method: 'POST',
      url: '/api/drill',
      payload: { cornerId: 'T7' },
    });
    expect(start.statusCode).toBe(409);
    expect(start.json().error.code).toBe('noCorner');

    const bad = await server.app.inject({ method: 'POST', url: '/api/drill', payload: {} });
    expect(bad.statusCode).toBe(400);

    const stop = await server.app.inject({ method: 'DELETE', url: '/api/drill' });
    expect(stop.statusCode).toBe(200);
    expect(stop.json<ApiDrillStop>()).toEqual({ drill: null, summary: null });
  });

  it('lists the stored drills of a session and of a corner', async () => {
    const server = await makeApp();
    const store = server.runtime.store;
    store.insertTrack(TRACK);
    store.saveSession(SESSION);
    store.saveDrill(drill('d1', 10_000));
    store.saveDrill(drill('d2', 20_000));

    const bySession = await server.app.inject({ method: 'GET', url: '/api/sessions/s-1/drills' });
    expect(bySession.json<CornerDrill[]>().map((d) => d.id)).toEqual(['d1', 'd2']);

    const byCorner = await server.app.inject({
      method: 'GET',
      url: '/api/tracks/trk-1/drills?corner=T7',
    });
    expect(byCorner.json<CornerDrill[]>().map((d) => d.id)).toEqual(['d2', 'd1']);
    expect(byCorner.json<CornerDrill[]>()[0]!.passes).toHaveLength(2);

    expect(
      (await server.app.inject({ method: 'GET', url: '/api/tracks/trk-1/drills' })).statusCode,
    ).toBe(400);
    expect(
      (await server.app.inject({ method: 'GET', url: '/api/sessions/nope/drills' })).statusCode,
    ).toBe(404);
  });
});
