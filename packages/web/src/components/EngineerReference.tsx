import {
  type ApiSettings,
  carName,
  DELTA_REFERENCE_KINDS,
  type DeltaReferenceKind,
} from '@gt7/shared';
import { useState } from 'react';
import { api } from '../analysis/api.ts';
import { type FetchState, useFetch } from '../analysis/useFetch.ts';
import { formatLapTime } from '../lib/format.ts';
import { DELTA_REFERENCE_LABELS } from '../lib/labels.ts';
import { live } from '../live/liveStore.ts';
import { useLiveRender } from '../live/raf.ts';
import { dispatchProfile } from '../state/actions.ts';
import { useUi } from '../state/uiStore.ts';
import { EngineerTraining } from './EngineerTraining.tsx';

export function EngineerReference({
  settings,
  audioHere,
}: {
  settings: FetchState<ApiSettings>;
  audioHere: boolean;
}) {
  const profileKind = useUi((s) => s.profile.deltaReference);
  const [trackId, setTrackId] = useState(() => live.frame?.track?.id ?? null);
  const [car, setCar] = useState(() => live.frame?.car.carCode ?? 0);
  const [liveRef, setLiveRef] = useState(() => live.frame?.lap.delta.referenceLapId ?? null);
  const [liveRefKind, setLiveRefKind] = useState(() => live.frame?.lap.delta.reference ?? null);
  const [sendError, setSendError] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = settings.data?.deltaReference;
  useLiveRender((frame) => {
    setTrackId(frame.track?.id ?? null);
    setCar(frame.car.carCode);
    setLiveRef(frame.lap.delta.referenceLapId);
    setLiveRefKind(frame.lap.delta.reference);
  });
  const track = useFetch(trackId ? `engineer-track:${trackId}` : null, () => api.track(trackId!));
  const { data, error } = useFetch(trackId && car > 0 ? `refs:${trackId}|${car}` : null, () =>
    api.trackLaps(trackId!, { carCode: car, references: 'only', validOnly: true, orderBy: 'time' }),
  );
  const laps = (data ?? []).filter((lap) => lap.trackId === trackId && lap.carCode === car);
  const selectedId = current?.lapId;
  const refId = selectedId ?? (current?.kind === liveRefKind ? liveRef : null);
  const reference = useFetch(refId ? `engineer-lap:${refId}` : null, () => api.lap(refId!));
  const ref = reference.data?.id === refId ? reference.data : null;
  const refTrackId = ref?.trackId;
  const refTrack = useFetch(
    refTrackId && refTrackId !== trackId ? `engineer-ref-track:${refTrackId}` : null,
    () => api.track(refTrackId!),
  );
  const description =
    refTrackId === trackId ? track.data : refTrack.data?.id === refTrackId ? refTrack.data : null;
  const compatible =
    !!ref && ref.valid && !!trackId && ref.trackId === trackId && car > 0 && ref.carCode === car;
  const needsFallback =
    (!!ref && (!ref.valid || (!!trackId && car > 0 && !compatible))) ||
    (!!selectedId && !!reference.error);
  const best = useFetch(
    needsFallback && trackId && car > 0 ? `engineer-best:${trackId}|${car}` : null,
    () =>
      api.trackLaps(trackId!, {
        carCode: car,
        references: 'exclude',
        validOnly: true,
        orderBy: 'time',
        limit: 1,
      }),
  );
  const personal = best.data?.find((lap) => lap.trackId === trackId && lap.carCode === car);

  async function selectReference(value: string): Promise<boolean> {
    const lapId = value.startsWith('lap:') ? value.slice(4) : null;
    const kind = lapId ? 'reference' : (value as DeltaReferenceKind);
    setSaving(true);
    setSendError(false);
    try {
      const updated = await api.patchSettings({ deltaReference: { kind, lapId } });
      settings.setData(updated);
      dispatchProfile({ type: 'setDeltaReference', kind });
      return true;
    } catch {
      setSendError(true);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <label>
        Volta de referência do painel
        <select
          value={selectedId ? `lap:${selectedId}` : (current?.kind ?? profileKind)}
          disabled={saving || settings.loading}
          onChange={(event) => void selectReference(event.currentTarget.value)}
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
              {lap.referenceMeta?.driverName ?? 'Referência'} · {formatLapTime(lap.timeMs)}
            </option>
          ))}
        </select>
      </label>
      {ref && (
        <div className="engineer-reference-info">
          <strong>
            {formatLapTime(ref.timeMs)} · {ref.referenceMeta?.driverName ?? 'Volta própria'}
          </strong>
          <p>
            {ref.referenceMeta?.carName || carName(ref.carCode) || `Carro #${ref.carCode}`} ·{' '}
            {description?.name ?? 'Traçado indisponível'}
            {description?.layout && ` · ${description.layout}`}
          </p>
          <p>
            {ref.flags.includes('replay')
              ? 'Captura de replay'
              : ref.referenceMeta?.source === 'import'
                ? 'Volta importada'
                : 'Telemetria de pilotagem'}
          </p>
        </div>
      )}
      {needsFallback && (
        <div role="status">
          <p>A referência não está disponível para este carro e traçado.</p>
          {personal && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => void selectReference('personalBest')}
            >
              Usar melhor pessoal · {formatLapTime(personal.timeMs)}
            </button>
          )}
        </div>
      )}
      {!refId && !needsFallback && (
        <p>
          O painel mostra os detalhes assim que encontrar a volta para o carro e traçado atuais.
        </p>
      )}
      {(sendError || error) && (
        <p role="status">
          {sendError
            ? 'Não foi possível trocar a referência.'
            : 'Não foi possível listar as referências salvas.'}
        </p>
      )}
      <EngineerTraining
        key={trackId ?? ''}
        track={track.data?.id === trackId ? track.data : null}
        reference={compatible ? ref : null}
        audioHere={audioHere}
        pin={selectReference}
      />
    </>
  );
}
