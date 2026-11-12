/**
 * #/analise/sessao/:id/resumo — the session in one screen (spec 12): best lap against the driver's
 * record, pace, consistency, comparison with the last/best session or the goal, where corners were
 * gained and lost, and up to three rule-made suggestions for next time.
 */

import {
  type SessionSummary,
  type SummaryComparison,
  type SummaryTrend,
  suggestionText,
  summaryToText,
} from '@gt7/shared';
import { useMemo, useState } from 'react';
import { formatDelta, formatLapTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { routes } from '../../lib/route.ts';
import { api } from '../api.ts';
import { CarName } from '../components/CarName.tsx';
import {
  Card,
  CopyButton,
  Empty,
  ErrorBox,
  Loading,
  PageHead,
  useTitle,
} from '../components/ui.tsx';
import { formatDuration, fullTrackName } from '../lib/history.ts';
import { formatDateTime } from '../lib/labels.ts';
import { useFetch } from '../useFetch.ts';

type CompareKind = 'lastSession' | 'bestSession' | 'goal';

const TREND_TEXT: Record<SummaryTrend, () => string> = {
  improving: () => uiText('Melhorando ao longo da sessão'),
  steady: () => uiText('Estável'),
  worsening: () => uiText('Piorando ao longo da sessão'),
};

function compareLabel(kind: CompareKind): string {
  return kind === 'lastSession'
    ? uiText('Última sessão')
    : kind === 'bestSession'
      ? uiText('Melhor sessão')
      : uiText('Meta');
}

function Delta({ ms }: { ms: number }) {
  return (
    <span className="num" data-tone={ms < 0 ? 'gain' : ms > 0 ? 'loss' : undefined}>
      {formatDelta(ms)}
    </span>
  );
}

function ComparisonBlock({ kind, c }: { kind: CompareKind; c: SummaryComparison }) {
  return (
    <div className="ss-compare">
      <p>
        {kind === 'goal'
          ? uiText('Sua melhor volta contra a meta ({0}):', formatLapTime(c.baselineMs))
          : uiText(
              'Sua melhor volta contra a {0} ({1}):',
              compareLabel(kind).toLowerCase(),
              formatLapTime(c.baselineMs),
            )}{' '}
        <Delta ms={c.bestDeltaMs} />
      </p>
      {c.paceDeltaMs !== null && (
        <p>
          {uiText('Média das 5 melhores contra essa sessão:')} <Delta ms={c.paceDeltaMs} />
        </p>
      )}
      {c.startedAt !== null && c.sessionId !== null && (
        <p className="dim a-small">
          <a href={routes.summary(c.sessionId)}>{formatDateTime(c.startedAt)}</a>
        </p>
      )}
    </div>
  );
}

function Histogram({ buckets }: { buckets: NonNullable<SessionSummary['pace']>['histogram'] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="ss-hist-box">
      <div className="ss-hist" role="img" aria-label={uiText('Distribuição dos tempos de volta')}>
        {buckets.map((b) => (
          <div
            key={b.fromMs}
            className="ss-hist-col"
            title={`${formatLapTime(b.fromMs)} – ${formatLapTime(b.toMs)}`}
          >
            <span
              className="ss-hist-bar"
              style={{ height: b.count === 0 ? '2px' : `${Math.max(14, (b.count / max) * 100)}%` }}
              data-empty={b.count === 0 ? '1' : '0'}
            />
            <span className="ss-hist-n num">{b.count}</span>
          </div>
        ))}
      </div>
      <div className="ss-hist-axis num">
        <span>{formatLapTime(buckets[0]!.fromMs)}</span>
        <span>{formatLapTime(buckets.at(-1)!.toMs)}</span>
      </div>
    </div>
  );
}

export function SessionSummaryPage({ id }: { id: string }) {
  const sum = useFetch(`sum:${id}`, () => api.sessionSummary(id));
  const s = sum.data;
  const track = useFetch(s?.trackId ? `track:${s.trackId}` : null, () => api.track(s!.trackId!));
  useTitle(uiText('Resumo da sessão'));

  const kinds = useMemo(
    () =>
      (['lastSession', 'bestSession', 'goal'] as const).filter((k) => s?.comparisons[k] != null),
    [s],
  );
  const [picked, setPicked] = useState<CompareKind | null>(null);
  const kind: CompareKind | null = picked && kinds.includes(picked) ? picked : (kinds[0] ?? null);

  const back = { href: routes.session(id), label: uiText('Voltas da sessão') };
  if (sum.error && !s) {
    return (
      <>
        <PageHead title={uiText('Resumo da sessão')} back={back} />
        <ErrorBox error={sum.error} onRetry={sum.reload} />
      </>
    );
  }
  if (!s) return <Loading />;

  const trackName = track.data ? fullTrackName(track.data) : null;
  const text = summaryToText(s, {
    lapTime: (ms) => formatLapTime(ms),
    delta: (ms) => formatDelta(ms),
    ...(trackName ? { trackName } : {}),
    translate: uiText,
  });
  const comparison = kind ? s.comparisons[kind] : null;

  return (
    <>
      <PageHead
        back={back}
        title={uiText('Resumo da sessão')}
        sub={
          <>
            {trackName ?? uiText('Pista não identificada')} · <CarName carCode={s.carCode} /> ·{' '}
            {formatDateTime(s.startedAt)}
          </>
        }
        actions={<CopyButton text={text} label={uiText('Copiar resumo')} />}
      />

      {s.laps.total === 0 || !s.best ? (
        <Empty action={{ label: uiText('Abrir a tela ao vivo'), href: routes.live() }}>
          <p>{uiText('Esta sessão não tem voltas válidas para resumir.')}</p>
        </Empty>
      ) : (
        <>
          {s.reduced && (
            <p className="ui-card ss-note" data-tone="info">
              {uiText(
                'Sessão curta (menos de 3 voltas limpas): o resumo mostra só o essencial, sem tendência.',
              )}
            </p>
          )}

          <div className="a-stats">
            <div className="a-stat" data-emph="1">
              <span className="a-stat-k">{uiText('Melhor volta')}</span>
              <span className="a-stat-v num">{formatLapTime(s.best.timeMs)}</span>
              <span className="a-stat-s">
                {s.best.deltaMs === null ? (
                  uiText('Primeira vez nesta pista')
                ) : (
                  <>
                    <Delta ms={s.best.deltaMs} /> {uiText('contra o recorde anterior')}
                  </>
                )}
              </span>
            </div>
            <div className="a-stat">
              <span className="a-stat-k">{uiText('Voltas')}</span>
              <span className="a-stat-v num">{s.laps.total}</span>
              <span className="a-stat-s">
                {uiText('{0} válidas · {1} inválidas', s.laps.valid, s.laps.invalid)}
              </span>
            </div>
            <div className="a-stat">
              <span className="a-stat-k">{uiText('Tempo de pista')}</span>
              <span className="a-stat-v num">
                {s.durationMs !== null ? (formatDuration(0, s.durationMs) ?? '–') : '–'}
              </span>
            </div>
          </div>

          {s.pace && (
            <Card title={uiText('Ritmo')}>
              <div className="a-stats">
                <div className="a-stat">
                  <span className="a-stat-k">{uiText('Média das 5 melhores')}</span>
                  <span className="a-stat-v num">{formatLapTime(s.pace.top5AvgMs)}</span>
                </div>
                <div className="a-stat">
                  <span className="a-stat-k">{uiText('Mediana')}</span>
                  <span className="a-stat-v num">{formatLapTime(s.pace.medianMs)}</span>
                </div>
                <div className="a-stat">
                  <span className="a-stat-k">{uiText('Faixa de tempos')}</span>
                  <span className="a-stat-v num">
                    {formatDelta(s.pace.spreadMs).replace('+', '')}
                  </span>
                  <span className="a-stat-s num">
                    {formatLapTime(s.pace.fastestMs)} – {formatLapTime(s.pace.slowestMs)}
                  </span>
                </div>
              </div>
              {s.pace.histogram.length > 0 && <Histogram buckets={s.pace.histogram} />}
            </Card>
          )}

          {s.consistency && (
            <Card title={uiText('Regularidade')}>
              <p>
                {uiText('Desvio das voltas limpas:')}{' '}
                <strong className="num">
                  {(s.consistency.stdDevMs / 1000).toFixed(3).replace('.', ',')} s
                </strong>
                {s.consistency.trend && (
                  <>
                    {' · '}
                    <span data-trend={s.consistency.trend}>
                      {TREND_TEXT[s.consistency.trend]()}
                    </span>
                  </>
                )}
              </p>
            </Card>
          )}

          <Card
            title={uiText('Comparação')}
            actions={
              kinds.length > 1 && (
                <fieldset className="ss-pick" aria-label={uiText('Comparar contra')}>
                  {kinds.map((k) => (
                    <label key={k} className="ui-chip" data-on={kind === k ? '1' : '0'}>
                      <input
                        type="radio"
                        name="ss-kind"
                        checked={kind === k}
                        onChange={() => setPicked(k)}
                      />
                      {compareLabel(k)}
                    </label>
                  ))}
                </fieldset>
              )
            }
          >
            {comparison && kind ? (
              <ComparisonBlock kind={kind} c={comparison} />
            ) : (
              <p className="dim">
                {s.best.firstTime
                  ? uiText('Primeira vez nesta pista: ainda não há com o que comparar.')
                  : uiText('Sem uma sessão anterior com este carro nesta pista para comparar.')}
              </p>
            )}
          </Card>

          {s.corners && (s.corners.gains.length > 0 || s.corners.losses.length > 0) && (
            <Card title={uiText('Onde você ganhou e onde perdeu')}>
              <p className="dim a-small">
                {uiText(
                  'Sua melhor volta desta sessão contra a melhor volta anterior, curva a curva.',
                )}
              </p>
              <div className="ss-cols">
                <ul className="ss-list" aria-label={uiText('Ganhou')}>
                  {s.corners.gains.map((c) => (
                    <li key={c.cornerId}>
                      <span>{c.name ?? c.cornerId}</span> <Delta ms={c.deltaMs} />
                    </li>
                  ))}
                </ul>
                <ul className="ss-list" aria-label={uiText('Perdeu')}>
                  {s.corners.losses.map((c) => (
                    <li key={c.cornerId}>
                      <span>{c.name ?? c.cornerId}</span> <Delta ms={c.deltaMs} />
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}

          <Card title={uiText('Para a próxima')}>
            {s.suggestions.length > 0 ? (
              <ul className="ss-tips">
                {s.suggestions.map((tip) => (
                  <li key={tip.code}>{suggestionText(tip, uiText)}</li>
                ))}
              </ul>
            ) : (
              <p className="dim">
                {uiText('Nada se destaca acima do ruído normal das voltas. Siga o plano.')}
              </p>
            )}
            <p className="a-actions">
              <a className="a-btn a-btn-ghost" href={routes.session(id)}>
                {uiText('Ver as voltas')}
              </a>
              {s.trackId && (
                <a className="a-btn a-btn-ghost" href={routes.track(s.trackId)}>
                  {uiText('Abrir a pista')}
                </a>
              )}
            </p>
          </Card>
        </>
      )}
    </>
  );
}
