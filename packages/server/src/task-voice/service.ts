/**
 * Voice of the engineer tasks (spec 20): the audio pack of the active voice, downloaded from a
 * GitHub Release by this PC (the Bono server) the first time the driver allows it, and served to
 * the browsers and the Discord radio from the data directory.
 *
 * - Opt-in: nothing is downloaded until the driver turns it on (`enabled`).
 * - One file per voice (`tasks-<voice>-<hash>.wav`, ~5 MB), only for the voice in use.
 * - Integrity: size and SHA-256 come from the manifest inside the app (TASK_VOICE_MANIFEST), not
 *   from the Release, so a changed or corrupted file is never played.
 * - Background and resumable: a `.part` file is continued with a Range request when possible.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { appendFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Gt7Store } from '@gt7/core';
import {
  type ApiTaskVoice,
  TASK_VOICE_MANIFEST,
  type TaskVoiceFile,
  type TaskVoiceManifest,
} from '@gt7/shared';

/** Where the packs are published: one Release per dictionary version. */
export const TASK_VOICE_RELEASE_BASE =
  'https://github.com/lucassm02/bono-engineer/releases/download';

const SETTING_ENABLED = 'taskVoice.enabled';
const FILE_RE = /^tasks-[a-z0-9-]{1,30}-[0-9a-f]{10}\.wav$/;

export interface TaskVoiceOptions {
  /** The manifest to trust (tests inject a small one). */
  manifest?: TaskVoiceManifest;
  /** Base URL of the Release folder; the file name is appended. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface Job {
  progress: number;
  done: Promise<void>;
}

export class TaskVoiceService {
  readonly #store: Gt7Store;
  readonly #manifest: TaskVoiceManifest;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #dir: string;
  readonly #jobs = new Map<string, Job>();
  readonly #errors = new Map<string, string>();
  /** Files whose hash was verified in this process. */
  readonly #verified = new Set<string>();

  constructor(store: Gt7Store, opts: TaskVoiceOptions = {}) {
    this.#store = store;
    this.#manifest = opts.manifest ?? TASK_VOICE_MANIFEST;
    this.#baseUrl = (
      opts.baseUrl ??
      process.env.GT7_TASK_VOICE_URL ??
      `${TASK_VOICE_RELEASE_BASE}/task-voices-v${this.#manifest.dictionaryVersion}`
    ).replace(/\/+$/, '');
    this.#fetch = opts.fetch ?? fetch;
    this.#dir = join(store.dataDir, 'task-voices');
  }

  get enabled(): boolean {
    return this.#store.getSetting<boolean>(SETTING_ENABLED, false);
  }

  setEnabled(on: boolean): void {
    this.#store.setSetting(SETTING_ENABLED, on);
  }

  /** The packs the manifest knows (voice pack names: `alex`, `en-nick`...). */
  voices(): string[] {
    return Object.keys(this.#manifest.voices);
  }

  #entry(voice: string): TaskVoiceFile | null {
    return this.#manifest.voices[voice] ?? null;
  }

  #path(entry: TaskVoiceFile): string {
    return join(this.#dir, entry.file);
  }

  async #hashOf(path: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(path), hash);
    return hash.digest('hex');
  }

  /** Whether the pack is on disk, whole and checked. */
  async #ready(entry: TaskVoiceFile): Promise<boolean> {
    const path = this.#path(entry);
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return false;
    }
    if (size !== entry.bytes) return false;
    if (this.#verified.has(entry.file)) return true;
    if ((await this.#hashOf(path)) !== entry.sha256) {
      rmSync(path, { force: true });
      return false;
    }
    this.#verified.add(entry.file);
    return true;
  }

  async status(voice: string): Promise<ApiTaskVoice> {
    const entry = this.#entry(voice);
    const base = { enabled: this.enabled, voice };
    if (!entry) {
      return {
        ...base,
        status: 'unavailable',
        progress: null,
        bytes: null,
        error: 'Esta voz ainda não tem o pacote de tarefas.',
        file: null,
      };
    }
    const job = this.#jobs.get(voice);
    if (job) {
      return {
        ...base,
        status: 'downloading',
        progress: job.progress,
        bytes: entry.bytes,
        error: null,
        file: null,
      };
    }
    if (await this.#ready(entry)) {
      return {
        ...base,
        status: 'ready',
        progress: 1,
        bytes: entry.bytes,
        error: null,
        file: entry.file,
      };
    }
    const error = this.#errors.get(voice) ?? null;
    return {
      ...base,
      status: error ? 'failed' : 'idle',
      progress: null,
      bytes: entry.bytes,
      error,
      file: null,
    };
  }

  /** Starts the download in the background (once per voice); returns the current state. */
  async ensure(voice: string): Promise<ApiTaskVoice> {
    const entry = this.#entry(voice);
    if (entry && !(await this.#ready(entry)) && !this.#jobs.has(voice)) {
      this.#errors.delete(voice);
      const job: Job = { progress: 0, done: Promise.resolve() };
      job.done = this.#download(voice, entry, job)
        .catch((e: unknown) => {
          this.#errors.set(voice, (e as Error).message || 'Não foi possível baixar a voz.');
        })
        .finally(() => this.#jobs.delete(voice));
      this.#jobs.set(voice, job);
    }
    return this.status(voice);
  }

  /** Resolves when the download of the voice (if any) ended; for tests. */
  async settled(voice: string): Promise<void> {
    await this.#jobs.get(voice)?.done;
  }

  async #download(voice: string, entry: TaskVoiceFile, job: Job): Promise<void> {
    mkdirSync(this.#dir, { recursive: true });
    const final = this.#path(entry);
    const part = `${final}.part`;
    let have = existsSync(part) ? statSync(part).size : 0;
    if (have >= entry.bytes) {
      rmSync(part, { force: true });
      have = 0;
    }
    const url = `${this.#baseUrl}/${entry.file}`;
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: have > 0 ? { range: `bytes=${have}-` } : {},
        redirect: 'follow',
      });
    } catch {
      throw new Error('Sem conexão com o GitHub. Tente de novo mais tarde.');
    }
    if (response.status === 200) {
      have = 0; // the server ignored the range: start over
      await writeFile(part, new Uint8Array(0));
    } else if (response.status !== 206) {
      throw new Error(`O GitHub respondeu ${response.status} ao baixar a voz.`);
    }
    if (!response.body) throw new Error('Resposta vazia ao baixar a voz.');
    let received = have;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > entry.bytes) {
        rmSync(part, { force: true });
        throw new Error('O arquivo da voz é maior do que o esperado.');
      }
      await appendFile(part, value);
      job.progress = Math.min(0.99, received / entry.bytes);
    }
    if (received !== entry.bytes || (await this.#hashOf(part)) !== entry.sha256) {
      rmSync(part, { force: true });
      throw new Error('O arquivo da voz veio corrompido (SHA-256 diferente). Tente de novo.');
    }
    await rename(part, final);
    this.#verified.add(entry.file);
    this.#errors.delete(voice);
    this.#clean(entry.file);
  }

  /** Removes packs of other versions of the same voice. */
  #clean(keep: string): void {
    const prefix = keep.replace(/-[0-9a-f]{10}\.wav$/, '-');
    for (const name of readdirSync(this.#dir)) {
      if (name !== keep && name.startsWith(prefix) && FILE_RE.test(name)) {
        rmSync(join(this.#dir, name), { force: true });
      }
    }
  }

  async remove(voice: string): Promise<ApiTaskVoice> {
    const entry = this.#entry(voice);
    if (entry && !this.#jobs.has(voice)) {
      rmSync(this.#path(entry), { force: true });
      rmSync(`${this.#path(entry)}.part`, { force: true });
      this.#verified.delete(entry.file);
      this.#errors.delete(voice);
    }
    return this.status(voice);
  }

  /** The path to serve for a file name from the manifest, when it is whole on disk. */
  async servable(file: string): Promise<{ path: string; bytes: number } | null> {
    if (!FILE_RE.test(file)) return null;
    const entry = Object.values(this.#manifest.voices).find((v) => v.file === file);
    if (!entry || !(await this.#ready(entry))) return null;
    return { path: this.#path(entry), bytes: entry.bytes };
  }
}
