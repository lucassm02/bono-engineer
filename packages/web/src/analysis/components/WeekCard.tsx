/**
 * Início: "Sua semana": the last 7 days in one line, with the way to the full summary. Only shown
 * when the driver drove in the period, so a new install does not get an empty card.
 */

import { t as uiText } from '../../lib/i18n.ts';
import { routes } from '../../lib/route.ts';
import '../../styles/weekly-summary.css';
import { api } from '../api.ts';
import { useFetch } from '../useFetch.ts';
import { Panel } from './Panel.tsx';

export function WeekCard() {
  const week = useFetch('week-card', () => api.weekly(0));
  const s = week.data;
  if (!s || s.sessions === 0) return null;
  return (
    <Panel
      title={uiText('Sua semana')}
      description={
        s.records > 0
          ? uiText(
              '{0} sessões · {1} voltas · {2} recorde(s) pessoal(is)',
              s.sessions,
              s.laps,
              s.records,
            )
          : uiText('{0} sessões · {1} voltas', s.sessions, s.laps)
      }
      actions={
        <a className="ui-btn" data-variant="secondary" data-size="sm" href={routes.weekly()}>
          {uiText('Ver resumo da semana')}
        </a>
      }
    >
      <p className="dim a-small">
        {uiText(
          'Melhor volta de cada pista, recordes e metas batidas, para copiar ou compartilhar como imagem.',
        )}
      </p>
    </Panel>
  );
}
