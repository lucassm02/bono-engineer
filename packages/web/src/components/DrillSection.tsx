/**
 * "Treinar uma curva" (spec 18) inside the Treino de curva view: pick one corner and the engineer
 * talks only about it; this card shows every pass (stretch time, speeds, brake point), the last ten
 * and how the best pass compares. Stopping shows the summary of the drill.
 */

import { assessDrillPass, type LiveDrill, type LiveDrillPass } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { parseLapTime } from '../analysis/lib/lapTime.ts';
import { formatDelta } from '../lib/format.ts';
import { t as uiText } from '../lib/i18n.ts';
import { useLiveRender } from '../live/raf.ts';
import {
  dismissDrillSummary,
  feedDrill,
  loadDrillCorners,
  startDrill,
  stopDrill,
  useDrill,
} from '../state/drill.ts';
import { cornerLabel } from '../views/MapView.tsx';

const sec = (ms: number) => (ms / 1000).toFixed(3).replace('.', ',');

function phaseText(d: LiveDrill): string {
  if (d.phase === 'in') return uiText('Na curva');
  if (d.phase === 'approach') {
    return d.distanceToEntryM !== null
      ? uiText('Entrada em {0} m', d.distanceToEntryM)
      : uiText('Chegando à curva');
  }
  return uiText('Dê a volta e volte à curva');
}

function History({ drill }: { drill: LiveDrill }) {
  const times = drill.passes.map((p) => p.timeMs);
  if (times.length === 0) return null;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = Math.max(1, max - min);
  return (
    <ol className="dr-hist" aria-label={uiText('Últimas passagens')}>
      {drill.passes.map((p) => (
        <li
          key={p.n}
          data-best={drill.best?.n === p.n ? '1' : '0'}
          title={`#${p.n} · ${sec(p.timeMs)} s`}
        >
          <span
            className="dr-hist-bar"
            style={{ height: `${30 + ((p.timeMs - min) / span) * 70}%` }}
          />
          <span className="num dr-hist-n">{p.n}</span>
        </li>
      ))}
    </ol>
  );
}

function LastPass({ drill, pass }: { drill: LiveDrill; pass: LiveDrillPass }) {
  const earlier = drill.passes.filter((p) => p.n < pass.n);
  const pool =
    drill.best && drill.best.n < pass.n && !earlier.some((p) => p.n === drill.best!.n)
      ? [...earlier, drill.best]
      : earlier;
  const v = assessDrillPass(pass, pool);
  const tone =
    v.vsBestMs === null ? undefined : v.vsBestMs < 0 ? 'gain' : v.vsBestMs > 0 ? 'loss' : undefined;
  return (
    <div className="dr-last">
      <div className="dr-last-head">
        <span className="readout-label">{uiText('Passagem {0}', pass.n)}</span>
        <span className="num dr-time" data-tone={tone}>
          {sec(pass.timeMs)} s
        </span>
        {v.vsBestMs !== null && (
          <span className="num" data-tone={tone}>
            {formatDelta(v.vsBestMs)} {uiText('vs a melhor')}
          </span>
        )}
      </div>
      <dl className="dr-stats num">
        <div>
          <dt>{uiText('Entrada')}</dt>
          <dd>
            {Math.round(pass.entrySpeedKmh)} km/h
            {v.entrySpeedDeltaKmh !== null && Math.abs(v.entrySpeedDeltaKmh) >= 1 && (
              <small>
                {' '}
                ({v.entrySpeedDeltaKmh > 0 ? '+' : '−'}
                {Math.abs(Math.round(v.entrySpeedDeltaKmh))})
              </small>
            )}
          </dd>
        </div>
        <div>
          <dt>{uiText('V-mín')}</dt>
          <dd>{Math.round(pass.minSpeedKmh)} km/h</dd>
        </div>
        <div>
          <dt>{uiText('Saída')}</dt>
          <dd>
            {Math.round(pass.exitSpeedKmh)} km/h
            {v.exitSpeedDeltaKmh !== null && Math.abs(v.exitSpeedDeltaKmh) >= 1 && (
              <small>
                {' '}
                ({v.exitSpeedDeltaKmh > 0 ? '+' : '−'}
                {Math.abs(Math.round(v.exitSpeedDeltaKmh))})
              </small>
            )}
          </dd>
        </div>
        <div>
          <dt>{uiText('Freada')}</dt>
          <dd>
            {pass.brakePointM === null ? uiText('sem freio') : `${pass.brakePointM} m`}
            {drill.referenceBrakeM !== null && (
              <small> {uiText('(ref. {0} m)', drill.referenceBrakeM)}</small>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function DrillSection() {
  const drill = useDrill((s) => s.drill);
  const summary = useDrill((s) => s.summary);
  const corners = useDrill((s) => s.corners);
  const busy = useDrill((s) => s.busy);
  const error = useDrill((s) => s.error);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [cornerId, setCornerId] = useState('');
  const [target, setTarget] = useState('');

  useLiveRender((f) => {
    feedDrill(f);
    const id = f.track?.id ?? null;
    setTrackId((cur) => (cur === id ? cur : id));
  });

  useEffect(() => {
    if (trackId) void loadDrillCorners(trackId);
  }, [trackId]);

  const list = corners && corners.trackId === trackId ? corners.list : [];
  const targetMs = target.trim() ? parseLapTime(target) : null;
  const last = drill?.passes.at(-1) ?? null;

  if (drill) {
    return (
      <section
        className="drill-drill ui-card"
        data-no-gesture
        aria-label={uiText('Treino de curva')}
      >
        <header className="dr-head">
          <div>
            <span className="readout-label">{uiText('Treinando')}</span>
            <strong className="dr-corner">{cornerLabel(drill.cornerId, drill.cornerName)}</strong>
          </div>
          <span className="ui-badge" data-tone={drill.phase === 'in' ? 'accent' : undefined}>
            {phaseText(drill)}
          </span>
        </header>
        {last ? (
          <LastPass drill={drill} pass={last} />
        ) : (
          <p className="dim">
            {uiText('Passe pela curva. O engenheiro avalia cada passagem e fala só dela.')}
          </p>
        )}
        <History drill={drill} />
        {drill.best && (
          <p className="num dr-best">
            {uiText('Melhor: {0} s (passagem {1})', sec(drill.best.timeMs), drill.best.n)}
            {drill.targetMs !== null && (
              <>
                {' · '}
                {uiText('meta {0} s', sec(drill.targetMs))}{' '}
                <span data-tone={drill.best.timeMs <= drill.targetMs ? 'gain' : 'loss'}>
                  ({formatDelta(drill.best.timeMs - drill.targetMs)})
                </span>
              </>
            )}
          </p>
        )}
        <div className="drill-controls">
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            disabled={busy}
            onClick={() => void stopDrill()}
          >
            {uiText('Parar treino')}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="drill-drill ui-card" data-no-gesture aria-label={uiText('Treino de curva')}>
      {summary && (
        <div className="dr-summary" role="status">
          <strong>{uiText('Treino de {0} encerrado', cornerLabel(summary.cornerId, null))}</strong>
          <p className="num">
            {uiText(
              '{0} passagens; melhor trecho {1} s',
              summary.data.count,
              sec(summary.data.bestMs),
            )}
            {summary.data.count > 1 && summary.data.improvementMs > 0 && (
              <>
                {'; '}
                {uiText('melhora de {0} s desde a primeira', sec(summary.data.improvementMs))}
              </>
            )}
            .
          </p>
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={dismissDrillSummary}
          >
            {uiText('Entendi')}
          </button>
        </div>
      )}
      <h3 className="dr-title">{uiText('Treinar uma curva')}</h3>
      {!trackId || list.length === 0 ? (
        <p className="dim">
          {uiText(
            'Para treinar uma curva, dirija numa pista identificada com curvas detectadas. O engenheiro passa a falar só da curva escolhida.',
          )}
        </p>
      ) : (
        <form
          className="dr-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (cornerId) void startDrill(cornerId, targetMs);
          }}
        >
          <div className="ui-field">
            <label className="ui-label" htmlFor="dr-corner">
              {uiText('Curva')}
            </label>
            <select
              id="dr-corner"
              className="ui-input"
              value={cornerId}
              onChange={(e) => setCornerId(e.target.value)}
            >
              <option value="">{uiText('Escolha…')}</option>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {cornerLabel(c.id, c.name)}
                </option>
              ))}
            </select>
          </div>
          <div className="ui-field">
            <label className="ui-label" htmlFor="dr-target">
              {uiText('Meta do trecho (opcional)')}
            </label>
            <input
              id="dr-target"
              className="ui-input num"
              value={target}
              placeholder="3.400"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={target.trim() !== '' && targetMs === null}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <button type="submit" className="ui-btn" disabled={busy || !cornerId}>
            {uiText('Começar')}
          </button>
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
