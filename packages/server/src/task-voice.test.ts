import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiTaskVoice, TaskVoiceManifest } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const AUDIO = Buffer.from('RIFF....WAVE'.repeat(5000));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const FILE = `tasks-alex-${sha(AUDIO).slice(0, 10)}.wav`;
const MANIFEST: TaskVoiceManifest = {
  dictionaryVersion: 1,
  sampleRate: 24000,
  voices: { alex: { file: FILE, bytes: AUDIO.length, sha256: sha(AUDIO), clips: {} } },
};

/** A fake "GitHub Release": serves `body` for the file, honouring Range. */
async function releaseServer(body: () => Buffer, hits: { ranges: string[] } = { ranges: [] }) {
  const server: Server = createServer((req, res) => {
    if (req.url !== `/${FILE}`) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const data = body();
    const range = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    if (range) {
      hits.ranges.push(req.headers.range ?? '');
      const from = Number(range[1]);
      res.statusCode = 206;
      res.end(data.subarray(from));
      return;
    }
    res.end(data);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function makeApp(baseUrl: string): Promise<{ server: Gt7Server; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-taskvoice-'));
  const server = await createApp({
    port: 46895,
    host: '127.0.0.1',
    webDist: null,
    firewall: { platform: 'linux' },
    hub: { keepAliveMs: 0 },
    runtime: { dataDir: join(dir, 'data'), record: false, persistConsoleIp: false },
    taskVoice: { manifest: MANIFEST, baseUrl },
  });
  cleanups.push(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { server, dir };
}

describe('the downloaded voice of the tasks', () => {
  it('downloads nothing until the driver allows it, then fetches, checks and serves the file', async () => {
    let downloads = 0;
    const base = await releaseServer(() => {
      downloads += 1;
      return AUDIO;
    });
    const { server } = await makeApp(base);
    const { app, taskVoice } = server;

    const idle = (
      await app.inject({ method: 'GET', url: '/api/tasks/voice?voice=alex' })
    ).json<ApiTaskVoice>();
    expect(idle).toMatchObject({ enabled: false, status: 'idle', bytes: AUDIO.length });
    const refused = await app.inject({
      method: 'POST',
      url: '/api/tasks/voice/download',
      payload: { voice: 'alex' },
    });
    expect(refused.statusCode).toBe(409);

    const attempts = await Promise.all(
      Array.from({ length: 2 }, () =>
        app.inject({
          method: 'PUT',
          url: '/api/tasks/voice',
          payload: { enabled: true, voice: 'alex' },
        }),
      ),
    );
    for (const response of attempts) {
      expect(['downloading', 'ready']).toContain(response.json<ApiTaskVoice>().status);
    }
    await taskVoice.settled('alex');
    expect(downloads).toBe(1);
    const ready = (
      await app.inject({ method: 'GET', url: '/api/tasks/voice?voice=alex' })
    ).json<ApiTaskVoice>();
    expect(ready).toMatchObject({ enabled: true, status: 'ready', file: FILE });

    const audio = await app.inject({ method: 'GET', url: `/api/tasks/voice/file/${FILE}` });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers['content-type']).toContain('audio/wav');
    expect(audio.rawPayload.equals(AUDIO)).toBe(true);
    expect(
      (await app.inject({ method: 'GET', url: '/api/tasks/voice/file/tasks-alex-0000000000.wav' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/tasks/voice/file/..%2Fsessions.db' }))
        .statusCode,
    ).toBe(404);

    const gone = (
      await app.inject({ method: 'DELETE', url: '/api/tasks/voice?voice=alex' })
    ).json<ApiTaskVoice>();
    expect(gone.status).toBe('idle');
  });

  it('refuses a file that does not match the SHA-256 of the manifest', async () => {
    const corrupt = Buffer.from(AUDIO);
    corrupt[10] = corrupt[10]! ^ 0xff;
    const base = await releaseServer(() => corrupt);
    const { server } = await makeApp(base);
    server.taskVoice.setEnabled(true);
    await server.taskVoice.ensure('alex');
    await server.taskVoice.settled('alex');
    const st = await server.taskVoice.status('alex');
    expect(st.status).toBe('failed');
    expect(st.error).toContain('SHA-256');
    expect(await server.taskVoice.servable(FILE)).toBeNull();
  });

  it('continues a partial download with a Range request', async () => {
    const hits = { ranges: [] as string[] };
    const base = await releaseServer(() => AUDIO, hits);
    const { server, dir } = await makeApp(base);
    const half = AUDIO.length >> 1;
    const folder = join(dir, 'data', 'task-voices');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${FILE}.part`), AUDIO.subarray(0, half));
    server.taskVoice.setEnabled(true);
    await server.taskVoice.ensure('alex');
    await server.taskVoice.settled('alex');
    expect(hits.ranges).toEqual([`bytes=${half}-`]);
    expect((await server.taskVoice.status('alex')).status).toBe('ready');
  });

  it('reports a voice the app has no pack for, and fails cleanly when the release is missing', async () => {
    const base = await releaseServer(() => AUDIO);
    const { server } = await makeApp(`${base}/nada`);
    const { app } = server;
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/tasks/voice?voice=en-nick' })
      ).json<ApiTaskVoice>().status,
    ).toBe('unavailable');
    server.taskVoice.setEnabled(true);
    await server.taskVoice.ensure('alex');
    await server.taskVoice.settled('alex');
    const st = await server.taskVoice.status('alex');
    expect(st.status).toBe('failed');
    expect(st.error).toContain('404');
    expect(
      (await app.inject({ method: 'GET', url: '/api/tasks/voice?voice=BAD!' })).statusCode,
    ).toBe(400);
  });
});
