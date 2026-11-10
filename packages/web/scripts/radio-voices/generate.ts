/**
 * Regenerate the neural radio packs from the phrase catalog.
 *
 *   npm run radio:voices                 regenerate every pack + manifest + credits
 *   npm run radio:voices -- --setup      prepare the local TTS cache (sherpa-onnx-node + models)
 *   npm run radio:voices -- --audition   render the same sample with every candidate voice
 *                                        into <cache>/audition for listening
 *
 * Inputs: src/lib/radioPhrases.ts (what to say), src/lib/radioVoices.ts (shipped voices),
 * scripts/radio-voices/voices.ts (how each voice is synthesized).
 * Outputs: public/radio/<pack>-<hash>.wav (one sprite per voice, mono 16-bit 24 kHz),
 * src/lib/radio-manifest.json (clip offsets/lengths in samples) and public/radio/CREDITS.txt.
 *
 * Synthesis results are cached in <cache>/clips, so adding a phrase only synthesizes the new one.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RADIO_CATALOG,
  RADIO_SEQUENCE_GAP_MS,
  type RadioEntry,
} from '../../src/lib/radioPhrases.ts';
import { RADIO_VOICES } from '../../src/lib/radioVoices.ts';
import {
  activeRms,
  concat,
  db,
  encodeWav,
  highPass,
  medianPitch,
  normalize,
  peak,
  resample,
  trimSilence,
} from './audio.ts';
import { CACHE, createSynthesizer, SHERPA_VERSION, type Synthesize, setup } from './sherpa.ts';
import { AUDITION, AUDITION_TEXT, type ModelKey, type Recipe, VOICE_SOURCES } from './voices.ts';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(WEB, 'public', 'radio');
const MANIFEST = join(WEB, 'src', 'lib', 'radio-manifest.json');

export const SAMPLE_RATE = 24_000;
/** Pause between sentences inside one phrase (added after each sentence's own trimmed pad). */
const SENTENCE_GAP_MS = 160;
/** Silence between clips inside the sprite, so a late stop never bleeds into the next clip. */
const SPRITE_GAP_MS = 100;
/** Loudness target for every clip of every voice. */
const LOUDNESS = { rmsDb: -20, peakDb: -1.5 };

function cachedSynth(synth: Synthesize, recipe: Recipe, text: string) {
  const key = createHash('sha256')
    .update(JSON.stringify({ sherpa: SHERPA_VERSION, recipe, text }))
    .digest('hex')
    .slice(0, 32);
  const file = join(CACHE, 'clips', `${key}.f32`);
  if (existsSync(file)) {
    const bytes = readFileSync(file);
    const sampleRate = bytes.readUInt32LE(0);
    const samples = new Float32Array(
      bytes.buffer.slice(bytes.byteOffset + 4, bytes.byteOffset + bytes.byteLength),
    );
    return { samples, sampleRate };
  }
  const audio = synth(recipe, text);
  mkdirSync(dirname(file), { recursive: true });
  const header = Buffer.alloc(4);
  header.writeUInt32LE(audio.sampleRate, 0);
  writeFileSync(file, Buffer.concat([header, Buffer.from(new Float32Array(audio.samples).buffer)]));
  return { samples: new Float32Array(audio.samples), sampleRate: audio.sampleRate };
}

/** Synthesize one catalog entry: sentence by sentence, trimmed, fixed pauses, normalized. */
function renderEntry(synth: Synthesize, recipe: Recipe, entry: RadioEntry): Float32Array {
  const say = entry.say ?? entry.text;
  const sentences = say.split(/(?<=[.!?])\s+/).filter(Boolean);
  const parts = sentences.map((sentence) => {
    const raw = cachedSynth(synth, recipe, sentence);
    const audio = resample(raw.samples, raw.sampleRate, SAMPLE_RATE);
    return trimSilence(highPass(audio, SAMPLE_RATE), SAMPLE_RATE);
  });
  const joined = concat(parts, Math.round((SAMPLE_RATE * SENTENCE_GAP_MS) / 1000));
  const clip = normalize(joined, SAMPLE_RATE, LOUDNESS);
  const seconds = clip.length / SAMPLE_RATE;
  const letters = say.replace(/[^\p{L}\p{N}]/gu, '').length;
  if (seconds > 0.6 + letters * 0.12 || seconds < letters * 0.025)
    console.warn(`  ! duração suspeita (${seconds.toFixed(2)} s): ${entry.text}`);
  return clip;
}

interface VoiceManifest {
  file: string;
  clips: Record<string, [number, number]>;
}

function generate(): void {
  const sources = RADIO_VOICES.map((voice) => {
    const source = VOICE_SOURCES[voice.pack];
    if (!source) throw new Error(`Sem receita de síntese para ${voice.pack} (voices.ts)`);
    return { voice, source };
  });
  const synth = createSynthesizer(sources.map((s) => s.source.recipe));
  const voices: Record<string, VoiceManifest> = {};
  const gap = new Float32Array(Math.round((SAMPLE_RATE * SPRITE_GAP_MS) / 1000));
  mkdirSync(OUT_DIR, { recursive: true });
  for (const { voice, source } of sources) {
    console.log(`${voice.name} (${voice.pack}): ${RADIO_CATALOG.length} clipes`);
    const clips: Record<string, [number, number]> = {};
    const pieces: Float32Array[] = [];
    let at = 0;
    let limited = 0;
    let pitchSum = 0;
    for (const entry of RADIO_CATALOG) {
      const clip = renderEntry(synth, source.recipe, entry);
      if (
        db(peak(clip)) > LOUDNESS.peakDb - 0.05 &&
        db(activeRms(clip, SAMPLE_RATE)) < LOUDNESS.rmsDb - 0.5
      )
        limited++;
      pitchSum += medianPitch(clip, SAMPLE_RATE);
      clips[entry.text] = [at, clip.length];
      pieces.push(clip, gap);
      at += clip.length + gap.length;
    }
    const sprite = new Float32Array(at);
    let offset = 0;
    for (const piece of pieces) {
      sprite.set(piece, offset);
      offset += piece.length;
    }
    const wav = encodeWav(sprite, SAMPLE_RATE);
    const hash = createHash('sha256').update(wav).digest('hex').slice(0, 10);
    const file = `${voice.pack}-${hash}.wav`;
    writeFileSync(join(OUT_DIR, file), wav);
    voices[voice.pack] = { file, clips };
    console.log(
      `  ${file}: ${(sprite.length / SAMPLE_RATE).toFixed(1)} s, ${(wav.length / 1048576).toFixed(2)} MiB,` +
        ` F0 médio ${(pitchSum / RADIO_CATALOG.length).toFixed(0)} Hz, limitador em ${limited} clipes`,
    );
  }
  const manifest = {
    format: 1,
    sampleRate: SAMPLE_RATE,
    sequenceGapMs: RADIO_SEQUENCE_GAP_MS,
    loudness: LOUDNESS,
    voices,
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest)}\n`);
  // Keep the committed manifest in the repository's format (biome).
  const biome = join(WEB, '..', '..', 'node_modules', '@biomejs', 'biome', 'bin', 'biome');
  spawnSync(process.execPath, [biome, 'format', '--write', MANIFEST], { stdio: 'ignore' });
  const keep = new Set(Object.values(voices).map((v) => v.file));
  for (const name of readdirSync(OUT_DIR))
    if (name.endsWith('.wav') && !keep.has(name)) {
      rmSync(join(OUT_DIR, name));
      console.log(`  removido ${name}`);
    }
  writeCredits(sources);
  console.log(`Manifesto: ${MANIFEST}`);
}

function writeCredits(
  sources: { voice: (typeof RADIO_VOICES)[number]; source: { credits: string[] } }[],
) {
  const lines = [
    'Clipes de rádio em português do Brasil pré-gerados para o Bono Engineer.',
    'Áudio sintético (voz gerada por computador), gerado offline com sherpa-onnx',
    `(https://github.com/k2-fsa/sherpa-onnx, Apache-2.0), sherpa-onnx-node ${SHERPA_VERSION}.`,
    'Regenerar: npm run radio:voices (packages/web/scripts/radio-voices).',
    'Pós-processamento: corte de silêncio, filtro passa-altas, normalização de volume.',
    '',
  ];
  for (const { voice, source } of sources)
    lines.push(`== ${voice.name} (${voice.id})`, ...source.credits, '');
  writeFileSync(join(OUT_DIR, 'CREDITS.txt'), lines.join('\n'));
}

function audition(text: string): void {
  const recipes = Object.entries(AUDITION);
  const dir = join(CACHE, 'audition');
  mkdirSync(dir, { recursive: true });
  const synth = createSynthesizer(recipes.map(([, recipe]) => recipe));
  for (const [name, recipe] of recipes) {
    try {
      const clip = renderEntry(synth, recipe, { text, say: text });
      writeFileSync(join(dir, `${name}.wav`), encodeWav(clip, SAMPLE_RATE));
      console.log(
        `${name.padEnd(24)} ${(clip.length / SAMPLE_RATE).toFixed(2)} s  F0 ${medianPitch(clip, SAMPLE_RATE).toFixed(0)} Hz`,
      );
    } catch (error) {
      console.log(`${name.padEnd(24)} indisponível: ${(error as Error).message.split('\n')[0]}`);
    }
  }
  console.log(`Amostras em ${dir}`);
}

const args = process.argv.slice(2);
try {
  if (args.includes('--setup')) {
    const all = args.includes('--all-models');
    const keys: ModelKey[] = all
      ? ['kokoro', 'supertonic', 'piperFaber', 'piperCadu', 'piperJeff']
      : ['kokoro'];
    await setup(keys);
    console.log(`Cache pronto em ${CACHE}`);
  } else if (args.includes('--audition')) {
    const at = args.indexOf('--audition');
    audition(args[at + 1] && !args[at + 1]!.startsWith('--') ? args[at + 1]! : AUDITION_TEXT);
  } else generate();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
