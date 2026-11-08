import type { IngestorState, PacketFormat } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { Gt7Ingestor, type IngestedPacket } from './ingestor.ts';
import { FakeConsole } from './simulator/fake-console.ts';

// Non-default ports so tests do not clash with a running sim/sniff.
const CONSOLE_PORT = 43739;
const CLIENT_PORT = 43740;

function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 5000): Promise<T> {
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

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
});

async function setup(format: PacketFormat = 'A') {
  const fake = new FakeConsole({
    port: CONSOLE_PORT,
    host: '127.0.0.1',
    targetPort: CLIENT_PORT,
    heartbeatTimeoutMs: 1500,
    formatLockMs: 300,
    source: { kind: 'synthetic', profile: 'pro', seed: 3, includeMenu: false },
  });
  await fake.start();
  cleanup.push(() => fake.stop());
  const ing = new Gt7Ingestor({
    consoleIp: '127.0.0.1',
    consolePort: CONSOLE_PORT,
    bindPort: CLIENT_PORT,
    bindAddress: '127.0.0.1',
    format,
    heartbeatIntervalMs: 100,
    timeoutMs: 500,
    statsIntervalMs: 250,
  });
  const packets: IngestedPacket[] = [];
  const states: IngestorState[] = [];
  ing.on('packet', (p) => packets.push(p));
  ing.on('state', (s) => states.push(s));
  await ing.start();
  cleanup.push(() => ing.stop());
  return { fake, ing, packets, states };
}

describe('FakeConsole + Gt7Ingestor over UDP', () => {
  it('receives, decrypts and parses packets at ~60 Hz', async () => {
    const { ing, packets, states } = await setup('A');
    await waitFor(() => packets.length >= 60);
    expect(states).toContain('connected');
    expect(ing.state).toBe('connected');
    const p = packets.at(-1)!;
    expect(p.packet.format).toBe('A');
    expect(p.raw.byteLength).toBe(296);
    expect(p.packet.speedMps).toBeGreaterThan(1);
    expect(p.remote.address).toBe('127.0.0.1');
    for (let i = 1; i < packets.length; i++) {
      expect(packets[i]!.packet.packetId).toBeGreaterThan(packets[i - 1]!.packet.packetId);
    }
    const stats = await new Promise<import('@gt7/shared').IngestorStats>((r) =>
      ing.once('stats', r),
    );
    expect(stats.received).toBeGreaterThan(0);
    expect(stats.rateHz).toBeGreaterThan(30);
    expect(stats.rateHz).toBeLessThan(90);
    expect(stats.decryptFailures).toBe(0);
  });

  it('switches format after a heartbeat cooldown; a format change without pause is ignored', async () => {
    const { ing, packets, fake } = await setup('A');
    await waitFor(() => packets.length >= 10);
    // no pause: the console keeps the locked format
    await ing.setFormat('~', 0);
    const mark = packets.length;
    await waitFor(() => packets.length >= mark + 20);
    expect(packets.slice(mark).every((p) => p.packet.format === 'A')).toBe(true);
    expect(fake.format).toBe('A');
    // with a pause longer than the console lock time it switches
    const states: IngestorState[] = [];
    ing.on('state', (s) => states.push(s));
    await ing.setFormat('B', 600);
    expect(states).toContain('switchingFormat');
    const b = await waitFor(() => packets.find((p) => p.packet.format === 'B'), 3000);
    expect(b.raw.byteLength).toBe(316);
    expect(b.packet.steeringAngle).toBeTypeOf('number');
    expect(fake.format).toBe('B');
  });

  it('emits timeout when the console stops streaming, and recovers', async () => {
    const { ing, packets, fake } = await setup('C');
    await waitFor(() => packets.length >= 10);
    expect(packets.at(-1)!.packet.format).toBe('C');
    await fake.stop();
    await waitFor(() => ing.state === 'timeout', 3000);
    // a new console comes back on the same port: heartbeats resume the stream
    const fake2 = new FakeConsole({
      port: CONSOLE_PORT,
      host: '127.0.0.1',
      targetPort: CLIENT_PORT,
      source: { kind: 'synthetic', profile: 'amateur', seed: 9, includeMenu: false },
    });
    await fake2.start();
    cleanup.push(() => fake2.stop());
    await waitFor(() => ing.state === 'connected', 3000);
  });

  it('ignores garbage datagrams without crashing', async () => {
    const { ing, packets } = await setup('A');
    await waitFor(() => packets.length >= 5);
    const { createSocket } = await import('node:dgram');
    const s = createSocket('udp4');
    await new Promise<void>((r) =>
      s.send(Buffer.alloc(296, 7), CLIENT_PORT, '127.0.0.1', () => r()),
    );
    await new Promise<void>((r) => s.send(Buffer.alloc(13), CLIENT_PORT, '127.0.0.1', () => r()));
    s.close();
    await waitFor(() => ing.stats.decryptFailures >= 1 && ing.stats.invalidSize >= 1, 3000);
    const n = packets.length;
    await waitFor(() => packets.length > n + 5);
  });
});
