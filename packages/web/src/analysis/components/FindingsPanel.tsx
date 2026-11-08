/** Ranked coaching findings (one per corner, costliest first) with the action to try next. */

import type { Corner, CornerFinding } from '@gt7/shared';
import { cornerLabel, fixed } from '../lib/chartData.ts';
import { CONFIDENCE_LABELS } from '../lib/labels.ts';
import { Tag } from './ui.tsx';

interface Props {
  findings: CornerFinding[];
  corners: Corner[];
  referenceIsReplay: boolean;
  onCorner: (cornerId: string) => void;
  max?: number;
}

export function FindingsPanel({ findings, corners, referenceIsReplay, onCorner, max = 8 }: Props) {
  const list = findings.slice(0, max);
  return (
    <div className="a-findings">
      {referenceIsReplay && (
        <p className="a-note">
          Referência capturada de <strong>replay</strong>: as entradas (freio, volante) são
          suavizadas. Pontos de frenagem e traçado têm precisão de alguns metros — use para
          tendências, não para milissegundos.
        </p>
      )}
      {list.length === 0 ? (
        <p className="dim">Nenhum ponto relevante: você está no ritmo da referência nesta volta.</p>
      ) : (
        <ol className="a-finding-list">
          {list.map((f, i) => {
            const corner = corners.find((c) => c.id === f.cornerId);
            return (
              <li key={`${f.cornerId}-${f.kind}-${f.value}`} className="a-finding">
                <div className="a-finding-head">
                  <span className="a-finding-rank num">{i + 1}</span>
                  <strong>{corner ? cornerLabel(corner) : (f.cornerId ?? 'Volta')}</strong>
                  {typeof f.costMs === 'number' && f.costMs > 0 && (
                    <span className="a-finding-cost num" title="Custo estimado desta causa">
                      ≈ {fixed(f.costMs / 1000, 2)} s
                    </span>
                  )}
                  {f.confidence && (
                    <Tag
                      tone={
                        f.confidence === 'high' ? 'sb' : f.confidence === 'medium' ? 'info' : 'warn'
                      }
                    >
                      {CONFIDENCE_LABELS[f.confidence]}
                    </Tag>
                  )}
                </div>
                {f.message && <p className="a-finding-msg">{f.message}</p>}
                {f.action && (
                  <p className="a-finding-action">
                    <span aria-hidden="true">→ </span>
                    {f.action}
                  </p>
                )}
                {f.cornerId && (
                  <button
                    type="button"
                    className="a-btn a-btn-ghost a-btn-sm"
                    onClick={() => onCorner(f.cornerId!)}
                  >
                    Ver no gráfico
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
