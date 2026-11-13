/**
 * #/analise/semana?w=N — "Resumo da semana": the last 7 days (or the 7 before them, N weeks back)
 * per track: best lap against the record before, personal records, goals reached. It can be copied
 * as text or shared as an image.
 */

import { PRODUCT_NAME, type WeeklySummary, weeklyToText } from '@gt7/shared';
import { useEffect, useMemo, useState } from 'react';
import { formatDelta, formatLapTime } from '../../lib/format.ts';
import { getLanguage, t as uiText } from '../../lib/i18n.ts';
import { type Route, routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import '../../styles/weekly-summary.css';
import { api } from '../api.ts';
import {
  Card,
  CopyButton,
  Empty,
  ErrorBox,
  Loading,
  PageHead,
  useTitle,
} from '../components/ui.tsx';
import { formatDuration } from '../lib/history.ts';
import { carLabel } from '../lib/labels.ts';
import { weeklyImageBlob, weeklyImageModel } from '../lib/weeklyImage.ts';
import { useFetch } from '../useFetch.ts';

const dateOf = (ms: number) =>
  new Date(ms).toLocaleDateString(getLanguage(), { day: '2-digit', month: '2-digit' });

function Delta({ ms }: { ms: number }) {
  return (
    <span className="num" data-tone={ms < 0 ? 'gain' : ms > 0 ? 'loss' : undefined}>
      {formatDelta(ms)}
    </span>
  );
}

function textOf(s: WeeklySummary): string {
  return weeklyToText(s, {
    lapTime: (ms) => formatLapTime(ms),
    delta: (ms) => formatDelta(ms),
    date: dateOf,
    car: (c) => carLabel(c),
    translate: uiText,
  });
}

/** The shareable card as an image, with the buttons to download or copy it. */
function ShareImage({ summary }: { summary: WeeklySummary }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const model = useMemo(
    () =>
      weeklyImageModel(summary, {
        lapTime: (ms) => formatLapTime(ms),
        delta: (ms) => formatDelta(ms),
        date: dateOf,
        car: (c) => carLabel(c),
        t: uiText,
      }),
    [summary],
  );

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    void weeklyImageBlob(model, PRODUCT_NAME).then((b) => {
      if (!alive || !b) return;
      made = URL.createObjectURL(b);
      setBlob(b);
      setUrl(made);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [model]);

  const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
  const copy = async () => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      addNotice('info', uiText('Imagem copiada.'), 3000);
    } catch {
      addNotice('error', uiText('Não foi possível copiar a imagem. Baixe o arquivo.'), 5000);
    }
  };

  return (
    <Card
      title={uiText('Imagem para compartilhar')}
      actions={
        <>
          {url && (
            <a
              className="a-btn a-btn-ghost a-btn-sm"
              href={url}
              download={`bono-semana-${new Date(summary.toMs - 1).toISOString().slice(0, 10)}.png`}
            >
              {uiText('Baixar imagem')}
            </a>
          )}
          {canCopy && (
            <button
              type="button"
              className="a-btn a-btn-ghost a-btn-sm"
              disabled={!blob}
              onClick={() => void copy()}
            >
              {uiText('Copiar imagem')}
            </button>
          )}
        </>
      }
    >
      {url ? (
        <img
          className="ws-image"
          src={url}
          alt={uiText('Resumo da semana, pronto para compartilhar')}
        />
      ) : (
        <Loading />
      )}
    </Card>
  );
}

export function WeeklySummaryPage({ route }: { route: Route }) {
  const weeksAgo = Math.max(0, Math.min(520, Number.parseInt(route.query.w ?? '0', 10) || 0));
  const data = useFetch(`weekly:${weeksAgo}`, () => api.weekly(weeksAgo));
  useTitle(uiText('Resumo da semana'));
  const s = data.data;

  const text = useMemo(() => (s ? textOf(s) : ''), [s]);
  const back = { href: routes.home(), label: uiText('Início') };

  if (data.error && !s) {
    return (
      <>
        <PageHead title={uiText('Resumo da semana')} back={back} />
        <ErrorBox error={data.error} onRetry={data.reload} />
      </>
    );
  }
  if (!s) return <Loading />;

  const nav = (
    <>
      <a className="a-btn a-btn-ghost a-btn-sm" href={routes.weekly(weeksAgo + 1)}>
        {uiText('Semana anterior')}
      </a>
      {weeksAgo > 0 && (
        <a className="a-btn a-btn-ghost a-btn-sm" href={routes.weekly(weeksAgo - 1)}>
          {uiText('Semana seguinte')}
        </a>
      )}
    </>
  );

  return (
    <>
      <PageHead
        back={back}
        title={uiText('Resumo da semana')}
        sub={uiText('{0} a {1}', dateOf(s.fromMs), dateOf(s.toMs - 1))}
        actions={
          <>
            {nav}
            {s.sessions > 0 && <CopyButton text={text} label={uiText('Copiar resumo')} />}
          </>
        }
      />

      {s.sessions === 0 ? (
        <Empty action={{ label: uiText('Abrir a tela ao vivo'), href: routes.live() }}>
          <p>{uiText('Nenhuma volta nesta semana.')}</p>
        </Empty>
      ) : (
        <div className="ss-stack">
          <div className="a-stats">
            <div className="a-stat" data-emph="1">
              <span className="a-stat-k">{uiText('Recordes pessoais')}</span>
              <span className="a-stat-v num">{s.records}</span>
              <span className="a-stat-s">
                {s.goalsReached.length > 0
                  ? uiText('{0} meta(s) batida(s)', s.goalsReached.length)
                  : uiText('Nenhuma meta batida')}
              </span>
            </div>
            <div className="a-stat">
              <span className="a-stat-k">{uiText('Sessões')}</span>
              <span className="a-stat-v num">{s.sessions}</span>
            </div>
            <div className="a-stat">
              <span className="a-stat-k">{uiText('Voltas')}</span>
              <span className="a-stat-v num">{s.laps}</span>
              <span className="a-stat-s">{uiText('{0} válidas', s.validLaps)}</span>
            </div>
            <div className="a-stat">
              <span className="a-stat-k">{uiText('Tempo de pista')}</span>
              <span className="a-stat-v num">{formatDuration(0, s.drivingMs) ?? '–'}</span>
            </div>
          </div>

          <Card title={uiText('Por pista')}>
            <ul className="ws-tracks">
              {s.tracks.map((t) => (
                <li key={`${t.trackId}-${t.carCode}`} className="ws-track">
                  <div className="ws-track-name">
                    <a href={routes.track(t.trackId)}>
                      <strong>{t.trackName ?? uiText('Pista')}</strong>
                    </a>
                    <span className="dim a-small">
                      {carLabel(t.carCode)} · {uiText('{0} voltas', t.laps)}
                    </span>
                  </div>
                  <div className="ws-track-time">
                    <span className="num ws-best">
                      {t.bestMs === null ? '–' : formatLapTime(t.bestMs)}
                    </span>
                    <span className="a-small">
                      {t.firstTime ? (
                        <span className="dim">{uiText('primeira vez')}</span>
                      ) : t.deltaMs !== null ? (
                        <>
                          <Delta ms={t.deltaMs} />{' '}
                          <span className="dim">
                            {t.deltaMs < 0
                              ? uiText('vs. recorde anterior')
                              : uiText('do recorde anterior')}
                          </span>
                        </>
                      ) : null}
                    </span>
                    {t.goal && (
                      <span className="a-small ws-goal" data-reached={t.goal.reached ? '1' : '0'}>
                        {t.goal.reached
                          ? uiText('Meta batida')
                          : uiText(
                              'Faltam {0} para a meta',
                              formatDelta(t.goal.remainingMs).replace('+', ''),
                            )}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {s.goalsReached.length > 0 && (
            <Card title={uiText('Metas batidas na semana')}>
              <ul className="ss-list">
                {s.goalsReached.map((g) => (
                  <li key={`${g.trackId}-${g.achievedAt}`}>
                    <span>{g.trackName ?? uiText('Pista')}</span>
                    <span className="num">{formatLapTime(g.targetMs)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <ShareImage summary={s} />
        </div>
      )}
    </>
  );
}
