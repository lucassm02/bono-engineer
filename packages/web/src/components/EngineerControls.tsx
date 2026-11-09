import { useEffect, useState } from 'react';
import { api } from '../analysis/api.ts';
import { useFetch } from '../analysis/useFetch.ts';
import { RADIO_VOICES, radioPack } from '../lib/engineerClips.ts';
import { portugueseVoices, speechSupported } from '../lib/speech.ts';
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

export function EngineerControls() {
  const enabled = useEngineer((s) => s.enabled);
  const controls = useEngineer((s) => s.controls);
  const muted = useEngineer((s) => s.muted);
  const voiceError = useEngineer((s) => s.voiceError);
  const voiceLoading = useEngineer((s) => s.voiceLoading);
  const previewPlaying = useEngineer((s) => s.previewPlaying);
  const voiceUri = useEngineer((s) => s.voiceUri);
  const pace = useEngineer((s) => s.pace);
  const canSpeak = speechSupported();
  const canPlay = typeof AudioContext !== 'undefined';
  const selectedPack = radioPack(voiceUri);
  const audioAvailable = selectedPack ? canPlay : canSpeak;
  const [voices, setVoices] = useState(portugueseVoices);
  useEffect(() => {
    if (!canSpeak) return;
    const synth = window.speechSynthesis;
    const refresh = () => setVoices(portugueseVoices());
    synth.addEventListener('voiceschanged', refresh);
    refresh();
    return () => synth.removeEventListener('voiceschanged', refresh);
  }, [canSpeak]);
  const deviceId = useUi((s) => s.profile.deviceId);
  const serverStatus = useUi((s) => s.serverStatus);
  const [deviceError, setDeviceError] = useState(false);
  const [savingDevice, setSavingDevice] = useState(false);
  const settings = useFetch('engineer-reference', api.settings);
  const audioDevice = serverStatus?.engineerAudioDeviceId ?? '';
  const audioHere = !audioDevice || audioDevice === deviceId;
  const otherDevices = serverStatus?.devices.filter((device) => device.deviceId !== deviceId) ?? [];

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
      <p>Instruções de pilotagem em voz e na tela, a partir da sua referência.</p>
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
          Nível de detalhe
          <select
            value={controls.detail}
            onChange={(event) =>
              setRadioControls({
                detail: event.currentTarget.value === 'essential' ? 'essential' : 'full',
              })
            }
          >
            <option value="essential">Essencial · frenagens principais</option>
            <option value="full">Completo · todas as dicas</option>
          </select>
        </label>
      </div>
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
            disabled={!canSpeak && !canPlay}
            value={
              selectedPack || voices.some((voice) => voice.voiceURI === voiceUri) ? voiceUri : ''
            }
            onChange={(event) => setEngineerVoice(event.currentTarget.value, pace)}
          >
            <optgroup label="Clipes em pt-BR" disabled={!canPlay}>
              {RADIO_VOICES.map((voice) => (
                <option key={voice.value} value={voice.value}>
                  {voice.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Vozes do dispositivo" disabled={!canSpeak}>
              <option value="">Automática (português)</option>
              {voices.map((voice) => (
                <option value={voice.voiceURI} key={voice.voiceURI}>
                  {`${voice.name.replace(/\s+-\s+Portuguese(?:\s+\([^)]*\))?$/i, '')} · ${voice.lang}`}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {!selectedPack && (
          <label>
            Ritmo da fala
            <select
              disabled={!canSpeak}
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
        )}
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
        <p role="status">Voz indisponível neste aparelho. As instruções aparecem na tela.</p>
      )}
      <EngineerReference settings={settings} audioHere={audioHere} />
    </section>
  );
}
