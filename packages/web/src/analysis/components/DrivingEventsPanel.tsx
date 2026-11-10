/**
 * Driving events of the lap (saída de frente/traseira, travamento, perda de tração): type, corner,
 * confidence, measured evidence and the action, with a button that zooms the synced charts on the
 * event and shows the yaw and wheel-slip traces. Medium/low confidence = probable (review only).
 */

import type { Corner, DrivingEvent, DrivingEventEvidence } from '@gt7/shared';
import { cornerLabel, fixed } from '../lib/chartData.ts';
import {
  CONFIDENCE_LABELS,
  DRIVING_EVENT_LABELS,
  DRIVING_EVENT_PHASE_LABELS,
} from '../lib/labels.ts';
import { Tag } from './ui.tsx';

interface Props {
  events: DrivingEvent[];
  corners: Corner[];
  selectedId: string | null;
  onOpen: (event: DrivingEvent) => void;
  warnings?: string[];
}

const pct = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;

/** Short evidence chips (pt-BR) of the values that support each kind. */
export function evidenceChips(e: DrivingEventEvidence): string[] {
  const out: string[] = [`${Math.round(e.speedKmh)} km/h`];
  if (e.steeringDeg !== null) out.push(`volante ${Math.round(e.steeringDeg)}°`);
  if (e.yawRateDps !== null && e.expectedYawRateDps !== null) {
    out.push(
      `guinada ${Math.round(e.yawRateDps)}°/s (esperada ${Math.round(e.expectedYawRateDps)})`,
    );
  } else if (e.yawRatio !== null) {
    out.push(`guinada ${fixed(e.yawRatio, 1)}× a esperada`);
  }
  if (e.lineOpeningM !== null) out.push(`linha abriu ${fixed(e.lineOpeningM, 1)} m`);
  if (e.slipAngleDeg !== null) out.push(`giro além da trajetória ${fixed(e.slipAngleDeg, 1)}°`);
  if (e.countersteerS) out.push(`contravolante ${fixed(e.countersteerS, 2)} s`);
  if (e.frontSlipPeak !== null) out.push(`dianteira ${pct(e.frontSlipPeak)}`);
  if (e.rearSlipPeak !== null) out.push(`traseira ${pct(e.rearSlipPeak)}`);
  if (e.tcsActiveS) out.push(`TCS ${fixed(e.tcsActiveS, 2)} s`);
  return out;
}

export function DrivingEventsPanel({ events, corners, selectedId, onOpen, warnings }: Props) {
  return (
    <div className="a-findings">
      <p className="dim a-small">
        Detectados nos sinais do carro (volante, guinada, trajetória e rotação das rodas). Confiança
        média ou baixa indica um diagnóstico provável: confira nos traços.
      </p>
      {warnings?.map((w) => (
        <p key={w} className="a-note">
          {w}
        </p>
      ))}
      {events.length === 0 ? (
        <p className="dim">
          Nenhum evento nesta volta: sem saída de frente, de traseira, travamento ou perda de
          tração.
        </p>
      ) : (
        <ol className="a-finding-list">
          {events.map((e) => {
            const corner = corners.find((c) => c.id === e.cornerId);
            return (
              <li
                key={e.id}
                className="a-finding"
                data-selected={e.id === selectedId ? '1' : undefined}
              >
                <div className="a-finding-head">
                  <strong>{corner ? cornerLabel(corner) : (e.cornerId ?? 'Reta')}</strong>
                  <span>
                    {DRIVING_EVENT_LABELS[e.kind]}
                    {e.kind !== 'exitTraction' && ` · ${DRIVING_EVENT_PHASE_LABELS[e.phase]}`}
                  </span>
                  <Tag
                    tone={
                      e.confidence === 'high' ? 'sb' : e.confidence === 'medium' ? 'info' : 'warn'
                    }
                  >
                    {CONFIDENCE_LABELS[e.confidence]}
                  </Tag>
                  <span className="dim a-small num">
                    {Math.round(e.startM)}–{Math.round(e.endM)} m · {fixed(e.durationS, 2)} s
                  </span>
                </div>
                <p className="a-finding-msg">{e.message}</p>
                <p className="a-finding-action">
                  <span aria-hidden="true">→ </span>
                  {e.action}
                </p>
                <p className="dim a-small">{evidenceChips(e.evidence).join(' · ')}</p>
                {e.notes.length > 0 && <p className="dim a-small">{e.notes.join(' ')}</p>}
                <button
                  type="button"
                  className="a-btn a-btn-ghost a-btn-sm"
                  onClick={() => onOpen(e)}
                >
                  Ver traços
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
