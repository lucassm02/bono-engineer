import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultDataDir } from '@gt7/core';
import type { LanInfo } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { type CreateAppOptions, createApp, type Gt7Server } from './app.ts';
import { ConfigError, parseConfig, SIM_CLIENT_PORT, SIM_CONSOLE_PORT } from './config.ts';
import { FirewallChecker } from './firewall.ts';
import { lanAddresses } from './lan.ts';

const v4 = (address: string, internal = false) =>
  ({
    address,
    family: 'IPv4',
    internal,
    netmask: '255.255.255.0',
    mac: '00:00:00:00:00:00',
    cidr: null,
  }) as NetworkInterfaceInfo;

const IFACES: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  'vEthernet (WSL)': [v4('172.20.0.1')],
  Loopback: [v4('127.0.0.1', true)],
  'Ethernet 2': [v4('10.0.0.5'), v4('169.254.10.1')],
  'Wi-Fi': [
    v4('192.168.0.10'),
    { ...v4('fe80::1'), family: 'IPv6' } as unknown as NetworkInterfaceInfo,
  ],
};

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function makeApp(opts: Partial<CreateAppOptions> = {}): Promise<Gt7Server> {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-lan-'));
  const server = await createApp({
    port: 46780,
    host: '0.0.0.0',
    interfaces: () => IFACES,
    webDist: null,
    firewall: { platform: 'linux' },
    hub: { keepAliveMs: 0 },
    runtime: { dataDir: join(dir, 'data'), record: false },
    ...opts,
  });
  cleanups.push(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return server;
}

describe('LAN addresses', () => {
  it('keeps non-internal IPv4, prefers 192.168 / physical interfaces', () => {
    expect(lanAddresses(IFACES).map((a) => a.address)).toEqual([
      '192.168.0.10',
      '10.0.0.5',
      '172.20.0.1',
    ]);
  });

  it('/api/lan returns URLs and an SVG QR code', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/lan' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as LanInfo;
    expect(body.urls).toEqual([
      'http://192.168.0.10:46780/',
      'http://10.0.0.5:46780/',
      'http://172.20.0.1:46780/',
    ]);
    expect(body.preferredUrl).toBe('http://192.168.0.10:46780/');
    expect(body.localUrl).toBe('http://localhost:46780/');
    expect(body.qrSvgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(body.qrSvgDataUrl!.split(',')[1]!, 'base64').toString('utf8');
    expect(svg).toContain('<svg');
    const status = await app.inject({ method: 'GET', url: '/api/status' });
    expect(status.json().lanUrls).toEqual(body.urls);
  });
});

describe('access token', () => {
  it('protects /api and /ws, accepts header/query/cookie and sets the cookie from ?token=', async () => {
    const { app } = await makeApp({ token: 's3cr3t' });
    const denied = await app.inject({ method: 'GET', url: '/api/status' });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error.message).toMatch(/Token/);
    expect((await app.inject({ method: 'GET', url: '/ws' })).statusCode).toBe(401);
    const ok = await app.inject({
      method: 'GET',
      url: '/api/lan',
      headers: { 'x-gt7-token': 's3cr3t' },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as LanInfo).preferredUrl).toBe('http://192.168.0.10:46780/?token=s3cr3t');
    expect((await app.inject({ method: 'GET', url: '/api/status?token=s3cr3t' })).statusCode).toBe(
      200,
    );
    const page = await app.inject({ method: 'GET', url: '/?token=s3cr3t' });
    expect(page.statusCode).toBe(200);
    const cookie = String(page.headers['set-cookie']);
    expect(cookie).toContain('gt7_token=s3cr3t');
    const withCookie = await app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { cookie: 'gt7_token=s3cr3t' },
    });
    expect(withCookie.statusCode).toBe(200);
    expect(withCookie.json().tokenRequired).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/?token=errado' })).headers['set-cookie']).toBe(
      undefined,
    );
  });
});

describe('static dashboard', () => {
  it('serves dist with SPA fallback and long cache for assets', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'gt7-dist-'));
    cleanups.push(() => rmSync(dist, { recursive: true, force: true }));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>painel</title>');
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'assets', 'app-123.js'), 'console.log(1)');
    const { app } = await makeApp({ webDist: dist });

    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('painel');
    expect(root.headers['cache-control']).toBe('no-cache');
    const spa = await app.inject({ method: 'GET', url: '/analise/volta/1' });
    expect(spa.statusCode).toBe(200);
    expect(spa.body).toContain('painel');
    const asset = await app.inject({ method: 'GET', url: '/assets/app-123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect((await app.inject({ method: 'GET', url: '/assets/nao-existe.js' })).statusCode).toBe(
      404,
    );
    const api = await app.inject({ method: 'GET', url: '/api/nada' });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.message).toMatch(/Rota não encontrada/);
  });
});

describe('Windows Firewall check', () => {
  it('reports missing rules with the elevated commands (never changes the firewall)', async () => {
    const calls: string[][] = [];
    const fw = new FirewallChecker({
      httpPort: 8770,
      platform: 'win32',
      exec: async (file, args) => {
        calls.push([file, ...args]);
        return { code: args.at(-1)!.includes('TCP') ? 0 : 1 };
      },
    });
    const st = await fw.check();
    expect(calls.every((c) => c[0] === 'netsh' && c.includes('show'))).toBe(true);
    expect(st.state).toBe('missing');
    expect(st.rules.map((r) => r.present)).toEqual([true, false]);
    expect(st.powershellCommands).toEqual([
      'New-NetFirewallRule -DisplayName "Bono Engineer (UDP 33740)" -Direction Inbound -Protocol UDP -LocalPort 33740 -Action Allow -Profile Private',
    ]);
    expect(st.netshCommands[0]).toContain('protocol=UDP localport=33740');

    const ok = new FirewallChecker({
      httpPort: 8770,
      platform: 'win32',
      exec: async () => ({ code: 0 }),
    });
    expect((await ok.check()).state).toBe('ok');
    const linux = new FirewallChecker({ httpPort: 8770, platform: 'linux' });
    const lst = await linux.check();
    expect(lst.state).toBe('unknown');
    expect(lst.powershellCommands).toEqual([]);
  });
});

describe('config', () => {
  it('parses CLI flags over env vars', () => {
    const c = parseConfig(['--port', '9000', '--sim', '--no-open', '--sim-laps', '5'], {
      GT7_PORT: '1234',
      GT7_TOKEN: 'abc',
    });
    expect(c.port).toBe(9000);
    expect(c.open).toBe(false);
    expect(c.token).toBe('abc');
    expect(c.sim).toMatchObject({
      profile: 'amateur',
      laps: 5,
      consolePort: SIM_CONSOLE_PORT,
      clientPort: SIM_CLIENT_PORT,
    });
    expect(c.dataDir).toBe(
      join(defaultDataDir({ env: { GT7_PORT: '1234', GT7_TOKEN: 'abc' } }), 'demo'),
    );

    const denv = { GT7_PORT: '1234', GT7_NO_OPEN: '1', GT7_PS_IP: '192.168.0.20' };
    const d = parseConfig([], denv);
    expect(d).toMatchObject({ port: 1234, open: false, consoleIp: '192.168.0.20', sim: null });
    expect(d.dataDir).toBe(defaultDataDir({ env: denv }));

    expect(() => parseConfig(['--port', 'abc'], {})).toThrow(ConfigError);
    expect(() => parseConfig(['--format', 'Z'], {})).toThrow(ConfigError);
    expect(() => parseConfig(['--bogus'], {})).toThrow(ConfigError);
  });
});
