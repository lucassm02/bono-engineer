/**
 * #/inicio — the home of the app: the history already organised by track, with no folders and no
 * setup. One card per track, most recent activity first.
 */

import { useMemo, useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { routes } from '../../lib/route.ts';
import { loadJson, saveJson } from '../../lib/storage.ts';
import { api } from '../api.ts';
import { NewTrackPrompt } from '../components/TrackNaming.tsx';
import { TrackThumb } from '../components/TrackThumb.tsx';
import { ErrorBox, Loading, PageHead, Tag, useTitle } from '../components/ui.tsx';
import {
  carsOf,
  filterTracks,
  formatKm,
  fullTrackName,
  plural,
  type TrackOverview,
  trendLabel,
  whenLabel,
} from '../lib/history.ts';
import { carLabel, formatAgo } from '../lib/labels.ts';
import { useFetch } from '../useFetch.ts';

const DISMISSED_KEY = 'gt7.nameDismissed';
const HIDE_DEMO_KEY = 'gt7.hideDemo';

function loadDismissed(): string[] {
  const v = loadJson<string[]>(DISMISSED_KEY);
  return Array.isArray(v) ? v : [];
}

export function TrackCard({ t, demo }: { t: TrackOverview; demo: boolean }) {
  const trend = trendLabel(t.trend);
  const cars = t.cars.slice(0, 3);
  return (
    <a className="a-trackcard" href={routes.track(t.id)}>
      <TrackThumb line={t.thumb} className="a-trackcard-thumb" label={`Traçado de ${t.name}`} />
      <div className="a-trackcard-body">
        <h3 className="a-trackcard-title">
          <span>{fullTrackName(t)}</span>
          {demo && (
            <Tag tone="warn" title="Dados gerados pelo simulador, não são suas voltas reais">
              Demo
            </Tag>
          )}
          {t.needsName && (
            <Tag tone="info" title="Ainda sem nome: abra a pista para dizer qual é">
              sem nome
            </Tag>
          )}
        </h3>
        <p className="a-trackcard-meta dim">
          {formatKm(t.lengthM)} · {plural(t.sessionCount, 'sessão', 'sessões')} ·{' '}
          {plural(t.lapCount, 'volta', 'voltas')}
        </p>
        {t.best ? (
          <p className="a-trackcard-best">
            <span className="a-sum-k">Melhor volta</span>
            <span className="a-trackcard-time num">{formatLapTime(t.best.timeMs)}</span>
            <span className="dim a-small">
              {whenLabel(t.best.at)}
              {t.cars.length > 1 ? ` · ${carLabel(t.best.carCode)}` : ''}
            </span>
          </p>
        ) : (
          <p className="dim a-small">Ainda sem volta válida.</p>
        )}
        <div className="a-trackcard-foot">
          {trend && (
            <span
              className="a-trend"
              data-tone={trend.tone}
              title="Melhor volta da última sessão contra a sessão anterior com o mesmo carro"
            >
              <span aria-hidden="true">
                {trend.tone === 'gain' ? '▲' : trend.tone === 'loss' ? '▼' : '●'}
              </span>{' '}
              {trend.text}
            </span>
          )}
          {cars.length > 0 && (
            <span className="a-trackcard-cars dim a-small">
              {cars.map((c) => carLabel(c.carCode)).join(' · ')}
              {t.cars.length > cars.length ? ` +${t.cars.length - cars.length}` : ''}
            </span>
          )}
          {t.referenceCount > 0 && (
            <Tag tone="ref" title="Voltas do top do ranking guardadas para comparar">
              {t.referenceCount} ref. do top
            </Tag>
          )}
        </div>
        {t.lastActivityAt && (
          <p className="a-trackcard-last dim a-small">
            Última atividade {formatAgo(t.lastActivityAt)}
          </p>
        )}
      </div>
    </a>
  );
}

function EmptyHome({ hiddenDemo, onShowDemo }: { hiddenDemo: boolean; onShowDemo: () => void }) {
  return (
    <div className="a-welcome">
      <div className="a-welcome-art" aria-hidden="true">
        <TrackThumb
          line={{
            x: [0, 40, 80, 100, 90, 60, 30, 10],
            z: [0, -10, 0, 30, 60, 70, 50, 30],
          }}
        />
      </div>
      <h2>{hiddenDemo ? 'Só há dados de demonstração' : 'Suas pistas vão aparecer aqui'}</h2>
      {hiddenDemo ? (
        <p>
          Você escondeu os dados de demonstração. Quando pilotar de verdade, as pistas aparecem
          sozinhas.
        </p>
      ) : (
        <p>
          Abra o Gran Turismo 7 e dê algumas voltas: cada pista que você correr ganha um cartão com
          seus tempos, sem precisar criar pastas nem configurar nada.
        </p>
      )}
      {!hiddenDemo && (
        <p className="dim">
          Ainda não ligou o console?{' '}
          <a href={routes.config('conexao')}>Veja a conexão com o PlayStation</a>.
        </p>
      )}
      <div className="a-actions a-actions-center">
        {hiddenDemo ? (
          <button type="button" className="a-btn" onClick={onShowDemo}>
            Mostrar a demonstração
          </button>
        ) : (
          <a className="a-btn" href="/?mock=1#/">
            Ver demonstração
          </a>
        )}
        <a className="a-btn a-btn-ghost" href={routes.live()}>
          Abrir o painel ao vivo
        </a>
      </div>
      {!hiddenDemo && (
        <p className="dim a-small">
          A demonstração mostra o painel ao vivo com um piloto simulado. Para ver o histórico
          preenchido com voltas de exemplo, rode <code>npm run demo</code> no PC.
        </p>
      )}
    </div>
  );
}

export function HomePage() {
  const overview = useFetch('overview', () => api.tracksOverview(), 15000);
  const [query, setQuery] = useState('');
  const [carCode, setCarCode] = useState<number | null>(null);
  const [hideDemo, setHideDemo] = useState(() => loadJson<boolean>(HIDE_DEMO_KEY) === true);
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  useTitle('Início');

  const data = overview.data;
  const isDemo = data?.simulator === true;
  const tracks = data?.tracks ?? [];
  // A track with no own laps (only references) is still a track: it keeps its card.
  const shown = useMemo(
    () => filterTracks(tracks, { query, carCode, hideDemo }, isDemo),
    [tracks, query, carCode, hideDemo, isDemo],
  );
  const cars = useMemo(() => carsOf(tracks), [tracks]);
  const unnamed = !isDemo
    ? tracks.filter((t) => t.needsName && t.lapCount > 0 && !dismissed.includes(t.id))
    : [];
  const filtering = query.trim() !== '' || carCode !== null;

  const setHide = (v: boolean) => {
    setHideDemo(v);
    saveJson(HIDE_DEMO_KEY, v);
  };
  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    saveJson(DISMISSED_KEY, next);
  };

  const totalLaps = tracks.reduce((n, t) => n + t.lapCount, 0);

  return (
    <>
      <PageHead
        title="Suas pistas"
        sub={
          data && tracks.length > 0
            ? `${plural(tracks.length, 'pista', 'pistas')} · ${plural(totalLaps, 'volta', 'voltas')} guardadas. Escolha uma pista para ver seus melhores tempos e evolução.`
            : 'Seu histórico de voltas, organizado por pista automaticamente.'
        }
        actions={
          <>
            <a className="a-btn a-btn-ghost" href={routes.sessions()}>
              Todas as sessões
            </a>
            <a className="a-btn" href={routes.live()}>
              Ao vivo
            </a>
          </>
        }
      />

      {overview.error && !data ? (
        <ErrorBox error={overview.error} onRetry={overview.reload} />
      ) : !data ? (
        <Loading text="Carregando suas pistas…" />
      ) : (
        <>
          {unnamed.slice(0, 1).map((t) => (
            <NewTrackPrompt
              key={t.id}
              trackId={t.id}
              lengthM={t.lengthM}
              onSaved={overview.reload}
              onLater={() => dismiss(t.id)}
            />
          ))}

          {tracks.length > 0 && (
            <div className="a-filters a-home-filters">
              <label className="a-grow">
                Buscar pista
                <input
                  className="a-input"
                  type="search"
                  value={query}
                  placeholder="Ex.: Monza, Suzuka…"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {cars.length > 1 && (
                <label>
                  Carro
                  <select
                    value={carCode ?? ''}
                    onChange={(e) =>
                      setCarCode(e.target.value === '' ? null : Number(e.target.value))
                    }
                  >
                    <option value="">Todos</option>
                    {cars.map((c) => (
                      <option key={c.carCode} value={c.carCode}>
                        {carLabel(c.carCode)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {isDemo && (
                <label className="a-check-inline">
                  <input
                    type="checkbox"
                    checked={hideDemo}
                    onChange={(e) => setHide(e.target.checked)}
                  />
                  Esconder demonstração
                </label>
              )}
            </div>
          )}

          {isDemo && !hideDemo && tracks.length > 0 && (
            <p className="a-note">
              <Tag tone="warn">Demo</Tag> Você está no modo demonstração: estas voltas vêm de um
              piloto simulado, não do console.
            </p>
          )}

          {shown.length === 0 ? (
            filtering ? (
              <div className="a-empty">
                <p>Nenhuma pista encontrada com esse filtro.</p>
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  onClick={() => {
                    setQuery('');
                    setCarCode(null);
                  }}
                >
                  Limpar filtros
                </button>
              </div>
            ) : (
              <EmptyHome
                hiddenDemo={isDemo && hideDemo && tracks.length > 0}
                onShowDemo={() => setHide(false)}
              />
            )
          ) : (
            <div className="a-trackgrid">
              {shown.map((t) => (
                <TrackCard key={t.id} t={t} demo={isDemo} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
