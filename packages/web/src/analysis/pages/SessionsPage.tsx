/** #/analise — every session in one table, with track/car/mode filters (the home is #/inicio). */

import type { Session, Track } from '@gt7/shared';
import { useMemo, useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { navigate, type Route, routes } from '../../lib/route.ts';
import { api } from '../api.ts';
import { Empty, ErrorBox, Loading, PageHead, Tag, useTitle } from '../components/ui.tsx';
import { fullTrackName } from '../lib/history.ts';
import { carLabel, formatDateTime, SESSION_MODE_LABELS } from '../lib/labels.ts';
import { useFetch } from '../useFetch.ts';

export function trackName(tracks: Track[] | null, id: string | null): string {
  if (!id) return 'Pista não identificada';
  const t = tracks?.find((x) => x.id === id);
  return t ? fullTrackName(t) : 'Pista';
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
        back={{ href: routes.home(), label: 'Suas pistas' }}
        title="Todas as sessões"
        sub="Todas as sessões em ordem de data. Para ver por pista, volte ao início."
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
                Abra o Gran Turismo 7 e dê algumas voltas: cada volta completa aparece aqui sozinha.
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
    </>
  );
}
