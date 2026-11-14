import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiSessionRace, ApiSettings, Session } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function makeApp(): Promise<Gt7Server> {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-kindapi-'));
  const server = await createApp({
    port: 46895,
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

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    trackId: null,
    carCode: 3253,
    startedAt: Number(id.replace(/\D/g, '')) || 1,
    endedAt: 99,
    format: '~',
    mode: 'live',
    lapCount: 0,
    bestLapMs: null,
    recordingFile: null,
    ...patch,
  };
}

describe('session kinds over HTTP (spec 21)', () => {
  it('sets, clears and filters the kind of a session', async () => {
    const { app, runtime } = await makeApp();
    runtime.store.saveSession(session('s1'));
    runtime.store.saveSession(session('s2'));

    const r = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/s1',
      payload: { kind: 'race' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json<Session>()).toMatchObject({ kind: 'race', kindSource: 'user' });

    const list = await app.inject({ method: 'GET', url: '/api/sessions?kind=race' });
    expect(list.json<Session[]>().map((s) => s.id)).toEqual(['s1']);
    const none = await app.inject({ method: 'GET', url: '/api/sessions?kind=none' });
    expect(none.json<Session[]>().map((s) => s.id)).toEqual(['s2']);

    const clear = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/s1',
      payload: { kind: null },
    });
    expect(clear.json<Session>()).toMatchObject({ kind: null, kindSource: null });
  });

  it('changes several sessions in one request and rejects bad input', async () => {
    const { app, runtime } = await makeApp();
    for (const id of ['s1', 's2', 's3']) runtime.store.saveSession(session(id));
    const batch = await app.inject({
      method: 'PATCH',
      url: '/api/sessions',
      payload: { ids: ['s1', 's2'], kind: 'qualifying' },
    });
    expect(batch.statusCode).toBe(200);
    expect(batch.json()).toEqual({ ok: true, changed: 2 });
    const q = await app.inject({ method: 'GET', url: '/api/sessions?kind=qualifying' });
    expect(q.json<Session[]>()).toHaveLength(2);

    const bad = [
      { method: 'PATCH', url: '/api/sessions/s1', payload: { kind: 'sprint' } },
      { method: 'PATCH', url: '/api/sessions', payload: { ids: [], kind: 'race' } },
      { method: 'PATCH', url: '/api/sessions', payload: { ids: ['../x'], kind: 'race' } },
      { method: 'GET', url: '/api/sessions?kind=sprint' },
    ] as const;
    for (const b of bad) {
      expect((await app.inject({ ...b })).statusCode, `${b.method} ${b.url}`).toBe(400);
    }
    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/sessions/nope',
      payload: { kind: 'race' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('returns the race of a session: the result and the events in order', async () => {
    const { app, runtime } = await makeApp();
    runtime.store.saveSession(
      session('s1', { kind: 'race', startPosition: 4, finishPosition: 5, fieldSize: 15 }),
    );
    runtime.store.addSessionEvents([
      { id: 'b', sessionId: 's1', at: 20, kind: 'impact', lap: 3, distanceM: null, data: {} },
      {
        id: 'a',
        sessionId: 's1',
        at: 10,
        kind: 'position',
        lap: 2,
        distanceM: null,
        data: { from: 4, to: 5 },
      },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/sessions/s1/race' });
    expect(res.statusCode).toBe(200);
    const race = res.json<ApiSessionRace>();
    expect(race.session).toMatchObject({ startPosition: 4, finishPosition: 5, fieldSize: 15 });
    expect(race.events.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('keeps the default for sessions that are not races in the settings', async () => {
    const { app } = await makeApp();
    const get = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(get.json<ApiSettings>().sessionKindDefault).toBe('ask');
    const set = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { sessionKindDefault: 'practice' },
    });
    expect(set.statusCode).toBe(200);
    const again = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(again.json<ApiSettings>().sessionKindDefault).toBe('practice');
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { sessionKindDefault: 'race' },
    });
    expect(bad.statusCode).toBe(400);
  });
});
