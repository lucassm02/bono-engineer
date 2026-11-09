import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Gt7Runtime, SETTINGS_KEYS } from './runtime.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-conn-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function open(dir: string, opts: ConstructorParameters<typeof Gt7Runtime>[0] = {}): Gt7Runtime {
  const rt = new Gt7Runtime({ dataDir: dir, record: false, ...opts });
  cleanups.push(() => rt.close());
  return rt;
}

describe('Gt7Runtime console connection (no network)', () => {
  it('starts idle with a hint, no IP and automatic format', () => {
    const rt = open(tmp());
    const c = rt.getConnection();
    expect(c).toMatchObject({
      state: 'idle',
      consoleIp: null,
      source: null,
      subnets: [],
      hostsProbed: 0,
      lastScanAt: null,
      lastPacketAt: null,
    });
    expect(c.hint).toMatch(/parada/);
    expect(rt.getStatus().consoleConnection).toEqual(c);
    expect(rt.getSettings()).toMatchObject({
      consoleIp: null,
      consoleIpSource: null,
      liveFormat: '~',
      liveFormatAuto: true,
    });
  });

  it('an IP typed by the user is manual, persisted, and can be cleared', () => {
    const dir = tmp();
    const rt = open(dir);
    rt.setConsoleIp('192.168.0.20');
    expect(rt.getSettings()).toMatchObject({
      consoleIp: '192.168.0.20',
      consoleIpSource: 'manual',
    });
    expect(rt.store.getSetting(SETTINGS_KEYS.consoleIpSource)).toBe('manual');

    rt.setConsoleIp(null);
    expect(rt.getSettings()).toMatchObject({ consoleIp: null, consoleIpSource: null });
    expect(rt.store.getSetting(SETTINGS_KEYS.consoleIp)).toBeUndefined();
    expect(rt.store.getSetting(SETTINGS_KEYS.consoleIpSource)).toBeUndefined();
  });

  it('remembers a discovered IP across runs and treats an old saved IP as manual', async () => {
    const dir = tmp();
    const rt = open(dir);
    rt.store.setSetting(SETTINGS_KEYS.consoleIp, '10.0.0.9'); // saved by an older version: no source
    await rt.close();
    const rt2 = open(dir);
    expect(rt2.getSettings()).toMatchObject({ consoleIp: '10.0.0.9', consoleIpSource: 'manual' });
    await rt2.close();

    const rt3 = open(dir);
    rt3.store.setSetting(SETTINGS_KEYS.consoleIpSource, 'discovered');
    await rt3.close();
    const rt4 = open(dir);
    expect(rt4.getSettings()).toMatchObject({
      consoleIp: '10.0.0.9',
      consoleIpSource: 'discovered',
    });
    expect(rt4.getConnection()).toMatchObject({ consoleIp: '10.0.0.9', source: 'discovered' });
  });

  it('--ps-ip (option) wins and is saved as manual; the demo console is never saved', () => {
    const dir = tmp();
    const rt = open(dir, { consoleIp: '192.168.1.50' });
    expect(rt.getSettings().consoleIpSource).toBe('manual');
    const demo = open(tmp(), { consoleIp: '127.0.0.1', simulator: true, persistConsoleIp: false });
    expect(demo.getConnection()).toMatchObject({ consoleIp: '127.0.0.1', source: 'simulator' });
    expect(demo.store.getSetting(SETTINGS_KEYS.consoleIp)).toBeUndefined();
  });

  it('pinning a format turns the automatic mode off; auto can be turned back on', async () => {
    const dir = tmp();
    const rt = open(dir);
    await rt.setPacketFormat('B');
    expect(rt.getSettings()).toMatchObject({ liveFormat: 'B', liveFormatAuto: false });
    await rt.close();
    const rt2 = open(dir);
    expect(rt2.getSettings()).toMatchObject({ liveFormat: 'B', liveFormatAuto: false });
    await rt2.setLiveFormatAuto(true);
    expect(rt2.getSettings().liveFormatAuto).toBe(true);
    // a format given as an option (--format) is pinned
    const rt3 = open(tmp(), { liveFormat: 'A' });
    expect(rt3.getSettings()).toMatchObject({ liveFormat: 'A', liveFormatAuto: false });
  });

  it('rescan() reports false while telemetry is not running', () => {
    expect(open(tmp()).rescan()).toBe(false);
  });
});
