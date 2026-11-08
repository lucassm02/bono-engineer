/** Corner-by-corner table: you vs reference for the main metrics, diff colouring, sortable. */

import type { CornerComparisonRow, CornerMetrics } from '@gt7/shared';
import { useState } from 'react';
import {
  CORNER_METRICS,
  type CornerSort,
  fixed,
  metricDiff,
  metricTone,
  offsetTone,
  signed,
  sortRows,
  timeTone,
} from '../lib/chartData.ts';
import { CORNER_KIND_LABELS } from '../lib/labels.ts';

interface Props {
  rows: CornerComparisonRow[];
  focusCorner: string | null;
  onCorner: (cornerId: string) => void;
}

export function CornerTable({ rows, focusCorner, onCorner }: Props) {
  const [sort, setSort] = useState<CornerSort>('order');
  const sorted = sortRows(rows, sort);
  return (
    <div className="a-corner-table">
      <fieldset className="a-seg" aria-label="Ordenar curvas">
        <button type="button" aria-pressed={sort === 'order'} onClick={() => setSort('order')}>
          Ordem da pista
        </button>
        <button
          type="button"
          aria-pressed={sort === 'timeLost'}
          onClick={() => setSort('timeLost')}
        >
          Mais tempo perdido
        </button>
      </fieldset>
      <div className="a-table-wrap">
        <table className="a-table a-table-click a-ct">
          <thead>
            <tr>
              <th>Curva</th>
              <th
                className="num-col"
                title="+ = você perdeu tempo nesta curva (zona de frenagem → saída)"
              >
                Tempo
              </th>
              {CORNER_METRICS.map((m) => (
                <th
                  key={m.key}
                  className="num-col"
                  title={`${m.label} (${m.unit}). Diferença: ${m.hint}`}
                >
                  {m.short}
                  <span className="dim"> {m.unit}</span>
                </th>
              ))}
              <th
                className="num-col"
                title="Desvio lateral do seu traçado em relação à linha da referência (+ = à esquerda): entrada / ápice / saída"
              >
                Traçado <span className="dim">m</span>
              </th>
              <th className="num-col" title="Marcha no ápice: você / referência">
                Marcha
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const off = r.a.lateralOffsetM;
              return (
                <tr
                  key={r.corner.id}
                  data-focus={r.corner.id === focusCorner ? '1' : '0'}
                  onClick={() => onCorner(r.corner.id)}
                >
                  <td>
                    <button
                      type="button"
                      className="a-link-btn"
                      onClick={() => onCorner(r.corner.id)}
                    >
                      <strong>{r.corner.id}</strong>
                      {r.corner.name && <span> {r.corner.name}</span>}
                    </button>
                    <span className="dim a-small">
                      {' '}
                      {r.corner.direction === 'left' ? '↰' : '↱'}
                      {r.corner.kind ? ` ${CORNER_KIND_LABELS[r.corner.kind]}` : ''}
                    </span>
                  </td>
                  <td className="num num-col">
                    <span className="a-diff" data-tone={timeTone(r.timeLostMs)}>
                      {signed(r.timeLostMs / 1000, 3)}
                    </span>
                  </td>
                  {CORNER_METRICS.map((m) => {
                    const a = r.a[m.key as keyof CornerMetrics] as number | null;
                    const b = r.b[m.key as keyof CornerMetrics] as number | null;
                    const d = metricDiff(r, m.key);
                    return (
                      <td key={m.key} className="num num-col a-mcell">
                        <span className="a-m-you">{fixed(a, m.digits)}</span>
                        <span className="a-m-ref">{fixed(b, m.digits)}</span>
                        <span className="a-diff" data-tone={metricTone(m, d)}>
                          {d === null ? '' : signed(d, m.digits)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="num num-col">
                    {off ? (
                      <span className="a-offsets">
                        <span data-tone={offsetTone(off.entry)}>{signed(off.entry, 1)}</span>
                        <span data-tone={offsetTone(off.apex)}>{signed(off.apex, 1)}</span>
                        <span data-tone={offsetTone(off.exit)}>{signed(off.exit, 1)}</span>
                      </span>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="num num-col">
                    <span data-tone={r.a.gearAtApex !== r.b.gearAtApex ? 'warn' : undefined}>
                      {r.a.gearAtApex || 'N'}/{r.b.gearAtApex || 'N'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="dim a-small">
        Em cada métrica: <span className="a-m-you">você</span> ·{' '}
        <span className="a-m-ref">referência</span> · diferença (verde = a seu favor, vermelho =
        custa tempo). Frenagem e retomada são posições na volta (m); frenagem + = você freia mais
        tarde.
      </p>
    </div>
  );
}
