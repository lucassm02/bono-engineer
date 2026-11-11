/**
 * Synthesis recipes for the radio voices and the candidates heard in auditions.
 *
 * Models come only from the official k2-fsa/sherpa-onnx `tts-models` release and live in the
 * local cache (see sherpa.ts), never in the repository.
 */

export interface ModelSource {
  /** Archive name in https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models */
  archive: string;
  /** Folder inside the archive. */
  folder: string;
}

export const MODELS = {
  kokoro: { archive: 'kokoro-multi-lang-v1_0', folder: 'kokoro-multi-lang-v1_0' },
  supertonic: {
    archive: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11',
    folder: 'sherpa-onnx-supertonic-3-tts-int8-2026-05-11',
  },
  piperFaber: {
    archive: 'vits-piper-pt_BR-faber-medium',
    folder: 'vits-piper-pt_BR-faber-medium',
  },
  piperCadu: { archive: 'vits-piper-pt_BR-cadu-medium', folder: 'vits-piper-pt_BR-cadu-medium' },
  piperJeff: { archive: 'vits-piper-pt_BR-jeff-medium', folder: 'vits-piper-pt_BR-jeff-medium' },
} satisfies Record<string, ModelSource>;

export type ModelKey = keyof typeof MODELS;

/** Kokoro v1.0 speaker order (model metadata `speaker_names`). */
export const KOKORO_SPEAKERS = [
  'af_alloy',
  'af_aoede',
  'af_bella',
  'af_heart',
  'af_jessica',
  'af_kore',
  'af_nicole',
  'af_nova',
  'af_river',
  'af_sarah',
  'af_sky',
  'am_adam',
  'am_echo',
  'am_eric',
  'am_fenrir',
  'am_liam',
  'am_michael',
  'am_onyx',
  'am_puck',
  'am_santa',
  'bf_alice',
  'bf_emma',
  'bf_isabella',
  'bf_lily',
  'bm_daniel',
  'bm_fable',
  'bm_george',
  'bm_lewis',
  'ef_dora',
  'em_alex',
  'ff_siwis',
  'hf_alpha',
  'hf_beta',
  'hm_omega',
  'hm_psi',
  'if_sara',
  'im_nicola',
  'jf_alpha',
  'jf_gongitsune',
  'jf_nezumi',
  'jf_tebukuro',
  'jm_kumo',
  'pf_dora',
  'pm_alex',
  'pm_santa',
  'zf_xiaobei',
  'zf_xiaoni',
  'zf_xiaoxiao',
  'zf_xiaoyi',
  'zm_yunjian',
  'zm_yunxi',
  'zm_yunxia',
  'zm_yunyang',
  'em_santa',
] as const;

export type Recipe =
  | {
      engine: 'kokoro';
      /** Style-vector mix, weights summing to 1. */
      mix: Partial<Record<(typeof KOKORO_SPEAKERS)[number], number>>;
      speed: number;
      lang?: 'en-us' | 'es';
    }
  | { engine: 'vits'; model: 'piperFaber' | 'piperCadu' | 'piperJeff'; speed: number }
  | { engine: 'supertonic'; sid: number; speed: number; steps: number };

export interface VoiceSource {
  recipe: Recipe;
  /** Lines appended to public/radio/CREDITS.txt. */
  credits: string[];
}

const KOKORO_CREDITS = [
  'Modelo: Kokoro-82M v1.0, de hexgrad. Licença Apache-2.0.',
  'https://huggingface.co/hexgrad/Kokoro-82M',
  'Conversão ONNX: k2-fsa/sherpa-onnx, kokoro-multi-lang-v1_0 (Apache-2.0).',
  'https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models',
];

/** Shipped voices, keyed by `RadioVoice.pack` (src/lib/radioVoices.ts). */
export const VOICE_SOURCES: Record<string, VoiceSource> = {
  alex: {
    recipe: { engine: 'kokoro', mix: { pm_alex: 1 }, speed: 1 },
    credits: [...KOKORO_CREDITS, 'Voz: pm_alex.'],
  },
  santa: {
    recipe: { engine: 'kokoro', mix: { pm_santa: 1 }, speed: 1 },
    credits: [...KOKORO_CREDITS, 'Voz: pm_santa.'],
  },
  bruno: {
    recipe: { engine: 'kokoro', mix: { pm_alex: 0.6, am_onyx: 0.4 }, speed: 0.97 },
    credits: [
      ...KOKORO_CREDITS,
      'Voz: mistura gerada pelo Bono dos estilos pm_alex (60%) e am_onyx (40%), modificação',
      'dos arquivos de voz Apache-2.0 do Kokoro, com fonemas em pt-BR.',
    ],
  },
  'en-michael': {
    recipe: { engine: 'kokoro', mix: { am_michael: 1 }, speed: 1, lang: 'en-us' },
    credits: [...KOKORO_CREDITS, 'Voice: am_michael.'],
  },
  'en-nick': {
    recipe: { engine: 'kokoro', mix: { am_santa: 1 }, speed: 1, lang: 'en-us' },
    credits: [...KOKORO_CREDITS, 'Voice: am_santa.'],
  },
  'en-onyx': {
    recipe: { engine: 'kokoro', mix: { am_onyx: 1 }, speed: 0.97, lang: 'en-us' },
    credits: [...KOKORO_CREDITS, 'Voice: am_onyx.'],
  },
  'es-alex': {
    recipe: { engine: 'kokoro', mix: { em_alex: 1 }, speed: 1, lang: 'es' },
    credits: [...KOKORO_CREDITS, 'Voz: em_alex.'],
  },
  'es-santos': {
    recipe: { engine: 'kokoro', mix: { em_santa: 1 }, speed: 1, lang: 'es' },
    credits: [...KOKORO_CREDITS, 'Voz: em_santa.'],
  },
  'es-bruno': {
    recipe: { engine: 'kokoro', mix: { em_alex: 0.55, am_onyx: 0.45 }, speed: 0.97, lang: 'es' },
    credits: [
      ...KOKORO_CREDITS,
      'Voz: mezcla de em_alex (55 %) y am_onyx (45 %), con fonemas en español.',
    ],
  },
};

/**
 * Candidates rendered by `--audition` with the same sample phrase. Not shipped:
 * - Piper pt_BR faber/cadu/jeff: dataset CC0, but fine-tuned from the en_US lessac checkpoint,
 *   whose Blizzard 2013 dataset license is research-only and forbids third-party use.
 * - Piper pt_BR edresson (base ryan, CC BY-NC-SA), miro and dii (CC BY-NC-SA): non-commercial.
 * - Supertonic 3 (OpenRAIL-M; male styles are sids 5–9): language tag is generic `pt` with no
 *   confirmation of a Brazilian accent; keep for listening tests only.
 */
export const AUDITION: Record<string, Recipe> = {
  'kokoro-pm_alex': { engine: 'kokoro', mix: { pm_alex: 1 }, speed: 1 },
  'kokoro-pm_santa': { engine: 'kokoro', mix: { pm_santa: 1 }, speed: 1 },
  'kokoro-alex+onyx': { engine: 'kokoro', mix: { pm_alex: 0.6, am_onyx: 0.4 }, speed: 0.97 },
  'kokoro-alex+lewis': { engine: 'kokoro', mix: { pm_alex: 0.65, bm_lewis: 0.35 }, speed: 1 },
  'kokoro-santa+nicola': { engine: 'kokoro', mix: { pm_santa: 0.6, im_nicola: 0.4 }, speed: 1 },
  'kokoro-santa+em_santa': { engine: 'kokoro', mix: { pm_santa: 0.5, em_santa: 0.5 }, speed: 1 },
  'piper-faber': { engine: 'vits', model: 'piperFaber', speed: 1 },
  'piper-cadu': { engine: 'vits', model: 'piperCadu', speed: 1 },
  'piper-jeff': { engine: 'vits', model: 'piperJeff', speed: 1 },
  ...Object.fromEntries(
    [5, 6, 7, 8, 9].map((sid) => [
      `supertonic-sid${sid}`,
      { engine: 'supertonic', sid, speed: 1, steps: 10 } satisfies Recipe,
    ]),
  ),
};

export const AUDITION_TEXT =
  'Freada forte em duzentos. Terceira marcha na tê quatro. Melhorou dois décimos.';
