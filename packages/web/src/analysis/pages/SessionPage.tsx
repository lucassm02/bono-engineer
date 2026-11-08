/** #/analise/sessao/:id — laps table, selection for comparison, references, downloads, delete. */

import type { Lap } from '@gt7/shared';
import { type ReactNode, useMemo, useState } from 'react';
import { formatLapTime, formatSectorTime } from '../../lib/format.ts';
import { navigate, routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api, urls } from '../api.ts';
import {
  ConfirmButton,
  Empty,
  ErrorBox,
  Loading,
  PageHead,
  Tag,
  useTitle,
} from '../components/ui.tsx';
import {
  carLabel,
  formatDateTime,
  INFO_FLAGS,
  LAP_FLAG_LABELS,
  SESSION_MODE_LABELS,
} from '../lib/labels.ts';
import { formatLapTimeInput, parseLapTime } from '../lib/lapTime.ts';
import { useFetch } from '../useFetch.ts';

const MAX_SELECTED = 3;

/** Best valid sector times of the session (purple), index-aligned. */
export function bestSectors(laps: Lap[]): (number | null)[] {
  const n = Math.max(0, ...laps.map((l) => l.sectorTimesMs.length));
  const out: (number | null)[] = [];
  for (let k = 0; k < n; k++) {
    let best: number | null = null;
    for (const l of laps) {
      const v = l.sectorTimesMs[k];
      if (l.valid && typeof v === 'number' && (best === null || v < best)) best = v;
    }
    out.push(best);
  }
  return out;
}

function ReferenceForm({
  lap,
  onDone,
  onCancel,
}: {
  lap: Lap;
  onDone: (l: Lap) => void;
  onCancel: () => void;
}) {
  const [driver, setDriver] = useState(lap.referenceMeta?.driverName ?? 'Você');
  const [time, setTime] = useState(formatLapTimeInput(lap.referenceMeta?.rankingTimeMs ?? null));
  const [notes, setNotes] = useState(lap.referenceMeta?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rankingMs = time.trim() ? parseLapTime(time) : null;
  return (
    <form
      className="a-inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (time.trim() && rankingMs === null) {
          setErr('Tempo inválido. Use o formato 1:30.960.');
          return;
        }
        setBusy(true);
        try {
          const saved = await api.setReference(lap.id, {
            driverName: driver.trim() || 'Você',
            ...(rankingMs ? { rankingTimeMs: rankingMs } : {}),
            notes: notes.trim() || null,
          });
          onDone(saved);
        } catch (x) {
          setErr((x as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Piloto
        <input value={driver} maxLength={80} onChange={(e) => setDriver(e.target.value)} />
      </label>
      <label>
        Tempo do ranking (opcional)
        <input
          value={time}
          placeholder="1:30.960"
          inputMode="decimal"
          onChange={(e) => setTime(e.target.value)}
          aria-invalid={time.trim() !== '' && rankingMs === null}
        />
      </label>
      <label className="a-grow">
        Notas
        <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="a-actions">
        <button type="submit" className="a-btn" disabled={busy}>
          Salvar referência
        </button>
        <button type="button" className="a-btn a-btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
      {err && <p className="a-form-error">{err}</p>}
    </form>
  );
}

export function SessionPage({ id }: { id: string }) {
  const detail = useFetch(`session:${id}`, () => api.session(id), 10000);
  const trackId = detail.data?.session.trackId ?? null;
  const track = useFetch(trackId ? `track:${trackId}` : null, () => api.track(trackId!));
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  useTitle('Sessão');

  const laps = detail.data?.laps ?? [];
  const best = useMemo(() => bestSectors(laps), [laps]);
  const bestLap = useMemo(
    () =>
      laps
        .filter((l) => l.valid)
        .reduce<Lap | null>((b, l) => (!b || l.timeMs < b.timeMs ? l : b), null),
    [laps],
  );

  if (detail.error && !detail.data)
    return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Loading />;
  const { session, active } = detail.data;

  const toggle = (lapId: string) =>
    setSelected((s) =>
      s.includes(lapId)
        ? s.filter((x) => x !== lapId)
        : s.length >= MAX_SELECTED
          ? s
          : [...s, lapId],
    );

  const replaceLap = (l: Lap) =>
    detail.setData({ ...detail.data!, laps: laps.map((x) => (x.id === l.id ? l : x)) });

  const compareHref =
    selected.length === 0
      ? null
      : routes.compare({
          lap: selected[0]!,
          ref: selected[1] ?? 'auto',
          extra: selected.slice(2),
        });

  const sectorCount = Math.max(0, ...laps.map((l) => l.sectorTimesMs.length));
  const trackLabel = track.data?.name ?? (trackId ? trackId : 'Pista não identificada');

  return (
    <>
      <PageHead
        back={{ href: routes.sessions(), label: 'Sessões' }}
        title={trackLabel}
        sub={
          <>
            {formatDateTime(session.startedAt)} · {carLabel(session.carCode)} ·{' '}
            {SESSION_MODE_LABELS[session.mode]} · formato {session.format} · {session.lapCount}{' '}
            voltas
            {active && (
              <>
                {' '}
                <Tag tone="info">em andamento</Tag>
              </>
            )}
          </>
        }
        actions={
          <>
            <a className="a-btn" href={routes.coach({ session: session.id })}>
              Debrief com IA
            </a>
            {trackId && (
              <a
                className="a-btn a-btn-ghost"
                href={routes.track(trackId, { session: session.id })}
              >
                Consistência e evolução
              </a>
            )}
            {session.recordingFile && (
              <a className="a-btn a-btn-ghost" href={urls.recording(session.id)} download>
                Baixar gravação (.gt7rec)
              </a>
            )}
            <ConfirmButton
              label="Apagar sessão"
              question="Apagar a sessão e todas as voltas?"
              confirmLabel="Apagar"
              disabled={active}
              onConfirm={async () => {
                try {
                  await api.deleteSession(session.id);
                  addNotice('info', 'Sessão apagada.');
                  navigate(routes.sessions());
                } catch (e) {
                  addNotice('error', (e as Error).message, 6000);
                }
              }}
            />
          </>
        }
      />

      <div className="a-selbar" data-active={selected.length > 0 ? '1' : '0'}>
        <span>
          {selected.length === 0
            ? 'Marque de 1 a 3 voltas para comparar (a 1ª é a sua, a 2ª a referência).'
            : `${selected.length} volta(s) marcada(s)${
                selected.length === 1 ? ' — referência automática' : ''
              }`}
        </span>
        {compareHref && (
          <a className="a-btn" href={compareHref}>
            Comparar
          </a>
        )}
        {selected.length > 0 && (
          <button type="button" className="a-btn a-btn-ghost" onClick={() => setSelected([])}>
            Limpar
          </button>
        )}
      </div>

      {laps.length === 0 ? (
        <Empty>Esta sessão ainda não tem voltas completas.</Empty>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table a-laps">
            <thead>
              <tr>
                <th aria-label="Selecionar" />
                <th className="num-col">Volta</th>
                <th className="num-col">Tempo</th>
                {Array.from({ length: sectorCount }, (_, k) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: sector columns
                  <th key={k} className="num-col">
                    S{k + 1}
                  </th>
                ))}
                <th>Situação</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {laps.map((l) => {
                const sel = selected.indexOf(l.id);
                const isBest = bestLap?.id === l.id;
                const badFlags = l.flags.filter((f) => !INFO_FLAGS.has(f));
                const infoFlags = l.flags.filter((f) => INFO_FLAGS.has(f));
                return (
                  <FragmentRows
                    key={l.id}
                    editing={editing === l.id}
                    colSpan={5 + sectorCount}
                    form={
                      <ReferenceForm
                        lap={l}
                        onCancel={() => setEditing(null)}
                        onDone={(saved) => {
                          replaceLap(saved);
                          setEditing(null);
                          addNotice('info', 'Volta marcada como referência.');
                        }}
                      />
                    }
                  >
                    <tr data-selected={sel >= 0 ? '1' : '0'} data-invalid={l.valid ? '0' : '1'}>
                      <td>
                        <label className="a-check">
                          <input
                            type="checkbox"
                            checked={sel >= 0}
                            disabled={sel < 0 && selected.length >= MAX_SELECTED}
                            onChange={() => toggle(l.id)}
                            aria-label={`Selecionar volta ${l.number}`}
                          />
                          {sel >= 0 && <span className="a-check-n">{sel + 1}</span>}
                        </label>
                      </td>
                      <td className="num num-col">{l.number}</td>
                      <td className="num num-col">
                        <span data-best={isBest ? '1' : '0'} className="a-laptime">
                          {formatLapTime(l.timeMs)}
                        </span>
                      </td>
                      {Array.from({ length: sectorCount }, (_, k) => {
                        const v = l.sectorTimesMs[k] ?? null;
                        const purple = l.valid && v !== null && v === best[k];
                        return (
                          // biome-ignore lint/suspicious/noArrayIndexKey: sector columns
                          <td key={k} className="num num-col" data-sector={purple ? 'best' : ''}>
                            {formatSectorTime(v)}
                          </td>
                        );
                      })}
                      <td>
                        {l.valid ? (
                          <Tag tone="sb">válida</Tag>
                        ) : (
                          <Tag
                            tone="bad"
                            title={badFlags.map((f) => LAP_FLAG_LABELS[f]).join(', ')}
                          >
                            inválida
                          </Tag>
                        )}
                        {badFlags.map((f) => (
                          <span key={f} className="a-flag">
                            {LAP_FLAG_LABELS[f]}
                          </span>
                        ))}
                        {infoFlags.map((f) => (
                          <span key={f} className="a-flag a-flag-info">
                            {LAP_FLAG_LABELS[f]}
                          </span>
                        ))}
                        {l.isReference && (
                          <Tag tone="ref" title={l.referenceMeta?.notes ?? undefined}>
                            ref · {l.referenceMeta?.driverName ?? 'referência'}
                            {l.referenceMeta?.rankingTimeMs
                              ? ` (${formatLapTime(l.referenceMeta.rankingTimeMs)})`
                              : ''}
                          </Tag>
                        )}
                      </td>
                      <td>
                        <div className="a-row-actions">
                          <a
                            className="a-btn a-btn-sm"
                            href={routes.compare({ lap: l.id, ref: 'auto' })}
                          >
                            Comparar
                          </a>
                          {l.isReference ? (
                            <ConfirmButton
                              className="a-btn a-btn-ghost a-btn-sm"
                              label="Tirar referência"
                              question="Deixar de ser referência?"
                              confirmLabel="Sim"
                              onConfirm={async () => {
                                try {
                                  replaceLap(await api.unsetReference(l.id));
                                } catch (e) {
                                  addNotice('error', (e as Error).message, 6000);
                                }
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="a-btn a-btn-ghost a-btn-sm"
                              onClick={() => setEditing(l.id)}
                            >
                              Marcar referência
                            </button>
                          )}
                          <details className="a-menu">
                            <summary className="a-btn a-btn-ghost a-btn-sm">Mais</summary>
                            <div className="a-menu-body">
                              <a href={urls.lapCsv(l.id)} download>
                                Baixar CSV
                              </a>
                              <a href={urls.lapTrace(l.id)} download>
                                Baixar trace (JSON)
                              </a>
                              <a href={routes.coach({ session: session.id, lap: l.id })}>
                                Debrief desta volta
                              </a>
                              <ConfirmButton
                                className="a-btn a-btn-danger a-btn-sm"
                                label="Apagar volta"
                                question="Apagar esta volta?"
                                confirmLabel="Apagar"
                                onConfirm={async () => {
                                  try {
                                    await api.deleteLap(l.id);
                                    setSelected((s) => s.filter((x) => x !== l.id));
                                    detail.reload();
                                  } catch (e) {
                                    addNotice('error', (e as Error).message, 6000);
                                  }
                                }}
                              />
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  </FragmentRows>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="dim a-small a-mt">
        Roxo = melhor setor da sessão (voltas válidas). Voltas de replay e com tempo divergente só
        são marcadas, não invalidadas.
      </p>
    </>
  );
}

function FragmentRows({
  children,
  editing,
  form,
  colSpan,
}: {
  children: ReactNode;
  editing: boolean;
  form: ReactNode;
  colSpan: number;
}) {
  return (
    <>
      {children}
      {editing && (
        <tr className="a-form-row">
          <td colSpan={colSpan}>{form}</td>
        </tr>
      )}
    </>
  );
}
