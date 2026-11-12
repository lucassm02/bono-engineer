import { isLanguage, LANGUAGES } from '@gt7/shared';
import { useEffect } from 'react';
import {
  RadioVoicePicker,
  RadioVoicePreview,
  RadioVoiceStatus,
} from '../../components/RadioVoice.tsx';
import { LANGUAGE_NAMES, setLanguage, t, useLanguage } from '../../lib/i18n.ts';
import { stopEngineerPreview } from '../../state/engineer.ts';
import { Panel } from './Panel.tsx';

export function LanguageSettings() {
  const language = useLanguage();
  useEffect(() => stopEngineerPreview, []);
  return (
    <Panel id="idioma" title={t('Idioma')}>
      <div className="cfg-stack">
        <div className="cfg-two">
          <label className="ui-field">
            <span className="ui-label">{t('Idioma do app e do engenheiro')}</span>
            <select
              className="ui-select"
              value={language}
              onChange={({ currentTarget }) => {
                if (isLanguage(currentTarget.value)) setLanguage(currentTarget.value);
              }}
            >
              {LANGUAGES.map((option) => (
                <option key={option} value={option} lang={option}>
                  {LANGUAGE_NAMES[option]}
                </option>
              ))}
            </select>
          </label>
          <RadioVoicePicker />
        </div>
        <div>
          <RadioVoicePreview />
        </div>
        <RadioVoiceStatus />
      </div>
    </Panel>
  );
}
