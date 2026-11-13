import {
  CONSISTENCY_TARGET_RANGE_MS,
  DISCORD_RADIO_DEVICE_ID,
  RADIO_MODES,
  SUMMARY_FREQUENCIES,
  TRAINING_PROFILES,
} from '@gt7/shared';
import { useState } from 'react';
import { api } from '../analysis/api.ts';
import { useFetch } from '../analysis/useFetch.ts';
import { t as uiText } from '../lib/i18n.ts';
import {
  RADIO_MODE_HINTS,
  RADIO_MODE_LABELS,
  SPEECH_LEVEL_LABELS,
  SUMMARY_LABELS,
  TRAINING_PROFILE_LABELS,
} from '../lib/radioLabels.ts';
import {
  type EngineerPace,
  setEngineerEnabled,
  setEngineerMuted,
  setEngineerVoice,
  setRadioControls,
  testEngineerVoice,
  useEngineer,
} from '../state/engineer.ts';
import { useUi } from '../state/uiStore.ts';
import { DiscordOutput } from './DiscordOutput.tsx';
import { EngineerReference } from './EngineerReference.tsx';
import { RadioVoicePicker, RadioVoicePreview, RadioVoiceStatus } from './RadioVoice.tsx';
import { ToggleRow } from './ToggleRow.tsx';
import { Icon } from './ui/Icon.tsx';

const pickOption = <T extends string>(values: readonly T[], value: string, fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback;

const SPEECH_LEVELS = ['essential', 'detailed', 'mute'] as const;
const PACES: readonly { id: EngineerPace; label: string }[] = [
  {
    id: 'calm',
    get label() {
      return uiText('Calmo');
    },
  },
  {
    id: 'normal',
    get label() {
      return uiText('Normal');
    },
  },
  {
    id: 'fast',
    get label() {
      return uiText('Rápido');
    },
  },
];

export function EngineerControls() {
  const enabled = useEngineer((s) => s.enabled);
  const controls = useEngineer((s) => s.controls);
  const muted = useEngineer((s) => s.muted);
  const voiceUri = useEngineer((s) => s.voiceUri);
  const pace = useEngineer((s) => s.pace);
  const audioAvailable = typeof AudioContext !== 'undefined';
  const deviceId = useUi((s) => s.profile.deviceId);
  const serverStatus = useUi((s) => s.serverStatus);
  const [deviceError, setDeviceError] = useState(false);
  const [savingDevice, setSavingDevice] = useState(false);
  const settings = useFetch('engineer-reference', api.settings);
  const audioDevice = serverStatus?.engineerAudioDeviceId ?? '';
  const audioHere = !audioDevice || audioDevice === deviceId;
  const audioDiscord = audioDevice === DISCORD_RADIO_DEVICE_ID;
  const otherDevices =
    serverStatus?.devices.filter(
      (device) => device.deviceId !== deviceId && device.deviceId !== DISCORD_RADIO_DEVICE_ID,
    ) ?? [];
  const consistency = controls.trainingProfile === 'consistency';
  const summaries = consistency
    ? SUMMARY_FREQUENCIES.filter((frequency) => frequency !== 'lap')
    : SUMMARY_FREQUENCIES;
  const summary = consistency && controls.summary === 'lap' ? 'block' : controls.summary;
  const speechLevel = muted ? 'mute' : controls.level;

  /** Mudo keeps the panel and the chosen level; Essencial/Detalhado also turn the sound back on. */
  function selectSpeechLevel(value: string) {
    if (value === 'mute') {
      setEngineerMuted(true);
      return;
    }
    setRadioControls({ level: value === 'detailed' ? 'detailed' : 'essential' });
    if (muted) setEngineerMuted(false, audioHere && enabled);
  }

  async function selectAudioDevice(value: string) {
    setSavingDevice(true);
    setDeviceError(false);
    if (!audioHere && (!value || value === deviceId) && enabled && !muted) testEngineerVoice(false);
    try {
      const updated = await api.patchSettings({ engineerAudioDeviceId: value || null });
      useUi.setState((state) =>
        state.serverStatus
          ? {
              serverStatus: {
                ...state.serverStatus,
                engineerAudioDeviceId: updated.engineerAudioDeviceId,
              },
            }
          : {},
      );
    } catch {
      setDeviceError(true);
    } finally {
      setSavingDevice(false);
    }
  }

  return (
    <div className="bn-stack engineer-controls">
      <section className="ui-card bn-card" data-tone={enabled ? 'accent' : undefined}>
        <ToggleRow
          title={uiText('Engenheiro ao vivo')}
          description={uiText('Instruções em voz e na tela. O ajuste fica salvo neste aparelho.')}
          checked={enabled}
          onChange={(next) => setEngineerEnabled(next, audioHere)}
        />
      </section>

      <DiscordOutput />

      <section className="ui-card bn-card" aria-labelledby="engineer-radio-title">
        <div className="ui-card-head">
          <h3 id="engineer-radio-title" className="ui-card-title">
            {uiText('Como o engenheiro ajuda')}
          </h3>
        </div>
        <div className="bn-fields">
          <div className="bn-grid-2">
            <label className="ui-field">
              <span className="ui-label">{uiText('Modo')}</span>
              <select
                className="ui-select"
                value={controls.mode}
                onChange={(event) =>
                  setRadioControls({
                    mode: pickOption(RADIO_MODES, event.currentTarget.value, controls.mode),
                  })
                }
              >
                {RADIO_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {RADIO_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>
            {controls.mode === 'training' && (
              <label className="ui-field">
                <span className="ui-label">{uiText('Perfil do treino')}</span>
                <select
                  className="ui-select"
                  value={controls.trainingProfile}
                  onChange={(event) =>
                    setRadioControls({
                      trainingProfile: pickOption(
                        TRAINING_PROFILES,
                        event.currentTarget.value,
                        controls.trainingProfile,
                      ),
                    })
                  }
                >
                  {TRAINING_PROFILES.map((profile) => (
                    <option key={profile} value={profile}>
                      {TRAINING_PROFILE_LABELS[profile]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="ui-help engineer-controls-hint">{RADIO_MODE_HINTS[controls.mode]}</p>

          {controls.mode === 'training' && controls.trainingProfile === 'learnTrack' && (
            <label className="ui-field">
              <span className="ui-label">{uiText('Instruções de freada')}</span>
              <select
                className="ui-select"
                value={controls.learningBrakePercent ? 'detailed' : 'basic'}
                onChange={(event) =>
                  setRadioControls({
                    learningBrakePercent: event.currentTarget.value === 'detailed',
                  })
                }
              >
                <option value="basic">{uiText('Básicas · freada leve, forte ou normal')}</option>
                <option value="detailed">{uiText('Detalhadas · percentual do pedal')}</option>
              </select>
            </label>
          )}

          {controls.mode === 'training' && consistency && (
            <label className="ui-field">
              <span className="ui-label">{uiText('Meta por volta, em segundos')}</span>
              <input
                className="ui-input"
                key={controls.consistencyTargetMs ?? 'reference'}
                type="number"
                min={CONSISTENCY_TARGET_RANGE_MS[0] / 1000}
                max={CONSISTENCY_TARGET_RANGE_MS[1] / 1000}
                step={0.001}
                placeholder={uiText('Tempo da referência')}
                defaultValue={
                  controls.consistencyTargetMs === null ? '' : controls.consistencyTargetMs / 1000
                }
                onBlur={({ currentTarget: field }) => {
                  if (field.validity.valid) {
                    setRadioControls({
                      consistencyTargetMs: field.value
                        ? Math.round(field.valueAsNumber * 1000)
                        : null,
                    });
                  } else {
                    field.value =
                      controls.consistencyTargetMs === null
                        ? ''
                        : String(controls.consistencyTargetMs / 1000);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </label>
          )}

          <div className="bn-grid-2">
            <label className="ui-field">
              <span className="ui-label">{uiText('Antecipação')}</span>
              <select
                className="ui-select"
                value={controls.anticipationMs}
                onChange={(event) =>
                  setRadioControls({ anticipationMs: Number(event.currentTarget.value) })
                }
              >
                <option value={0}>{uiText('Padrão')}</option>
                <option value={350}>{uiText('Mais cedo (+0,35 s)')}</option>
                <option value={700}>{uiText('Bem antes (+0,7 s)')}</option>
              </select>
            </label>
            {controls.mode === 'training' && controls.trainingProfile !== 'free' && (
              <label className="ui-field">
                <span className="ui-label">{uiText('Resumo do treino')}</span>
                <select
                  className="ui-select"
                  value={summary}
                  onChange={(event) =>
                    setRadioControls({
                      summary: pickOption(summaries, event.currentTarget.value, summary),
                    })
                  }
                >
                  {summaries.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {SUMMARY_LABELS[frequency]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {controls.mode === 'training' && controls.trainingProfile !== 'free' && !consistency && (
            <ToggleRow
              title={uiText('Reforço positivo')}
              description={uiText('O engenheiro também avisa quando você acerta a curva.')}
              checked={controls.praise}
              onChange={(praise) => setRadioControls({ praise })}
            />
          )}
        </div>
      </section>

      <section className="ui-card bn-card" aria-labelledby="engineer-voice-title">
        <div className="ui-card-head">
          <h3 id="engineer-voice-title" className="ui-card-title">
            {uiText('Voz e som')}
          </h3>
        </div>
        <div className="bn-fields">
          <div className="ui-field">
            <span className="ui-label" id="engineer-level-label">
              {uiText('Nível de fala')}
            </span>
            <fieldset className="ui-segmented bn-segmented" aria-labelledby="engineer-level-label">
              {SPEECH_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-pressed={speechLevel === level}
                  onClick={() => selectSpeechLevel(level)}
                >
                  {SPEECH_LEVEL_LABELS[level]}
                </button>
              ))}
            </fieldset>
          </div>

          <RadioVoicePicker />

          <div className="ui-field">
            <span className="ui-label" id="engineer-pace-label">
              {uiText('Ritmo da fala')}
            </span>
            <fieldset className="ui-segmented bn-segmented" aria-labelledby="engineer-pace-label">
              {PACES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={!audioAvailable}
                  aria-pressed={pace === item.id}
                  onClick={() => setEngineerVoice(voiceUri, item.id)}
                >
                  {item.label}
                </button>
              ))}
            </fieldset>
          </div>

          <label className="ui-field">
            <span className="ui-label bn-label-row">
              {uiText('Volume do engenheiro')}
              <output className="num">{Math.round(controls.volume * 100)}%</output>
            </span>
            <input
              className="ui-range"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(controls.volume * 100)}
              onChange={(event) =>
                setRadioControls({ volume: Number(event.currentTarget.value) / 100 })
              }
            />
          </label>

          <div className="bn-actions engineer-controls-audio">
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              data-size="sm"
              disabled={!audioAvailable}
              onClick={() => setEngineerMuted(!muted, audioHere)}
            >
              <Icon name={muted ? 'volume' : 'volume-off'} size={18} />
              {muted ? uiText('Ativar som') : uiText('Silenciar')}
            </button>
            <RadioVoicePreview />
          </div>
          <RadioVoiceStatus />

          <hr className="ui-divider" />

          <label className="ui-field">
            <span className="ui-label">{uiText('Aparelho do engenheiro')}</span>
            <select
              className="ui-select"
              value={audioDevice}
              disabled={savingDevice || !serverStatus}
              onChange={(event) => void selectAudioDevice(event.currentTarget.value)}
            >
              <option value="">{uiText('Cada aparelho controla o próprio som')}</option>
              <option value={deviceId}>{uiText('Somente neste aparelho')}</option>
              <option value={DISCORD_RADIO_DEVICE_ID}>Discord · PS5</option>
              {otherDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.name}
                </option>
              ))}
              {audioDevice &&
                !audioHere &&
                !otherDevices.some((device) => device.deviceId === audioDevice) && (
                  <option value={audioDevice}>
                    {uiText('Aparelho selecionado · desconectado')}
                  </option>
                )}
            </select>
          </label>
          {!audioHere && (
            <p className="bn-note" data-tone="info">
              {audioDiscord
                ? uiText(
                    'O som sai pelo canal do Discord. O Bono para Windows precisa estar aberto com o rádio do Discord ativado.',
                  )
                : uiText('Ative o engenheiro no aparelho escolhido para ouvi-lo.')}
            </p>
          )}
          {deviceError && (
            <p className="bn-note" data-tone="loss" role="status">
              {uiText('Não foi possível alterar o aparelho do engenheiro.')}
            </p>
          )}
        </div>
      </section>

      <EngineerReference settings={settings} audioHere={audioHere} />
    </div>
  );
}
