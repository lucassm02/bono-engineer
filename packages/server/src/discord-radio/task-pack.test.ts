import { createHash } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import type { ApiTaskVoice, TaskVoiceManifest } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { radioAudio } from './audio.ts';
import { fetchTaskPack } from './task-pack.ts';

const RATE = 24_000;

/** A mono 16-bit WAV at the pack sample rate with `samples` constant-valued samples. */
function wav(samples: number, value = 1000): Buffer {
  const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write('WAVEfmt ', 8, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) out.writeInt16LE(value, 44 + i * 2);
  return out;
}

const PACK = wav(4800);
const CLIPS: Record<string, [number, number]> = {
  'loc.after.13': [0, 2400],
  'act.gear.up': [2400, 2400],
};
const MANIFEST: TaskVoiceManifest = {
  dictionaryVersion: 1,
  sampleRate: RATE,
  voices: {
    alex: {
      file: 'tasks-alex-0123456789.wav',
      bytes: PACK.length,
      sha256: createHash('sha256').update(PACK).digest('hex'),
      clips: CLIPS,
    },
  },
};

const status = (over: Partial<ApiTaskVoice>): ApiTaskVoice => ({
  enabled: true,
  voice: 'alex',
  status: 'ready',
  progress: 1,
  bytes: PACK.length,
  error: null,
  file: 'tasks-alex-0123456789.wav',
  ...over,
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** A fake Bono: `voice` is the status it reports; `file` is what it serves. */
function fakeBono(voice: ApiTaskVoice, file: Buffer = PACK) {
  const calls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace('http://127.0.0.1:8770', '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    headers.push((init?.headers ?? {}) as Record<string, string>);
    if (path.startsWith('/api/tasks/voice/file/')) return new Response(new Uint8Array(file));
    if (path === '/api/tasks/voice/download') return json({ ...voice, status: 'downloading' });
    return json(voice);
  }) as typeof fetch;
  return { fetcher, calls, headers };
}

const options = (fetcher: typeof fetch, extra = {}) => ({
  voice: 'alex',
  baseUrl: 'http://127.0.0.1:8770',
  manifest: MANIFEST,
  fetch: fetcher,
  ...extra,
});

describe('task voice of the Discord radio', () => {
  it('speaks a task sentence once the task pack is loaded', async () => {
    const audio = radioAudio('alex', 1);
    const sentence = ['loc.after.13', 'act.gear.up'];
    expect(audio.durationMs(sentence)).toBeNull();
    expect(audio.stream(sentence)).toBeNull();

    const bono = fakeBono(status({}));
    const result = await fetchTaskPack(options(bono.fetcher));
    expect(result.state).toBe('ready');
    if (result.state !== 'ready') return;
    audio.setTaskPack(result.wav, result.clips, result.sampleRate);

    expect(audio.hasTaskPack()).toBe(true);
    // 2 clips of 100 ms at 48 kHz stereo 16-bit + the fixed gap between them
    const pcm = await buffer(audio.stream(sentence)!);
    expect(pcm.length / 192).toBe(audio.durationMs(sentence));
    expect(audio.durationMs(sentence)).toBeGreaterThan(200);
    // the pieces come from the task pack, scaled by the volume
    expect(pcm.readInt16LE(0)).toBe(1000);

    audio.setTaskPack(null);
    expect(audio.stream(sentence)).toBeNull();
  });

  it('keeps playing the bundled clips with a task pack loaded', async () => {
    const audio = radioAudio('alex', 1);
    audio.setTaskPack(PACK, CLIPS, RATE);
    expect(audio.stream('inexistente')).toBeNull();
    // a sentence that only the task pack has is not mixed with clips of the other pack
    expect(audio.durationMs(['loc.after.13', 'clip.that.does.not.exist'])).toBeNull();
  });

  it('refuses a task pack in the wrong audio format', () => {
    const audio = radioAudio('alex', 1);
    const bad = wav(10);
    bad.writeUInt32LE(44_100, 24);
    expect(() => audio.setTaskPack(bad, CLIPS, RATE)).toThrow();
    expect(audio.hasTaskPack()).toBe(false);
  });

  it('asks the Bono with its access token', async () => {
    const bono = fakeBono(status({}));
    await fetchTaskPack(options(bono.fetcher, { token: 'secret' }));
    expect(bono.calls).toEqual([
      'GET /api/tasks/voice?voice=alex',
      'GET /api/tasks/voice/file/tasks-alex-0123456789.wav',
    ]);
    expect(bono.headers.every((h) => h['x-gt7-token'] === 'secret')).toBe(true);
  });

  it('waits while the driver has not allowed the download', async () => {
    const bono = fakeBono(status({ enabled: false, status: 'idle', progress: null, file: null }));
    const result = await fetchTaskPack(options(bono.fetcher));
    expect(result).toMatchObject({ state: 'waiting' });
    expect(bono.calls).toEqual(['GET /api/tasks/voice?voice=alex']);
  });

  it('starts the download when it is allowed but nobody asked yet', async () => {
    const bono = fakeBono(status({ status: 'idle', progress: null, file: null }));
    const result = await fetchTaskPack(options(bono.fetcher));
    expect(result).toMatchObject({ state: 'waiting' });
    expect(bono.calls).toEqual([
      'GET /api/tasks/voice?voice=alex',
      'POST /api/tasks/voice/download',
    ]);
  });

  it('never trusts a file that does not match the manifest', async () => {
    const tampered = Buffer.from(PACK);
    tampered.writeInt16LE(7, 100);
    const result = await fetchTaskPack(options(fakeBono(status({}), tampered).fetcher));
    expect(result).toMatchObject({ state: 'waiting', reason: expect.stringContaining('confere') });
  });

  it('gives up on a voice without a task pack and survives a Bono that is down', async () => {
    const bono = fakeBono(status({}));
    expect(await fetchTaskPack(options(bono.fetcher, { voice: 'en-nick' }))).toEqual({
      state: 'unavailable',
    });
    expect(bono.calls).toEqual([]);
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    expect(await fetchTaskPack(options(down))).toMatchObject({ state: 'waiting' });
  });
});
