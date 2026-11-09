/**
 * Network test: the unicast sweep finds a FakeConsole listening on a loopback address
 * (127.0.0.x stands for the PS5's LAN IP) and finds it again after its "IP" changes.
 */

import type { NetworkInterfaceInfo } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { Gt7Ingestor, type Gt7IngestorOptions } from './ingestor.ts';
import { FakeConsole } from './simulator/fake-console.ts';

// Ports reserved for this test file (48xxx range).
const CONSOLE_PORT = 48739;
const CLIENT_PORT = 48740;

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

function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 15_000): Promise<T> {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
});

async function startConsole(address: string): Promise<FakeConsole> {
  const fake = new FakeConsole({
    port: CONSOLE_PORT,
    host: address,
    targetPort: CLIENT_PORT,
    heartbeatTimeoutMs: 30_000,
    formatLockMs: 300,
    source: { kind: 'synthetic', profile: 'pro', seed: 3, includeMenu: false },
  });
  await fake.start();
  cleanup.push(() => fake.stop());
  return fake;
}

async function startIngestor(extra: Partial<Gt7IngestorOptions> = {}) {
  const ing = new Gt7Ingestor({
    consolePort: CONSOLE_PORT,
    bindPort: CLIENT_PORT,
    bindAddress: '127.0.0.1',
    format: 'A',
    heartbeatIntervalMs: 100,
    timeoutMs: 500,
    statsIntervalMs: 250,
    deadAfterMs: 1200,
    discovery: true,
    broadcastAddresses: [], // no broadcast on the loopback test net: the sweep does the work
    scan: {
      interfaces: LOOPBACK_NET,
      allowLoopback: true,
      arp: null,
      fastIntervalMs: 300,
      fastDurationMs: 60_000,
      slowIntervalMs: 300,
      pollMs: 50,
      batchDelayMs: 2,
    },
    ...extra,
  });
  const found: { ip: string; previous: string | null }[] = [];
  const addresses = new Set<string>();
  ing.on('discovered', (ip, previous) => found.push({ ip, previous }));
  ing.on('packet', (p) => addresses.add(p.remote.address));
  await ing.start();
  cleanup.push(() => ing.stop());
  return { ing, found, addresses };
}

describe('Gt7Ingestor unicast discovery (FakeConsole on 127.0.0.x)', () => {
  it('finds the console by sweeping the subnet, with no IP configured', async () => {
    await startConsole('127.0.0.37');
    const { ing, found } = await startIngestor();
    expect(ing.consoleIp).toBeNull();
    await waitFor(() => found.length > 0);
    expect(found[0]).toEqual({ ip: '127.0.0.37', previous: null });
    expect(ing.consoleIp).toBe('127.0.0.37');
    await waitFor(() => ing.state === 'connected');
    expect(ing.discoveryInfo.subnets).toEqual(['127.0.0.0/24']);
    expect(ing.discoveryInfo.hostsProbed).toBeGreaterThan(100);
    expect(ing.discoveryInfo.lastScanAt).not.toBeNull();
  });

  it('keeps searching while the console is not up, and finds it when it appears', async () => {
    const { ing, found } = await startIngestor();
    await sleep(900);
    expect(found).toHaveLength(0);
    expect(ing.state).toBe('connecting');
    const scansBefore = ing.discoveryInfo.hostsProbed;
    expect(scansBefore).toBeGreaterThan(200); // several rounds already
    await startConsole('127.0.0.64'); // the game was opened
    await waitFor(() => found.length > 0);
    expect(found[0]!.ip).toBe('127.0.0.64');
  });

  it('rediscovers the console after its IP changes (old IP silent > deadAfterMs)', async () => {
    const a = await startConsole('127.0.0.37');
    const { ing, found, addresses } = await startIngestor();
    await waitFor(() => ing.state === 'connected' && found.length === 1);
    expect(ing.consoleIp).toBe('127.0.0.37');

    await a.stop(); // console "leaves" .37 ...
    await startConsole('127.0.0.91'); // ... and comes back as .91
    await waitFor(() => found.length === 2, 20_000);
    expect(found[1]).toEqual({ ip: '127.0.0.91', previous: '127.0.0.37' });
    expect(ing.consoleIp).toBe('127.0.0.91');
    await waitFor(() => ing.state === 'connected' && ing.stats.received > 0);
    expect(addresses.has('127.0.0.91')).toBe(true);
  });

  it('never overwrites a configured IP that is alive; replaces it once it is dead', async () => {
    const manual = await startConsole('127.0.0.37');
    const { ing, found } = await startIngestor({ consoleIp: '127.0.0.37' });
    await waitFor(() => ing.state === 'connected');
    // a different host would answer if probed, but the sweep is idle and strangers are ignored
    await startConsole('127.0.0.91').catch(() => null);
    await sleep(1800);
    expect(ing.consoleIp).toBe('127.0.0.37');
    expect(found).toHaveLength(0);

    await manual.stop();
    await waitFor(() => found.length === 1, 20_000);
    expect(found[0]).toEqual({ ip: '127.0.0.91', previous: '127.0.0.37' });
    expect(ing.consoleIp).toBe('127.0.0.91');
  });

  it('setConsoleIp(null) goes back to automatic mode', async () => {
    await startConsole('127.0.0.37');
    const { ing, found } = await startIngestor({ consoleIp: '127.0.0.200' }); // wrong manual IP
    await waitFor(() => found.length === 1, 20_000); // dead after 1.2 s, then replaced
    expect(found[0]).toEqual({ ip: '127.0.0.37', previous: '127.0.0.200' });
    ing.setConsoleIp(null);
    expect(ing.consoleIp).toBeNull();
    await waitFor(() => found.length === 2, 20_000);
    expect(found[1]).toEqual({ ip: '127.0.0.37', previous: null });
  });
});
