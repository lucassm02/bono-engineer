/**
 * Setores da pista (spec 14): best time of each sector, the lap that made it, the average of the
 * best five and the ideal lap (sum of the best sectors) with an honest note about what it means.
 */

import type { ApiTrackSectors } from '@gt7/shared';
import { useState } from 'react';
import { formatDelta, formatLapTime, formatSectorTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import { ApiError, api } from '../api.ts';
import { carLabel, formatDateTime } from '../lib/labels.ts';
import { useFetch } from '../useFetch.ts';
import { Card, Empty, ErrorBox, Loading } from './ui.tsx';

const ANY_CAR = '';

export function SectorsTab({ trackId, cars }: { trackId: string; cars: { carCode: number }[] }) {
  const [scope, setScope] = useState<string>(ANY_CAR);
  const carCode = scope === ANY_CAR ? undefined : Number(scope);
  const sectors = useFetch(`sec:${trackId}:${scope}`, () => api.trackSectors(trackId, carCode));
  const [busy, setBusy] = useState(false);
  const data: ApiTrackSectors | null = sectors.data;

  const setIdealAsGoal = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await api.setGoal(trackId, { targetMs: data.table.idealLapMs, carCode: carCode ?? null });
      addNotice('info', uiText('Meta definida: {0}', formatLapTime(data.table.idealLapMs)));
    } catch (e) {
      addNotice(
        'error',
        e instanceof ApiError ? uiText(e.message) : uiText('Não foi possível salvar a meta.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={uiText('Setores e volta ideal')}
      actions={
        cars.length > 1 && (
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label={uiText('Carro')}
          >
            <option value={ANY_CAR}>{uiText('Todos os carros')}</option>
            {cars.map((c) => (
              <option key={c.carCode} value={String(c.carCode)}>
                {carLabel(c.carCode)}
              </option>
            ))}
          </select>
        )
      }
    >
      {sectors.error && !data ? (
        sectors.error.status === 400 ? (
          <Empty action={{ label: uiText('Abrir a tela ao vivo'), href: routes.live() }}>
            <p>{uiText('Esta pista ainda não tem voltas válidas suas.')}</p>
          </Empty>
        ) : (
          <ErrorBox error={sectors.error} onRetry={sectors.reload} compact />
        )
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <div className="a-table-wrap">
            <table className="a-table a-table-cards">
              <thead>
                <tr>
                  <th>{uiText('Setor')}</th>
                  <th className="num-col">{uiText('Melhor tempo')}</th>
                  <th>{uiText('Volta')}</th>
                  <th className="num-col">{uiText('Média das 5 melhores')}</th>
                  <th className="num-col">{uiText('Sua melhor volta perde')}</th>
                </tr>
              </thead>
              <tbody>
                {data.table.rows.map((r) => {
                  const lap = data.laps.find((l) => l.lapId === r.bestLapId);
                  return (
                    <tr key={r.index}>
                      <td data-label={uiText('Setor')}>S{r.index + 1}</td>
                      <td className="num num-col" data-label={uiText('Melhor tempo')}>
                        {formatSectorTime(r.bestMs)}
                      </td>
                      <td data-label={uiText('Volta')}>
                        {lap
                          ? `${uiText('Volta')} ${lap.number} · ${formatDateTime(lap.startedAt)}`
                          : '–'}
                      </td>
                      <td className="num num-col" data-label={uiText('Média das 5 melhores')}>
                        {formatSectorTime(r.avgTopMs)}
                      </td>
                      <td
                        className="num num-col"
                        data-label={uiText('Sua melhor volta perde')}
                        data-tone={r.bestLapLossMs > 0 ? 'loss' : undefined}
                      >
                        {r.bestLapLossMs > 0 ? formatDelta(r.bestLapLossMs) : '–'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="a-stats a-mt">
            <div className="a-stat">
              <span className="a-stat-k">{uiText('Sua melhor')}</span>
              <span className="a-stat-v num">{formatLapTime(data.table.bestLapMs)}</span>
            </div>
            <div className="a-stat" data-emph="ideal">
              <span className="a-stat-k">{uiText('Volta ideal')}</span>
              <span className="a-stat-v num">{formatLapTime(data.table.idealLapMs)}</span>
            </div>
            <div className="a-stat">
              <span className="a-stat-k">{uiText('Ganho possível')}</span>
              <span className="a-stat-v num" data-tone={data.table.gainMs > 0 ? 'gain' : undefined}>
                {data.table.gainMs > 0 ? formatDelta(-data.table.gainMs) : '–'}
              </span>
            </div>
          </div>

          <p className="dim a-small">
            {uiText(
              'A volta ideal é um teto teórico, calculado com {0} volta(s) válida(s): juntar os melhores setores nem sempre é possível, porque a saída de um setor depende de como você entrou nele.',
              data.table.lapCount,
            )}
          </p>
          {data.table.gainMs > 0 && (
            <button
              type="button"
              className="a-btn"
              disabled={busy}
              onClick={() => void setIdealAsGoal()}
            >
              {uiText('Usar a volta ideal como meta')}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
