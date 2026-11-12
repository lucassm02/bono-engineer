/**
 * "Voltas de referência gravadas": every saved reference lap grouped by track, with driver, car, time,
 * where the time comes from and the date. Rename (driver / car / notes) in place, compare with
 * your best lap and delete with a two-step confirmation.
 */

import {
  DEFAULT_REPLAY_DRIVER,
  type Lap,
  makerOfCar,
  type ReferenceMeta,
  type Track,
} from '@gt7/shared';
import { useEffect, useMemo, useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { getLanguage, t as uiText } from '../../lib/i18n.ts';
import { routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import {
  carDisplayName,
  groupReferences,
  parseCarChoice,
  resolvedCarName,
  timeOriginLabel,
} from '../lib/captureForm.ts';
import { BrandLogo } from './BrandLogo.tsx';
import { CarSelect } from './CarSelect.tsx';
import { Card, ConfirmButton, Empty, ErrorBox, Loading, Tag } from './ui.tsx';

const whenText = (ms: number) =>
  new Date(ms).toLocaleString(getLanguage(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Logo + the name saved with the reference (or the catalogue name of the lap's car). */
function RefCar({ lap }: { lap: Lap }) {
  const maker = makerOfCar(lap.carCode);
  const text = lap.referenceMeta?.carName || carDisplayName(lap.carCode);
  return (
    <span className="carname" title={text}>
      {maker && <BrandLogo maker={maker} size={22} className="carname-logo" />}
      <span className="carname-text">{text}</span>
    </span>
  );
}

function RefEditor({
  lap,
  drivers,
  onDone,
}: {
  lap: Lap;
  drivers: readonly string[];
  onDone: (saved: Lap | null) => void;
}) {
  const meta = lap.referenceMeta as ReferenceMeta;
  const [driver, setDriver] = useState(meta.driverName);
  const [car, setCar] = useState('keep');
  const [notes, setNotes] = useState(meta.notes ?? '');
  const [busy, setBusy] = useState(false);
  const current = meta.carName || carDisplayName(lap.carCode);
  const id = `ref-edit-${lap.id}`;

  const save = async () => {
    setBusy(true);
    try {
      const choice = car === 'keep' ? 'keep' : car === 'none' ? 'none' : parseCarChoice(car);
      const body: { driverName: string; notes: string | null; carName?: string | null } = {
        driverName: driver.trim() || DEFAULT_REPLAY_DRIVER,
        notes: notes.trim() || null,
      };
      if (choice === 'none') body.carName = null;
      else if (typeof choice === 'number') body.carName = resolvedCarName(choice) ?? current;
      const saved = await api.setReference(lap.id, body);
      addNotice('info', uiText('Referência atualizada.'));
      onDone(saved);
    } catch (e) {
      addNotice('error', (e as Error).message, 6000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="cap-edit"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="cap-field" htmlFor={`${id}-driver`}>
        {uiText('Piloto')}
        <input
          id={`${id}-driver`}
          className="a-input"
          list="cap-drivers"
          value={driver}
          maxLength={80}
          autoComplete="off"
          onChange={(e) => setDriver(e.target.value)}
        />
      </label>
      <label className="cap-field" htmlFor={`${id}-car`}>
        {uiText('Carro')}
        <CarSelect
          id={`${id}-car`}
          value={car}
          onChange={setCar}
          lead={[
            { value: 'keep', label: uiText('Manter: {0}', current) },
            { value: 'none', label: uiText('Sem nome de carro') },
          ]}
        />
      </label>
      <label className="cap-field" htmlFor={`${id}-notes`}>
        {uiText('Notas')}
        <textarea
          id={`${id}-notes`}
          className="a-input"
          rows={2}
          maxLength={500}
          value={notes}
          placeholder={uiText('acerto, pneus, condições…')}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <datalist id="cap-drivers">
        {drivers.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <div className="a-actions">
        <button type="submit" className="a-btn cap-btn" disabled={busy}>
          {uiText('Salvar')}
        </button>
        <button
          type="button"
          className="a-btn a-btn-ghost cap-btn"
          disabled={busy}
          onClick={() => onDone(null)}
        >
          {uiText('Cancelar')}
        </button>
      </div>
    </form>
  );
}

export function ReferenceList({
  refs,
  error,
  loading,
  tracks,
  drivers,
  onReload,
}: {
  refs: readonly Lap[] | null;
  error: Error | null;
  loading: boolean;
  tracks: readonly Track[];
  drivers: readonly string[];
  onReload: () => void;
}) {
  const groups = useMemo(() => groupReferences(refs ?? [], tracks), [refs, tracks]);
  const [editing, setEditing] = useState<string | null>(null);
  // Your own laps per track (to offer "Comparar com o meu melhor"), loaded once per track.
  const [mine, setMine] = useState<Record<string, Lap[]>>({});

  const trackKey = groups.map((g) => g.trackId).join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: trackKey identifies the set of tracks
  useEffect(() => {
    let alive = true;
    for (const g of groups) {
      if (!g.trackId) continue;
      api
        .trackLaps(g.trackId, {
          references: 'exclude',
          validOnly: true,
          orderBy: 'time',
          limit: 60,
        })
        .then((l) => alive && setMine((m) => ({ ...m, [g.trackId]: l })))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [trackKey]);

  const bestOf = (lap: Lap): Lap | null => {
    const ls = (lap.trackId ? mine[lap.trackId] : undefined)?.filter(
      (l) => !l.flags.includes('replay'),
    );
    return ls?.find((l) => l.carCode === lap.carCode) ?? null;
  };

  return (
    <Card title={uiText('Voltas de referência gravadas')} className="cap-refs" id="referencias">
      {error && !refs ? (
        <ErrorBox error={error} onRetry={onReload} compact />
      ) : !refs ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Empty>
          {uiText(
            'Nenhuma volta de referência ainda. Grave a volta de um replay acima e ela aparece aqui.',
          )}
        </Empty>
      ) : (
        <>
          <p className="dim a-small cap-refs-intro">
            {uiText('O delta ao vivo usa a volta mais rápida de cada carro na pista (marcada com')}{' '}
            <Tag tone="ref">delta</Tag>). {loading ? uiText('Atualizando…') : ''}
          </p>
          {groups.map((g) => (
            <section key={g.trackId || 'sem-pista'} className="cap-group">
              <h3>
                {g.trackName}
                {g.layout ? <span className="dim"> — {g.layout}</span> : null}
              </h3>
              <ul className="cap-reflist">
                {g.laps.map((lap) => {
                  const meta = lap.referenceMeta as ReferenceMeta;
                  const myBest = bestOf(lap);
                  return (
                    <li
                      key={lap.id}
                      className="cap-ref"
                      data-editing={editing === lap.id || undefined}
                    >
                      <div className="cap-ref-main">
                        <span className="cap-ref-time num">{formatLapTime(lap.timeMs)}</span>
                        <div className="cap-ref-who">
                          <strong>{meta.driverName}</strong>
                          {g.deltaIds.has(lap.id) && <Tag tone="ref">delta</Tag>}
                          <RefCar lap={lap} />
                        </div>
                      </div>
                      <p className="dim a-small cap-ref-meta">
                        {`${uiText('Tempo:')} `}
                        {timeOriginLabel(meta)} · {whenText(meta.capturedAt)}
                        {meta.notes ? ` · ${meta.notes}` : ''}
                      </p>
                      {editing === lap.id ? (
                        <RefEditor
                          lap={lap}
                          drivers={drivers}
                          onDone={(saved) => {
                            setEditing(null);
                            if (saved) onReload();
                          }}
                        />
                      ) : (
                        <div className="a-actions cap-ref-actions">
                          {myBest ? (
                            <a
                              className="a-btn a-btn-ghost cap-btn"
                              href={routes.compare({ lap: myBest.id, ref: lap.id })}
                            >
                              {uiText('Comparar com o meu melhor')}
                            </a>
                          ) : (
                            <span className="dim a-small">
                              {uiText(
                                'Sem volta sua válida com este carro nesta pista para comparar.',
                              )}
                            </span>
                          )}
                          <button
                            type="button"
                            className="a-btn a-btn-ghost cap-btn"
                            onClick={() => setEditing(lap.id)}
                          >
                            {uiText('Renomear')}
                          </button>
                          <ConfirmButton
                            className="a-btn a-btn-danger cap-btn"
                            label={uiText('Excluir')}
                            question={uiText('Excluir esta volta?')}
                            confirmLabel={uiText('Sim, excluir')}
                            onConfirm={async () => {
                              try {
                                await api.deleteLap(lap.id);
                                addNotice('info', uiText('Referência excluída.'));
                                onReload();
                              } catch (e) {
                                addNotice('error', (e as Error).message, 6000);
                              }
                            }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </Card>
  );
}
