/**
 * Status screens over the dashboard: no server, server without console, menu, paused, switching
 * packet format. Full screens block the views; banners leave them visible.
 */

import { GT7_CLIENT_PORT } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { describeLink } from '../lib/consoleLink.ts';
import { t as uiText } from '../lib/i18n.ts';
import { statusKind } from '../lib/status.ts';
import { retryServerNow, startMock } from '../net/connection.ts';
import { rescanConsole } from '../net/consoleActions.ts';
import { openConnectionPanel, useConsoleConnection } from '../state/consoleLink.ts';
import { useUi } from '../state/uiStore.ts';
import { Icon, type IconName } from './ui/Icon.tsx';

function useCountdown(until: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  return until === null ? null : Math.max(0, Math.ceil((until - now) / 1000));
}

export function StatusLayer() {
  const source = useUi((s) => s.source);
  const wsStatus = useUi((s) => s.wsStatus);
  const wsEverOpened = useUi((s) => s.wsEverOpened);
  const wsAttempt = useUi((s) => s.wsAttempt);
  const wsRetryAt = useUi((s) => s.wsRetryAt);
  const liveState = useUi((s) => s.liveState);
  const serverStatus = useUi((s) => s.serverStatus);
  const conn = useConsoleConnection();
  const link = describeLink(conn);
  const kind = statusKind({ source, wsStatus, wsEverOpened, wsAttempt, liveState });
  const secs = useCountdown(kind === 'noServer' ? wsRetryAt : null);

  if (kind === 'none') return null;

  if (kind === 'paused' || kind === 'switchingFormat') {
    return (
      <div className="status-banner" data-kind={kind} role="status">
        <span
          className="ui-dot"
          data-tone={kind === 'paused' ? 'warn' : 'accent'}
          aria-hidden="true"
        />
        {kind === 'paused' ? (
          <strong>{uiText('Pausado')}</strong>
        ) : (
          <span className="status-banner-text">
            <strong>{uiText('Trocando o formato do pacote')}</strong>
            <span>
              {uiText('O console precisa de uns 15 s sem sinal para aceitar o novo formato.')}
            </span>
          </span>
        )}
      </div>
    );
  }

  const icon: IconName | null =
    kind === 'noServer'
      ? 'alert'
      : kind === 'noConsole'
        ? 'remote'
        : kind === 'menu'
          ? 'live'
          : null;
  const host = typeof location === 'undefined' ? '' : location.host;
  return (
    <div className="status-screen" data-kind={kind} role="status">
      <div className="status-card">
        {icon && (
          <span className="status-icon" aria-hidden="true">
            <Icon name={icon} size={28} />
          </span>
        )}
        {kind === 'connectingServer' && (
          <>
            <h1>{uiText('Conectando ao servidor…')}</h1>
            <p className="status-muted">{host}</p>
          </>
        )}
        {kind === 'noServer' && (
          <>
            <h1>{uiText('Sem conexão com o servidor')}</h1>
            <p>
              {`${uiText('O painel não encontrou o servidor em')} `}
              <strong>{host}</strong>.{wsEverOpened ? uiText(' A conexão caiu.') : ''}
            </p>
            <ul>
              <li>{uiText('Confira se o servidor está rodando no PC.')}</li>
              <li>{uiText('O PC e o dispositivo remoto precisam estar na mesma rede local.')}</li>
              <li>{uiText('Use o endereço ou o QR code mostrado na tela do PC.')}</li>
            </ul>
            <p className="status-muted">
              {secs !== null && secs > 0
                ? uiText('Nova tentativa em {0} s', secs)
                : uiText('Tentando de novo…')}
            </p>
            <div className="status-actions" data-no-gesture>
              <button type="button" className="ui-btn" data-size="lg" onClick={retryServerNow}>
                <Icon name="refresh" size={20} />
                {uiText('Tentar agora')}
              </button>
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                data-size="lg"
                onClick={() => startMock(false)}
              >
                {uiText('Ver demonstração')}
              </button>
            </div>
          </>
        )}
        {kind === 'noConsole' && (
          <>
            <h1>{conn ? link.title : uiText('Servidor ok, console não conectado')}</h1>
            {conn && link.detail && <p>{link.detail}</p>}
            <ul>
              <li>{uiText('PS5 ligado e na mesma rede (Wi-Fi) que este PC.')}</li>
              <li>{uiText('Gran Turismo 7 aberto numa pista (no menu o PS5 não envia dados).')}</li>
              <li>
                {`${uiText('Porta UDP')} `}
                {GT7_CLIENT_PORT}
                {` ${uiText('liberada no Firewall do Windows (rede privada).')}`}
              </li>
            </ul>
            <div className="status-actions" data-no-gesture>
              <button
                type="button"
                className="ui-btn"
                data-size="lg"
                onClick={() => void rescanConsole()}
              >
                <Icon name="refresh" size={20} />
                {uiText('Procurar de novo')}
              </button>
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                data-size="lg"
                onClick={openConnectionPanel}
              >
                {uiText('Detalhes')}
              </button>
            </div>
            {serverStatus && (
              <p className="status-muted num">
                {`${uiText('Pacotes recebidos:')} `}
                {serverStatus.ingestor.received}
                {uiText('. Formato pedido:')} {serverStatus.ingestor.format}
              </p>
            )}
          </>
        )}
        {kind === 'menu' && (
          <>
            <h1>{uiText('No menu')}</h1>
            <p>{uiText('O painel volta sozinho quando o carro estiver na pista.')}</p>
          </>
        )}
        <p className="status-foot">{uiText('Segure a tela para escolher as telas e ajustes.')}</p>
      </div>
    </div>
  );
}
