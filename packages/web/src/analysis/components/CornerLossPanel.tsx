/**
 * "Onde você perde tempo" (spec 15): the corners that cost the most against the reference, each
 * with the probable cause and the number behind it, and the sum that closes with the straights.
 */

import { type CornerLossReport, cornerLossRanking, type LapComparison } from '@gt7/shared';
import { useMemo } from 'react';
import { formatDelta } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { cornerLabel } from '../lib/chartData.ts';

export function CornerLossPanel({
  comparison,
  onZoom,
  onDrill,
  busyCorner,
}: {
  comparison: LapComparison;
  onZoom: (cornerId: string) => void;
  /** Starts a corner drill on this corner (spec 18); absent = no button. */
  onDrill?: (cornerId: string) => void;
  busyCorner?: string | null;
}) {
  const report: CornerLossReport = useMemo(
    () => cornerLossRanking(comparison, { topN: 3 }),
    [comparison],
  );

  if (report.rows.length === 0) {
    return (
      <p className="dim">
        {uiText(
          'Nenhuma curva perdeu mais de {0} ms contra a referência. A diferença está no conjunto da volta.',
          report.minLossMs,
        )}
      </p>
    );
  }

  return (
    <>
      <ol className="cl-list">
        {report.rows.map((row, i) => (
          <li key={row.cornerId} className="cl-card ui-card">
            <header className="cl-head">
              <span className="cl-rank num">{i + 1}</span>
              <strong>{cornerLabel({ id: row.cornerId, name: row.name })}</strong>
              <span className="num cl-loss" data-tone="loss">
                {formatDelta(row.lossMs)}
              </span>
            </header>
            {row.reasons.length > 0 ? (
              <ul className="cl-reasons">
                {row.reasons.map((r) => (
                  <li key={r.kind}>
                    <span className="cl-prob">{uiText('Provável:')}</span> {r.message}
                    {r.action && <span className="dim"> · {r.action}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dim cl-raw num">
                {uiText(
                  'Sem causa clara. Freada {0} m · {1} m na referência; V-mín {2} km/h · {3} km/h.',
                  fmt(row.brakePointM[0]),
                  fmt(row.brakePointM[1]),
                  fmt(row.minSpeedKmh[0]),
                  fmt(row.minSpeedKmh[1]),
                )}
              </p>
            )}
            <div className="cl-actions">
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                data-size="sm"
                onClick={() => onZoom(row.cornerId)}
              >
                {uiText('Ver nos gráficos')}
              </button>
              {onDrill && (
                <button
                  type="button"
                  className="ui-btn"
                  data-variant="secondary"
                  data-size="sm"
                  disabled={busyCorner === row.cornerId}
                  onClick={() => onDrill(row.cornerId)}
                >
                  {uiText('Treinar esta curva')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="dim a-small num cl-sum">
        {uiText('Perdas listadas')} {formatDelta(report.rows.reduce((a, r) => a + r.lossMs, 0))} ·{' '}
        {uiText('outras curvas')} {formatDelta(report.otherCornersMs)} · {uiText('retas')}{' '}
        {formatDelta(report.straightsMs)} = {formatDelta(report.totalDeltaMs)}
      </p>
    </>
  );
}

const fmt = (v: number | null) => (v === null ? '–' : String(Math.round(v)));
