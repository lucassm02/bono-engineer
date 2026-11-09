/**
 * #/inicio — the home of the app: the history already organised by track, with no folders and no
 * setup. One card per track, most recent activity first.
 */

import { useMemo, useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { GT7_INTEGRATION } from '../../lib/integrations.ts';
import { routes } from '../../lib/route.ts';
import { loadJson, saveJson } from '../../lib/storage.ts';
import { api } from '../api.ts';
import { CarName } from '../components/CarName.tsx';
import { CarFilterChips, CarFilterField, FilterChip } from '../components/CarPicker.tsx';
import { NewTrackPrompt } from '../components/TrackNaming.tsx';
import { TrackThumb } from '../components/TrackThumb.tsx';
import { ErrorBox, Loading, PageHead, Tag, useTitle } from '../components/ui.tsx';
import {
  type CarFilter,
  carMatchesFilter,
  isCarFiltering,
  lapsPerCar,
  NO_CAR_FILTER,
} from '../lib/carFilter.ts';
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
import { formatAgo } from '../lib/labels.ts';
import { useCarFilter } from '../lib/useCarFilter.ts';
import { useFetch } from '../useFetch.ts';

const DISMISSED_KEY = 'gt7.nameDismissed';
const HIDE_DEMO_KEY = 'gt7.hideDemo';

function loadDismissed(): string[] {
  const v = loadJson<string[]>(DISMISSED_KEY);
  return Array.isArray(v) ? v : [];
}

export function TrackCard({
  t,
  demo,
  carFilter = NO_CAR_FILTER,
}: {
  t: TrackOverview;
  demo: boolean;
  carFilter?: CarFilter;
}) {
  const trend = trendLabel(t.trend);
  const cars = t.cars.slice(0, 3);
  // With a car/maker filter the card talks about those cars only.
  const carFiltering = isCarFiltering(carFilter);
  const fcars = carFiltering
    ? t.cars.filter((c) => carMatchesFilter(carFilter, c.carCode))
    : t.cars;
  const fbest = carFiltering
    ? fcars.reduce<{ ms: number; carCode: number } | null>(
        (b, c) =>
          c.bestMs !== null && (!b || c.bestMs < b.ms) ? { ms: c.bestMs, carCode: c.carCode } : b,
        null,
      )
    : null;
  const lapCount = carFiltering ? fcars.reduce((n, c) => n + c.laps, 0) : t.lapCount;
  const sessionCount = carFiltering ? fcars.reduce((n, c) => n + c.sessions, 0) : t.sessionCount;
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
          {formatKm(t.lengthM)} · {plural(sessionCount, 'sessão', 'sessões')} ·{' '}
          {plural(lapCount, 'volta', 'voltas')}
          {carFiltering ? ' com o filtro' : ''}
        </p>
        {carFiltering ? (
          fbest ? (
            <p className="a-trackcard-best">
              <span className="a-sum-k">Melhor volta</span>
              <span className="a-trackcard-time num">{formatLapTime(fbest.ms)}</span>
              <span className="dim a-small">
                <CarName carCode={fbest.carCode} logoSize={16} />
              </span>
            </p>
          ) : (
            <p className="dim a-small">Sem volta válida com esse filtro.</p>
          )
        ) : t.best ? (
          <p className="a-trackcard-best">
            <span className="a-sum-k">Melhor volta</span>
            <span className="a-trackcard-time num">{formatLapTime(t.best.timeMs)}</span>
            <span className="dim a-small">
              {whenLabel(t.best.at)}
              {t.cars.length > 1 && (
                <>
                  {' · '}
                  <CarName carCode={t.best.carCode} logoSize={16} />
                </>
              )}
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
              {cars.map((c) => (
                <CarName key={c.carCode} carCode={c.carCode} logoSize={16} />
              ))}
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
          Entre em uma pista no simulador conectado e dê algumas voltas. Seus tempos aparecem aqui,
          organizados por pista.
        </p>
      )}
      {!hiddenDemo && (
        <p className="dim">
          <a href={routes.config('conexao')}>Configurar a integração de telemetria</a>
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
  const [carFilter, setCarFilter] = useCarFilter();
  const [hideDemo, setHideDemo] = useState(() => loadJson<boolean>(HIDE_DEMO_KEY) === true);
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  useTitle('Início');

  const data = overview.data;
  const isDemo = data?.simulator === true;
  const tracks = data?.tracks ?? [];
  // A track with no own laps (only references) is still a track: it keeps its card.
  const shown = useMemo(
    () =>
      filterTracks(
        tracks,
        { query, carCode: carFilter.carCode, makerId: carFilter.makerId, hideDemo },
        isDemo,
      ),
    [tracks, query, carFilter, hideDemo, isDemo],
  );
  const usage = useMemo(() => lapsPerCar(carsOf(tracks)), [tracks]);
  const unnamed = !isDemo
    ? tracks.filter((t) => t.needsName && t.lapCount > 0 && !dismissed.includes(t.id))
    : [];
  const filtering = query.trim() !== '' || isCarFiltering(carFilter);

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
      <div className="a-pitwall">
        <div className="a-pitwall-content">
          <p className="a-pitwall-kicker">Seu engenheiro de pista</p>
          <PageHead
            title="Suas pistas"
            sub={
              data && tracks.length > 0
                ? `${plural(tracks.length, 'pista', 'pistas')} · ${plural(totalLaps, 'volta', 'voltas')} guardadas. Escolha uma pista para ver seus melhores tempos e evolução.`
                : 'Seu histórico de voltas, organizado por pista automaticamente.'
            }
            actions={
              <>
                <a className="a-btn" href={routes.live()}>
                  Abrir painel ao vivo
                </a>
                <a className="a-btn a-btn-ghost" href={routes.sessions()}>
                  Todas as sessões
                </a>
              </>
            }
          />
          <a className="a-pitwall-integration" href={routes.config('conexao')}>
            <span>{isDemo ? 'Fonte das voltas' : 'Integração disponível'}</span>
            <strong>{isDemo ? 'Demonstração' : GT7_INTEGRATION.name}</strong>
          </a>
        </div>
        <svg className="a-pitwall-signal" viewBox="0 0 440 236" aria-hidden="true">
          <path
            className="a-pitwall-grid"
            d="M0 44h440M0 93h440M0 142h440M0 191h440M72 0v236M132 0v236M192 0v236M252 0v236M312 0v236M372 0v236"
          />
          <path
            className="a-pitwall-echo"
            d="M0 192h105l38-26h31l39-48h35l28 22h44l56-38h64M0 180h97l43-32h32l38-47h39l30 25h41l54-40h66"
          />
          <path className="a-pitwall-trace" d="M0 166h95l43-38h30l40-48h42l30 28h37l55-41h68" />
          <path className="a-pitwall-axis" d="M208 44v148M372 44v148" />
          <circle cx="208" cy="80" r="4" />
          <circle cx="372" cy="67" r="4" />
        </svg>
      </div>

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
              <CarFilterField usage={usage} value={carFilter} onChange={setCarFilter} />
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

          {tracks.length > 0 && filtering && (
            <div className="cf-chips">
              {query.trim() !== '' && (
                <FilterChip
                  label={`Pista: ${query.trim()}`}
                  title="Busca por pista"
                  onRemove={() => setQuery('')}
                />
              )}
              <CarFilterChips value={carFilter} onChange={setCarFilter} />
              <button
                type="button"
                className="a-btn a-btn-ghost a-btn-sm cf-chip-clear"
                onClick={() => {
                  setQuery('');
                  setCarFilter(NO_CAR_FILTER);
                }}
              >
                Limpar filtros
              </button>
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
                <p>
                  Nenhuma pista encontrada com esse filtro.
                  {isCarFiltering(carFilter) &&
                    ' Talvez você ainda não tenha voltas com esse carro.'}
                </p>
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  onClick={() => {
                    setQuery('');
                    setCarFilter(NO_CAR_FILTER);
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
                <TrackCard key={t.id} t={t} demo={isDemo} carFilter={carFilter} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
