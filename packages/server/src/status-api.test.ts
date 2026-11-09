import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiDiscoveryScanResult, ApiSettings, ApiStatus } from '@gt7/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';

describe('REST: console connection, discovery and format settings (no UDP)', () => {
  let dir: string;
  let server: Gt7Server;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gt7-status-'));
    server = await createApp({
      webDist: null,
      firewall: { platform: 'linux' },
      hub: { keepAliveMs: 0 },
      mcp: false,
      runtime: { dataDir: dir, record: false },
    });
  });
  afterAll(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function call<T>(method: string, url: string, payload?: unknown) {
    const res = await server.app.inject({
      method: method as 'GET',
      url,
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    return { status: res.statusCode, body: res.json() as T, headers: res.headers };
  }

  it('GET /api/status carries consoleConnection next to the old connection field', async () => {
    const r = await call<ApiStatus>('GET', '/api/status');
    expect(r.status).toBe(200);
    expect(r.headers['x-gt7-race-engineer']).toBe('real');
    expect(typeof r.body.connection).toBe('string'); // ConnectionState, unchanged
    expect(r.body.consoleConnection).toMatchObject({
      state: 'idle',
      consoleIp: null,
      source: null,
      subnets: [],
      hostsProbed: 0,
      lastScanAt: null,
      lastPacketAt: null,
    });
    expect(r.body.settings).toMatchObject({
      consoleIp: null,
      consoleIpSource: null,
      liveFormatAuto: true,
    });
  });

  it('PATCH consoleIp pins a manual IP; null / DELETE go back to automatic', async () => {
    const set = await call<ApiSettings>('PATCH', '/api/settings', { consoleIp: '192.168.0.20' });
    expect(set.body).toMatchObject({ consoleIp: '192.168.0.20', consoleIpSource: 'manual' });
    expect((await call<ApiStatus>('GET', '/api/status')).body.consoleConnection).toMatchObject({
      consoleIp: '192.168.0.20',
      source: 'manual',
    });

    const clear = await call<ApiSettings>('PATCH', '/api/settings', { consoleIp: null });
    expect(clear.body).toMatchObject({ consoleIp: null, consoleIpSource: null });

    await call('PATCH', '/api/settings', { consoleIp: '10.0.0.5' });
    const del = await call<ApiSettings>('DELETE', '/api/settings/consoleIp');
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ consoleIp: null, consoleIpSource: null });

    const bad = await call<{ error: { message: string } }>('PATCH', '/api/settings', {
      consoleIp: '999.1.1',
    });
    expect(bad.status).toBe(400);
  });

  it('liveFormat pins (auto off); liveFormatAuto: true turns it back on', async () => {
    const pin = await call<ApiSettings>('PATCH', '/api/settings', { liveFormat: 'B' });
    expect(pin.body).toMatchObject({ liveFormat: 'B', liveFormatAuto: false });
    const auto = await call<ApiSettings>('PATCH', '/api/settings', { liveFormatAuto: true });
    expect(auto.body.liveFormatAuto).toBe(true);
    const off = await call<ApiSettings>('PATCH', '/api/settings', { liveFormatAuto: false });
    expect(off.body.liveFormatAuto).toBe(false);
    const bad = await call('PATCH', '/api/settings', { liveFormatAuto: 'sim' });
    expect(bad.status).toBe(400);
  });

  it('POST /api/discovery/scan answers started=false while telemetry is stopped', async () => {
    const r = await call<ApiDiscoveryScanResult>('POST', '/api/discovery/scan');
    expect(r.status).toBe(200);
    expect(r.body.started).toBe(false);
    expect(r.body.consoleConnection.state).toBe('idle');
    expect(r.body.consoleConnection.hint).toBeTruthy();
  });
});
