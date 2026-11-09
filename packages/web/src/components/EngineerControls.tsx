import { DELTA_REFERENCE_KINDS, type DeltaReferenceKind } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { api } from '../analysis/api.ts';
import { useFetch } from '../analysis/useFetch.ts';
import { RADIO_VOICES, radioPack } from '../lib/engineerClips.ts';
import { formatLapTime } from '../lib/format.ts';
import { DELTA_REFERENCE_LABELS } from '../lib/labels.ts';
import { portugueseVoices, speechSupported } from '../lib/speech.ts';
import { live } from '../live/liveStore.ts';
import { useLiveRender } from '../live/raf.ts';
import { dispatchProfile } from '../state/actions.ts';
import {
  type EngineerPace,
  setEngineerEnabled,
  setEngineerMuted,
  setEngineerVoice,
  stopEngineerPreview,
  testEngineerVoice,
  useEngineer,
} from '../state/engineer.ts';
import { useUi } from '../state/uiStore.ts';

export function EngineerControls() {
  const enabled = useEngineer((s) => s.enabled);
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
  const profileKind = useUi((s) => s.profile.deltaReference);
  const [track, setTrack] = useState(() => live.frame?.track?.id ?? null);
  const [car, setCar] = useState(() => live.frame?.car.carCode ?? 0);
  const [sendError, setSendError] = useState(false);
  const [saving, setSaving] = useState(false);
  const settings = useFetch('engineer-reference', api.settings);
  const current = settings.data?.deltaReference;
  useLiveRender((frame) => {
    setTrack(frame.track?.id ?? null);
    setCar(frame.car.carCode);
  });
  const { data, error } = useFetch(track && car > 0 ? `${track}|${car}` : null, () =>
    api.trackLaps(track!, { carCode: car, references: 'only', validOnly: true, orderBy: 'time' }),
  );
  const laps = (data ?? []).filter((lap) => lap.trackId === track && lap.carCode === car);
  const selectedId = current?.lapId;

  async function selectReference(value: string) {
    const lapId = value.startsWith('lap:') ? value.slice(4) : null;
    const kind = lapId ? 'reference' : (value as DeltaReferenceKind);
    setSaving(true);
    setSendError(false);
    try {
      const updated = await api.patchSettings({ deltaReference: { kind, lapId } });
      settings.setData(updated);
      dispatchProfile({ type: 'setDeltaReference', kind });
    } catch {
      setSendError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="engineer-controls" aria-labelledby="engineer-controls-title">
      <header>
        <h3 id="engineer-controls-title">Engenheiro ao vivo</h3>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setEngineerEnabled(!enabled)}
        >
          {enabled ? 'Desativar' : 'Ativar'}
        </button>
      </header>
      <p>Instruções de pilotagem em voz e na tela, a partir da sua referência.</p>
      <label>
        Volta de referência do painel
        <select
          value={selectedId ? `lap:${selectedId}` : (current?.kind ?? profileKind)}
          disabled={saving || settings.loading}
          onChange={(event) => selectReference(event.currentTarget.value)}
        >
          {DELTA_REFERENCE_KINDS.map((kind) => (
            <option value={kind} key={kind}>
              {DELTA_REFERENCE_LABELS[kind]}
            </option>
          ))}
          {selectedId && !laps.some((lap) => lap.id === selectedId) && (
            <option value={`lap:${selectedId}`}>Volta selecionada anteriormente</option>
          )}
          {laps.map((lap) => (
            <option value={`lap:${lap.id}`} key={lap.id}>
              {`${lap.referenceMeta?.driverName ?? 'Referência'} · ${formatLapTime(lap.timeMs)}`}
            </option>
          ))}
        </select>
      </label>
      {(sendError || error) && (
        <p role="status">
          {sendError
            ? 'Não foi possível trocar a referência.'
            : 'Não foi possível listar as referências salvas.'}
        </p>
      )}
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
          onClick={() => setEngineerMuted(!muted)}
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
    </section>
  );
}
