/** #/analise — every session in one table, with track/car/mode filters (the home is #/inicio). */

import type { Session, Track } from '@gt7/shared';
import { useMemo, useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { navigate, type Route, routes } from '../../lib/route.ts';
import { api } from '../api.ts';
import { CarName } from '../components/CarName.tsx';
import { CarFilterChips, CarFilterField } from '../components/CarPicker.tsx';
import { Empty, ErrorBox, Loading, PageHead, Tag, useTitle } from '../components/ui.tsx';
import { carMatchesFilter, isCarFiltering, lapsPerCar, pickCar } from '../lib/carFilter.ts';
import { fullTrackName } from '../lib/history.ts';
import { formatDateTime, SESSION_MODE_LABELS } from '../lib/labels.ts';
import { useCarFilter } from '../lib/useCarFilter.ts';
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
  // A link with ?car=<carCode> wins; otherwise the last filter chosen is restored.
  const urlCar = Number(route.query.car);
  const [carFilter, setCarFilter] = useCarFilter(
    route.query.car && Number.isInteger(urlCar) ? pickCar(urlCar) : undefined,
  );

  const setTrack = (v: string) => {
    navigate(routes.sessions({ track: v || undefined }), true);
  };

  const usage = useMemo(
    () => lapsPerCar((sessions.data ?? []).map((s) => ({ carCode: s.carCode, laps: s.lapCount }))),
    [sessions.data],
  );
  const list = useMemo(
    () =>
      (sessions.data ?? []).filter(
        (s: Session) =>
          (!trackFilter || s.trackId === trackFilter) &&
          carMatchesFilter(carFilter, s.carCode) &&
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
          <select value={trackFilter} onChange={(e) => setTrack(e.target.value)}>
            <option value="">Todas</option>
            {(tracks.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <CarFilterField usage={usage} value={carFilter} onChange={setCarFilter} />
        <label>
          Modo
          <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="">Todos</option>
            <option value="live">Ao vivo</option>
            <option value="replayCapture">Captura de replay</option>
          </select>
        </label>
      </div>
      {isCarFiltering(carFilter) && (
        <div className="cf-chips">
          <CarFilterChips value={carFilter} onChange={setCarFilter} />
        </div>
      )}

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
                  <td>
                    <CarName carCode={s.carCode} />
                  </td>
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
