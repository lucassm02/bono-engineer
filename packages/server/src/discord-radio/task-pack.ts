/**
 * The engineer-task voice for the Discord radio (spec 20). The Bono server downloads the pack of
 * the voice from the GitHub Release (opt-in, SHA-256 checked) and serves it on
 * `/api/tasks/voice/file/<file>`; this separate process asks the server for it, checks it again
 * against the manifest compiled into the app, and hands the WAV to the radio audio.
 */

import { createHash } from 'node:crypto';
import { type ApiTaskVoice, TASK_VOICE_MANIFEST, type TaskVoiceManifest } from '@gt7/shared';

export interface TaskPackOptions {
  /** Voice pack name (`alex`, `en-nick`...). */
  voice: string;
  /** `http://127.0.0.1:<port>` of the Bono server. */
  baseUrl: string;
  /** Access token of the Bono server, when it asks for one. */
  token?: string;
  manifest?: TaskVoiceManifest;
  fetch?: typeof fetch;
}

export type TaskPackResult =
  | { state: 'ready'; wav: Buffer; clips: Record<string, [number, number]>; sampleRate: number }
  /** Nothing to load yet: not allowed, still downloading or the server is not reachable. */
  | { state: 'waiting'; reason: string }
  /** This voice has no task pack; do not try again. */
  | { state: 'unavailable' };

/** Asks the server for the task pack of the voice; never throws. */
export async function fetchTaskPack(opts: TaskPackOptions): Promise<TaskPackResult> {
  const manifest = opts.manifest ?? TASK_VOICE_MANIFEST;
  const entry = Object.hasOwn(manifest.voices, opts.voice) ? manifest.voices[opts.voice] : null;
  if (!entry) return { state: 'unavailable' };
  const request = opts.fetch ?? fetch;
  const headers: Record<string, string> = opts.token ? { 'x-gt7-token': opts.token } : {};
  const api = (path: string, init: RequestInit = {}) =>
    request(`${opts.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
  try {
    const query = `voice=${encodeURIComponent(opts.voice)}`;
    const answer = await api(`/api/tasks/voice?${query}`);
    if (!answer.ok) return { state: 'waiting', reason: `o Bono respondeu ${answer.status}` };
    let status = (await answer.json()) as ApiTaskVoice;
    if (status.enabled && status.status === 'idle') {
      // The driver allowed the download but no browser asked for it yet: start it here.
      const started = await api('/api/tasks/voice/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ voice: opts.voice }),
      });
      if (started.ok) status = (await started.json()) as ApiTaskVoice;
    }
    if (status.status !== 'ready' || status.file !== entry.file) {
      return {
        state: 'waiting',
        reason: status.enabled ? 'o download da voz das tarefas ainda não terminou' : 'desativada',
      };
    }
    const file = await api(`/api/tasks/voice/file/${entry.file}`);
    if (!file.ok) return { state: 'waiting', reason: `o Bono respondeu ${file.status}` };
    const wav = Buffer.from(await file.arrayBuffer());
    if (
      wav.length !== entry.bytes ||
      createHash('sha256').update(wav).digest('hex') !== entry.sha256
    ) {
      return { state: 'waiting', reason: 'o arquivo da voz das tarefas não confere' };
    }
    return { state: 'ready', wav, clips: entry.clips, sampleRate: manifest.sampleRate };
  } catch {
    return { state: 'waiting', reason: 'sem conexão com o Bono' };
  }
}
