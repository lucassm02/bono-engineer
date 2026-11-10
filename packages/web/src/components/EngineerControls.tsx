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

const pickOption = <T extends string>(values: readonly T[], value: string, fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback;

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
    <section className="engineer-controls" aria-labelledby="engineer-controls-title">
      <header>
        <h3 id="engineer-controls-title">Engenheiro ao vivo</h3>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setEngineerEnabled(!enabled, audioHere)}
        >
          {enabled ? 'Desativar' : 'Ativar'}
        </button>
      </header>
      <p>Instruções em voz e na tela. Quando tudo corre bem, o rádio fica em silêncio.</p>
      <div className="engineer-voice-options">
        <label>
          Modo
          <select
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
          <label>
            Perfil do treino
            <select
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
      <p className="engineer-controls-hint">{RADIO_MODE_HINTS[controls.mode]}</p>
      {controls.mode === 'training' && controls.trainingProfile === 'learnTrack' && (
        <label>
          Instruções de freada
          <select
            value={controls.learningBrakePercent ? 'detailed' : 'basic'}
            onChange={(event) =>
              setRadioControls({ learningBrakePercent: event.currentTarget.value === 'detailed' })
            }
          >
            <option value="basic">Básicas · freada leve, forte ou normal</option>
            <option value="detailed">Detalhadas · percentual do pedal</option>
          </select>
        </label>
      )}
      {controls.mode === 'training' && consistency && (
        <label>
          Meta por volta em segundos
          <input
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
                  consistencyTargetMs: field.value ? Math.round(field.valueAsNumber * 1000) : null,
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
      <label>
        Volume do rádio · {Math.round(controls.volume * 100)}%
        <input
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
      <div className="engineer-voice-options">
        <label>
          Antecipação
          <select
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
        <label>
          Nível de fala
          <select
            value={muted ? 'mute' : controls.level}
            onChange={(event) => selectSpeechLevel(event.currentTarget.value)}
          >
            <option value="essential">{SPEECH_LEVEL_LABELS.essential}</option>
            <option value="detailed">{SPEECH_LEVEL_LABELS.detailed}</option>
            <option value="mute">{SPEECH_LEVEL_LABELS.mute}</option>
          </select>
        </label>
      </div>
      {controls.mode === 'training' && controls.trainingProfile !== 'free' && (
        <div className="engineer-voice-options">
          <label>
            Resumo do treino
            <select
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
          {!consistency && (
            <label className="engineer-controls-check">
              <input
                type="checkbox"
                checked={controls.praise}
                onChange={(event) => setRadioControls({ praise: event.currentTarget.checked })}
              />
              Reforço positivo
            </label>
          )}
        </div>
      )}
      <label>
        Aparelho que toca o rádio
        <select
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
      {!audioHere && <p>Ative o engenheiro no aparelho escolhido para ouvir o rádio.</p>}
      {deviceError && <p role="status">Não foi possível alterar o aparelho do rádio.</p>}
      <div className="engineer-voice-options">
        <label>
          Voz do rádio
          <select
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
        <label>
          Ritmo da fala
          <select
            disabled={!audioAvailable}
            value={pace}
            onChange={(event) =>
              setEngineerVoice(voiceUri, event.currentTarget.value as EngineerPace)
            }
          >
            <option value="calma">Calmo</option>
            <option value="normal">Normal</option>
            <option value="rapida">Rápido</option>
          </select>
        </label>
      </div>
      <div className="engineer-controls-audio">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!audioAvailable}
          onClick={() => setEngineerMuted(!muted, audioHere)}
        >
          {muted ? 'Ativar som' : 'Silenciar'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!audioAvailable || voiceLoading}
          onClick={() => (previewPlaying ? stopEngineerPreview() : testEngineerVoice())}
        >
          {voiceLoading ? 'Preparando áudio…' : previewPlaying ? 'Parar prévia' : 'Testar voz'}
        </button>
      </div>
      {(!audioAvailable || voiceError) && (
        <p role="status">Áudio do rádio indisponível. As instruções continuam na tela.</p>
      )}
      {audioAvailable && !voiceError && voiceFallback && (
        <p role="status">
          {`Voz ${radioVoice(voiceUri)?.name ?? ''} indisponível. Tocando com ${radioVoice(DEFAULT_RADIO_VOICE)?.name}.`}
        </p>
      )}
      <EngineerReference settings={settings} audioHere={audioHere} />
    </section>
  );
}
