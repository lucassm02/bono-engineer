import { useMemo, useRef } from 'react';
import { setText } from '../lib/dom.ts';
import { formatDelta, formatLapTime, formatSectorTime } from '../lib/format.ts';
import { t as uiText } from '../lib/i18n.ts';
import {
  bestSectors,
  consistency,
  invalidReason,
  lapTrend,
  sectorCellStatus,
  sectorCount,
  sessionBestLap,
  theoreticalBest,
} from '../lib/lapStats.ts';
import { useLiveRender } from '../live/raf.ts';
import { useSessionLaps } from '../state/sessionStore.ts';

const TREND_GLYPH = { melhorando: '▼', piorando: '▲', estável: '■' } as const;

export function TimesView() {
  const laps = useSessionLaps((s) => s.laps);
  const pbMs = useSessionLaps((s) => s.personalBestMs);
  const remote = useSessionLaps((s) => s.remote);
  const r = useRef<Record<string, HTMLElement | null>>({});
  const set = (k: string) => (el: HTMLElement | null) => {
    r.current[k] = el;
  };

  const stats = useMemo(() => {
    const best = sessionBestLap(laps);
    const n = Math.max(3, sectorCount(laps));
    const bs = bestSectors(laps, n);
    return {
      best,
      n,
      bestSectors: bs,
      theoretical: theoreticalBest(laps),
      consistency: consistency(laps),
      trend: lapTrend(laps, 3),
      rows: [...laps].reverse(),
    };
  }, [laps]);

  useLiveRender((f) => {
    const e = r.current;
    setText(e.current, formatLapTime(f.lap.currentLapMs));
    setText(e.lapNo, f.lap.lap > 0 ? uiText('Volta {0}', f.lap.lap) : uiText('Volta de saída'));
  });

  const pb = pbMs !== null && stats.best ? Math.min(pbMs, stats.best.timeMs) : (pbMs ?? null);
  const sb = stats.best?.timeMs ?? null;
  const sectorIdx = Array.from({ length: stats.n }, (_, i) => i);

  return (
    <div className="view tempos">
      <section className="times-summary">
        <div className="times-stat">
          <span className="readout-label">{uiText('Melhor pessoal')}</span>
          <span className="num times-pb">{formatLapTime(pb)}</span>
        </div>
        <div className="times-stat">
          <span className="readout-label">{uiText('Melhor da sessão')}</span>
          <span className="num times-sb">{formatLapTime(sb)}</span>
        </div>
        <div className="times-stat">
          <span className="readout-label">{uiText('Ideal teórica')}</span>
          <span className="num">{formatLapTime(stats.theoretical)}</span>
          {stats.theoretical !== null && sb !== null && (
            <span className="num dim times-sub">
              {formatDelta(stats.theoretical - sb)}
              {` ${uiText('da melhor')}`}
            </span>
          )}
        </div>
        <div className="times-stat">
          <span className="readout-label">{uiText('Consistência')}</span>
          <span className="num">
            {stats.consistency ? `± ${formatSectorTime(stats.consistency.stddevMs)}` : '–'}
          </span>
          {stats.consistency && (
            <span className="dim times-sub">
              {stats.consistency.count}
              {` ${uiText('voltas válidas')}`}
            </span>
          )}
        </div>
        <div className="times-stat times-trend" data-trend={stats.trend.label ?? 'none'}>
          <span className="readout-label">{uiText('Últimas 3')}</span>
          <span className="num times-trend-laps">
            {stats.trend.laps.length > 0
              ? stats.trend.laps.map((l) => formatLapTime(l.timeMs, true)).join('  ')
              : '–'}
          </span>
          {stats.trend.label && (
            <span className="times-sub times-trend-label">
              {TREND_GLYPH[stats.trend.label]} {stats.trend.label}
            </span>
          )}
        </div>
        <div className="times-stat times-now">
          <span className="readout-label" ref={set('lapNo')} />
          <span className="num" ref={set('current')} />
        </div>
      </section>
      <section className="times-table-wrap" aria-label={uiText('Voltas da sessão')}>
        {stats.rows.length === 0 ? (
          <div className="times-empty">
            <strong>{uiText('Nenhuma volta completa nesta sessão')}</strong>
            <span className="dim">
              {remote === 'loading'
                ? uiText('Carregando voltas do servidor…')
                : uiText('As voltas aparecem aqui assim que cruzar a linha.')}
            </span>
          </div>
        ) : (
          <table className="times-table num">
            <thead>
              <tr>
                <th>{uiText('Volta')}</th>
                <th>{uiText('Tempo')}</th>
                {sectorIdx.map((i) => (
                  <th key={i}>S{i + 1}</th>
                ))}
                <th>{uiText('Δ melhor')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.rows.map((row) => {
                const isBest = stats.best?.lapId === row.lapId;
                return (
                  <tr
                    key={row.lapId}
                    data-valid={row.valid ? '1' : '0'}
                    data-best={isBest ? '1' : '0'}
                  >
                    <td className="times-lapno">{row.lapNumber}</td>
                    <td className="times-time">
                      {formatLapTime(row.timeMs)}
                      {!row.valid && (
                        <span className="ui-badge" data-tone="loss">
                          {invalidReason(row.flags)}
                        </span>
                      )}
                      {row.valid && row.isPersonalBest && (
                        <span className="ui-badge" data-tone="purple">
                          PB
                        </span>
                      )}
                    </td>
                    {sectorIdx.map((i) => {
                      const t = row.sectorTimesMs[i] ?? null;
                      const isBestSector = row.valid && t !== null && t === stats.bestSectors[i];
                      return (
                        <td key={i}>
                          <span
                            className="sector times-sector"
                            data-status={sectorCellStatus(row, i, stats.bestSectors)}
                            data-best={isBestSector ? '1' : '0'}
                          >
                            {formatSectorTime(t)}
                          </span>
                        </td>
                      );
                    })}
                    <td
                      className="times-delta"
                      data-tone={
                        !row.valid || sb === null
                          ? 'neutral'
                          : row.timeMs - sb <= 0
                            ? 'gain'
                            : 'loss'
                      }
                    >
                      {sb === null ? '–' : isBest ? uiText('melhor') : formatDelta(row.timeMs - sb)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
