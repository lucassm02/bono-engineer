import type { CornerComparisonRow, EngineerRadioCall, EngineerRadioLog } from '@gt7/shared';
import { isBrake } from '../../lib/engineerRadio.ts';
import { formatDelta } from '../../lib/format.ts';
import { routes } from '../../lib/route.ts';
import { cornerLabel } from '../lib/chartData.ts';
import { Panel } from './Panel.tsx';

function pedalMetric(call: EngineerRadioCall, row?: CornerComparisonRow) {
  if (!row) return null;
  if (isBrake(call.kind)) return { position: row.a.brakePointM, offset: row.diff.brakePointM };
  if (call.kind === 'throttle' || call.kind === 'throttleSmooth') {
    return { position: row.a.throttlePickupM, offset: row.diff.throttlePickupM };
  }
  if (call.kind === 'release')
    return { position: row.a.brakeReleaseM, offset: row.diff.brakeReleaseM };
  return null;
}

export function EngineerRadioReview({
  lapId,
  referenceId,
  logs,
  rows,
  onCorner,
}: {
  lapId: string;
  referenceId: string;
  logs: readonly EngineerRadioLog[];
  rows: CornerComparisonRow[];
  onCorner: (id: string) => void;
}) {
  if (!logs.length) return null;
  const calls = logs
    .filter((log) => log.referenceLapId === referenceId)
    .flatMap((log) => log.calls.map((call) => ({ ...call, deviceId: log.deviceId })))
    .sort((a, b) => a.distanceM - b.distanceM);
  const otherReferences = [...new Set(logs.map((log) => log.referenceLapId))].filter(
    (id) => id !== referenceId,
  );
  return (
    <Panel
      title="Chamadas do engenheiro"
      description={
        calls.length > 0
          ? 'As linhas azuis nos gráficos indicam onde o áudio começou. A posição dos pedais é comparada à referência. A diferença de tempo é da curva inteira.'
          : undefined
      }
    >
      {calls.length > 0 && (
        <div className="cmp-table-wrap">
          <table className="cmp-table">
            <thead>
              <tr>
                <th>Curva e chamada</th>
                <th>Áudio e ponto indicado</th>
                <th>Ação do piloto</th>
                <th>Tempo na curva</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => {
                const row = rows.find((item) => item.corner.id === call.cornerId);
                const pedal = pedalMetric(call, row);
                const delta = pedal?.offset;
                return (
                  <tr key={`${call.deviceId}|${call.cornerId}|${call.distanceM}|${call.kind}`}>
                    <td>
                      {row && (
                        <button
                          type="button"
                          className="ui-btn"
                          data-variant="secondary"
                          data-size="sm"
                          onClick={() => onCorner(row.corner.id)}
                        >
                          {cornerLabel(row.corner)}
                        </button>
                      )}{' '}
                      {call.text}
                    </td>
                    <td>
                      {Math.round(call.distanceM)} m · meta {Math.round(call.actionDistanceM)} m
                    </td>
                    <td>
                      {pedal?.position == null
                        ? '—'
                        : `${Math.round(pedal.position)} m${delta == null ? '' : ` · ${Math.abs(delta) < 0.5 ? 'no ponto' : `${Math.round(Math.abs(delta))} m ${delta > 0 ? 'depois' : 'antes'}`}`}`}
                    </td>
                    <td>{row ? formatDelta(row.timeLostMs) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {otherReferences.map((id) => (
        <p key={id} className="cmp-table-note">
          <a href={routes.compare({ lap: lapId, ref: id })}>
            Ver chamadas com a referência usada no rádio
          </a>
        </p>
      ))}
    </Panel>
  );
}
