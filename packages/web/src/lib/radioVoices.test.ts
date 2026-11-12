import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateVoicePrefs, setEngineerVoice, useEngineer } from '../state/engineer.ts';
import { pickRadioPack, radioPack, radioUtteranceMs } from './engineerClips.ts';
import { setLanguage, t } from './i18n.ts';
import manifest from './radio-manifest.json';
import {
  gearSegment,
  lapDeltaUtterance,
  ptNumber,
  RADIO_CATALOG,
  RADIO_PREVIEW_KEY,
  SEGMENTS,
} from './radioPhrases.ts';
import {
  DEFAULT_RADIO_VOICE,
  defaultRadioVoice,
  migrateRadioVoice,
  RADIO_VOICES,
  radioVoice,
  voiceLabel,
  voiceLabelOf,
} from './radioVoices.ts';

const WEB = join(import.meta.dirname, '..', '..');
const voices = manifest.voices as Record<string, { file: string; clips: Record<string, number[]> }>;

describe('catálogo de vozes neurais', () => {
  it('offers three neural voices per language and keeps radio:alex (Voz 1) as the Portuguese default', () => {
    expect(DEFAULT_RADIO_VOICE).toBe('radio:alex');
    expect(radioVoice(DEFAULT_RADIO_VOICE)?.slot).toBe(1);
    for (const language of ['pt-BR', 'en', 'es'] as const) {
      expect(RADIO_VOICES.filter((v) => v.language === language)).toHaveLength(3);
      expect(defaultRadioVoice(language).language).toBe(language);
    }
    expect(new Set(RADIO_VOICES.map((v) => v.name)).size).toBe(RADIO_VOICES.length);
    expect(RADIO_VOICES.every((v) => v.id.startsWith('radio:'))).toBe(true);
    expect(RADIO_VOICES.some((v) => /dora/i.test(v.id))).toBe(false);
  });

  it('names the voices by number, following the language, with no proper name', () => {
    const labels = (language: string) =>
      RADIO_VOICES.filter((v) => v.language === language).map(voiceLabel);
    expect(labels('pt-BR')).toEqual(['Voz 1', 'Voz 2', 'Voz 3']);
    expect(labels('en')).toEqual(['Voice 1', 'Voice 2', 'Voice 3']);
    expect(labels('es')).toEqual(['Voz 1', 'Voz 2', 'Voz 3']);
    expect(voiceLabelOf('radio:alex')).toBe('Voz 1');
    expect(voiceLabelOf('radio:santa')).toBe('Voz 2');
    expect(voiceLabelOf('radio:bruno')).toBe('Voz 3');
    expect(voiceLabelOf('radio:en-onyx')).toBe('Voice 3');
    expect(voiceLabelOf('radio:dora')).toBeNull();
    for (const v of RADIO_VOICES) {
      expect(voiceLabel(v)).not.toMatch(new RegExp(v.name, 'i'));
      expect(v.description).not.toMatch(new RegExp(v.name, 'i'));
    }
  });

  it('updates the UI and voice together, remembering the voice selected for each language', () => {
    try {
      setLanguage('en');
      expect(t('Configurações')).toBe('Settings');
      setEngineerVoice('radio:en-onyx', 'calma');
      setLanguage('es');
      expect(t('Configurações')).toBe('Configuración');
      expect(useEngineer.getState().voiceUri).toBe('radio:es-alex');
      setLanguage('en');
      expect(useEngineer.getState()).toMatchObject({ voiceUri: 'radio:en-onyx', pace: 'calma' });
    } finally {
      setLanguage('pt-BR');
    }
  });

  it('ships every catalog entry for every voice, inside its pack file', () => {
    expect(Object.keys(voices).sort()).toEqual(RADIO_VOICES.map((v) => v.pack).sort());
    for (const voice of RADIO_VOICES) {
      const pack = voices[voice.pack];
      expect(pack, voice.pack).toBeDefined();
      const wav = join(WEB, 'public', 'radio', pack!.file);
      expect(existsSync(wav), pack!.file).toBe(true);
      const samples = (statSync(wav).size - 44) / 2;
      for (const entry of RADIO_CATALOG) {
        const clip = pack!.clips[entry.text];
        expect(clip, `${voice.name} sem "${entry.text}" — rode npm run radio:voices`).toBeDefined();
        const [start, length] = clip!;
        expect(length!).toBeGreaterThan(manifest.sampleRate * 0.2);
        expect(start! + length!).toBeLessThanOrEqual(samples);
      }
    }
  });

  it('plays the same preview in every voice', () => {
    for (const voice of RADIO_VOICES)
      expect(radioUtteranceMs(radioPack(voice.id)!, RADIO_PREVIEW_KEY)).toBeGreaterThan(3000);
  });

  it('keeps no pack of removed voices and precaches the default pack', () => {
    const files = new Set(Object.values(voices).map((v) => v.file));
    const radioDir = join(WEB, 'public', 'radio');
    expect(existsSync(join(radioDir, 'dora.wav'))).toBe(false);
    expect([...files].every((file) => existsSync(join(radioDir, file)))).toBe(true);
    const config = readFileSync(join(WEB, 'vite.config.ts'), 'utf8');
    expect(config).toContain(`radio/${radioVoice(DEFAULT_RADIO_VOICE)!.pack}-*.wav`);
  });

  it('assembles values without a recorded phrase from shipped segments', () => {
    const pack = radioPack(DEFAULT_RADIO_VOICE)!;
    for (const tenths of [-12, -10, -3, 0, 1, 2, 9])
      expect(radioUtteranceMs(pack, lapDeltaUtterance(tenths)), String(tenths)).toBeGreaterThan(0);
    expect(radioUtteranceMs(pack, ['Na T4', gearSegment(3)])).toBeGreaterThan(1000);
    expect(SEGMENTS.find((s) => s.text === 'Na T12')?.say).toBe('Na tê doze');
  });
});

describe('números em pt-BR', () => {
  it('spells the radio numbers', () => {
    expect([0, 1, 2, 15, 21, 50, 100, 150, 200, 250, 999].map(ptNumber)).toEqual([
      'zero',
      'um',
      'dois',
      'quinze',
      'vinte e um',
      'cinquenta',
      'cem',
      'cento e cinquenta',
      'duzentos',
      'duzentos e cinquenta',
      'novecentos e noventa e nove',
    ]);
    expect(lapDeltaUtterance(2)).toEqual(['Melhorou', 'dois décimos.']);
    expect(lapDeltaUtterance(-1)).toEqual(['Perdeu', 'um décimo.']);
    expect(lapDeltaUtterance(-15)).toEqual(['Perdeu', 'mais de um segundo.']);
  });
});

describe('migração da voz salva', () => {
  it('keeps a voice of the new catalog', () => {
    expect(migrateRadioVoice('radio:santa')).toBe('radio:santa');
    expect(migrateVoicePrefs({ voiceUri: 'radio:bruno', pace: 'rapida' })).toEqual({
      voiceUri: 'radio:bruno',
      pace: 'rapida',
    });
  });

  it('moves empty, Dora, device and unknown voices to the default neural voice, keeping the pace', () => {
    for (const saved of [
      '',
      undefined,
      null,
      42,
      'radio:dora',
      'com.apple.voice.compact.pt-BR.Luciana',
      'Google português do Brasil',
      'Microsoft Daniel - Portuguese (Brazil)',
      'radio:antiga',
    ])
      expect(migrateRadioVoice(saved), String(saved)).toBe(DEFAULT_RADIO_VOICE);
    expect(migrateVoicePrefs({ voiceUri: 'radio:dora', pace: 'calma' })).toEqual({
      voiceUri: DEFAULT_RADIO_VOICE,
      pace: 'calma',
    });
    expect(migrateVoicePrefs(null)).toEqual({ voiceUri: DEFAULT_RADIO_VOICE, pace: 'normal' });
    expect(migrateVoicePrefs({ pace: 'turbo' })).toEqual({
      voiceUri: DEFAULT_RADIO_VOICE,
      pace: 'normal',
    });
  });
});

describe('fallback com o manifesto real', () => {
  it('falls back to the default voice only when the chosen one cannot play', () => {
    const phrase = 'Freio em cem.';
    expect(pickRadioPack('radio:santa', phrase, () => true)?.voiceId).toBe('radio:santa');
    expect(pickRadioPack('radio:santa', phrase, (p) => p.voiceId !== 'radio:santa')?.voiceId).toBe(
      DEFAULT_RADIO_VOICE,
    );
    expect(pickRadioPack('radio:santa', phrase, () => false)).toBeNull();
    expect(pickRadioPack('radio:santa', 'Frase que não existe.', () => true)).toBeNull();
    expect(
      pickRadioPack('radio:es-bruno', phrase, (p) => p.voiceId !== 'radio:es-bruno')?.voiceId,
    ).toBe('radio:es-alex');
  });
});
