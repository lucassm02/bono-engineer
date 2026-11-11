/**
 * Neural radio packs: one sprite WAV per voice (public/radio) with clip offsets in
 * radio-manifest.json. Playback uses Web Audio only; there is no device/browser synthesis.
 */

import manifest from './radio-manifest.json';
import { type RadioUtterance, utteranceKeys } from './radioPhrases.ts';
import { defaultRadioVoice, radioVoice } from './radioVoices.ts';

export interface RadioPack {
  voiceId: string;
  file: string;
  sampleRate: number;
  /** key → [start, length] in samples */
  clips: Readonly<Record<string, readonly number[]>>;
}

export type RadioPackStatus = 'idle' | 'loading' | 'ready' | 'failed';

const VOICES = manifest.voices as Record<string, { file: string; clips: Record<string, number[]> }>;
/** Fixed gap between the clips of a sequence. */
export const RADIO_GAP_MS = manifest.sequenceGapMs;

export function radioPack(voiceId: string): RadioPack | null {
  const voice = radioVoice(voiceId);
  const entry = voice && VOICES[voice.pack];
  return entry
    ? { voiceId, file: entry.file, sampleRate: manifest.sampleRate, clips: entry.clips }
    : null;
}

/** Exact duration (ms) of one clip, or undefined when the pack does not have it. */
export function radioClipMs(pack: RadioPack, phrase: string): number | undefined {
  const length = pack.clips[phrase]?.[1];
  return length === undefined ? undefined : (length / pack.sampleRate) * 1000;
}

export function hasRadioUtterance(pack: RadioPack, utterance: RadioUtterance): boolean {
  const keys = utteranceKeys(utterance);
  return keys.length > 0 && keys.every((key) => pack.clips[key] !== undefined);
}

/**
 * Exact time (ms) the utterance will take when played at `rate`: clip lengths / rate plus the
 * fixed gaps. Undefined when any clip is missing.
 */
export function radioUtteranceMs(
  pack: RadioPack,
  utterance: RadioUtterance,
  rate = 1,
): number | undefined {
  if (!hasRadioUtterance(pack, utterance)) return undefined;
  const keys = utteranceKeys(utterance);
  const clips = keys.reduce((sum, key) => sum + radioClipMs(pack, key)!, 0);
  return clips / rate + RADIO_GAP_MS * (keys.length - 1);
}

/**
 * Which pack should play the utterance: the chosen voice when usable and complete, otherwise
 * the default voice only when it has every clip. Null → audio unavailable (keep the panel).
 */
export function pickRadioPack(
  voiceId: string,
  utterance: RadioUtterance,
  usable: (pack: RadioPack) => boolean = (pack) => radioPackStatus(pack) !== 'failed',
): RadioPack | null {
  const fallback = defaultRadioVoice(radioVoice(voiceId)?.language ?? 'pt-BR');
  for (const id of new Set([voiceId, fallback.id])) {
    const pack = radioPack(id);
    if (pack && usable(pack) && hasRadioUtterance(pack, utterance)) return pack;
  }
  return null;
}

let context: AudioContext | undefined;
let output: GainNode | undefined;
const buffers = new Map<string, Promise<AudioBuffer>>();
const decoded = new Map<string, AudioBuffer>();
const failed = new Set<string>();
let playing: { sources: AudioBufferSourceNode[]; preview: boolean } | null = null;

export function radioPackStatus(pack: RadioPack): RadioPackStatus {
  if (decoded.has(pack.file)) return 'ready';
  if (buffers.has(pack.file)) return 'loading';
  return failed.has(pack.file) ? 'failed' : 'idle';
}

/** Start or resume audio from the user gesture, then decode the pack once. */
export async function prepareRadioPack(pack: RadioPack): Promise<void> {
  context ??= new AudioContext({ latencyHint: 'interactive' });
  const ctx = context;
  const resume = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
  let loading = buffers.get(pack.file);
  if (!loading && !decoded.has(pack.file)) {
    failed.delete(pack.file);
    loading = fetch(`/radio/${pack.file}`)
      .then((response) => {
        if (!response.ok) throw new Error('Pacote de rádio indisponível');
        return response.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes))
      .then((buffer) => {
        decoded.set(pack.file, buffer);
        buffers.delete(pack.file);
        return buffer;
      })
      .catch((error: unknown) => {
        buffers.delete(pack.file);
        failed.add(pack.file);
        throw error;
      });
    buffers.set(pack.file, loading);
  }
  await Promise.all([resume, loading]);
}

export function stopRadioClip(preview: boolean): void {
  if (playing?.preview !== preview) return;
  const { sources } = playing;
  playing = null;
  for (const source of sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // never started
    }
    source.disconnect();
  }
}

/**
 * Play an utterance (one clip or a sequence with fixed gaps) from a decoded pack.
 * Returns false when the pack is not decoded, a clip is missing or audio is not running.
 */
export function playRadioUtterance(
  pack: RadioPack,
  utterance: RadioUtterance,
  preview: boolean,
  done?: () => void,
  volume = 1,
  rate = 1,
): boolean {
  const buffer = decoded.get(pack.file);
  if (!buffer || !hasRadioUtterance(pack, utterance) || context?.state !== 'running') return false;
  const ctx = context;
  if (playing) stopRadioClip(playing.preview);
  if (!output) {
    output = ctx.createGain();
    output.connect(ctx.destination);
  }
  output.gain.value = volume;
  const keys = utteranceKeys(utterance);
  const sources: AudioBufferSourceNode[] = [];
  let at = ctx.currentTime;
  keys.forEach((key, index) => {
    const [start, length] = pack.clips[key]!;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(output!);
    const seconds = length! / pack.sampleRate;
    source.start(at, start! / pack.sampleRate, seconds);
    at += seconds / rate + (index < keys.length - 1 ? RADIO_GAP_MS / 1000 : 0);
    sources.push(source);
  });
  playing = { sources, preview };
  const last = sources[sources.length - 1]!;
  last.onended = () => {
    if (playing?.sources !== sources) return;
    playing = null;
    for (const source of sources) source.disconnect();
    done?.();
  };
  return true;
}

/** Single-clip form kept for existing callers. */
export function playRadioClip(
  pack: RadioPack,
  phrase: string,
  preview: boolean,
  done?: () => void,
  volume = 1,
): boolean {
  return playRadioUtterance(pack, phrase, preview, done, volume);
}

export function setRadioClipVolume(volume: number): void {
  if (output) output.gain.value = volume;
}
