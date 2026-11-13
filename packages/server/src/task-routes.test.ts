import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiTaskList, ApiTaskPreview, EngineerTask, Track } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const TRACK: Track = {
  id: 'trk-1',
  name: 'Meu circuito',
  layout: null,
  fingerprint: {} as never,
  lengthM: 3000,
  centerline: null,
  sectorGates: [],
  corners: [
    {
      id: 'T1',
      index: 0,
      name: null,
      entryM: 400,
      apexM: 480,
      exitM: 560,
      direction: 'left',
      kind: 'slow',
    },
  ],
  source: 'auto',
  createdAt: 1,
  updatedAt: 1,
};

async function makeApp(): Promise<Gt7Server> {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-taskapi-'));
  const server = await createApp({
    port: 46894,
    host: '127.0.0.1',
    webDist: null,
    firewall: { platform: 'linux' },
    hub: { keepAliveMs: 0 },
    runtime: { dataDir: join(dir, 'data'), record: false, persistConsoleIp: false },
  });
  server.runtime.store.insertTrack(TRACK);
  cleanups.push(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return server;
}

const BODY = {
  trackId: 'trk-1',
  where: { corner: 1, phase: 'entry' },
  say: { action: 'brake', amount: 'm20', comparator: 'later' },
};

describe('/api/tasks', () => {
  it('previews, creates the driver task active, edits, pauses and deletes it', async () => {
    const { app } = await makeApp();
    const pre = await app.inject({ method: 'POST', url: '/api/tasks/preview', payload: BODY });
    expect(pre.statusCode).toBe(200);
    const prev = pre.json<ApiTaskPreview>();
    expect(prev.ok).toBe(true);
    expect(prev.text?.['pt-BR']).toBe('Foco. Na T1, entrada. Freie vinte metros mais tarde.');

    const made = await app.inject({ method: 'POST', url: '/api/tasks', payload: BODY });
    expect(made.statusCode).toBe(201);
    const task = made.json<EngineerTask>();
    expect(task).toMatchObject({ status: 'active', source: 'driver' });

    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { say: { action: 'brake', amount: 'm10', comparator: 'earlier' }, carCode: 3455 },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json<EngineerTask>()).toMatchObject({ carCode: 3455 });

    const pause = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'paused' },
    });
    expect(pause.json<EngineerTask>().status).toBe('paused');

    const list = await app.inject({ method: 'GET', url: '/api/tasks?trackId=trk-1' });
    expect(list.json<ApiTaskList>().tasks).toHaveLength(1);

    expect((await app.inject({ method: 'DELETE', url: `/api/tasks/${task.id}` })).statusCode).toBe(
      200,
    );
    expect((await app.inject({ method: 'DELETE', url: `/api/tasks/${task.id}` })).statusCode).toBe(
      404,
    );
  });

  it('keeps an agent proposal waiting until the driver approves it', async () => {
    const server = await makeApp();
    const { app, runtime } = server;
    const r = runtime.tasks.propose({
      trackId: 'trk-1',
      where: { corner: 1 },
      say: { action: 'dose' },
      source: 'agent',
      agent: 'claude-code',
    });
    const list = (await app.inject({ method: 'GET', url: '/api/tasks' })).json<ApiTaskList>();
    expect(list.proposals).toBe(1);
    expect(list.tasks[0]?.status).toBe('proposed');

    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${r.task!.id}`,
      payload: { status: 'active' },
    });
    expect(ok.json<EngineerTask>().status).toBe('active');
    expect(
      (await app.inject({ method: 'GET', url: '/api/tasks' })).json<ApiTaskList>().proposals,
    ).toBe(0);
  });

  it('refuses what the dictionary cannot say, and bad input', async () => {
    const { app } = await makeApp();
    const bad = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { ...BODY, say: { action: 'dance' } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalidTask');
    expect(bad.json().error.message).toContain('brake');

    expect(
      (await app.inject({ method: 'POST', url: '/api/tasks', payload: { trackId: 'trk-1' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/tasks',
          payload: { ...BODY, trackId: 'nope' },
        })
      ).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/tasks?status=foo' })).statusCode).toBe(
      400,
    );

    const misses = await app.inject({ method: 'GET', url: '/api/tasks/misses' });
    expect(misses.json()).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: '/api/tasks/misses' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/tasks/dictionary' })).json().version).toBe(
      1,
    );
  });
});
