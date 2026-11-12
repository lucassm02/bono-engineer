/**
 * Neural voices of the radio engineer. Pre-generated packs with no device,
 * browser or online synthesis. The generator (scripts/radio-voices/voices.ts) has one synthesis
 * recipe per `pack`; the manifest test checks that every voice here ships every catalog entry.
 */

import type { Language } from '@gt7/shared';

export interface RadioVoice {
  /** Stable ID saved in preferences (`gt7.engineer.voice`). */
  id: `radio:${string}`;
  /** Manifest key / pack file prefix. */
  pack: string;
  language: Language;
  /**
   * Technical name of the source voice. Never shown to the user (see `voiceLabel`); only the
   * generator and the license credits use it.
   */
  name: string;
  /** Position in the picker, 1 to 3: the user knows the voice as 'Voz 1', 'Voice 2'... */
  slot: 1 | 2 | 3;
  description: string;
}

const VOICE_WORD: Record<Language, string> = { 'pt-BR': 'Voz', en: 'Voice', es: 'Voz' };

/** What the user reads: 'Voz 1' / 'Voice 1' / 'Voz 1', by the language of the voice. */
export function voiceLabel(voice: Pick<RadioVoice, 'language' | 'slot'>): string {
  return `${VOICE_WORD[voice.language]} ${voice.slot}`;
}

export const RADIO_VOICES: readonly RadioVoice[] = [
  {
    id: 'radio:alex',
    pack: 'alex',
    language: 'pt-BR',
    name: 'Alex',
    slot: 1,
    description: 'timbre médio, direto',
  },
  {
    id: 'radio:santa',
    pack: 'santa',
    language: 'pt-BR',
    name: 'Santa',
    slot: 2,
    description: 'mais claro e enérgico',
  },
  {
    id: 'radio:bruno',
    pack: 'bruno',
    language: 'pt-BR',
    name: 'Bruno',
    slot: 3,
    description: 'grave e calmo',
  },
  {
    id: 'radio:en-michael',
    pack: 'en-michael',
    language: 'en',
    name: 'Michael',
    slot: 1,
    description: 'direct, mid-range',
  },
  {
    id: 'radio:en-nick',
    pack: 'en-nick',
    language: 'en',
    name: 'Nick',
    slot: 2,
    description: 'clear and energetic',
  },
  {
    id: 'radio:en-onyx',
    pack: 'en-onyx',
    language: 'en',
    name: 'Onyx',
    slot: 3,
    description: 'deep and calm',
  },
  {
    id: 'radio:es-alex',
    pack: 'es-alex',
    language: 'es',
    name: 'Álex',
    slot: 1,
    description: 'tono medio y directo',
  },
  {
    id: 'radio:es-santos',
    pack: 'es-santos',
    language: 'es',
    name: 'Santos',
    slot: 2,
    description: 'claro y enérgico',
  },
  {
    id: 'radio:es-bruno',
    pack: 'es-bruno',
    language: 'es',
    name: 'Bruno ES',
    slot: 3,
    description: 'grave y tranquilo',
  },
];

/** Label of a saved voice ID (`null` when the ID is not in the catalog). */
export function voiceLabelOf(id: string): string | null {
  const voice = RADIO_VOICES.find((v) => v.id === id);
  return voice ? voiceLabel(voice) : null;
}

export const DEFAULT_RADIO_VOICE = 'radio:alex';

export function defaultRadioVoice(language: Language): RadioVoice {
  return RADIO_VOICES.find((voice) => voice.language === language)!;
}

export function radioVoice(id: string): RadioVoice | undefined {
  return RADIO_VOICES.find((voice) => voice.id === id);
}

/**
 * Saved voice preference → voice in the current catalog. Keeps a known ID; anything else
 * (empty, the retired Dora, a device voiceURI, an unknown ID) moves to the default neural voice.
 */
export function migrateRadioVoice(saved: unknown): string {
  return typeof saved === 'string' && radioVoice(saved) ? saved : DEFAULT_RADIO_VOICE;
}
