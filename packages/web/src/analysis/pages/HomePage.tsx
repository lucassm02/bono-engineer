/**
 * #/inicio — the home of the app: the history already organised by track, with no folders and no
 * setup. One card per track, most recent activity first.
 */

import { useMemo, useState } from 'react';
import { Icon } from '../../components/ui/Icon.tsx';
import { formatLapTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { GT7_INTEGRATION } from '../../lib/integrations.ts';
import { routes } from '../../lib/route.ts';
import { loadJson, saveJson } from '../../lib/storage.ts';
import { openSetupAssistant } from '../../state/setup.ts';
import { useUi } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { CarName } from '../components/CarName.tsx';
import { CarFilterChips, CarFilterField, FilterChip } from '../components/CarPicker.tsx';
import { PendingSetupCard } from '../components/config/HealthSummary.tsx';
import { DailiesAsk } from '../components/DailiesAsk.tsx';
import { DailiesStrip } from '../components/DailiesStrip.tsx';
import { NewTrackPrompt } from '../components/TrackNaming.tsx';
import { TrackThumb } from '../components/TrackThumb.tsx';
import { ErrorBox, Loading, Tag, useTitle } from '../components/ui.tsx';
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

function PhoneQrCard() {
  const lanAddress = useUi((s) => s.serverStatus?.lanUrls[0]);
  const { data } = useFetch(lanAddress ?? null, api.lan);
  if (!lanAddress || !data?.qrSvgDataUrl) return null;

  return (
    <aside className="a-phone-card ui-card" aria-label={uiText('Abrir no celular')}>
      <a href={routes.config('acesso-remoto')}>{uiText('Abrir no celular')}</a>
      <img src={data.qrSvgDataUrl} alt={uiText('QR Code para abrir o ao vivo em outro aparelho')} />
      <p>{uiText('Escaneie na mesma rede Wi-Fi.')}</p>
    </aside>
  );
}

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
  tourAnchor,
}: {
  t: TrackOverview;
  demo: boolean;
  carFilter?: CarFilter;
  /** First card of the page: anchor of the guided tour. */
  tourAnchor?: boolean;
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
    <a
      className="a-trackcard"
      href={routes.track(t.id)}
      data-tour={tourAnchor ? 'track-card' : undefined}
    >
      <TrackThumb
        line={t.thumb}
        className="a-trackcard-thumb"
        label={uiText('Traçado de {0}', t.name)}
      />
      <div className="a-trackcard-body">
        <h3 className="a-trackcard-title">
          <span>{fullTrackName(t)}</span>
          {demo && (
            <Tag
              tone="warn"
              title={uiText('Dados gerados pelo simulador, não são suas voltas reais')}
            >
              Demo
            </Tag>
          )}
          {t.needsName && (
            <Tag tone="info" title={uiText('Ainda sem nome: abra a pista para dizer qual é')}>
              {uiText('sem nome')}
            </Tag>
          )}
        </h3>
        {carFiltering ? (
          fbest ? (
            <p className="a-trackcard-best">
              <span className="a-stat-k">{uiText('Melhor volta com o filtro')}</span>
              <span className="a-trackcard-best-row">
                <span className="a-trackcard-time num">{formatLapTime(fbest.ms)}</span>
                <span className="a-trackcard-sub">
                  <CarName carCode={fbest.carCode} logoSize={16} />
                </span>
              </span>
            </p>
          ) : (
            <p className="a-trackcard-sub">{uiText('Sem volta válida com esse filtro.')}</p>
          )
        ) : t.best ? (
          <p className="a-trackcard-best">
            <span className="a-stat-k">{uiText('Melhor volta')}</span>
            <span className="a-trackcard-best-row">
              <span className="a-trackcard-time num">{formatLapTime(t.best.timeMs)}</span>
              {trend && (
                <span
                  className="a-trend"
                  data-tone={trend.tone}
                  title={uiText(
                    'Melhor volta da última sessão contra a sessão anterior com o mesmo carro',
                  )}
                >
                  <span aria-hidden="true">
                    {trend.tone === 'gain' ? '▲' : trend.tone === 'loss' ? '▼' : '●'}
                  </span>
                  {trend.text}
                </span>
              )}
            </span>
            <span className="a-trackcard-sub">
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
          <p className="a-trackcard-sub">{uiText('Ainda sem volta válida.')}</p>
        )}
        <ul className="a-trackcard-meta">
          <li>{plural(sessionCount, uiText('sessão'), uiText('sessões'))}</li>
          <li>
            {plural(lapCount, uiText('volta'), uiText('voltas'))}
            {carFiltering ? uiText(' com o filtro') : ''}
          </li>
          <li>{formatKm(t.lengthM)}</li>
        </ul>
        <div className="a-trackcard-foot">
          {cars.length > 0 && (
            <span className="a-trackcard-cars">
              {cars.map((c) => (
                <CarName key={c.carCode} carCode={c.carCode} logoSize={16} />
              ))}
              {t.cars.length > cars.length ? `+${t.cars.length - cars.length}` : ''}
            </span>
          )}
          {t.referenceCount > 0 && (
            <Tag tone="ref" title={uiText('Voltas do top do ranking guardadas para comparar')}>
              {t.referenceCount}
              {` ${uiText('ref. do top')}`}
            </Tag>
          )}
          {t.lastActivityAt && (
            <span>
              {`${uiText('Última atividade')} `}
              {formatAgo(t.lastActivityAt)}
            </span>
          )}
        </div>
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
      <h2>
        {hiddenDemo
          ? uiText('Só há dados de demonstração')
          : uiText('Suas pistas vão aparecer aqui')}
      </h2>
      {hiddenDemo ? (
        <p>
          {uiText(
            'Você escondeu os dados de demonstração. Quando pilotar de verdade, as pistas aparecem sozinhas.',
          )}
        </p>
      ) : (
        <p>
          {uiText(
            'Entre em uma pista no simulador conectado e dê algumas voltas. Seus tempos aparecem aqui, organizados por pista.',
          )}
        </p>
      )}
      {!hiddenDemo && (
        <p className="dim">
          <a href={routes.config('conexao')}>{uiText('Configurar a integração de telemetria')}</a>
        </p>
      )}
      <div className="a-actions a-actions-center">
        {hiddenDemo ? (
          <button type="button" className="a-btn" onClick={onShowDemo}>
            {uiText('Mostrar a demonstração')}
          </button>
        ) : (
          <a className="a-btn" href="/?mock=1#/">
            {uiText('Ver demonstração')}
          </a>
        )}
        <a className="a-btn a-btn-ghost" href={routes.live()}>
          {uiText('Abrir a tela ao vivo')}
        </a>
      </div>
      {!hiddenDemo && (
        <p className="dim a-small">
          {`${uiText(
            'A demonstração mostra a tela ao vivo com um piloto simulado. Para ver o histórico preenchido com voltas de exemplo, rode',
          )} `}
          <code>npm run demo</code>
          {` ${uiText('no PC.')}`}
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
  useTitle(uiText('Início'));

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
  const totalSessions = tracks.reduce((n, t) => n + t.sessionCount, 0);
  const clearFilters = () => {
    setQuery('');
    setCarFilter(NO_CAR_FILTER);
  };

  return (
    <>
      <section className="a-hero" aria-label={uiText('Suas pistas')}>
        <div className="a-hero-content">
          <p className="a-eyebrow">{uiText('Seu engenheiro de pista')}</p>
          <h1>{uiText('Suas pistas')}</h1>
          <p className="a-sub">
            {data && tracks.length > 0
              ? uiText(
                  'Escolha uma pista para ver seus melhores tempos, a evolução e onde ainda dá para ganhar.',
                )
              : uiText('Seu histórico de voltas, organizado por pista automaticamente.')}
          </p>
          <div className="a-actions a-hero-actions">
            <a className="a-btn a-btn-lg" href={routes.live()}>
              <Icon name="live" size={20} />
              {uiText('Abrir a tela ao vivo')}
            </a>
            <a className="a-btn a-btn-lg a-btn-ghost" href={routes.sessions()}>
              {uiText('Todas as sessões')}
            </a>
          </div>
          {data && tracks.length > 0 && (
            <dl className="a-hero-stats">
              <div>
                <dt>{uiText('Pistas')}</dt>
                <dd className="num">{tracks.length}</dd>
              </div>
              <div>
                <dt>{uiText('Sessões')}</dt>
                <dd className="num">{totalSessions}</dd>
              </div>
              <div>
                <dt>{uiText('Voltas')}</dt>
                <dd className="num">{totalLaps}</dd>
              </div>
            </dl>
          )}
          <a className="a-hero-source" href={routes.config('conexao')}>
            <span className="ui-dot" data-tone={isDemo ? 'warn' : 'accent'} />
            <span>{isDemo ? uiText('Fonte das voltas') : uiText('Integração disponível')}</span>
            <strong>{isDemo ? uiText('Demonstração') : GT7_INTEGRATION.name}</strong>
          </a>
        </div>
        <PhoneQrCard />
        <svg className="a-hero-signal" viewBox="0 0 440 236" aria-hidden="true">
          <path
            className="a-hero-grid"
            d="M0 44h440M0 93h440M0 142h440M0 191h440M72 0v236M132 0v236M192 0v236M252 0v236M312 0v236M372 0v236"
          />
          <path
            className="a-hero-echo"
            d="M0 192h105l38-26h31l39-48h35l28 22h44l56-38h64M0 180h97l43-32h32l38-47h39l30 25h41l54-40h66"
          />
          <path className="a-hero-trace" d="M0 166h95l43-38h30l40-48h42l30 28h37l55-41h68" />
          <path className="a-hero-axis" d="M208 44v148M372 44v148" />
          <circle cx="208" cy="80" r="4" />
          <circle cx="372" cy="67" r="4" />
        </svg>
      </section>

      <PendingSetupCard onOpenAssistant={openSetupAssistant} />

      <DailiesStrip />
      <DailiesAsk />

      {overview.error && !data ? (
        <ErrorBox error={overview.error} onRetry={overview.reload} />
      ) : !data ? (
        <Loading text={uiText('Carregando suas pistas…')} />
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

          {isDemo && !hideDemo && tracks.length > 0 && (
            <p className="a-note">
              <Tag tone="warn">Demo</Tag>
              {' ' +
                uiText(
                  'Você está no modo demonstração: estas voltas vêm de um piloto simulado, não do console.',
                )}
            </p>
          )}

          {tracks.length > 0 && (
            <search className="a-toolbar">
              <label className="a-search a-grow">
                {uiText('Buscar pista')}
                <span className="a-search-field">
                  <Icon name="search" size={18} />
                  <input
                    className="a-input"
                    type="search"
                    value={query}
                    placeholder={uiText('Ex.: Monza, Suzuka…')}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </span>
              </label>
              <CarFilterField usage={usage} value={carFilter} onChange={setCarFilter} />
              {isDemo && (
                <label className="a-check-inline">
                  <input
                    type="checkbox"
                    checked={hideDemo}
                    onChange={(e) => setHide(e.target.checked)}
                  />
                  {uiText('Esconder demonstração')}
                </label>
              )}
            </search>
          )}

          {tracks.length > 0 && filtering && (
            <div className="cf-chips">
              {query.trim() !== '' && (
                <FilterChip
                  label={uiText('Pista: {0}', query.trim())}
                  title={uiText('Busca por pista')}
                  onRemove={() => setQuery('')}
                />
              )}
              <CarFilterChips value={carFilter} onChange={setCarFilter} />
              <button
                type="button"
                className="a-btn a-btn-quiet a-btn-sm cf-chip-clear"
                onClick={clearFilters}
              >
                {uiText('Limpar filtros')}
              </button>
            </div>
          )}

          {shown.length === 0 ? (
            filtering ? (
              <div className="ui-empty a-empty">
                <Icon name="search" size={28} />
                <strong>{uiText('Nenhuma pista encontrada')}</strong>
                <p>
                  {uiText('Nada combina com esse filtro.')}
                  {isCarFiltering(carFilter) &&
                    uiText(' Talvez você ainda não tenha voltas com esse carro.')}
                </p>
                <button type="button" className="a-btn a-btn-ghost" onClick={clearFilters}>
                  {uiText('Limpar filtros')}
                </button>
              </div>
            ) : (
              <EmptyHome
                hiddenDemo={isDemo && hideDemo && tracks.length > 0}
                onShowDemo={() => setHide(false)}
              />
            )
          ) : (
            <>
              <div className="a-sectionhead">
                <h2>{filtering ? uiText('Resultado') : uiText('Pistas')}</h2>
                <span className="dim a-small">
                  {filtering
                    ? uiText(
                        '{0} de {1}',
                        shown.length,
                        plural(tracks.length, uiText('pista'), uiText('pistas')),
                      )
                    : uiText('Mais recentes primeiro')}
                </span>
              </div>
              <div className="a-trackgrid">
                {shown.map((t, i) => (
                  <TrackCard
                    key={t.id}
                    t={t}
                    demo={isDemo}
                    carFilter={carFilter}
                    tourAnchor={i === 0}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
