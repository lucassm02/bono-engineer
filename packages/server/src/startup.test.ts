import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';
import { INSTANCE_HEADER } from './identity.ts';
import { isGt7Instance, isPortFree, pickPort, webNeedsBuild } from './startup.ts';

// Ports reserved for this test file (49870+, above the UDP test ports).
const BASE = 49870;

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

function squat(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<Socket>();
    const srv: Server = createServer((sock) => {
      sockets.add(sock); // accepts and never answers, like a foreign program
      sock.on('error', () => {});
    });
    srv.once('error', reject);
    srv.listen({ port, host: '127.0.0.1' }, () => {
      closers.push(
        () =>
          new Promise<void>((r) => {
            for (const sock of sockets) sock.destroy();
            srv.close(() => r());
          }),
      );
      resolve();
    });
  });
}

async function startApp(port: number, opts: { simulator?: boolean; token?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-startup-'));
  const server: Gt7Server = await createApp({
    port,
    host: '127.0.0.1',
    webDist: null,
    firewall: { platform: 'linux' },
    hub: { keepAliveMs: 0 },
    mcp: false,
    simulator: opts.simulator ?? false,
    token: opts.token ?? null,
    runtime: { dataDir: dir, record: false },
  });
  await server.app.listen({ port, host: '127.0.0.1' });
  closers.push(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return server;
}

describe('single instance / port selection', () => {
  it('recognises a running instance by its identity header, even behind a token', async () => {
    await startApp(BASE);
    expect(await isGt7Instance('0.0.0.0', BASE, 'real')).toBe(true);
    expect(await isGt7Instance('127.0.0.1', BASE, 'demo')).toBe(false); // other mode
    await startApp(BASE + 1, { token: 'segredo' });
    const r = await fetch(`http://127.0.0.1:${BASE + 1}/api/status`);
    expect(r.status).toBe(401);
    expect(r.headers.get(INSTANCE_HEADER)).toBe('real');
    expect(await isGt7Instance('127.0.0.1', BASE + 1, 'real')).toBe(true);
    await startApp(BASE + 2, { simulator: true });
    expect(await isGt7Instance('127.0.0.1', BASE + 2, 'demo')).toBe(true);
    expect(await isGt7Instance('127.0.0.1', BASE + 2, 'real')).toBe(false);
  });

  it('does not take another program for an instance', async () => {
    await squat(BASE + 3);
    expect(await isGt7Instance('127.0.0.1', BASE + 3, 'real', 500)).toBe(false);
    expect(await isPortFree(BASE + 3, '127.0.0.1')).toBe(false);
    expect(await isPortFree(BASE + 4, '127.0.0.1')).toBe(true);
  });

  it('pickPort: our instance → existing; foreign program → next free port', async () => {
    await startApp(BASE + 5);
    expect(await pickPort(BASE + 5, '127.0.0.1', 'real', false)).toEqual({
      kind: 'existing',
      port: BASE + 5,
    });
    await squat(BASE + 6);
    await squat(BASE + 7);
    expect(await pickPort(BASE + 6, '127.0.0.1', 'real', false)).toEqual({
      kind: 'run',
      port: BASE + 8,
      skipped: [BASE + 6, BASE + 7],
    });
    // a demo next to a real instance does not "reuse" it: the real one counts as a busy port
    expect(await pickPort(BASE + 5, '127.0.0.1', 'demo', false)).toEqual({
      kind: 'run',
      port: BASE + 8,
      skipped: [BASE + 5, BASE + 6, BASE + 7],
    });
  });

  it('pickPort: an explicit busy port is an error, a free one is used', async () => {
    await squat(BASE + 10);
    expect(await pickPort(BASE + 10, '127.0.0.1', 'real', true)).toEqual({
      kind: 'busy',
      port: BASE + 10,
    });
    expect(await pickPort(BASE + 11, '127.0.0.1', 'real', true)).toEqual({
      kind: 'run',
      port: BASE + 11,
      skipped: [],
    });
  });

  it('pickPort gives up after `tries` busy ports (injected checks)', async () => {
    const r = await pickPort(8770, '0.0.0.0', 'real', false, 3, {
      isInstance: async () => false,
      isFree: async () => false,
    });
    expect(r).toEqual({ kind: 'busy', port: 8770 });
  });
});

describe('webNeedsBuild', () => {
  it('builds when dist is missing or older than a source, skips when up to date', () => {
    const root = mkdtempSync(join(tmpdir(), 'gt7-web-'));
    closers.push(() => rmSync(root, { recursive: true, force: true }));
    const dist = join(root, 'dist');
    const src = join(root, 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'a.ts'), 'x');
    expect(webNeedsBuild(dist, [src], [])).toBe(true); // no dist
    mkdirSync(dist);
    writeFileSync(join(dist, 'index.html'), '<html>');
    const now = Date.now() / 1000;
    utimesSync(join(src, 'a.ts'), now - 100, now - 100);
    utimesSync(join(dist, 'index.html'), now - 50, now - 50);
    expect(webNeedsBuild(dist, [src], [])).toBe(false);
    utimesSync(join(src, 'a.ts'), now, now); // edited after the build
    expect(webNeedsBuild(dist, [src], [])).toBe(true);
    expect(webNeedsBuild(dist, [join(root, 'nao-existe')], [join(root, 'nada.json')])).toBe(false);
  });
});
