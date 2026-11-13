import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { type RadioUtterance, utteranceKeys } from '@gt7/shared/radio-phrases';
import manifest from '../../../web/src/lib/radio-manifest.json' with { type: 'json' };

const voices: Record<string, { file: string; clips: Record<string, number[]> }> = manifest.voices;
const OUTPUT_RATE = 48_000;
const WAV_HEADER_BYTES = 44;
const FRAME_BYTES = 4; // Stereo signed 16-bit PCM.
type Clip = { start: number; length: number };

/** A sprite pack in memory: the PCM samples and where each clip is (key → [start, length]). */
interface SamplePack {
  data: Buffer;
  catalog: Readonly<Record<string, readonly number[]>>;
}

/** Checks the WAV header (mono, 16-bit PCM, the pack sample rate) and returns the samples. */
function wavSamples(wav: Buffer, sampleRate: number): Buffer {
  if (
    wav.length < WAV_HEADER_BYTES ||
    wav.toString('ascii', 36, 40) !== 'data' ||
    wav.readUInt16LE(20) !== 1 ||
    wav.readUInt16LE(22) !== 1 ||
    wav.readUInt32LE(24) !== sampleRate ||
    wav.readUInt16LE(34) !== 16
  ) {
    throw new Error('Formato de áudio do rádio inválido.');
  }
  return wav.subarray(WAV_HEADER_BYTES);
}

export function radioAudio(voice: string, volume: number, radioDir?: string) {
  const pack = voices[voice];
  if (!pack || !Object.hasOwn(voices, voice)) throw new Error('Voz do rádio inválida.');
  const { file, clips: catalog } = pack;
  const wav = readFileSync(
    radioDir ? join(radioDir, file) : new URL(`../../../web/public/radio/${file}`, import.meta.url),
  );
  const base: SamplePack = { data: wavSamples(wav, manifest.sampleRate), catalog };
  // The engineer-task pack (spec 20): downloaded by the Bono server, loaded after the start.
  let tasks: SamplePack | null = null;
  const gapFrames = Math.round((manifest.sequenceGapMs * OUTPUT_RATE) / 1000);
  const ratio = OUTPUT_RATE / manifest.sampleRate;

  /** The clips of the utterance when ONE pack has all of them (the bundled pack first). */
  function segmentsIn(source: SamplePack, keys: readonly string[]): Clip[] | null {
    const clips = [];
    for (const key of keys) {
      const clip = Object.hasOwn(source.catalog, key) ? source.catalog[key] : undefined;
      if (!clip) return null;
      const [start = -1, length = 0] = clip;
      if (start < 0 || length <= 0 || (start + length) * 2 > source.data.length) return null;
      clips.push({ start, length });
    }
    return clips.length ? clips : null;
  }

  function segments(utterance: RadioUtterance): { source: SamplePack; clips: Clip[] } | null {
    const keys = utteranceKeys(utterance);
    for (const source of tasks ? [base, tasks] : [base]) {
      const clips = segmentsIn(source, keys);
      if (clips) return { source, clips };
    }
    return null;
  }

  function frameCount(clips: readonly Clip[]): number {
    return (
      clips.reduce((total, clip) => total + Math.round(clip.length * ratio), 0) +
      gapFrames * (clips.length - 1)
    );
  }

  return {
    /** Gives (or, with null, takes away) the downloaded task pack. Throws on a bad WAV. */
    setTaskPack(
      wavFile: Buffer | null,
      taskCatalog: Readonly<Record<string, readonly number[]>> = {},
      sampleRate = manifest.sampleRate,
    ): void {
      tasks = wavFile ? { data: wavSamples(wavFile, sampleRate), catalog: taskCatalog } : null;
    },
    hasTaskPack(): boolean {
      return tasks !== null;
    },
    durationMs(utterance: RadioUtterance): number | null {
      const found = segments(utterance);
      return found ? (frameCount(found.clips) * 1000) / OUTPUT_RATE : null;
    },
    stream(utterance: RadioUtterance): Readable | null {
      const found = segments(utterance);
      if (!found) return null;
      const { source, clips } = found;
      const pcm = Buffer.alloc(frameCount(clips) * FRAME_BYTES);
      let out = 0;
      for (const { start, length } of clips) {
        for (let i = 0; i < Math.round(length * ratio); i++) {
          const pos = i / ratio;
          const index = Math.floor(pos);
          const left = source.data.readInt16LE((start + index) * 2);
          const right = source.data.readInt16LE((start + Math.min(index + 1, length - 1)) * 2);
          const value = Math.round((left + (right - left) * (pos - index)) * volume);
          pcm.writeInt16LE(value, out);
          pcm.writeInt16LE(value, out + 2);
          out += FRAME_BYTES;
        }
        out += gapFrames * FRAME_BYTES;
      }
      return Readable.from([pcm], { objectMode: false });
    },
  };
}

export function calibrationTone(): Readable {
  const frames = OUTPUT_RATE / 10;
  const pcm = Buffer.alloc(frames * FRAME_BYTES);
  for (let i = 0; i < frames; i++) {
    const ramp = Math.min(1, i / 100, (frames - i - 1) / 100);
    const sample = Math.round(Math.sin((2 * Math.PI * 880 * i) / OUTPUT_RATE) * 9000 * ramp);
    pcm.writeInt16LE(sample, i * FRAME_BYTES);
    pcm.writeInt16LE(sample, i * FRAME_BYTES + 2);
  }
  return Readable.from([pcm], { objectMode: false });
}
