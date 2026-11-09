import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCenterline, identifyOrCreateTrack, lapPolyline } from '@gt7/core';
import type { TrackRecognition } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import realLap from '../../shared/src/tracks/fixtures/trial-mountain-real-lap.json';
import { createApp, type Gt7Server } from './app.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function makeApp(): Promise<Gt7Server> {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-recog-'));
  const server = await createApp({
    port: 46891,
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

describe('GET /api/tracks/:id/recognition', () => {
  it('offers the official layout from the stored centerline, without renaming anything', async () => {
    const { app, runtime } = await makeApp();
    const store = runtime.store;
    // a track the user has not named yet: a lap on the real Trial Mountain line stored as unknown
    const line = lapPolyline(realLap.x, realLap.z);
    const r = identifyOrCreateTrack(store, {
      line,
      sourceLapId: 'lap-1',
      newId: () => 'trial1',
      now: 1,
    });
    store.updateTrack(r.track.id, { name: 'Pista desconhecida 1', layout: null, source: 'auto' });
    store.saveCenterline(buildCenterline(r.track.id, null, line));

    const res = await app.inject({ method: 'GET', url: '/api/tracks/trial1/recognition' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as TrackRecognition;
    expect(body.usedGeometry).toBe(true);
    expect(body.strong).toBe(true);
    expect(body.candidates[0]).toMatchObject({
      name: 'Trial Mountain Circuit',
      basis: 'geometry',
      confidence: 'high',
    });
    // nothing was renamed by asking
    expect(store.getTrack('trial1')?.name).toBe('Pista desconhecida 1');
  });

  it('falls back to the length window when the track has no centerline, 404 for unknown ids', async () => {
    const { app, runtime } = await makeApp();
    runtime.store.insertTrack({
      id: 'nolinha',
      name: 'Pista desconhecida 1',
      layout: null,
      fingerprint: {} as never,
      lengthM: 5361,
      centerline: null,
      sectorGates: [],
      corners: [],
      source: 'auto',
      createdAt: 1,
      updatedAt: 1,
    });
    const res = await app.inject({ method: 'GET', url: '/api/tracks/nolinha/recognition' });
    const body = res.json() as TrackRecognition;
    expect(body.usedGeometry).toBe(false);
    expect(body.strong).toBe(false);
    expect(body.candidates.map((c) => c.name)).toContain('Trial Mountain Circuit');
    expect(body.candidates.every((c) => c.basis === 'length')).toBe(true);
    const missing = await app.inject({ method: 'GET', url: '/api/tracks/naoexiste/recognition' });
    expect(missing.statusCode).toBe(404);
  });
});
