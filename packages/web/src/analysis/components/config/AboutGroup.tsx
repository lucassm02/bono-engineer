/**
 * Grupo "Sobre": versão, atualização, refazer o assistente e o tour, licenças e o aviso de projeto
 * pessoal. A porta e o token ficam recolhidos em "Detalhes técnicos".
 */

import { type ApiStatus, PRODUCT_NAME } from '@gt7/shared';
import { useState } from 'react';
import { t as uiText } from '../../../lib/i18n.ts';
import { routes } from '../../../lib/route.ts';
import { applySwUpdate, useSwUpdate } from '../../../lib/swUpdate.ts';
import { diagnosticRows, resetUsage } from '../../../lib/usage.ts';
import { restartSetupAssistant } from '../../../state/setup.ts';
import { requestTour } from '../../../state/tour.ts';
import { Panel } from '../Panel.tsx';
import { Advanced, CfgRow } from './ConfigRow.tsx';

/** Contadores de uso deste navegador (RF4): nada sai do PC. */
function Diagnostics() {
  const [rows, setRows] = useState(() => diagnosticRows());
  return (
    <Advanced summary={uiText('Diagnóstico')}>
      <p className="cfg-hint">
        {uiText(
          'Contadores simples de uso, guardados só neste navegador. Nada é enviado para fora do seu PC.',
        )}
      </p>
      <dl className="cfg-diag">
        {rows.map((row) => (
          <div key={row.id} className="cfg-diag-row">
            <dt>{row.label}</dt>
            <dd className="num">{row.value}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className="ui-btn"
        data-variant="secondary"
        onClick={() => {
          resetUsage();
          setRows(diagnosticRows());
        }}
      >
        {uiText('Zerar contadores')}
      </button>
    </Advanced>
  );
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
          title={uiText('Central de ajuda')}
          description={uiText('Passo a passo para configurar o Bono, problemas comuns e atalhos.')}
        >
          <a className="ui-btn" data-variant="secondary" href={routes.help()}>
            {uiText('Abrir a ajuda')}
          </a>
        </CfgRow>
        <CfgRow
          id="setup-again"
          title={uiText('Refazer o assistente')}
          description={uiText('Passa de novo pela configuração inicial: PS5, voz e telas.')}
        >
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            onClick={restartSetupAssistant}
          >
            {uiText('Refazer o assistente')}
          </button>
        </CfgRow>
        <CfgRow
          title={uiText('Refazer o tour')}
          description={uiText('Mostra de novo os gestos e botões do ao vivo.')}
        >
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            onClick={() => requestTour('live')}
          >
            {uiText('Refazer o tour')}
          </button>
        </CfgRow>
        <CfgRow
          title={uiText('Ver o tour do histórico')}
          description={uiText('Mostra onde ficam as pistas, a comparação e os ajustes.')}
        >
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            onClick={() => requestTour('analysis')}
          >
            {uiText('Ver o tour')}
          </button>
        </CfgRow>
      </div>

      <Diagnostics />

      <Advanced summary={uiText('Detalhes técnicos e licenças')}>
        <p className="cfg-hint">
          {uiText('Servidor na porta')} <span className="num">{status.httpPort}</span>
          {status.tokenRequired ? uiText(' · acesso com senha (token)') : ''}
        </p>
        <p className="cfg-hint">
          {uiText(
            'O código do Bono está disponível (licença PolyForm Noncommercial 1.0.0): uso e modificação só para fins não comerciais.',
          )}{' '}
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
