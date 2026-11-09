/**
 * Network test: Gt7Runtime's zero-config behaviour over real UDP on loopback — the sweep finds a
 * FakeConsole on 127.0.0.x, the connection state follows it, an IP change is followed, and the
 * automatic packet-format round works against a console that only speaks one format.
 */

import { createSocket, type Socket } from 'node:dgram';
import { mkdtempSync, rmSync } from 'node:fs';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeConsole } from '@gt7/protocol';
import type { ConsoleConnection, PacketFormat } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Gt7Runtime, type RuntimeNotice, SETTINGS_KEYS } from './runtime.ts';

// Ports reserved for this test file (49xxx range).
const CONSOLE_PORT = 49739;
const CLIENT_PORT = 49740;
const INNER_PORT = 49839;

const LOOPBACK_NET = () => ({
  lo: [
    {
      address: '127.0.0.1',
      netmask: '255.255.255.0',
      family: 'IPv4',
      internal: true,
      mac: '00:00:00:00:00:00',
      cidr: '127.0.0.1/24',
    } as NetworkInterfaceInfo,
  ],
});

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v) {
        clearInterval(iv);
        resolve(v);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error('waitFor timed out'));
      }
    }, 20);
  });
}

async function startConsole(host: string, port = CONSOLE_PORT): Promise<FakeConsole> {
  const fake = new FakeConsole({
    port,
    host,
    targetPort: CLIENT_PORT,
    heartbeatTimeoutMs: 30_000,
    formatLockMs: 200,
    source: { kind: 'synthetic', profile: 'pro', seed: 3, includeMenu: false },
  });
  await fake.start();
  cleanups.push(() => fake.stop());
  return fake;
}

/** A console that ignores every heartbeat whose format is not in `accepted`. */
async function startPickyConsole(accepted: PacketFormat[]): Promise<FakeConsole> {
  const inner = await startConsole('127.0.0.1', INNER_PORT);
  const relay: Socket = createSocket('udp4');
  relay.on('message', (msg) => {
    if (accepted.includes(String.fromCharCode(msg[0] ?? 0) as PacketFormat)) {
      relay.send(msg, INNER_PORT, '127.0.0.1');
    }
  });
  await new Promise<void>((r) => relay.bind(CONSOLE_PORT, '127.0.0.1', () => r()));
  cleanups.push(() => new Promise<void>((r) => relay.close(() => r())));
  return inner;
}

function newRuntime(opts: ConstructorParameters<typeof Gt7Runtime>[0] = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-rt-disc-'));
  const rt = new Gt7Runtime({
    dataDir: dir,
    record: false,
    ...opts,
    ingestor: {
      bindPort: CLIENT_PORT,
      bindAddress: '127.0.0.1',
      consolePort: CONSOLE_PORT,
      heartbeatIntervalMs: 100,
      timeoutMs: 600,
      statsIntervalMs: 200,
      deadAfterMs: 1200,
      formatSwitchCooldownMs: 200,
      broadcastAddresses: [],
      ...opts.ingestor,
    },
  });
  const notices: RuntimeNotice[] = [];
  const states: ConsoleConnection['state'][] = [];
  rt.on('notice', (n) => notices.push(n));
  rt.on('status', (s) => {
    const st = s.consoleConnection?.state;
    if (st && states.at(-1) !== st) states.push(st);
  });
  cleanups.push(async () => {
    await rt.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { rt, notices, states };
}

const SWEEP = {
  interfaces: LOOPBACK_NET,
  allowLoopback: true,
  arp: null,
  fastIntervalMs: 300,
  fastDurationMs: 60_000,
  slowIntervalMs: 300,
  pollMs: 50,
  batchDelayMs: 2,
};

describe('Gt7Runtime zero-config discovery (loopback)', () => {
  it('searches, finds the console by sweep, receives, and follows an IP change', async () => {
    const { rt, notices, states } = newRuntime({
      liveFormat: 'A',
      ingestor: { scan: SWEEP },
    });
    await rt.start();
    await waitFor(() => rt.getConnection().subnets.length > 0);
    expect(rt.getConnection()).toMatchObject({ state: 'searching', consoleIp: null, source: null });
    expect(rt.getConnection().hint).toMatch(/Procurando o PlayStation/);
    expect(rt.getConnection().subnets).toEqual(['127.0.0.0/24']);

    // the game is opened: a console appears on "127.0.0.55"
    const first = await startConsole('127.0.0.55');
    await waitFor(() => rt.getConnection().state === 'receiving');
    const c = rt.getConnection();
    expect(c).toMatchObject({ consoleIp: '127.0.0.55', source: 'discovered', hint: null });
    expect(c.hostsProbed).toBeGreaterThan(100);
    expect(c.lastScanAt).not.toBeNull();
    expect(c.lastPacketAt).not.toBeNull();
    expect(rt.getSettings()).toMatchObject({
      consoleIp: '127.0.0.55',
      consoleIpSource: 'discovered',
    });
    expect(rt.store.getSetting(SETTINGS_KEYS.consoleIp)).toBe('127.0.0.55');
    expect(
      notices.some((n) => n.code === 'consoleDiscovered' && /127.0.0.55/.test(n.message)),
    ).toBe(true);

    // the console is gone, then it comes back with another IP (DHCP lease changed)
    await first.stop();
    await waitFor(() => rt.getConnection().state === 'lost');
    expect(rt.getConnection().hint).toMatch(/parou de enviar/);
    await startConsole('127.0.0.77');
    await waitFor(() => rt.getConnection().consoleIp === '127.0.0.77');
    await waitFor(() => rt.getConnection().state === 'receiving');
    expect(rt.store.getSetting(SETTINGS_KEYS.consoleIp)).toBe('127.0.0.77');
    expect(notices.some((n) => /mudou de IP.*127.0.0.55.*127.0.0.77/.test(n.message))).toBe(true);
    expect(states).toEqual(expect.arrayContaining(['searching', 'receiving', 'lost']));
    expect(states.indexOf('searching')).toBeLessThan(states.indexOf('receiving'));
  });

  it('a wrong manual IP is replaced once dead; clearing it goes back to automatic', async () => {
    await startConsole('127.0.0.55');
    const { rt } = newRuntime({
      liveFormat: 'A',
      consoleIp: '127.0.0.200',
      ingestor: { scan: SWEEP },
    });
    await rt.start();
    expect(rt.getConnection()).toMatchObject({
      state: 'found',
      source: 'manual',
      consoleIp: '127.0.0.200',
    });
    expect(rt.getConnection().hint).toMatch(/127.0.0.200/);
    // not touched while it might still answer ...
    await waitFor(() => rt.getConnection().consoleIp === '127.0.0.55');
    // ... but replaced when it stayed silent for deadAfterMs
    expect(rt.getConnection().source).toBe('discovered');
    await waitFor(() => rt.getConnection().state === 'receiving');

    rt.setConsoleIp(null);
    expect(rt.getSettings()).toMatchObject({ consoleIp: null, consoleIpSource: null });
    expect(rt.getConnection().source).toBeNull();
    await waitFor(() => rt.getConnection().consoleIp === '127.0.0.55'); // found again by itself
    expect(rt.rescan()).toBe(true);
  });

  it('format round: ~ → B → A against a console that only speaks A; heals back to ~', async () => {
    const inner = await startPickyConsole(['A']);
    const { rt, notices } = newRuntime({
      consoleIp: '127.0.0.1',
      persistConsoleIp: false,
      autoFormatTimeoutMs: 400,
      autoFormatHealDelayMs: 300,
      ingestor: { discovery: false },
    });
    expect(rt.getSettings()).toMatchObject({ liveFormat: '~', liveFormatAuto: true });
    await rt.start();
    await waitFor(() => rt.getConnection().state === 'receiving', 30_000);
    expect(rt.ingestor?.format).toBe('A');
    expect(rt.liveFormat).toBe('A');
    expect(rt.store.getSetting(SETTINGS_KEYS.liveFormat)).toBe('A'); // saved what worked
    expect(rt.getSettings().liveFormatAuto).toBe(true);
    const fallbacks = notices.filter((n) => n.code === 'formatFallback').map((n) => n.message);
    expect(fallbacks[0]).toMatch(/'~'.*'B'/);
    expect(fallbacks[1]).toMatch(/'B'.*'A'/);
    expect(notices.some((n) => n.code === 'formatAuto')).toBe(true);

    // the session ends on a fallback format: after a while it goes back to '~'
    await inner.stop();
    await waitFor(() => rt.liveFormat === '~', 30_000);
  });

  it('a pinned format is never changed automatically', async () => {
    await startPickyConsole(['A']);
    const { rt } = newRuntime({
      consoleIp: '127.0.0.1',
      persistConsoleIp: false,
      autoFormatTimeoutMs: 300,
      ingestor: { discovery: false },
    });
    await rt.start();
    await rt.setPacketFormat('B'); // user pins B (the console ignores it)
    expect(rt.getSettings()).toMatchObject({ liveFormat: 'B', liveFormatAuto: false });
    await new Promise((r) => setTimeout(r, 1800));
    expect(rt.ingestor?.format).toBe('B');
    expect(rt.getConnection().state).toBe('found');
    expect(rt.store.getSetting(SETTINGS_KEYS.liveFormat)).toBe('B');
  });
});
