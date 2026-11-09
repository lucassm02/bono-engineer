import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePacket, FakeConsole, generateLaps, RecordingWriter } from '@gt7/protocol';
import {
  type ApiStatus,
  type ClientMessage,
  type DeviceInfo,
  type Lap,
  type LiveFrame,
  type ServerMessage,
  type Session,
  type SessionDetail,
  type Track,
  WS_PATH,
  WS_PROTOCOL_VERSION,
} from '@gt7/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';

// Ports reserved for this test file (46xxx range).
const HTTP_PORT = 46770;
const CONSOLE_PORT = 46739;
const CLIENT_PORT = 46740;
/** Recording time compression: 60 Hz data streamed 20× faster. */
const SPEEDUP = 20;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

type MsgOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

class TestClient {
  readonly msgs: ServerMessage[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (ev) => {
      this.msgs.push(JSON.parse(String(ev.data)) as ServerMessage);
    });
  }

  static open(): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${HTTP_PORT}${WS_PATH}`);
      const c = new TestClient(ws);
      ws.addEventListener('open', () => resolve(c), { once: true });
      ws.addEventListener('error', () => reject(new Error('ws error')), { once: true });
    });
  }

  send(m: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(m));
  }

  hello(deviceId: string, deviceName?: string): void {
    this.send({
      type: 'hello',
      protocolVersion: WS_PROTOCOL_VERSION,
      deviceId,
      ...(deviceName ? { deviceName } : {}),
    });
  }

  all<T extends ServerMessage['type']>(type: T): MsgOf<T>[] {
    return this.msgs.filter((m): m is MsgOf<T> => m.type === type);
  }

  waitFor<T extends ServerMessage['type']>(
    type: T,
    pred: (m: MsgOf<T>) => boolean = () => true,
    timeoutMs = 10_000,
  ): Promise<MsgOf<T>> {
    return waitFor(() => this.all(type).find(pred), timeoutMs);
  }

  close(): void {
    this.ws.close();
  }
}

function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      let v: T | undefined | null | false;
      try {
        v = fn();
      } catch {
        v = undefined;
      }
      if (v) {
        clearInterval(iv);
        resolve(v);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error('waitFor timed out'));
      }
    }, 25);
  });
}

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body: parsed as T, headers: res.headers };
}

describe('server app (Fastify + WS hub + REST) over a FakeConsole', () => {
  let dir: string;
  let fake: FakeConsole;
  let server: Gt7Server;
  let a: TestClient;
  let b: TestClient;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gt7-server-'));
    const gen = generateLaps({ profile: 'pro', seed: 41, laps: 3, format: 'B', outLapM: 300 });
    const recFile = join(dir, 'fast.gt7rec');
    const w = await RecordingWriter.open(recFile, {
      format: 'B',
      startTime: 0,
      meta: { source: 'test' },
    });
    gen.packets.forEach((p, i) => {
      w.write(encodePacket(p, 'B'), Math.round((i * 1000) / 60 / SPEEDUP));
    });
    await w.close();

    fake = new FakeConsole({
      port: CONSOLE_PORT,
      host: '127.0.0.1',
      targetPort: CLIENT_PORT,
      formatLockMs: 300,
      heartbeatTimeoutMs: 2000,
      source: { kind: 'recording', file: recFile, loop: false },
    });
    await fake.start();

    server = await createApp({
      port: HTTP_PORT,
      host: '127.0.0.1',
      webDist: null,
      firewall: { platform: 'linux' },
      hub: { keepAliveMs: 0 },
      runtime: {
        dataDir: join(dir, 'data'),
        consoleIp: '127.0.0.1',
        persistConsoleIp: false,
        liveFormat: 'B',
        formatFallback: null,
        ingestor: {
          bindPort: CLIENT_PORT,
          bindAddress: '127.0.0.1',
          consolePort: CONSOLE_PORT,
          discovery: false,
          heartbeatIntervalMs: 100,
          timeoutMs: 1000,
          statsIntervalMs: 250,
        },
      },
    });
    await server.app.listen({ port: HTTP_PORT, host: '127.0.0.1' });
  });

  afterAll(async () => {
    a?.close();
    b?.close();
    await server?.close();
    await fake?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('hello → welcome, deviceProfile (default, persisted), status, sessionChanged', async () => {
    a = await TestClient.open();
    a.hello('dev-a', 'PC Teste');
    const welcome = await a.waitFor('welcome');
    expect(welcome.deviceId).toBe('dev-a');
    expect(welcome.protocolVersion).toBe(WS_PROTOCOL_VERSION);
    const prof = await a.waitFor('deviceProfile');
    expect(prof.profile.deviceId).toBe('dev-a');
    expect(prof.profile.name).toBe('PC Teste');
    expect(prof.profile.updatedAt).toBe(1);
    const st = await a.waitFor('status');
    expect(st.status.connection).toBeDefined();
    await a.waitFor('sessionChanged');
    expect(server.runtime.store.getDeviceProfile('dev-a')?.name).toBe('PC Teste');
    // order: welcome first
    expect(a.msgs[0]!.type).toBe('welcome');
  });

  it('streams frames, sessionChanged and lapCompleted once the console streams', async () => {
    await server.runtime.start();
    await a.waitFor('lapCompleted', () => true, 25_000);
    const frames = a.all('frame');
    expect(frames.length).toBeGreaterThan(20);
    expect(frames.some((f) => (f.frame as LiveFrame).state === 'onTrack')).toBe(true);
    expect(a.all('sessionChanged').some((m) => m.session !== null)).toBe(true);
    const lap = a.all('lapCompleted')[0]!.event;
    expect(lap.timeMs).toBeGreaterThan(80_000);
  });

  it('setDeviceProfile persists the (normalized) profile', async () => {
    a.send({
      type: 'setDeviceProfile',
      profile: {
        deviceId: 'someone-else',
        name: 'Celular',
        views: ['deltaGrande', 'pneus', 'naoExiste'],
        startView: 'pneus',
        locked: true,
        popupsEnabled: false,
        deltaReference: 'sessionBest',
        customLayout: { columns: 4, rows: 3, items: [] },
        updatedAt: 123,
      },
    });
    const saved = await waitFor(() => {
      const p = server.runtime.store.getDeviceProfile('dev-a');
      return p?.name === 'Celular' ? p : null;
    });
    expect(saved.deviceId).toBe('dev-a');
    expect(saved.views).toEqual(['deltaGrande', 'pneus']);
    expect(saved.locked).toBe(true);
    expect(saved.updatedAt).toBe(123);
  });

  it('setTargetView routes showView to the target device (remote control)', async () => {
    b = await TestClient.open();
    b.hello('dev-b', 'Tablet');
    await b.waitFor('welcome');
    b.send({ type: 'currentView', view: 'pneus' });
    a.send({ type: 'setTargetView', targetDeviceId: 'dev-b', view: 'motor' });
    const sv = await b.waitFor('showView');
    expect(sv).toMatchObject({ view: 'motor', from: 'dev-a' });
    expect(a.all('showView')).toHaveLength(0);

    a.send({ type: 'setTargetView', targetDeviceId: 'ghost', view: 'motor' });
    await a.waitFor('notice', (n) => n.code === 'targetOffline');

    const st = await waitFor(async () => {
      const r = await api<ApiStatus>('GET', '/api/status');
      return r.body.devices?.find((d) => d.deviceId === 'dev-b' && d.currentView === 'pneus')
        ? r.body
        : null;
    });
    expect(st!.devices.map((d) => d.deviceId).sort()).toEqual(['dev-a', 'dev-b']);
  });

  it('answers ping, rejects bad messages and messages before hello', async () => {
    a.send({ type: 'ping', t: 42 });
    const pong = await a.waitFor('pong');
    expect(pong.t).toBe(42);
    a.ws.send('{not json');
    await a.waitFor('notice', (n) => n.code === 'badMessage');
    const c = await TestClient.open();
    c.send({ type: 'currentView', view: 'corrida' });
    await c.waitFor('notice', (n) => n.code === 'helloRequired');
    expect(c.all('frame')).toHaveLength(0);
    c.close();
  });

  it('REST: sessions, laps, references, tracks, settings, devices, capture, recordings', async () => {
    const sessions = await api<Session[]>('GET', '/api/sessions');
    expect(sessions.status).toBe(200);
    expect(sessions.body.length).toBeGreaterThanOrEqual(1);
    const sid = sessions.body[0]!.id;

    const detail = await api<SessionDetail>('GET', `/api/sessions/${sid}`);
    expect(detail.body.laps.length).toBeGreaterThanOrEqual(1);
    expect(detail.body.active).toBe(true);
    const del = await api<{ error: { message: string } }>('DELETE', `/api/sessions/${sid}`);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toMatch(/andamento/);
    expect((await api('GET', '/api/sessions/nao-existe')).status).toBe(404);

    const noFilter = await api<{ error: { code: string; message: string } }>('GET', '/api/laps');
    expect(noFilter.status).toBe(400);
    expect(noFilter.body.error.message).toMatch(/sessionId/);
    const laps = await api<Lap[]>('GET', `/api/laps?sessionId=${sid}`);
    expect(laps.body.length).toBeGreaterThanOrEqual(1);
    const lap = laps.body[0]!;
    expect((await api<Lap>('GET', `/api/laps/${lap.id}`)).body.id).toBe(lap.id);

    const ref = await api<Lap>('PUT', `/api/laps/${lap.id}/reference`, {
      driverName: 'Piloto Top',
      rankingTimeMs: 90_000,
    });
    expect(ref.status).toBe(200);
    expect(ref.body.isReference).toBe(true);
    expect(ref.body.referenceMeta?.driverName).toBe('Piloto Top');
    const refs = await api<Lap[]>('GET', '/api/references');
    expect(refs.body.map((l) => l.id)).toContain(lap.id);
    const unref = await api<Lap>('DELETE', `/api/laps/${lap.id}/reference`);
    expect(unref.body.isReference).toBe(false);
    expect((await api('PUT', `/api/laps/${lap.id}/reference`, { rankingTimeMs: 'x' })).status).toBe(
      400,
    );

    const tracks = await api<Track[]>('GET', '/api/tracks');
    expect(tracks.body.length).toBeGreaterThanOrEqual(1);
    const tid = tracks.body[0]!.id;
    const byTrack = await api<Lap[]>('GET', `/api/laps?trackId=${tid}&validOnly=true`);
    expect(byTrack.status).toBe(200);
    const renamed = await api<Track>('PATCH', `/api/tracks/${tid}`, { name: 'Anel Sintético' });
    expect(renamed.body.name).toBe('Anel Sintético');
    expect(renamed.body.source).toBe('user');
    const four = await api<Track>('PUT', `/api/tracks/${tid}/sectors`, { count: 4 });
    expect(four.body.sectorGates).toHaveLength(4);
    const gates = await api<Track>('PUT', `/api/tracks/${tid}/sectors`, {
      gates: [{ distanceM: 2000 }, { distanceM: 1000 }],
    });
    expect(gates.body.sectorGates.map((g) => [g.index, g.distanceM])).toEqual([
      [0, 0],
      [1, 1000],
      [2, 2000],
    ]);
    const badGates = await api<{ error: { message: string } }>(
      'PUT',
      `/api/tracks/${tid}/sectors`,
      {
        gates: [{ distanceM: 999_999 }],
      },
    );
    expect(badGates.status).toBe(400);
    expect(badGates.body.error.message).toMatch(/distanceM/);
    expect(
      (await api('PATCH', `/api/tracks/${tid}/corners/T99`, { name: 'Eau Rouge' })).status,
    ).toBe(404);
    await server.runtime.whenAnalysisIdle();
    const withCorners = (await api<Track>('GET', `/api/tracks/${tid}`)).body;
    const corner = withCorners.corners[0];
    if (corner) {
      const named = await api<Track>('PATCH', `/api/tracks/${tid}/corners/${corner.id}`, {
        name: 'Eau Rouge',
        brakeMarkerNote: 'placa de 100 m',
      });
      expect(named.status).toBe(200);
      expect(named.body.corners[0]).toMatchObject({
        name: 'Eau Rouge',
        brakeMarkerNote: 'placa de 100 m',
      });
    }
    expect((await api('GET', `/api/tracks/${tid}/centerline`)).status).toBe(200);

    const settings = await api<{ record: boolean; liveFormat: string }>('GET', '/api/settings');
    expect(settings.body.liveFormat).toBe('B');
    const patched = await api<{ record: boolean }>('PATCH', '/api/settings', { record: false });
    expect(patched.body.record).toBe(false);
    expect((await api('PATCH', '/api/settings', { liveFormat: 'X' })).status).toBe(400);
    expect((await api('PATCH', '/api/settings', { consoleIp: 'abc' })).status).toBe(400);
    expect((await api('PATCH', '/api/settings', { foo: 1 })).status).toBe(400);
    const badJson = await fetch(`${BASE}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    });
    expect(badJson.status).toBe(400);
    expect(((await badJson.json()) as { error: { message: string } }).error.message).toMatch(
      /JSON inválido/,
    );

    const devices = await api<DeviceInfo[]>('GET', '/api/devices');
    const devA = devices.body.find((d) => d.deviceId === 'dev-a');
    expect(devA?.online).toBe(true);
    expect(devA?.profile?.name).toBe('Celular');
    const put = await api<{ name: string }>('PUT', '/api/devices/dev-b', {
      name: 'Tablet da sala',
      views: ['mapa', 'corrida'],
    });
    expect(put.body.name).toBe('Tablet da sala');
    const pushed = await b.waitFor('deviceProfile', (m) => m.profile.name === 'Tablet da sala');
    expect(pushed.profile.views).toEqual(['mapa', 'corrida']);
    const show = await api('POST', '/api/devices/dev-b/show-view', { view: 'mapa' });
    expect(show.status).toBe(200);
    await b.waitFor('showView', (m) => m.view === 'mapa' && m.from === 'api');
    expect((await api('POST', '/api/devices/ghost/show-view', { view: 'mapa' })).status).toBe(409);
    expect((await api('POST', '/api/devices/dev-b/show-view', { view: 'xyz' })).status).toBe(400);
    expect((await api('DELETE', '/api/devices/ghost')).status).toBe(404);

    const cap = await api<{ state: string }>('GET', '/api/capture');
    expect(cap.body.state).toBe('idle');
    expect((await api('POST', '/api/capture/start', {})).status).toBe(400);
    expect(
      (await api('POST', '/api/capture/start', { driverName: 'X', trackId: 'nao-existe' })).status,
    ).toBe(400);

    const rec = await fetch(`${BASE}/api/recordings/${sid}`);
    expect(rec.status).toBe(200);
    expect(rec.headers.get('content-disposition')).toContain('.gt7rec');
    const bytes = new Uint8Array(await rec.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(10);
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]); // gzip
    expect((await api('GET', '/api/recordings/nao-existe')).status).toBe(404);

    const status = await api<ApiStatus>('GET', '/api/status');
    expect(status.body.running).toBe(true);
    expect(status.body.httpPort).toBe(HTTP_PORT);
    expect(status.body.firewall.state).toBe('unknown');
    expect(status.body.settings.record).toBe(false);
  });

  it('serves a friendly pt-BR page when the dashboard is not built', async () => {
    const res = await fetch(`${BASE}/qualquer/rota`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('npm run build');
    const api404 = await api<{ error: { code: string } }>('GET', '/api/nao-existe');
    expect(api404.status).toBe(404);
    expect(api404.body.error.code).toBe('notFound');
  });
});
