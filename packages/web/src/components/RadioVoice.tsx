import { t, useLanguage } from '../lib/i18n.ts';
import { defaultRadioVoice, RADIO_VOICES, radioVoice } from '../lib/radioVoices.ts';
import {
  setEngineerVoice,
  stopEngineerPreview,
  testEngineerVoice,
  useEngineer,
} from '../state/engineer.ts';
import { Icon } from './ui/Icon.tsx';

export function RadioVoicePicker() {
  const language = useLanguage();
  const voiceUri = useEngineer((state) => state.voiceUri);
  const pace = useEngineer((state) => state.pace);
  return (
    <label className="ui-field">
      <span className="ui-label">{t('Voz do rádio')}</span>
      <select
        className="ui-select"
        disabled={typeof AudioContext === 'undefined' && !window.bonoDiscord}
        value={voiceUri}
        onChange={(event) => setEngineerVoice(event.currentTarget.value, pace)}
      >
        {RADIO_VOICES.filter((voice) => voice.language === language).map((voice) => (
          <option key={voice.id} value={voice.id}>
            {`${voice.name} · ${voice.description}`}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RadioVoicePreview() {
  const loading = useEngineer((state) => state.voiceLoading);
  const playing = useEngineer((state) => state.previewPlaying);
  return (
    <button
      type="button"
      className="ui-btn"
      data-variant="secondary"
      data-size="sm"
      disabled={typeof AudioContext === 'undefined' || loading}
      onClick={() => (playing ? stopEngineerPreview() : testEngineerVoice())}
    >
      <Icon name={playing ? 'stop' : 'play'} size={18} />
      {loading ? t('Preparando áudio…') : playing ? t('Parar prévia') : t('Testar voz')}
    </button>
  );
}

export function RadioVoiceStatus() {
  const language = useLanguage();
  const voiceUri = useEngineer((state) => state.voiceUri);
  const error = useEngineer((state) => state.voiceError);
  const fallback = useEngineer((state) => state.voiceFallback);
  const message =
    typeof AudioContext === 'undefined' || error
      ? t('Áudio do rádio indisponível. As instruções continuam na tela.')
      : fallback
        ? t(
            'Voz {0} indisponível. Tocando com {1}.',
            radioVoice(voiceUri)?.name ?? '',
            defaultRadioVoice(language).name,
          )
        : null;
  return (
    message && (
      <p className="bn-note" data-tone="warn" role="status">
        {message}
      </p>
    )
  );
}
