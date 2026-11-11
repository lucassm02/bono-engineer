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
  name: string;
  description: string;
}

export const RADIO_VOICES: readonly RadioVoice[] = [
  {
    id: 'radio:alex',
    pack: 'alex',
    language: 'pt-BR',
    name: 'Alex',
    description: 'timbre médio, direto',
  },
  {
    id: 'radio:santa',
    pack: 'santa',
    language: 'pt-BR',
    name: 'Santa',
    description: 'mais claro e enérgico',
  },
  {
    id: 'radio:bruno',
    pack: 'bruno',
    language: 'pt-BR',
    name: 'Bruno',
    description: 'grave e calmo',
  },
  {
    id: 'radio:en-michael',
    pack: 'en-michael',
    language: 'en',
    name: 'Michael',
    description: 'direct, mid-range',
  },
  {
    id: 'radio:en-nick',
    pack: 'en-nick',
    language: 'en',
    name: 'Nick',
    description: 'clear and energetic',
  },
  {
    id: 'radio:en-onyx',
    pack: 'en-onyx',
    language: 'en',
    name: 'Onyx',
    description: 'deep and calm',
  },
  {
    id: 'radio:es-alex',
    pack: 'es-alex',
    language: 'es',
    name: 'Álex',
    description: 'tono medio y directo',
  },
  {
    id: 'radio:es-santos',
    pack: 'es-santos',
    language: 'es',
    name: 'Santos',
    description: 'claro y enérgico',
  },
  {
    id: 'radio:es-bruno',
    pack: 'es-bruno',
    language: 'es',
    name: 'Bruno ES',
    description: 'grave y tranquilo',
  },
];

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
