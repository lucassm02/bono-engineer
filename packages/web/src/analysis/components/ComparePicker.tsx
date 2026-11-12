/**
 * Start of the lap comparison when nothing was chosen yet (the sidebar "Comparar voltas" entry):
 * pick the track, one of your laps and what to compare it with, all on this page, then go. Every
 * step already has an answer (the last track driven, your best lap, the automatic reference), so
 * the shortest path is one click.
 */

import { useMemo, useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { navigate, routes } from '../../lib/route.ts';
import '../../styles/compare-picker.css';
import { api } from '../api.ts';
import { carLabel, formatDateTime } from '../lib/labels.ts';
import { useFetch } from '../useFetch.ts';
import { Card, Empty, ErrorBox, Loading } from './ui.tsx';

type Order = 'time' | 'startedAt';
const SHOWN = 12;
/** Laps listed before "show more": few enough for the Compare button to stay in view. */
const FIRST = 5;
const AUTO = 'auto';
const BEST = 'best';

export function ComparePicker() {
  const tracks = useFetch('cp:tracks', () => api.tracks());
  const recent = useFetch('cp:recent', () => api.sessions({ limit: 1 }));
  const [pickedTrack, setPickedTrack] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>('time');
  const [pickedLap, setPickedLap] = useState<string | null>(null);
  const [withWhat, setWithWhat] = useState<string>(AUTO);

  const list = tracks.data ?? [];
  const lastTrack = recent.data?.[0]?.trackId ?? null;
  const trackId =
    (pickedTrack && list.some((t) => t.id === pickedTrack) ? pickedTrack : null) ??
    (lastTrack && list.some((t) => t.id === lastTrack) ? lastTrack : null) ??
    list[0]?.id ??
    null;

  const byTime = useFetch(trackId ? `cp:laps:${trackId}:time` : null, () =>
    api.trackLaps(trackId!, {
      references: 'exclude',
      validOnly: true,
      orderBy: 'time',
      limit: SHOWN,
    }),
  );
  const byDate = useFetch(trackId && order === 'startedAt' ? `cp:laps:${trackId}:date` : null, () =>
    api.trackLaps(trackId!, {
      references: 'exclude',
      validOnly: true,
      orderBy: 'startedAt',
      limit: SHOWN,
    }),
  );
  const refs = useFetch(trackId ? `cp:refs:${trackId}` : null, () => api.references(trackId!));

  const [showAll, setShowAll] = useState(false);
  const active = order === 'time' ? byTime : byDate;
  const laps = active.data ?? [];
  const visible = showAll ? laps : laps.slice(0, FIRST);
  const best = byTime.data?.[0] ?? null;
  const lapId =
    pickedLap && laps.some((l) => l.id === pickedLap) ? pickedLap : (laps[0]?.id ?? null);
  const references = useMemo(
    () => [...(refs.data ?? [])].sort((a, b) => a.timeMs - b.timeMs),
    [refs.data],
  );
  // Comparing a lap with itself says nothing, so "your best lap" is offered only for the others.
  const canUseBest = best !== null && best.id !== lapId;
  const choice =
    withWhat === BEST
      ? canUseBest
        ? BEST
        : AUTO
      : references.some((r) => r.id === withWhat)
        ? withWhat
        : AUTO;

  if (tracks.error && !tracks.data)
    return <ErrorBox error={tracks.error} onRetry={tracks.reload} />;
  if (!tracks.data) return <Loading />;
  if (list.length === 0) {
    return (
      <Empty action={{ label: uiText('Abrir a tela ao vivo'), href: routes.live() }}>
        <p>{uiText('Nenhuma pista ainda. Dirija uma volta no jogo para poder comparar.')}</p>
      </Empty>
    );
  }

  const go = () => {
    if (!lapId) return;
    const ref = choice === AUTO ? undefined : choice === BEST ? best!.id : choice;
    navigate(routes.compare({ lap: lapId, ...(ref ? { ref } : {}) }));
  };

  return (
    <Card title={uiText('Escolha o que comparar')} className="cp">
      <form
        className="cp-form"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
      >
        <div className="ui-field">
          <label className="ui-label" htmlFor="cp-track">
            <span className="cp-n">1</span> {uiText('Pista')}
          </label>
          <select
            id="cp-track"
            className="ui-select"
            value={trackId ?? ''}
            onChange={(e) => {
              setPickedTrack(e.target.value);
              setPickedLap(null);
              setWithWhat(AUTO);
            }}
          >
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.layout ? `${t.name} · ${t.layout}` : t.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="cp-set">
          <legend>
            <span className="cp-n">2</span> {uiText('Sua volta')}
          </legend>
          <fieldset className="cp-order" aria-label={uiText('Ordenar as voltas')}>
            {(['time', 'startedAt'] as const).map((o) => (
              <button
                key={o}
                type="button"
                className="ui-chip"
                data-on={order === o ? '1' : '0'}
                aria-pressed={order === o}
                onClick={() => setOrder(o)}
              >
                {o === 'time' ? uiText('Mais rápidas') : uiText('Mais recentes')}
              </button>
            ))}
          </fieldset>
          {active.error && !active.data ? (
            <ErrorBox error={active.error} onRetry={active.reload} compact />
          ) : !active.data ? (
            <Loading />
          ) : laps.length === 0 ? (
            <p className="dim">{uiText('Você ainda não tem voltas válidas nesta pista.')}</p>
          ) : (
            <ul className="cp-laps">
              {visible.map((l, i) => (
                <li key={l.id}>
                  <label className="cp-row" data-on={lapId === l.id ? '1' : '0'}>
                    <input
                      type="radio"
                      name="cp-lap"
                      checked={lapId === l.id}
                      onChange={() => setPickedLap(l.id)}
                    />
                    <span
                      className="num cp-time"
                      data-best={order === 'time' && i === 0 ? '1' : '0'}
                    >
                      {formatLapTime(l.timeMs)}
                    </span>
                    <span className="dim cp-meta">
                      {formatDateTime(l.startedAt)}
                      {` ${uiText('· volta')} ${l.number} · ${carLabel(l.carCode)}`}
                    </span>
                  </label>
                </li>
              ))}
              {laps.length > FIRST && (
                <li>
                  <button
                    type="button"
                    className="ui-btn cp-more"
                    data-variant="secondary"
                    onClick={() => setShowAll((v) => !v)}
                  >
                    {showAll ? uiText('Mostrar menos') : uiText('Mostrar mais voltas')}
                  </button>
                </li>
              )}
            </ul>
          )}
        </fieldset>

        <fieldset className="cp-set">
          <legend>
            <span className="cp-n">3</span> {uiText('Comparar com')}
          </legend>
          <ul className="cp-laps">
            <li>
              <label className="cp-row" data-on={choice === AUTO ? '1' : '0'}>
                <input
                  type="radio"
                  name="cp-with"
                  checked={choice === AUTO}
                  onChange={() => setWithWhat(AUTO)}
                />
                <span className="cp-what">
                  {references.length > 0
                    ? uiText('Automática: a melhor referência do top')
                    : uiText('Automática: a sua melhor volta')}
                </span>
              </label>
            </li>
            {canUseBest && (
              <li>
                <label className="cp-row" data-on={choice === BEST ? '1' : '0'}>
                  <input
                    type="radio"
                    name="cp-with"
                    checked={choice === BEST}
                    onChange={() => setWithWhat(BEST)}
                  />
                  <span className="cp-what">{uiText('A sua melhor volta')}</span>
                  <span className="num dim cp-meta">{formatLapTime(best!.timeMs)}</span>
                </label>
              </li>
            )}
            {references.map((r) => (
              <li key={r.id}>
                <label className="cp-row" data-on={choice === r.id ? '1' : '0'}>
                  <input
                    type="radio"
                    name="cp-with"
                    checked={choice === r.id}
                    onChange={() => setWithWhat(r.id)}
                  />
                  <span className="cp-what">
                    {r.referenceMeta?.driverName ?? uiText('Referência do top')}
                  </span>
                  <span className="num dim cp-meta">{formatLapTime(r.timeMs)}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="cp-actions">
          <button type="submit" className="ui-btn" disabled={!lapId}>
            {uiText('Comparar')}
          </button>
        </div>
      </form>
    </Card>
  );
}
