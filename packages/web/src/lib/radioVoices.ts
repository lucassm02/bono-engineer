/**
 * Neural voices of the radio engineer. Only pre-generated male pt-BR voices: no device,
 * browser or online synthesis. The generator (scripts/radio-voices/voices.ts) has one synthesis
 * recipe per `pack`; the manifest test checks that every voice here ships every catalog entry.
 */

export interface RadioVoice {
  /** Stable ID saved in preferences (`gt7.engineer.voice`). */
  id: `radio:${string}`;
  /** Manifest key / pack file prefix. */
  pack: string;
  name: string;
  description: string;
}

export const RADIO_VOICES: readonly RadioVoice[] = [
  { id: 'radio:alex', pack: 'alex', name: 'Alex', description: 'timbre médio, direto' },
  { id: 'radio:santa', pack: 'santa', name: 'Santa', description: 'mais claro e enérgico' },
  { id: 'radio:bruno', pack: 'bruno', name: 'Bruno', description: 'grave e calmo' },
];

export const DEFAULT_RADIO_VOICE = 'radio:alex';

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
