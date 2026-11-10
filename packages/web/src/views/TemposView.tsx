import { useMemo, useRef } from 'react';
import { setText } from '../lib/dom.ts';
import { formatDelta, formatLapTime, formatSectorTime } from '../lib/format.ts';
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

export function TemposView() {
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
    setText(e.lapNo, f.lap.lap > 0 ? `Volta ${f.lap.lap}` : 'Volta de saída');
  });

  const pb = pbMs !== null && stats.best ? Math.min(pbMs, stats.best.timeMs) : (pbMs ?? null);
  const sb = stats.best?.timeMs ?? null;
  const sectorIdx = Array.from({ length: stats.n }, (_, i) => i);

  return (
    <div className="view tempos">
      <section className="tempos-summary">
        <div className="tempos-stat">
          <span className="readout-label">Melhor pessoal</span>
          <span className="num tempos-pb">{formatLapTime(pb)}</span>
        </div>
        <div className="tempos-stat">
          <span className="readout-label">Melhor da sessão</span>
          <span className="num tempos-sb">{formatLapTime(sb)}</span>
        </div>
        <div className="tempos-stat">
          <span className="readout-label">Ideal teórica</span>
          <span className="num">{formatLapTime(stats.theoretical)}</span>
          {stats.theoretical !== null && sb !== null && (
            <span className="num dim tempos-sub">
              {formatDelta(stats.theoretical - sb)} da melhor
            </span>
          )}
        </div>
        <div className="tempos-stat">
          <span className="readout-label">Consistência</span>
          <span className="num">
            {stats.consistency ? `± ${formatSectorTime(stats.consistency.stddevMs)}` : '–'}
          </span>
          {stats.consistency && (
            <span className="dim tempos-sub">{stats.consistency.count} voltas válidas</span>
          )}
        </div>
        <div className="tempos-stat tempos-trend" data-trend={stats.trend.label ?? 'none'}>
          <span className="readout-label">Últimas 3</span>
          <span className="num tempos-trend-laps">
            {stats.trend.laps.length > 0
              ? stats.trend.laps.map((l) => formatLapTime(l.timeMs, true)).join('  ')
              : '–'}
          </span>
          {stats.trend.label && (
            <span className="tempos-sub tempos-trend-label">
              {TREND_GLYPH[stats.trend.label]} {stats.trend.label}
            </span>
          )}
        </div>
        <div className="tempos-stat tempos-now">
          <span className="readout-label" ref={set('lapNo')} />
          <span className="num" ref={set('current')} />
        </div>
      </section>
      <section className="tempos-table-wrap" aria-label="Voltas da sessão">
        {stats.rows.length === 0 ? (
          <div className="tempos-empty">
            <strong>Nenhuma volta completa nesta sessão</strong>
            <span className="dim">
              {remote === 'loading'
                ? 'Carregando voltas do servidor…'
                : 'As voltas aparecem aqui assim que cruzar a linha.'}
            </span>
          </div>
        ) : (
          <table className="tempos-table num">
            <thead>
              <tr>
                <th>Volta</th>
                <th>Tempo</th>
                {sectorIdx.map((i) => (
                  <th key={i}>S{i + 1}</th>
                ))}
                <th>Δ melhor</th>
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
                    <td className="tempos-lapno">{row.lapNumber}</td>
                    <td className="tempos-time">
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
                            className="sector tempos-sector"
                            data-status={sectorCellStatus(row, i, stats.bestSectors)}
                            data-best={isBestSector ? '1' : '0'}
                          >
                            {formatSectorTime(t)}
                          </span>
                        </td>
                      );
                    })}
                    <td
                      className="tempos-delta"
                      data-tone={
                        !row.valid || sb === null
                          ? 'neutral'
                          : row.timeMs - sb <= 0
                            ? 'gain'
                            : 'loss'
                      }
                    >
                      {sb === null ? '–' : isBest ? 'melhor' : formatDelta(row.timeMs - sb)}
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
