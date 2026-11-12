import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session, Track } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function makeApp(): Promise<Gt7Server> {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-data-'));
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

describe('/api/data', () => {
  it('summarises the folder and counts', async () => {
    const server = await makeApp();
    server.runtime.store.insertTrack(TRACK);
    server.runtime.store.saveSession(SESSION);
    const res = await server.app.inject({ method: 'GET', url: '/api/data/summary' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.counts).toMatchObject({ sessions: 1, tracks: 1, laps: 0 });
    expect(body.dataDir).toBe(server.runtime.store.dataDir);
    expect(body.sizes.databaseBytes).toBeGreaterThan(0);
  });

  it('exports a backup and imports it into another install (two steps)', async () => {
    const a = await makeApp();
    a.runtime.store.insertTrack(TRACK);
    a.runtime.store.saveSession(SESSION);
    const exported = await a.app.inject({
      method: 'GET',
      url: '/api/data/export?laps=1&settings=1&recordings=0',
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-disposition']).toMatch(/Bono-backup-\d{4}-\d{2}-\d{2}\.bono/);
    const file = exported.rawPayload;
    expect(file.subarray(0, 2).toString()).toBe('PK');

    const b = await makeApp();
    const upload = await b.app.inject({
      method: 'POST',
      url: '/api/data/import',
      headers: { 'content-type': 'application/octet-stream' },
      payload: file,
    });
    expect(upload.statusCode).toBe(200);
    const up = upload.json();
    expect(up.manifest.counts).toMatchObject({ sessions: 1, tracks: 1 });

    const applied = await b.app.inject({
      method: 'POST',
      url: `/api/data/import/${up.uploadId}/apply`,
      payload: { mode: 'merge', settings: false },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({ sessions: 1, tracks: 1 });
    expect(b.runtime.store.getSession('s-1')?.trackId).toBe('trk-1');

    // The upload is single-use.
    const again = await b.app.inject({
      method: 'POST',
      url: `/api/data/import/${up.uploadId}/apply`,
      payload: { mode: 'merge', settings: false },
    });
    expect(again.statusCode).toBe(404);
  });

  it('rejects an upload that is not a backup and asks what to export', async () => {
    const a = await makeApp();
    const bad = await a.app.inject({
      method: 'POST',
      url: '/api/data/import',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('nada a ver'),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalidBackup');

    const none = await a.app.inject({ method: 'GET', url: '/api/data/export?laps=0&settings=0' });
    expect(none.statusCode).toBe(400);
  });
});
