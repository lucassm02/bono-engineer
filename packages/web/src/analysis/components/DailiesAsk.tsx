/**
 * One-time question on the Home: "want the weekly Gran Turismo news?". The Daily Races are off until
 * the answer is yes; either answer is remembered, so the question is never asked again (the
 * switch stays in Settings and on the Daily Races page).
 */

import { DAILY_SOURCE_NAME } from '@gt7/shared';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal.tsx';
import { t as uiText } from '../../lib/i18n.ts';
import { useTour } from '../../state/tour.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { useFetch } from '../useFetch.ts';

export function DailiesAsk() {
  const dailies = useFetch('dailies', () => api.dailyRaces());
  const touring = useTour((s) => s.active !== null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const data = dailies.data;
  const open = !!data && !data.asked && !done && !touring;

  async function answer(enabled: boolean) {
    setBusy(true);
    try {
      await api.dailySetEnabled(enabled);
      setDone(true);
      dailies.reload();
    } catch (e) {
      addNotice('error', (e as Error).message, 7000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      // closing without choosing counts as "not now": the question is not repeated
      onClose={() => void answer(false)}
      size="sm"
      title={uiText('Novidades semanais do Gran Turismo?')}
      footer={
        <>
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            disabled={busy}
            onClick={() => void answer(false)}
          >
            {uiText('Agora não')}
          </button>
          <button
            type="button"
            className="ui-btn"
            disabled={busy}
            onClick={() => void answer(true)}
          >
            {uiText('Sim, mostrar')}
          </button>
        </>
      }
    >
      <p>
        {uiText(
          'Quer ver as corridas diárias da semana, com as regras e os tempos das medalhas? O Bono busca no site {0} a partir do seu PC, no máximo uma vez por hora.',
          DAILY_SOURCE_NAME,
        )}
      </p>
      <p>{uiText('Você pode mudar isso depois em Configurações → Contas e dados.')}</p>
    </Modal>
  );
}
