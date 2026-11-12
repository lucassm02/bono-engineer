/**
 * Corridas diárias (#/diarias): as três corridas da semana do GT7 com as regras, os tempos de corte
 * das medalhas e, ao lado, a melhor volta do piloto na mesma pista. Os dados vêm do DG EDGE (buscados
 * pelo servidor local, com cache) e cada cartão leva o link para a página original.
 */

import type { ApiDailyRaces, DailyRace } from '@gt7/shared';
import { useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { t as uiText, useLanguage } from '../../lib/i18n.ts';
import { routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import '../../styles/dailies.css';
import { api } from '../api.ts';
import { Panel } from '../components/Panel.tsx';
import { ErrorBox, Loading, PageHead, useTitle } from '../components/ui.tsx';
import {
  formatRaceMinutes,
  type MedalName,
  matchSavedTrack,
  medalStatus,
  raceMinutes,
} from '../lib/dailies.ts';
import { type TrackOverview, whenLabel } from '../lib/history.ts';
import { useFetch } from '../useFetch.ts';

const MEDALS: { id: MedalName; label: () => string }[] = [
  { id: 'platinum', label: () => uiText('Platina') },
  { id: 'gold', label: () => uiText('Ouro') },
  { id: 'silver', label: () => uiText('Prata') },
  { id: 'bronze', label: () => uiText('Bronze') },
];

const medalLabel = (m: MedalName) => MEDALS.find((x) => x.id === m)!.label();

function dateRange(from: string, to: string, lang: string): string {
  const f = new Date(from);
  const t = new Date(to);
  const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${fmt.format(f)} – ${fmt.format(t)}`;
}

export function DailiesPage() {
  useTitle(uiText('Corridas diárias'));
  const lang = useLanguage();
  const dailies = useFetch('dailies', () => api.dailyRaces());
  const overview = useFetch('overview', () => api.tracksOverview());
  const [busy, setBusy] = useState(false);
  const data = dailies.data;

  async function refresh() {
    setBusy(true);
    try {
      const r = await api.dailyRefresh();
      if (!r.ok && r.reason === 'tooSoon') {
        addNotice('info', uiText('Atualizado há pouco. Tente de novo em alguns minutos.'), 5000);
      }
      dailies.reload();
    } catch (e) {
      addNotice('error', (e as Error).message, 7000);
    } finally {
      setBusy(false);
    }
  }

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    try {
      await api.dailySetEnabled(enabled);
      dailies.reload();
    } catch (e) {
      addNotice('error', (e as Error).message, 7000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        back={{ href: routes.home(), label: uiText('Voltar ao Início') }}
        eyebrow={uiText('GT7 · Modo Esportivo')}
        title={uiText('Corridas diárias')}
        sub={uiText(
          'As três corridas da semana, com as regras, os tempos de cada medalha e a sua melhor volta na mesma pista.',
        )}
        actions={
          data?.enabled ? (
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              disabled={busy}
              onClick={() => void refresh()}
            >
              {busy ? uiText('Atualizando…') : uiText('Atualizar')}
            </button>
          ) : undefined
        }
      />

      {dailies.error && !data ? (
        <ErrorBox error={dailies.error} onRetry={dailies.reload} />
      ) : !data ? (
        <Loading text={uiText('Buscando as corridas da semana…')} />
      ) : !data.enabled ? (
        <Panel tone="warn" title={uiText('Corridas diárias desativadas')}>
          <p className="dl-note">
            {uiText(
              'Com isto ligado, o Bono consulta o site DG EDGE a partir do seu PC, no máximo uma vez por hora, para mostrar as corridas da semana.',
            )}
          </p>
          <button
            type="button"
            className="ui-btn"
            disabled={busy}
            onClick={() => void setEnabled(true)}
          >
            {uiText('Ativar')}
          </button>
        </Panel>
      ) : (
        <>
          <Status data={data} />
          {data.races.length === 0 ? (
            <Panel title={uiText('Sem dados ainda')}>
              <p className="dl-note">
                {data.error
                  ? uiText('Não consegui buscar as corridas agora: {0}', data.error)
                  : uiText('Ainda não há corridas guardadas. Toque em Atualizar.')}
              </p>
            </Panel>
          ) : (
            <>
              {data.week && (
                <h2 className="dl-week">
                  {uiText('Semana {0}', data.week.week)}
                  <span>{dateRange(data.week.from, data.week.to, lang)}</span>
                </h2>
              )}
              <div className="dl-grid">
                {data.races.map((race) => (
                  <DailyCard
                    key={race.id}
                    race={race}
                    mine={overview.data ? matchSavedTrack(race, overview.data.tracks) : null}
                    lang={lang}
                  />
                ))}
              </div>
              <PastWeeks data={data} />
            </>
          )}
          <Source data={data} onDisable={() => void setEnabled(false)} busy={busy} />
        </>
      )}
    </>
  );
}

function Status({ data }: { data: ApiDailyRaces }) {
  if (!data.fetchedAt && !data.error) return null;
  return (
    <p className="dl-status" role="status" data-tone={data.error ? 'warn' : undefined}>
      {data.fetchedAt && uiText('Atualizado {0}.', whenLabel(data.fetchedAt, Date.now()))}{' '}
      {data.error && uiText('A última tentativa falhou: {0}', data.error)}
    </p>
  );
}

function DailyCard({
  race,
  mine,
  lang,
}: {
  race: DailyRace;
  mine: TrackOverview | null;
  lang: string;
}) {
  const minutes = raceMinutes(race.everyMinutes, race.offsetMinutes);
  const best = mine?.best ?? null;
  const status = best && race.medals ? medalStatus(best.timeMs, race.medals) : null;
  const chips: string[] = [];
  if (race.bop) chips.push('BoP');
  if (race.damage && race.damage !== 'none') chips.push(damageText(race.damage));
  if (race.startType)
    chips.push(race.startType === 'rolling' ? uiText('Largada lançada') : uiText('Largada parada'));
  if (race.tuningAllowed !== null)
    chips.push(race.tuningAllowed ? uiText('Ajustes liberados') : uiText('Sem ajustes'));
  if (race.slipstream) chips.push(uiText('Vácuo: {0}', slipstreamText(race.slipstream)));

  return (
    <article className="ui-card dl-card" aria-label={uiText('Corrida {0}', race.type)}>
      <header className="dl-head">
        <span className="ui-badge" data-tone="accent">
          {uiText('Corrida {0}', race.type)}
        </span>
        <h3 className="dl-track">{race.trackName}</h3>
        <p className="dl-car">
          {race.carLabel}
          <span>
            {uiText('{0} voltas', race.laps)}
            {race.tyres.length > 0 && ` · ${race.tyres.join(' + ')}`}
          </span>
        </p>
      </header>

      {chips.length > 0 && (
        <ul className="dl-chips" aria-label={uiText('Regras')}>
          {chips.map((c) => (
            <li key={c} className="ui-badge">
              {c}
            </li>
          ))}
        </ul>
      )}

      {minutes.length > 0 && (
        <p className="dl-schedule">
          {uiText(
            'Uma corrida a cada {0} min, aos {1}',
            race.everyMinutes,
            formatRaceMinutes(minutes),
          )}
        </p>
      )}

      {race.medals && (
        <ul className="dl-medals" aria-label={uiText('Tempos das medalhas')}>
          {MEDALS.map(({ id, label }) => (
            <li
              key={id}
              className="dl-medal"
              data-medal={id}
              data-reached={status?.reached === id ? '1' : undefined}
            >
              <span className="ui-stat-label">{label()}</span>
              <strong className="num">{formatLapTime(race.medals![id].timeMs)}</strong>
              <small>
                {uiText('{0}% dos jogadores', race.medals![id].percentPlayers.toLocaleString(lang))}
              </small>
            </li>
          ))}
        </ul>
      )}

      <div className="dl-mine">
        {best ? (
          <>
            <span className="ui-stat-label">{uiText('Sua melhor volta aqui')}</span>
            <strong className="num">{formatLapTime(best.timeMs)}</strong>
            {status && (
              <span className="dl-verdict">
                {status.reached ? medalLabel(status.reached) : uiText('Abaixo do bronze')}
                {status.next &&
                  ` · ${uiText('faltam {0} s para o {1}', (status.next.gapMs / 1000).toLocaleString(lang, { minimumFractionDigits: 3, maximumFractionDigits: 3 }), medalLabel(status.next.medal).toLowerCase())}`}
              </span>
            )}
            {mine && (
              <a className="dl-link" href={routes.track(mine.id, { from: 'dailies' })}>
                {uiText('Ver a pista')}
              </a>
            )}
          </>
        ) : (
          <span className="dl-muted">{uiText('Você ainda não tem voltas nesta pista.')}</span>
        )}
      </div>

      <dl className="dl-facts">
        {race.players !== null && (
          <div>
            <dt>{uiText('Jogadores')}</dt>
            <dd className="num">{race.players.toLocaleString(lang)}</dd>
          </div>
        )}
        {race.top100Ms !== null && (
          <div>
            <dt>{uiText('Top 100')}</dt>
            <dd className="num">{formatLapTime(race.top100Ms)}</dd>
          </div>
        )}
        {race.top1000Ms !== null && (
          <div>
            <dt>{uiText('Top 1000')}</dt>
            <dd className="num">{formatLapTime(race.top1000Ms)}</dd>
          </div>
        )}
      </dl>

      {race.mostUsedCars.length > 0 && (
        <div className="dl-cars">
          <span className="ui-stat-label">{uiText('Carros mais usados')}</span>
          <ol>
            {race.mostUsedCars.slice(0, 3).map((c) => (
              <li key={c.name}>
                <span>{c.name}</span>
                <span className="num">{c.percent.toLocaleString(lang)}%</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {race.leader && (
        <div className="dl-leader">
          <span className="ui-stat-label">{uiText('1º lugar')}</span>
          <p>
            <span className="num">{formatLapTime(race.leader.timeMs)}</span>
            {race.leader.car && <span className="dl-muted"> · {race.leader.car}</span>}
          </p>
          <a
            className="ui-btn"
            data-variant="secondary"
            data-size="sm"
            href={routes.capture({ daily: race.id })}
          >
            {uiText('Usar como referência')}
          </a>
        </div>
      )}

      <footer className="dl-foot">
        <a href={race.url} target="_blank" rel="noopener noreferrer">
          {uiText('Ver na íntegra no DG EDGE')}
        </a>
      </footer>
    </article>
  );
}

function slipstreamText(s: string): string {
  if (s === 'simulation') return uiText('simulação');
  if (s === 'custom') return uiText('personalizado');
  return s;
}

function damageText(d: string): string {
  switch (d) {
    case 'light':
      return uiText('Dano leve');
    case 'medium':
      return uiText('Dano médio');
    case 'heavy':
      return uiText('Dano pesado');
    default:
      return d;
  }
}

function PastWeeks({ data }: { data: ApiDailyRaces }) {
  if (data.past.length === 0) return null;
  return (
    <Panel
      title={uiText('Semanas anteriores')}
      description={uiText('Para saber quando uma pista já rodou.')}
    >
      <ul className="dl-past">
        {data.past.map((p) => (
          <li key={p.id}>
            <span className="num dl-past-week">
              {p.week}
              {p.type}
            </span>
            <a href={p.url} target="_blank" rel="noopener noreferrer">
              {p.trackName}
            </a>
            <span className="dl-muted">{p.carLabel}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Source({
  data,
  onDisable,
  busy,
}: {
  data: ApiDailyRaces;
  onDisable: () => void;
  busy: boolean;
}) {
  return (
    <p className="dl-source">
      {uiText('Dados do')}{' '}
      <a href={data.source.url} target="_blank" rel="noopener noreferrer">
        {data.source.name}
      </a>
      {uiText(
        ', buscados a partir do seu PC e guardados por uma hora. O Bono não republica nada: para ver o ranking e os detalhes, abra o site.',
      )}{' '}
      <button type="button" className="dl-linkbtn" disabled={busy} onClick={onDisable}>
        {uiText('Desativar')}
      </button>
    </p>
  );
}
