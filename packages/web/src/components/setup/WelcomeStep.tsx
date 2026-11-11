/**
 * Step 1 · Boas-vindas. Language of the app and of the engineer, and the voice with a "Ouvir"
 * button for each of the three voices of that language. Both write at once, with the same actions
 * as Configurações (`setLanguage`, `setEngineerVoice`).
 */

import type { Language } from '@gt7/shared';
import { useEffect } from 'react';
import {
  getLanguage,
  LANGUAGE_NAMES,
  setLanguage,
  t as uiText,
  useLanguage,
} from '../../lib/i18n.ts';
import { detectLanguage } from '../../lib/onboarding.ts';
import { RADIO_VOICES } from '../../lib/radioVoices.ts';
import { loadString } from '../../lib/storage.ts';
import { setEngineerVoice, testEngineerVoice, useEngineer } from '../../state/engineer.ts';
import { Icon } from '../ui/Icon.tsx';
import { useStepControl } from './ctx.ts';

const LANGUAGES = Object.keys(LANGUAGE_NAMES) as Language[];
/** Same key as `lib/i18n.ts`: present once the language was chosen (or detected) on this device. */
const LANGUAGE_KEY = 'bono.language';

export function WelcomeStep() {
  const language = useLanguage();
  const voiceUri = useEngineer((s) => s.voiceUri);
  const pace = useEngineer((s) => s.pace);
  const loading = useEngineer((s) => s.voiceLoading);
  const canPlay = typeof AudioContext !== 'undefined';
  useStepControl({ canContinue: true });

  // First time on this device: start in the language of the browser or the system.
  useEffect(() => {
    if (loadString(LANGUAGE_KEY) !== null) return;
    const detected = detectLanguage(
      navigator.languages?.length ? navigator.languages : [navigator.language],
    );
    if (detected && detected !== getLanguage()) setLanguage(detected);
  }, []);

  const voices = RADIO_VOICES.filter((v) => v.language === language);
  return (
    <div className="su-step">
      <p className="su-lead">
        {uiText(
          'Escolha o idioma e a voz do seu engenheiro. Dá para mudar depois em Configurações.',
        )}
      </p>

      <fieldset className="su-field">
        <legend className="ui-label">{uiText('Idioma')}</legend>
        <div className="ui-segmented">
          {LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={language === l}
              onClick={() => setLanguage(l)}
            >
              {LANGUAGE_NAMES[l]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="su-field">
        <legend className="ui-label">{uiText('Voz do engenheiro')}</legend>
        <div className="su-options" role="radiogroup" aria-label={uiText('Voz do engenheiro')}>
          {voices.map((voice) => (
            <div
              key={voice.id}
              className="su-option"
              data-checked={voiceUri === voice.id ? '1' : '0'}
            >
              <label className="su-option-main">
                <input
                  type="radio"
                  name="su-voice"
                  className="su-radio"
                  checked={voiceUri === voice.id}
                  onChange={() => setEngineerVoice(voice.id, pace)}
                />
                <span className="su-option-text">
                  <strong>{voice.name}</strong>
                  <span>{voice.description}</span>
                </span>
              </label>
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                data-size="sm"
                disabled={!canPlay || loading}
                aria-label={uiText('Ouvir a voz {0}', voice.name)}
                onClick={() => {
                  if (voiceUri !== voice.id) setEngineerVoice(voice.id, pace);
                  testEngineerVoice();
                }}
              >
                <Icon name="play" size={16} />
                {uiText('Ouvir')}
              </button>
            </div>
          ))}
        </div>
        {!canPlay && (
          <p className="ui-help">
            {uiText('Este navegador não toca o áudio do engenheiro. As instruções ficam na tela.')}
          </p>
        )}
      </fieldset>
    </div>
  );
}
