import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { type AddressInfo, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';
import { INSTANCE_HEADER } from './identity.ts';
import { isGt7Instance, isPortFree, pickPort, webNeedsBuild } from './startup.ts';

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

function squat(): Promise<number> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<Socket>();
    const srv = createServer((sock) => {
      sockets.add(sock); // accepts and never answers, like a foreign program
      sock.on('error', () => {});
    });
    srv.once('error', reject);
    srv.listen({ port: 0, host: '127.0.0.1' }, () => {
      closers.push(
        () =>
          new Promise<void>((r) => {
            for (const sock of sockets) sock.destroy();
            srv.close(() => r());
          }),
      );
      resolve((srv.address() as AddressInfo).port);
    });
  });
}

async function startApp(opts: { simulator?: boolean; token?: string } = {}): Promise<number> {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-startup-'));
  const server: Gt7Server = await createApp({
    host: '127.0.0.1',
    webDist: null,
    firewall: { platform: 'linux' },
    hub: { keepAliveMs: 0 },
    mcp: false,
    simulator: opts.simulator ?? false,
    token: opts.token ?? null,
    runtime: { dataDir: dir, record: false },
  });
  closers.push(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const url = await server.app.listen({ port: 0, host: '127.0.0.1' });
  return Number(new URL(url).port);
}

describe('single instance / port selection', () => {
  it('recognises a running instance by its identity header, even behind a token', async () => {
    const real = await startApp();
    expect(await isGt7Instance('0.0.0.0', real, 'real')).toBe(true);
    expect(await isGt7Instance('127.0.0.1', real, 'demo')).toBe(false);
    const protectedPort = await startApp({ token: 'segredo' });
    const r = await fetch(`http://127.0.0.1:${protectedPort}/api/status`);
    expect(r.status).toBe(401);
    expect(r.headers.get(INSTANCE_HEADER)).toBe('real');
    expect(await isGt7Instance('127.0.0.1', protectedPort, 'real')).toBe(true);
    const demo = await startApp({ simulator: true });
    expect(await isGt7Instance('127.0.0.1', demo, 'demo')).toBe(true);
    expect(await isGt7Instance('127.0.0.1', demo, 'real')).toBe(false);
  });

  it('does not take another program for an instance', async () => {
    const port = await squat();
    expect(await isGt7Instance('127.0.0.1', port, 'real', 500)).toBe(false);
    expect(await isPortFree(port, '127.0.0.1')).toBe(false);
    expect(await isPortFree(0, '127.0.0.1')).toBe(true);
  });

  it('pickPort reuses a running instance in the same mode', async () => {
    const port = await startApp();
    expect(await pickPort(port, '127.0.0.1', 'real', false)).toEqual({ kind: 'existing', port });
    expect(await pickPort(port, '127.0.0.1', 'demo', true)).toEqual({ kind: 'busy', port });
  });

  it('pickPort scans past busy ports unless the port was explicit', async () => {
    const checks = {
      isInstance: async () => false,
      isFree: async (port: number) => port === 8772,
    };
    expect(await pickPort(8770, '127.0.0.1', 'real', false, 3, checks)).toEqual({
      kind: 'run',
      port: 8772,
      skipped: [8770, 8771],
    });
    expect(await pickPort(8770, '127.0.0.1', 'real', true, 3, checks)).toEqual({
      kind: 'busy',
      port: 8770,
    });
    expect(await pickPort(8772, '127.0.0.1', 'real', true, 3, checks)).toEqual({
      kind: 'run',
      port: 8772,
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
