import {
  CONSISTENCY_TARGET_RANGE_MS,
  RADIO_MODES,
  SUMMARY_FREQUENCIES,
  TRAINING_PROFILES,
} from '@gt7/shared';
import { useState } from 'react';
import { api } from '../analysis/api.ts';
import { useFetch } from '../analysis/useFetch.ts';
import {
  RADIO_MODE_HINTS,
  RADIO_MODE_LABELS,
  SPEECH_LEVEL_LABELS,
  SUMMARY_LABELS,
  TRAINING_PROFILE_LABELS,
} from '../lib/radioLabels.ts';
import { DEFAULT_RADIO_VOICE, RADIO_VOICES, radioVoice } from '../lib/radioVoices.ts';
import {
  type EngineerPace,
  setEngineerEnabled,
  setEngineerMuted,
  setEngineerVoice,
  setRadioControls,
  stopEngineerPreview,
  testEngineerVoice,
  useEngineer,
} from '../state/engineer.ts';
import { useUi } from '../state/uiStore.ts';
import { EngineerReference } from './EngineerReference.tsx';
import { ToggleRow } from './ToggleRow.tsx';
import { Icon } from './ui/Icon.tsx';

const pickOption = <T extends string>(values: readonly T[], value: string, fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback;

const SPEECH_LEVELS = ['essential', 'detailed', 'mute'] as const;
const PACES: readonly { id: EngineerPace; label: string }[] = [
  { id: 'calma', label: 'Calmo' },
  { id: 'normal', label: 'Normal' },
  { id: 'rapida', label: 'Rápido' },
];

export function EngineerControls() {
  const enabled = useEngineer((s) => s.enabled);
  const controls = useEngineer((s) => s.controls);
  const muted = useEngineer((s) => s.muted);
  const voiceError = useEngineer((s) => s.voiceError);
  const voiceLoading = useEngineer((s) => s.voiceLoading);
  const previewPlaying = useEngineer((s) => s.previewPlaying);
  const voiceUri = useEngineer((s) => s.voiceUri);
  const pace = useEngineer((s) => s.pace);
  const voiceFallback = useEngineer((s) => s.voiceFallback);
  const audioAvailable = typeof AudioContext !== 'undefined';
  const deviceId = useUi((s) => s.profile.deviceId);
  const serverStatus = useUi((s) => s.serverStatus);
  const [deviceError, setDeviceError] = useState(false);
  const [savingDevice, setSavingDevice] = useState(false);
  const settings = useFetch('engineer-reference', api.settings);
  const audioDevice = serverStatus?.engineerAudioDeviceId ?? '';
  const audioHere = !audioDevice || audioDevice === deviceId;
  const otherDevices = serverStatus?.devices.filter((device) => device.deviceId !== deviceId) ?? [];
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
          title="Engenheiro ao vivo"
          description="Instruções em voz e na tela. Quando tudo corre bem, o rádio fica em silêncio."
          checked={enabled}
          onChange={(next) => setEngineerEnabled(next, audioHere)}
        />
      </section>

      <section className="ui-card bn-card" aria-labelledby="engineer-radio-title">
        <div className="ui-card-head">
          <h3 id="engineer-radio-title" className="ui-card-title">
            Como o rádio ajuda
          </h3>
        </div>
        <div className="bn-fields">
          <div className="bn-grid-2">
            <label className="ui-field">
              <span className="ui-label">Modo</span>
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
                <span className="ui-label">Perfil do treino</span>
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
              <span className="ui-label">Instruções de freada</span>
              <select
                className="ui-select"
                value={controls.learningBrakePercent ? 'detailed' : 'basic'}
                onChange={(event) =>
                  setRadioControls({
                    learningBrakePercent: event.currentTarget.value === 'detailed',
                  })
                }
              >
                <option value="basic">Básicas · freada leve, forte ou normal</option>
                <option value="detailed">Detalhadas · percentual do pedal</option>
              </select>
            </label>
          )}

          {controls.mode === 'training' && consistency && (
            <label className="ui-field">
              <span className="ui-label">Meta por volta, em segundos</span>
              <input
                className="ui-input"
                key={controls.consistencyTargetMs ?? 'reference'}
                type="number"
                min={CONSISTENCY_TARGET_RANGE_MS[0] / 1000}
                max={CONSISTENCY_TARGET_RANGE_MS[1] / 1000}
                step={0.001}
                placeholder="Tempo da referência"
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
              <span className="ui-label">Antecipação</span>
              <select
                className="ui-select"
                value={controls.anticipationMs}
                onChange={(event) =>
                  setRadioControls({ anticipationMs: Number(event.currentTarget.value) })
                }
              >
                <option value={0}>Padrão</option>
                <option value={350}>Mais cedo (+0,35 s)</option>
                <option value={700}>Bem antes (+0,7 s)</option>
              </select>
            </label>
            {controls.mode === 'training' && controls.trainingProfile !== 'free' && (
              <label className="ui-field">
                <span className="ui-label">Resumo do treino</span>
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
              title="Reforço positivo"
              description="O rádio também avisa quando você acerta a curva."
              checked={controls.praise}
              onChange={(praise) => setRadioControls({ praise })}
            />
          )}
        </div>
      </section>

      <section className="ui-card bn-card" aria-labelledby="engineer-voice-title">
        <div className="ui-card-head">
          <h3 id="engineer-voice-title" className="ui-card-title">
            Voz e som
          </h3>
        </div>
        <div className="bn-fields">
          <div className="ui-field">
            <span className="ui-label" id="engineer-level-label">
              Nível de fala
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

          <label className="ui-field">
            <span className="ui-label">Voz do rádio</span>
            <select
              className="ui-select"
              disabled={!audioAvailable}
              value={voiceUri}
              onChange={(event) => setEngineerVoice(event.currentTarget.value, pace)}
            >
              {RADIO_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {`${voice.name} · ${voice.description}`}
                </option>
              ))}
            </select>
          </label>

          <div className="ui-field">
            <span className="ui-label" id="engineer-pace-label">
              Ritmo da fala
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
              Volume do rádio
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
              {muted ? 'Ativar som' : 'Silenciar'}
            </button>
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              data-size="sm"
              disabled={!audioAvailable || voiceLoading}
              onClick={() => (previewPlaying ? stopEngineerPreview() : testEngineerVoice())}
            >
              <Icon name={previewPlaying ? 'stop' : 'play'} size={18} />
              {voiceLoading ? 'Preparando áudio…' : previewPlaying ? 'Parar prévia' : 'Testar voz'}
            </button>
          </div>
          {(!audioAvailable || voiceError) && (
            <p className="bn-note" data-tone="warn" role="status">
              Áudio do rádio indisponível. As instruções continuam na tela.
            </p>
          )}
          {audioAvailable && !voiceError && voiceFallback && (
            <p className="bn-note" data-tone="warn" role="status">
              {`Voz ${radioVoice(voiceUri)?.name ?? ''} indisponível. Tocando com ${radioVoice(DEFAULT_RADIO_VOICE)?.name}.`}
            </p>
          )}

          <hr className="ui-divider" />

          <label className="ui-field">
            <span className="ui-label">Aparelho que toca o rádio</span>
            <select
              className="ui-select"
              value={audioDevice}
              disabled={savingDevice || !serverStatus}
              onChange={(event) => void selectAudioDevice(event.currentTarget.value)}
            >
              <option value="">Cada aparelho controla o próprio som</option>
              <option value={deviceId}>Somente neste aparelho</option>
              {otherDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.name}
                </option>
              ))}
              {audioDevice &&
                !audioHere &&
                !otherDevices.some((device) => device.deviceId === audioDevice) && (
                  <option value={audioDevice}>Aparelho selecionado · desconectado</option>
                )}
            </select>
          </label>
          {!audioHere && (
            <p className="bn-note" data-tone="info">
              Ative o engenheiro no aparelho escolhido para ouvir o rádio.
            </p>
          )}
          {deviceError && (
            <p className="bn-note" data-tone="loss" role="status">
              Não foi possível alterar o aparelho do rádio.
            </p>
          )}
        </div>
      </section>

      <EngineerReference settings={settings} audioHere={audioHere} />
    </div>
  );
}
