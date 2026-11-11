/**
 * Grupo "Sobre": versão, atualização, refazer o assistente e o tour, licenças e o aviso de projeto
 * pessoal. A porta e o token ficam recolhidos em "Detalhes técnicos".
 */

import { type ApiStatus, PRODUCT_NAME } from '@gt7/shared';
import { t as uiText } from '../../../lib/i18n.ts';
import { ONBOARDING_KEY } from '../../../lib/onboarding.ts';
import { navigate, routes } from '../../../lib/route.ts';
import { loadString, saveString } from '../../../lib/storage.ts';
import { applySwUpdate, useSwUpdate } from '../../../lib/swUpdate.ts';
import { useUi } from '../../../state/uiStore.ts';
import { SETUP_STATE_KEY } from '../../lib/configNav.ts';
import { Panel } from '../Panel.tsx';
import { Advanced, CfgRow } from './ConfigRow.tsx';

/** Estado do tour guiado (spec 04). Apagar faz o tour recomeçar na próxima abertura do ao vivo. */
const TOUR_STATE_KEY = 'gt7.tour.v1';

function resetTour(): void {
  try {
    window.localStorage.removeItem(TOUR_STATE_KEY);
  } catch {
    // sem armazenamento: nada para refazer
  }
  navigate(routes.live());
}

/** Reabre o assistente: apaga o "feito" do formato antigo e do novo (se o novo existir). */
function resetSetup(): void {
  saveString(ONBOARDING_KEY, '0');
  const raw = loadString(SETUP_STATE_KEY);
  if (raw) {
    try {
      const state = JSON.parse(raw) as Record<string, unknown>;
      saveString(SETUP_STATE_KEY, JSON.stringify({ ...state, steps: {}, done: false }));
    } catch {
      // estado ilegível: o assistente novo recomeça sozinho
    }
  }
  useUi.setState({ onboarding: 'active' });
}

export function AboutGroup({ status }: { status: ApiStatus }) {
  const updateReady = useSwUpdate((s) => s.available);
  return (
    <Panel id="sobre" title={uiText('Sobre')}>
      <div className="cfg-list">
        <CfgRow
          title={PRODUCT_NAME}
          description={
            <>
              {uiText('Versão')} <span className="num">{status.serverVersion}</span>
            </>
          }
        >
          <span className="ui-badge">v{status.serverVersion}</span>
        </CfgRow>
        <CfgRow
          title={uiText('Atualizações')}
          description={
            updateReady
              ? uiText('Há uma versão nova pronta. Atualizar recarrega a tela.')
              : uiText('O Bono procura sozinho e avisa quando houver uma versão nova.')
          }
        >
          {updateReady ? (
            <button type="button" className="ui-btn" onClick={applySwUpdate}>
              {uiText('Atualizar agora')}
            </button>
          ) : (
            <span className="ui-badge" data-tone="gain">
              {uiText('Em dia')}
            </span>
          )}
        </CfgRow>
        <CfgRow
          id="setup-again"
          title={uiText('Refazer o assistente')}
          description={uiText('Passa de novo pela configuração inicial: PS5, voz e telas.')}
        >
          <button type="button" className="ui-btn" data-variant="secondary" onClick={resetSetup}>
            {uiText('Refazer o assistente')}
          </button>
        </CfgRow>
        <CfgRow
          title={uiText('Refazer o tour')}
          description={uiText('Mostra de novo os gestos e botões do ao vivo.')}
        >
          <button type="button" className="ui-btn" data-variant="secondary" onClick={resetTour}>
            {uiText('Refazer o tour')}
          </button>
        </CfgRow>
      </div>

      <Advanced summary={uiText('Detalhes técnicos e licenças')}>
        <p className="cfg-hint">
          {uiText('Servidor na porta')} <span className="num">{status.httpPort}</span>
          {status.tokenRequired ? uiText(' · acesso com senha (token)') : ''}
        </p>
        <p className="cfg-hint">
          {uiText('O Bono é software livre (licença MIT).')}{' '}
          {uiText('— dados: gt7info, gt7-datalogger-track-data e gt-telemetry (licenças livres).')}
        </p>
      </Advanced>

      <p className="cfg-hint cfg-credit">
        {uiText(
          'Projeto pessoal, sem relação com a Polyphony Digital. O protocolo de telemetria do GT7 não tem documentação oficial; vem de engenharia reversa da comunidade.',
        )}
      </p>
    </Panel>
  );
}
