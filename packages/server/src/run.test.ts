import { mkdtempSync, rmSync } from 'node:fs';
import { type AddressInfo, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from './config.ts';
import { INSTANCE_HEADER } from './identity.ts';
import { StartServerError, type StartServerOptions, startServer } from './run.ts';

const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

function cfgFor(port: number, extra: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-run-'));
  closers.push(() => rmSync(dir, { recursive: true, force: true }));
  return parseConfig(
    ['--no-open', '--host', '127.0.0.1', '--port', String(port), '--data', dir, ...extra],
    {},
  );
}

/** HTTP only: no UDP, no browser, no web build; MCP off like the other server tests. */
function opts(config: ReturnType<typeof cfgFor>): StartServerOptions {
  return {
    config: { ...config, webDist: join(tmpdir(), 'gt7-no-such-dist') },
    startRuntime: false,
    appOverrides: { mcp: false, firewall: { platform: 'linux' }, hub: { keepAliveMs: 0 } },
  };
}

function reservePort(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<Socket>();
    const srv = createServer((sock) => {
      sockets.add(sock); // accepts and never answers, like a foreign program
      sock.on('error', () => {});
    });
    srv.once('error', reject);
    srv.listen({ port: 0, host: '127.0.0.1' }, () => {
      const close = () =>
        new Promise<void>((done) => {
          for (const sock of sockets) sock.destroy();
          srv.close(() => done());
        });
      resolve({ port: (srv.address() as AddressInfo).port, close });
    });
  });
}

async function availablePort(): Promise<number> {
  const { port, close } = await reservePort();
  await close();
  return port;
}

describe('startServer', () => {
  it('starts, answers /api/status with the identity header and stops', async () => {
    const port = await availablePort();
    const run = await startServer(opts(cfgFor(port)));
    closers.push(() => run.stop());
    expect(run.attached).toBe(false);
    expect(run.port).toBe(port);
    expect(run.url).toBe(`http://localhost:${port}/`);
    expect(run.server).not.toBeNull();
    const res = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get(INSTANCE_HEADER)).toBe('real');
    await run.stop();
    await run.stop(); // idempotent
    await expect(fetch(`http://127.0.0.1:${port}/api/status`)).rejects.toThrow();
  });

  it('skips a port taken by another program (automatic port) and explains why', async () => {
    const { port, close } = await reservePort();
    closers.push(close);
    const base = cfgFor(port);
    const run = await startServer(opts({ ...base, portExplicit: false }));
    closers.push(() => run.stop());
    expect(run.port).toBeGreaterThan(port);
    expect(run.portNote).toContain(String(port));
    expect(run.config.port).toBe(run.port);
  });

  it('attaches to an instance of the same mode that is already running', async () => {
    const port = await availablePort();
    const first = await startServer(opts(cfgFor(port)));
    closers.push(() => first.stop());
    let prepared = false;
    const second = await startServer({
      ...opts(cfgFor(port)),
      prepare: () => {
        prepared = true;
      },
    });
    expect(second.attached).toBe(true);
    expect(second.server).toBeNull();
    expect(second.port).toBe(port);
    expect(prepared).toBe(false);
    await second.stop(); // does not stop the first one
    expect((await fetch(`http://127.0.0.1:${port}/api/status`)).status).toBe(200);
  });

  it('fails with a friendly error when an explicit port is busy', async () => {
    const { port, close } = await reservePort();
    closers.push(close);
    const err = await startServer(opts(cfgFor(port))).catch((e) => e);
    expect(err).toBeInstanceOf(StartServerError);
    expect(err.kind).toBe('port-busy');
    expect(err.message).toContain(String(port));
  });
});
