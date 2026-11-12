/** Configurações → Contas e dados → "Corridas diárias": liga ou desliga a busca no DG EDGE. */

import { DAILY_SOURCE_NAME } from '@gt7/shared';
import { useState } from 'react';
import { t as uiText } from '../../../lib/i18n.ts';
import { api } from '../../api.ts';
import { useFetch } from '../../useFetch.ts';
import { Panel } from '../Panel.tsx';
import { CfgToggle, useSave } from './ConfigRow.tsx';

export function DailiesSetting() {
  const state = useFetch('dailies-setting', () => api.dailyRaces());
  const { busy, run } = useSave();
  const [override, setOverride] = useState<boolean | null>(null);
  const enabled = override ?? state.data?.enabled ?? false;

  return (
    <Panel
      id="diarias"
      title={uiText('Corridas diárias')}
      description={uiText(
        'Mostra as corridas da semana do GT7, os tempos das medalhas e o 1º lugar, para usar de referência.',
      )}
    >
      <div className="cfg-list">
        <CfgToggle
          id="dailies"
          title={uiText('Buscar no {0}', DAILY_SOURCE_NAME)}
          description={uiText(
            'O Bono consulta o site a partir deste PC, no máximo uma vez por hora, e guarda o resultado aqui. Nada é enviado de volta.',
          )}
          checked={enabled}
          disabled={busy}
          onChange={() =>
            void run(async () => {
              const next = !enabled;
              await api.dailySetEnabled(next);
              setOverride(next);
            })
          }
        />
      </div>
    </Panel>
  );
}
