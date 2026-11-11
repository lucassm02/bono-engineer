/**
 * Spec 06: `GET /api/session/current`, `PUT /api/session/track-hint`, the WebSocket message
 * `setTrackHint` and the `trackMismatch` broadcast. The engine rules (expiry, reconciliation) are
 * tested in @gt7/core; here is the contract: validation, status codes and what travels.
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ApiSessionCurrent,
  type ServerStatus,
  type TrackMismatchInfo,
  WS_PROTOCOL_VERSION,
} from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';
import type { HubSocket } from './hub.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function makeApp(): Promise<Gt7Server> {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-hint-'));
  const server = await createApp({
    port: 46892,
    host: '127.0.0.1',
    webDist: null,
    firewall: { platform: 'linux' },
    hub: { keepAliveMs: 0 },
    runtime: { dataDir: join(dir, 'data'), record: false, persistConsoleIp: false },
  });
  cleanups.push(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return server;
}

function addTrack(server: Gt7Server, id: string, name: string): void {
  server.runtime.store.insertTrack({
    id,
    name,
    layout: null,
    fingerprint: {} as never,
    lengthM: 5000,
    centerline: null,
    sectorGates: [],
    corners: [],
    source: 'user',
    createdAt: 1,
    updatedAt: 1,
  });
}

class FakeSocket extends EventEmitter implements HubSocket {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.emit('close');
  }
  receive(msg: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)), false);
  }
  messages(): { type: string; [k: string]: unknown }[] {
    return this.sent.map((s) => JSON.parse(s) as { type: string });
  }
}

describe('GET /api/session/current', () => {
  it('sem sessão: contexto vazio, sem dica', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/session/current' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ApiSessionCurrent;
    expect(body.session).toBeNull();
    expect(body.carCode).toBeNull();
    expect(body.track).toMatchObject({
      trackId: null,
      name: null,
      confidence: 'unknown',
      basis: 'none',
      hint: null,
      learning: null,
    });
  });
});

describe('PUT /api/session/track-hint', () => {
  it('aceita uma pista salva e a devolve no contexto; null volta a reconhecer sozinho', async () => {
    const server = await makeApp();
    addTrack(server, 'trial', 'Trial Mountain Circuit');
    const put = await server.app.inject({
      method: 'PUT',
      url: '/api/session/track-hint',
      payload: { trackId: 'trial' },
    });
    expect(put.statusCode).toBe(200);
    const body = put.json() as ApiSessionCurrent;
    expect(body.track).toMatchObject({
      trackId: 'trial',
      name: 'Trial Mountain Circuit',
      confidence: 'probable',
      basis: 'hint',
    });
    expect(body.track.hint).toMatchObject({ trackId: 'trial', source: 'user' });
    expect(body.track.hint!.expiresAt).toBeGreaterThan(body.track.hint!.setAt);

    // the status snapshot carries it too (the web reads it from there)
    const status = (await server.app.inject({ method: 'GET', url: '/api/status' })).json() as {
      sessionCapture: ServerStatus['sessionCapture'];
    };
    expect(status.sessionCapture?.track?.hint?.trackId).toBe('trial');

    const clear = await server.app.inject({
      method: 'PUT',
      url: '/api/session/track-hint',
      payload: { trackId: null },
    });
    expect(clear.statusCode).toBe(200);
    expect((clear.json() as ApiSessionCurrent).track.hint).toBeNull();
    expect((clear.json() as ApiSessionCurrent).track.trackId).toBeNull();
  });

  it('valida o corpo e a pista (400 / 404)', async () => {
    const server = await makeApp();
    const put = (payload: unknown) =>
      server.app.inject({
        method: 'PUT',
        url: '/api/session/track-hint',
        payload: payload as never,
      });
    expect((await put({})).statusCode).toBe(400);
    expect((await put({ trackId: 42 })).statusCode).toBe(400);
    expect((await put({ trackId: '../x' })).statusCode).toBe(400);
    expect((await put({ trackId: null, force: 'sim' })).statusCode).toBe(400);
    const missing = await put({ trackId: 'naoexiste' });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { code: string } }).error.code).toBe('notFound');
    // nothing was stored by the failed attempts
    expect(server.runtime.engine.trackHint).toBeNull();
  });
});

describe('WebSocket: setTrackHint e trackMismatch', () => {
  function connect(server: Gt7Server): FakeSocket {
    const s = new FakeSocket();
    server.hub.attach(s);
    s.receive({ type: 'hello', protocolVersion: WS_PROTOCOL_VERSION, deviceId: 'tablet' });
    return s;
  }

  it('setTrackHint grava a dica; pista inexistente vira aviso, não exceção', async () => {
    const server = await makeApp();
    addTrack(server, 'trial', 'Trial Mountain Circuit');
    const s = connect(server);
    s.receive({ type: 'setTrackHint', trackId: 'trial' });
    expect(server.runtime.engine.trackHint?.trackId).toBe('trial');
    s.receive({ type: 'setTrackHint', trackId: 'naoexiste' });
    const notice = s.messages().filter((m) => m.type === 'notice' && m.code === 'trackNotFound');
    expect(notice).toHaveLength(1);
    expect(server.runtime.engine.trackHint?.trackId).toBe('trial');
    s.receive({ type: 'setTrackHint', trackId: 123 });
    expect(s.messages().some((m) => m.type === 'notice' && m.code === 'badMessage')).toBe(true);
    s.receive({ type: 'setTrackHint', trackId: null });
    expect(server.runtime.engine.trackHint).toBeNull();
  });

  it('a divergência chega a todos os painéis como "trackMismatch"', async () => {
    const server = await makeApp();
    const a = connect(server);
    const b = connect(server);
    const info: TrackMismatchInfo = {
      sessionId: 's1',
      hintedTrackId: 'x',
      hintedTrackName: 'Pista X',
      detectedTrackId: 'y',
      detectedTrackName: 'Pista Y',
      lapNumber: 1,
      lapsMoved: 0,
      at: 1,
    };
    server.runtime.engine.emit('trackMismatch', info);
    for (const s of [a, b]) {
      const m = s.messages().find((x) => x.type === 'trackMismatch');
      expect(m?.info).toEqual(info);
    }
  });
});
