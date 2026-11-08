import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_COACH_USAGE, type StoredCoachReport } from '@gt7/core';
import type { ApiMcpInfo, CoachConfig, Session } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';
import { CoachService } from './coach/service.ts';
import { parseConfig } from './config.ts';
import { buildMcpInfo, quoteArg } from './routes/mcp-info.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function makeApp(opts: Parameters<typeof createApp>[0] = {}): Promise<Gt7Server> {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-hard-'));
  const server = await createApp({
    port: 46890,
    host: '127.0.0.1',
    webDist: null,
    firewall: { platform: 'linux' },
    hub: { keepAliveMs: 0 },
    runtime: { dataDir: join(dir, 'data'), record: false, persistConsoleIp: false },
    ...opts,
  });
  cleanups.push(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return server;
}

describe('access token', () => {
  it('cannot be bypassed with percent-encoded paths', async () => {
    const { app } = await makeApp({ token: 'segredo-xyz' });
    for (const url of [
      '/api/status',
      '/%61pi/status',
      '/%61%70%69/status',
      '/api/%73tatus',
      '/%6dcp',
      '/ws',
      '/%77s',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
    // a malformed escape is never let through on the strength of a prefix check
    expect([400, 401]).toContain(
      (await app.inject({ method: 'GET', url: '/api/%E0%A4%A' })).statusCode,
    );
    const ok = await app.inject({ method: 'GET', url: '/%61pi/status?token=segredo-xyz' });
    expect(ok.statusCode).toBe(200);
  });
});

describe('cross-site requests', () => {
  it('refuses state changes and WebSocket upgrades coming from another origin', async () => {
    const { app } = await makeApp();
    const host = 'localhost:46890';
    const post = (origin?: string) =>
      app.inject({
        method: 'POST',
        url: '/api/capture/stop',
        headers: { host, ...(origin ? { origin } : {}) },
      });
    expect((await post('https://evil.example')).statusCode).toBe(403);
    expect((await post('http://evil.example:46890')).statusCode).toBe(403);
    expect((await post()).statusCode).not.toBe(403); // curl / MCP client: no Origin
    expect((await post('http://localhost:46890')).statusCode).not.toBe(403); // same origin
    expect((await post('http://localhost:5173')).statusCode).not.toBe(403); // Vite dev proxy
    const ws = await app.inject({
      method: 'GET',
      url: '/ws',
      headers: { host, origin: 'https://evil.example' },
    });
    expect(ws.statusCode).toBe(403);
    // reads stay open: the browser blocks reading them cross-site (no CORS headers)
    const get = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { host, origin: 'https://evil.example' },
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('error handler', () => {
  it('does not echo internal messages (paths, SQL) of unexpected errors', async () => {
    const { app } = await makeApp({
      extraRoutes: [
        (api) => {
          api.get('/boom', async () => {
            throw new Error('SQLITE_ERROR C:\\Users\\segredo\\data\\sessions.db');
          });
        },
      ],
    });
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('segredo');
    expect(res.body).not.toContain('SQLITE');
    expect(res.json().error.code).toBe('serverError');
    expect(res.body).not.toContain('stack');
  });
});

describe('recordings download', () => {
  it('refuses a recording path that escapes the data directory', async () => {
    const server = await makeApp();
    const base: Session = {
      id: 'sess-evil',
      trackId: null,
      carCode: 1,
      startedAt: 1,
      endedAt: 2,
      format: 'B',
      mode: 'live',
      lapCount: 0,
      bestLapMs: null,
      recordingFile: '../../../Windows/win.ini',
      notes: null,
    };
    server.runtime.store.saveSession(base);
    server.runtime.store.saveSession({
      ...base,
      id: 'sess-abs',
      recordingFile: 'C:\\Windows\\win.ini',
    });
    for (const id of ['sess-evil', 'sess-abs']) {
      const res = await server.app.inject({ method: 'GET', url: `/api/recordings/${id}` });
      expect(res.statusCode, id).toBe(400);
    }
    // ids that look like paths never reach the store
    for (const id of ['..%2f..%2fx', '..']) {
      const res = await server.app.inject({ method: 'GET', url: `/api/recordings/${id}` });
      expect([400, 404], id).toContain(res.statusCode);
    }
  });
});

describe('coach reports retention', () => {
  const report = (
    id: string,
    createdAt: number,
    status: 'done' | 'running',
  ): StoredCoachReport => ({
    id,
    createdAt,
    updatedAt: createdAt,
    title: id,
    kind: 'debrief',
    trackId: null,
    sessionId: null,
    lapId: null,
    reference: null,
    focusCorner: null,
    model: 'claude-opus-5-5',
    status,
    preview: '',
    usage: { ...EMPTY_COACH_USAGE },
    markdown: '',
    transcript: [],
    error: null,
    messages: [],
  });

  it('keeps the newest N finished reports and never prunes a running one', async () => {
    const { runtime } = await makeApp();
    const store = runtime.store;
    for (let i = 0; i < 12; i++) store.saveCoachReport(report(`r${i}`, 1000 + i, 'done'));
    store.saveCoachReport(report('running-old', 1, 'running'));
    expect(store.pruneCoachReports(5)).toBe(7);
    const left = store.listCoachReports().map((r) => r.id);
    expect(left).toEqual(['r11', 'r10', 'r9', 'r8', 'r7', 'running-old']);
  });

  it('fails reports left running by a dead process when the service starts', async () => {
    const { runtime } = await makeApp();
    runtime.store.saveCoachReport(report('stuck', 5, 'running'));
    const svc = new CoachService(runtime);
    const r = runtime.store.getCoachReport('stuck')!;
    expect(r.status).toBe('error');
    expect(r.error).toContain('reiniciado');
    await svc.close();
  });

  it('maxReports is configurable and validated', async () => {
    const { app } = await makeApp();
    const def = (
      await app.inject({ method: 'GET', url: '/api/coach/config' })
    ).json() as CoachConfig;
    expect(def.maxReports).toBe(50);
    const put = (body: unknown) =>
      app.inject({ method: 'PUT', url: '/api/coach/config', payload: body as object });
    const ok = await put({ maxReports: 20 });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as CoachConfig).maxReports).toBe(20);
    expect((await put({ maxReports: 2 })).statusCode).toBe(400);
    expect((await put({ maxReports: 1000 })).statusCode).toBe(400);
    expect((await put({ maxReports: 10.5 })).statusCode).toBe(400);
    expect(JSON.stringify(ok.json())).not.toContain('"apiKey"');
  });
});

describe('/api/mcp/info', () => {
  it('returns the real data dir of the running app', async () => {
    const server = await makeApp();
    const res = await server.app.inject({ method: 'GET', url: '/api/mcp/info' });
    expect(res.statusCode).toBe(200);
    const info = res.json() as ApiMcpInfo;
    expect(info.dataDir).toBe(server.runtime.store.dataDir);
    expect(info.http.localUrl).toBe('http://localhost:46890/mcp');
    expect(info.stdio.args).toContain('--data');
    expect(info.stdio.args.at(-1)).toBe(info.dataDir);
    expect(info.claudeDesktopConfig.mcpServers.gt7.command).toBe(info.nodePath);
  });

  it('builds file:/// loader URLs and quotes spaces', () => {
    const info = buildMcpInfo({
      repoRoot: 'C:\\Users\\Ana Maria\\Projects\\gt7',
      dataDir: 'C:\\Users\\Ana Maria\\Projects\\gt7\\data',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      localUrl: 'http://localhost:8770/',
      lanUrls: ['http://192.168.0.10:8770/'],
      tokenRequired: true,
      platform: 'win32',
    });
    expect(info.stdio.args[2]).toMatch(/^file:\/\/\/.*Ana%20Maria.*loader\.mjs$/);
    expect(info.stdio.commandLine.startsWith('"C:\\Program Files\\nodejs\\node.exe"')).toBe(true);
    expect(info.stdio.commandLine).toContain('--data "C:\\Users\\Ana Maria\\Projects\\gt7\\data"');
    expect(info.stdio.npmCommandLine.startsWith('npm.cmd run -s mcp -- --data "C:')).toBe(true);
    expect(info.http.lanUrls).toEqual(['http://192.168.0.10:8770/mcp']);
    expect(info.claudeCode.http).toContain('Authorization: Bearer <seu-token>');
    expect(quoteArg('simple')).toBe('simple');
    expect(quoteArg('a b')).toBe('"a b"');
  });
});

describe('data dir environment variables', () => {
  it('accepts GT7_DATA and GT7_DATA_DIR (flag wins)', () => {
    expect(parseConfig([], { GT7_DATA: 'C:\\a' }).dataDir).toMatch(/a$/);
    expect(parseConfig([], { GT7_DATA_DIR: 'C:\\b' }).dataDir).toMatch(/b$/);
    expect(parseConfig(['--data', 'C:\\c'], { GT7_DATA_DIR: 'C:\\b' }).dataDir).toMatch(/c$/);
  });
});
