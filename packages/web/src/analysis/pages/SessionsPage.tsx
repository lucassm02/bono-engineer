/** #/analise — sessions list with track/car/mode filters, plus the known tracks. */

import type { Session, Track } from '@gt7/shared';
import { useMemo, useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { navigate, type Route, routes } from '../../lib/route.ts';
import { api } from '../api.ts';
import { Card, Empty, ErrorBox, Loading, PageHead, Tag, useTitle } from '../components/ui.tsx';
import { carLabel, formatDateTime, SESSION_MODE_LABELS } from '../lib/labels.ts';
import { useFetch } from '../useFetch.ts';

export function trackName(tracks: Track[] | null, id: string | null): string {
  if (!id) return 'Pista não identificada';
  return tracks?.find((t) => t.id === id)?.name ?? id;
}

export function SessionsPage({ route }: { route: Route }) {
  const sessions = useFetch('sessions', () => api.sessions(), 15000);
  const tracks = useFetch('tracks', () => api.tracks());
  const [mode, setMode] = useState<'' | 'live' | 'replayCapture'>('');
  const trackFilter = route.query.track ?? '';
  const carFilter = route.query.car ?? '';

  const setFilter = (k: 'track' | 'car', v: string) => {
    const q = { track: trackFilter, car: carFilter, [k]: v };
    navigate(routes.sessions({ track: q.track || undefined, car: q.car || undefined }), true);
  };

  const cars = useMemo(
    () => [...new Set((sessions.data ?? []).map((s) => s.carCode))].sort((a, b) => a - b),
    [sessions.data],
  );
  const list = useMemo(
    () =>
      (sessions.data ?? []).filter(
        (s: Session) =>
          (!trackFilter || s.trackId === trackFilter) &&
          (!carFilter || String(s.carCode) === carFilter) &&
          (!mode || s.mode === mode),
      ),
    [sessions.data, trackFilter, carFilter, mode],
  );

  useTitle('Sessões');

  return (
    <>
      <PageHead
        title="Sessões"
        sub="Escolha uma sessão para ver as voltas, comparar com a referência e marcar voltas de referência."
        actions={
          <>
            <a className="a-btn a-btn-ghost" href={routes.capture()}>
              Capturar referência
            </a>
            <a className="a-btn" href={routes.coach()}>
              Debrief com IA
            </a>
          </>
        }
      />
      <div className="a-filters">
        <label>
          Pista
          <select value={trackFilter} onChange={(e) => setFilter('track', e.target.value)}>
            <option value="">Todas</option>
            {(tracks.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Carro
          <select value={carFilter} onChange={(e) => setFilter('car', e.target.value)}>
            <option value="">Todos</option>
            {cars.map((c) => (
              <option key={c} value={String(c)}>
                {carLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Modo
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="">Todos</option>
            <option value="live">Ao vivo</option>
            <option value="replayCapture">Captura de replay</option>
          </select>
        </label>
      </div>

      {sessions.error && !sessions.data ? (
        <ErrorBox error={sessions.error} onRetry={sessions.reload} />
      ) : !sessions.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty>
          {sessions.data.length === 0 ? (
            <>
              <p>Nenhuma sessão gravada ainda.</p>
              <p className="dim">
                Ligue o console e dê algumas voltas (ou rode <code>npm run demo</code>); cada volta
                completa aparece aqui.
              </p>
            </>
          ) : (
            <p>Nenhuma sessão com esses filtros.</p>
          )}
        </Empty>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table a-table-click">
            <thead>
              <tr>
                <th>Data</th>
                <th>Pista</th>
                <th>Carro</th>
                <th>Modo</th>
                <th className="num-col">Voltas</th>
                <th className="num-col">Melhor</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} onClick={() => navigate(routes.session(s.id))}>
                  <td>
                    <a href={routes.session(s.id)} onClick={(e) => e.stopPropagation()}>
                      {formatDateTime(s.startedAt)}
                    </a>
                    {s.endedAt === null && <Tag tone="info">em andamento</Tag>}
                  </td>
                  <td>
                    {s.trackId ? (
                      <a href={routes.track(s.trackId)} onClick={(e) => e.stopPropagation()}>
                        {trackName(tracks.data, s.trackId)}
                      </a>
                    ) : (
                      <span className="dim">{trackName(tracks.data, null)}</span>
                    )}
                  </td>
                  <td>{carLabel(s.carCode)}</td>
                  <td>
                    {s.mode === 'replayCapture' ? (
                      <Tag tone="ref">{SESSION_MODE_LABELS[s.mode]}</Tag>
                    ) : (
                      SESSION_MODE_LABELS[s.mode]
                    )}
                  </td>
                  <td className="num num-col">{s.lapCount}</td>
                  <td className="num num-col">{s.bestLapMs ? formatLapTime(s.bestLapMs) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tracks.data && tracks.data.length > 0 && (
        <Card title="Pistas" className="a-mt">
          <ul className="a-track-list">
            {tracks.data.map((t) => (
              <li key={t.id}>
                <a href={routes.track(t.id)}>{t.name}</a>
                <span className="dim num">
                  {' '}
                  · {(t.lengthM / 1000).toFixed(2).replace('.', ',')} km · {t.corners.length} curvas
                </span>
              </li>
            ))}
          </ul>
          <p className="dim a-small">
            Na página da pista: nomes das curvas, setores, consistência por sessão e evolução ao
            longo dos dias.
          </p>
        </Card>
      )}
    </>
  );
}
