/**
 * #/analysis/session/:id — session summary, laps table (invalid / out / in laps marked), quick
 * actions per lap (compare with my best, set as reference, delete), downloads and delete session.
 */

import type { Lap } from '@gt7/shared';
import { type ReactNode, useMemo, useState } from 'react';
import { Icon } from '../../components/ui/Icon.tsx';
import { humanizeError } from '../../lib/copy.ts';
import { formatDelta, formatLapTime, formatSectorTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { navigate, routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api, urls } from '../api.ts';
import { CarName } from '../components/CarName.tsx';
import { LapQuickActions } from '../components/LapActions.tsx';
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
  dayHeading,
  dayKey,
  formatClock,
  formatDuration,
  fullTrackName,
  plural,
} from '../lib/history.ts';
import { formatDateTime, INFO_FLAGS, LAP_FLAG_LABELS } from '../lib/labels.ts';
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
  const [driver, setDriver] = useState(lap.referenceMeta?.driverName ?? uiText('Você'));
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
          setErr(uiText('Tempo inválido. Use o formato 1:30.960.'));
          return;
        }
        setBusy(true);
        try {
          const saved = await api.setReference(lap.id, {
            driverName: driver.trim() || uiText('Você'),
            ...(rankingMs ? { rankingTimeMs: rankingMs } : {}),
            notes: notes.trim() || null,
          });
          onDone(saved);
        } catch (x) {
          setErr(humanizeError(x).text);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {uiText('Piloto')}
        <input
          className="a-input"
          value={driver}
          maxLength={80}
          onChange={(e) => setDriver(e.target.value)}
        />
      </label>
      <label>
        {uiText('Tempo do ranking (opcional)')}
        <input
          className="a-input"
          value={time}
          placeholder="1:30.960"
          inputMode="decimal"
          onChange={(e) => setTime(e.target.value)}
          aria-invalid={time.trim() !== '' && rankingMs === null}
        />
      </label>
      <label className="a-grow">
        {uiText('Notas')}
        <input
          className="a-input"
          value={notes}
          maxLength={500}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="a-actions">
        <button type="submit" className="a-btn" disabled={busy}>
          {uiText('Salvar referência')}
        </button>
        <button type="button" className="a-btn a-btn-ghost" onClick={onCancel}>
          {uiText('Cancelar')}
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
  const carCode = detail.data?.session.carCode;
  const pb = useFetch(
    trackId && carCode !== undefined ? `pb:${trackId}:${carCode}` : null,
    async () => {
      const list = await api.trackLaps(trackId!, {
        carCode: carCode!,
        validOnly: true,
        references: 'exclude',
        orderBy: 'time',
        limit: 5,
      });
      return list.find((l) => !l.flags.includes('replay')) ?? null;
    },
  );
  const refs = useFetch(trackId ? `refs:${trackId}` : null, () => api.references(trackId!));
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  useTitle(uiText('Sessão'));

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
  const idealMs =
    sectorCount > 1 && best.length === sectorCount && best.every((v): v is number => v !== null)
      ? best.reduce((a, b) => a + b, 0)
      : null;
  const trackLabel = track.data
    ? fullTrackName(track.data)
    : trackId
      ? uiText('Pista')
      : uiText('Pista não identificada');

  return (
    <>
      <PageHead
        back={
          trackId
            ? { href: routes.track(trackId, { tab: 'sessions' }), label: trackLabel }
            : { href: routes.home(), label: uiText('Suas pistas') }
        }
        title={trackId ? <a href={routes.track(trackId)}>{trackLabel}</a> : trackLabel}
        sub={
          <>
            {dayHeading(dayKey(session.startedAt))}, {formatClock(session.startedAt)} ·{' '}
            <CarName carCode={session.carCode} logoSize={22} />
            {session.mode === 'replayCapture' && (
              <Tag tone="ref">{uiText('captura de replay')}</Tag>
            )}
            {active && <Tag tone="info">{uiText('em andamento')}</Tag>}
          </>
        }
        actions={
          <>
            <a className="a-btn" href={routes.summary(session.id)}>
              {uiText('Resumo da sessão')}
            </a>
            <a className="a-btn" href={routes.coach({ session: session.id })}>
              <Icon name="coach" size={18} />
              {uiText('Debrief com IA')}
            </a>
            {trackId && (
              <a
                className="a-btn a-btn-ghost"
                href={routes.track(trackId, { session: session.id })}
              >
                {uiText('Consistência e evolução')}
              </a>
            )}
            {session.recordingFile && (
              <a className="a-btn a-btn-ghost" href={urls.recording(session.id)} download>
                {uiText('Baixar gravação (.gt7rec)')}
              </a>
            )}
            <ConfirmButton
              label={uiText('Apagar sessão')}
              question={uiText('Apagar a sessão e todas as voltas?')}
              confirmLabel={uiText('Apagar')}
              disabled={active}
              onConfirm={async () => {
                try {
                  await api.deleteSession(session.id);
                  addNotice('info', uiText('Sessão apagada.'));
                  navigate(trackId ? routes.track(trackId, { tab: 'sessions' }) : routes.home());
                } catch (e) {
                  addNotice('error', (e as Error).message, 6000);
                }
              }}
            />
          </>
        }
      />

      <div className="a-stats a-session-stats">
        <div className="a-stat">
          <span className="a-stat-k">{uiText('Voltas')}</span>
          <span className="a-stat-v num">{laps.length}</span>
          <span className="a-stat-s">
            {plural(laps.filter((l) => l.valid).length, uiText('válida'), uiText('válidas'))}
          </span>
        </div>
        <div className="a-stat" data-emph={bestLap ? '1' : undefined}>
          <span className="a-stat-k">{uiText('Melhor volta')}</span>
          <span className="a-stat-v num">{bestLap ? formatLapTime(bestLap.timeMs) : '–'}</span>
          {bestLap && (
            <span className="a-stat-s">
              {`${uiText('volta')} `}
              {bestLap.number}
            </span>
          )}
        </div>
        {idealMs !== null && bestLap && (
          <div className="a-stat" data-emph="ideal">
            <span className="a-stat-k">{uiText('Volta ideal')}</span>
            <span className="a-stat-v num">{formatLapTime(idealMs)}</span>
            <span className="a-stat-s" title={uiText('Soma dos melhores setores da sessão')}>
              {formatDelta(idealMs - bestLap.timeMs)}
              {` ${uiText('vs melhor')}`}
            </span>
          </div>
        )}
        <div className="a-stat">
          <span className="a-stat-k">{uiText('Duração')}</span>
          <span className="a-stat-v num">
            {formatDuration(session.startedAt, session.endedAt) ?? '–'}
          </span>
        </div>
        <div className="a-stat">
          <span className="a-stat-k">{uiText('Início')}</span>
          <span className="a-stat-v num">{formatDateTime(session.startedAt)}</span>
        </div>
      </div>

      <div className="a-selbar" data-active={selected.length > 0 ? '1' : '0'}>
        <span>
          {selected.length === 0
            ? uiText('Marque de 1 a 3 voltas para comparar (a 1ª é a sua, a 2ª a referência).')
            : uiText(
                '{0} volta(s) marcada(s){1}',
                selected.length,
                selected.length === 1 ? uiText(' — referência automática') : '',
              )}
        </span>
        {compareHref && (
          <a className="a-btn" href={compareHref}>
            {uiText('Comparar')}
          </a>
        )}
        {selected.length > 0 && (
          <button type="button" className="a-btn a-btn-ghost" onClick={() => setSelected([])}>
            {uiText('Limpar')}
          </button>
        )}
      </div>

      {laps.length === 0 ? (
        <Empty action={{ label: uiText('Abrir a tela ao vivo'), href: routes.live() }}>
          {uiText('Esta sessão ainda não tem voltas completas.')}
        </Empty>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table a-laps a-table-cards">
            <thead>
              <tr>
                <th aria-label={uiText('Selecionar')} />
                <th className="num-col">{uiText('Volta')}</th>
                <th className="num-col">{uiText('Tempo')}</th>
                {Array.from({ length: sectorCount }, (_, k) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: sector columns
                  <th key={k} className="num-col">
                    S{k + 1}
                  </th>
                ))}
                <th>{uiText('Situação')}</th>
                <th>{uiText('Ações')}</th>
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
                          addNotice('info', uiText('Volta marcada como referência.'));
                        }}
                      />
                    }
                  >
                    <tr
                      data-selected={sel >= 0 ? '1' : '0'}
                      data-invalid={l.valid ? '0' : '1'}
                      data-best={isBest ? '1' : '0'}
                    >
                      <td>
                        <label className="a-check">
                          <input
                            type="checkbox"
                            checked={sel >= 0}
                            disabled={sel < 0 && selected.length >= MAX_SELECTED}
                            onChange={() => toggle(l.id)}
                            aria-label={uiText('Selecionar volta {0}', l.number)}
                          />
                          {sel >= 0 && <span className="a-check-n">{sel + 1}</span>}
                        </label>
                      </td>
                      <td className="num num-col a-lap-n" data-label="Volta">
                        {l.number}
                      </td>
                      <td className="num num-col">
                        <span data-best={isBest ? '1' : '0'} className="a-laptime">
                          {formatLapTime(l.timeMs)}
                        </span>
                      </td>
                      {Array.from({ length: sectorCount }, (_, k) => {
                        const v = l.sectorTimesMs[k] ?? null;
                        const purple = l.valid && v !== null && v === best[k];
                        const sectorKey = `S${k + 1}`;
                        return (
                          <td
                            key={sectorKey}
                            className="num num-col"
                            data-label={`S${k + 1}`}
                            data-sector={purple ? 'best' : ''}
                          >
                            {formatSectorTime(v)}
                          </td>
                        );
                      })}
                      <td className="a-lap-status">
                        <div className="a-laptags">
                          {l.valid ? (
                            <Tag tone="sb">{uiText('válida')}</Tag>
                          ) : (
                            <Tag
                              tone="bad"
                              title={badFlags.map((f) => LAP_FLAG_LABELS[f]).join(', ')}
                            >
                              {uiText('inválida')}
                            </Tag>
                          )}
                          {isBest && <Tag tone="pb">{uiText('melhor da sessão')}</Tag>}
                          {l.flags.includes('outLap') && (
                            <Tag
                              tone="warn"
                              title={uiText(
                                'Saiu dos boxes ou do grid: volta lenta, não conta como volta lançada',
                              )}
                            >
                              {uiText('volta de saída')}
                            </Tag>
                          )}
                          {l.flags.includes('inLap') && (
                            <Tag
                              tone="warn"
                              title={uiText('Terminou nos boxes ou no fim da sessão')}
                            >
                              {uiText('volta de entrada')}
                            </Tag>
                          )}
                          {badFlags
                            .filter((f) => f !== 'outLap' && f !== 'inLap')
                            .map((f) => (
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
                              {`${uiText('referência ·')} `}
                              {l.referenceMeta?.driverName ?? uiText('referência')}
                              {l.referenceMeta?.rankingTimeMs
                                ? ` (${formatLapTime(l.referenceMeta.rankingTimeMs)})`
                                : ''}
                            </Tag>
                          )}
                        </div>
                      </td>
                      <td className="a-lap-actions">
                        <LapQuickActions
                          lap={l}
                          pbLapId={pb.data?.id ?? null}
                          hasTopReference={(refs.data?.length ?? 0) > 0}
                          onChanged={replaceLap}
                          onDeleted={() => {
                            setSelected((x) => x.filter((y) => y !== l.id));
                            detail.reload();
                            pb.reload();
                          }}
                          extra={
                            <>
                              {!l.isReference && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="a-menu-item"
                                  onClick={() => setEditing(l.id)}
                                >
                                  {uiText('Referência com detalhes…')}
                                </button>
                              )}
                              <a
                                role="menuitem"
                                href={routes.coach({ session: session.id, lap: l.id })}
                              >
                                {uiText('Debrief desta volta')}
                              </a>
                              <a role="menuitem" href={urls.lapCsv(l.id)} download>
                                {uiText('Baixar CSV')}
                              </a>
                              <a role="menuitem" href={urls.lapTrace(l.id)} download>
                                {uiText('Baixar trace (JSON)')}
                              </a>
                            </>
                          }
                        />
                      </td>
                    </tr>
                  </FragmentRows>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="a-section-note">
        {uiText(
          'Roxo = melhor setor da sessão (voltas válidas). Voltas de replay e com tempo divergente só são marcadas, não invalidadas.',
        )}
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
