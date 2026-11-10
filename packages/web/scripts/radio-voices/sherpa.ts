/**
 * Local TTS toolchain for the radio generator, kept out of the app's dependencies.
 *
 * Cache layout (default `~/.cache/bono-tts`, override with BONO_TTS_CACHE):
 *   package.json            pins sherpa-onnx-node (prebuilt native binaries)
 *   node_modules/           npm install output
 *   downloads/<name>.tar.bz2  official k2-fsa/sherpa-onnx `tts-models` archives
 *   models/<name>/<folder>/   each archive extracted into its own empty directory
 *   voices/, clips/          generated: Kokoro style mixes and the synthesis cache
 *
 * Downloaded archives are data: they are only read (ONNX, tokens, espeak data), never executed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { KOKORO_SPEAKERS, MODELS, type ModelKey, type Recipe } from './voices.ts';

/** sherpa-onnx-node 2.x dropped espeak-ng (no pt-BR phonemizer); 1.13.x still ships it. */
export const SHERPA_VERSION = '1.13.8';
export const CACHE = process.env.BONO_TTS_CACHE ?? join(homedir(), '.cache', 'bono-tts');
const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';

export interface Audio {
  samples: Float32Array;
  sampleRate: number;
}

interface SherpaTts {
  generate(request: {
    text: string;
    sid: number;
    speed: number;
    generationConfig?: Record<string, unknown>;
  }): Audio;
}
interface Sherpa {
  OfflineTts: new (config: unknown) => SherpaTts;
}

export const modelDir = (key: ModelKey) =>
  join(CACHE, 'models', MODELS[key].archive, MODELS[key].folder);

export function setupHelp(missing: string): string {
  return [
    `Ferramentas de voz ausentes: ${missing}`,
    '',
    'Prepare o cache local (fora do repositório) com:',
    '  npm run radio:voices -- --setup',
    '',
    `Isso cria ${CACHE}, instala sherpa-onnx-node@${SHERPA_VERSION} ali e baixa do release`,
    `oficial ${RELEASE.replace('/download/', '/tag/')} os modelos:`,
    ...Object.values(MODELS).map((m) => `  ${m.archive}.tar.bz2`),
    'Cada arquivo é extraído na própria pasta em models/<nome>/.',
  ].join('\n');
}

let sherpa: Sherpa | undefined;
function loadSherpa(): Sherpa {
  if (sherpa) return sherpa;
  try {
    const require = createRequire(join(CACHE, 'package.json'));
    sherpa = require('sherpa-onnx-node') as Sherpa;
    return sherpa;
  } catch {
    throw new Error(setupHelp(`sherpa-onnx-node em ${CACHE}`));
  }
}

function requireModel(key: ModelKey): string {
  const dir = modelDir(key);
  if (!existsSync(dir)) throw new Error(setupHelp(`modelo ${MODELS[key].archive}`));
  return dir;
}

/** Install sherpa-onnx-node and download/extract the models into the cache. */
export async function setup(keys: readonly ModelKey[]): Promise<void> {
  mkdirSync(join(CACHE, 'downloads'), { recursive: true });
  writeFileSync(
    join(CACHE, 'package.json'),
    `${JSON.stringify(
      {
        name: 'bono-tts-cache',
        private: true,
        description: 'Cache local do gerador de clipes de rádio do Bono Engineer.',
        dependencies: { 'sherpa-onnx-node': SHERPA_VERSION },
      },
      null,
      2,
    )}\n`,
  );
  const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], {
    cwd: CACHE,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (npm.status !== 0) throw new Error('npm install falhou no cache de voz.');
  for (const key of keys) {
    const { archive } = MODELS[key];
    const target = join(CACHE, 'models', archive);
    if (existsSync(modelDir(key))) continue;
    const file = join(CACHE, 'downloads', `${archive}.tar.bz2`);
    if (!existsSync(file)) {
      console.log(`Baixando ${archive}…`);
      const response = await fetch(`${RELEASE}/${archive}.tar.bz2`);
      if (!response.ok) throw new Error(`Falha ao baixar ${archive}: HTTP ${response.status}`);
      writeFileSync(file, new Uint8Array(await response.arrayBuffer()));
    }
    mkdirSync(target, { recursive: true });
    const tar = spawnSync('tar', ['-xjf', file, '-C', target], { stdio: 'inherit' });
    if (tar.status !== 0) throw new Error(`Falha ao extrair ${archive}`);
  }
}

/** Kokoro style table with each recipe's mix written into consecutive slots from 0. */
function kokoroVoices(mixes: readonly Recipe[]): { path: string; sid: Map<Recipe, number> } {
  const dir = requireModel('kokoro');
  const bytes = readFileSync(join(dir, 'voices.bin'));
  const table = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  const slot = table.length / KOKORO_SPEAKERS.length;
  const out = table.slice();
  const sid = new Map<Recipe, number>();
  mixes.forEach((recipe, index) => {
    if (recipe.engine !== 'kokoro') return;
    const style = new Float32Array(slot);
    for (const [name, weight] of Object.entries(recipe.mix)) {
      const from = KOKORO_SPEAKERS.indexOf(name as (typeof KOKORO_SPEAKERS)[number]);
      if (from < 0 || !weight) throw new Error(`Voz Kokoro desconhecida: ${name}`);
      for (let i = 0; i < slot; i++) style[i]! += weight * table[from * slot + i]!;
    }
    out.set(style, index * slot);
    sid.set(recipe, index);
  });
  mkdirSync(join(CACHE, 'voices'), { recursive: true });
  const path = join(CACHE, 'voices', 'kokoro-v1_0-bono.bin');
  writeFileSync(path, new Uint8Array(out.buffer));
  return { path, sid };
}

export type Synthesize = (recipe: Recipe, text: string) => Audio;

/** Build one synthesizer for a set of recipes (models load lazily, once). */
export function createSynthesizer(recipes: readonly Recipe[]): Synthesize {
  const lib = loadSherpa();
  const kokoroRecipes = recipes.filter((r) => r.engine === 'kokoro');
  let kokoro: { tts: SherpaTts; sid: Map<Recipe, number> } | undefined;
  const vits = new Map<string, SherpaTts>();
  let supertonic: SherpaTts | undefined;
  const threads = 4;

  return (recipe, text) => {
    if (recipe.engine === 'kokoro') {
      if (!kokoro) {
        const dir = requireModel('kokoro');
        const voices = kokoroVoices(kokoroRecipes);
        kokoro = {
          sid: voices.sid,
          tts: new lib.OfflineTts({
            model: {
              kokoro: {
                model: join(dir, 'model.onnx'),
                voices: voices.path,
                tokens: join(dir, 'tokens.txt'),
                dataDir: join(dir, 'espeak-ng-data'),
                lang: 'pt-br',
              },
              numThreads: threads,
            },
            maxNumSentences: 1,
          }),
        };
      }
      const sid = kokoro.sid.get(recipe);
      if (sid === undefined) throw new Error('Receita Kokoro fora do lote');
      return kokoro.tts.generate({ text, sid, speed: recipe.speed });
    }
    if (recipe.engine === 'vits') {
      let tts = vits.get(recipe.model);
      if (!tts) {
        const dir = requireModel(recipe.model);
        const name = MODELS[recipe.model].folder.replace(/^vits-piper-/, '');
        tts = new lib.OfflineTts({
          model: {
            vits: {
              model: join(dir, `${name}.onnx`),
              tokens: join(dir, 'tokens.txt'),
              dataDir: join(dir, 'espeak-ng-data'),
              lexicon: '',
            },
            numThreads: threads,
          },
          maxNumSentences: 1,
        });
        vits.set(recipe.model, tts);
      }
      return tts.generate({ text, sid: 0, speed: recipe.speed });
    }
    if (!supertonic) {
      const dir = requireModel('supertonic');
      supertonic = new lib.OfflineTts({
        model: {
          supertonic: {
            durationPredictor: join(dir, 'duration_predictor.int8.onnx'),
            textEncoder: join(dir, 'text_encoder.int8.onnx'),
            vectorEstimator: join(dir, 'vector_estimator.int8.onnx'),
            vocoder: join(dir, 'vocoder.int8.onnx'),
            ttsJson: join(dir, 'tts.json'),
            unicodeIndexer: join(dir, 'unicode_indexer.bin'),
            voiceStyle: join(dir, 'voice.bin'),
          },
          numThreads: threads,
        },
        maxNumSentences: 1,
      });
    }
    return supertonic.generate({
      text,
      sid: recipe.sid,
      speed: recipe.speed,
      generationConfig: {
        sid: recipe.sid,
        speed: recipe.speed,
        numSteps: recipe.steps,
        extra: { lang: 'pt' },
      },
    });
  };
}
