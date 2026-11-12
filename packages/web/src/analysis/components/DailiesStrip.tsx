/** Cartão da Início: as três corridas diárias da semana, com o caminho para a página completa. */

import { t as uiText } from '../../lib/i18n.ts';
import '../../styles/dailies.css';
import { routes } from '../../lib/route.ts';
import { api } from '../api.ts';
import { useFetch } from '../useFetch.ts';
import { Panel } from './Panel.tsx';

export function DailiesStrip() {
  const dailies = useFetch('dailies', () => api.dailyRaces());
  const data = dailies.data;
  // Nothing to show (off, never fetched, or the source is unreachable): stay out of the way.
  if (!data?.enabled || data.races.length === 0) return null;
  return (
    <Panel
      className="dl-home"
      title={uiText('Corridas diárias · Semana {0}', data.week?.week ?? '')}
      description={uiText('As corridas desta semana no GT7.')}
      actions={
        <a className="ui-btn" data-variant="secondary" data-size="sm" href={routes.dailies()}>
          {uiText('Ver tempos e medalhas')}
        </a>
      }
    >
      <ul className="dl-strip">
        {data.races.map((r) => (
          <li key={r.id}>
            <span className="ui-badge" data-tone="accent">
              {r.type}
            </span>
            <strong>{r.trackName}</strong>
            <span className="dl-muted">{r.carLabel}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
