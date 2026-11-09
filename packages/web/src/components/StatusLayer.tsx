/**
 * Status screens over the dashboard: no server, server without console, menu, paused, switching
 * packet format. Full screens block the views; banners leave them visible.
 */

import { GT7_CLIENT_PORT } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { describeLink } from '../lib/consoleLink.ts';
import { statusKind } from '../lib/status.ts';
import { retryServerNow, startMock } from '../net/connection.ts';
import { rescanConsole } from '../net/consoleActions.ts';
import { openConnectionPanel, useConsoleConnection } from '../state/consoleLink.ts';
import { useUi } from '../state/uiStore.ts';

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
        {kind === 'paused' ? (
          <strong>Pausado</strong>
        ) : (
          <>
            <strong>Trocando o formato do pacote</strong>
            <span>O console precisa de uns 15 s sem sinal para aceitar o novo formato.</span>
          </>
        )}
      </div>
    );
  }

  const host = typeof location === 'undefined' ? '' : location.host;
  return (
    <div className="status-screen" data-kind={kind} role="status">
      {kind === 'connectingServer' && (
        <>
          <h1>Conectando ao servidor…</h1>
          <p className="dim">{host}</p>
        </>
      )}
      {kind === 'noServer' && (
        <>
          <h1>Sem conexão com o servidor</h1>
          <p>
            O painel não encontrou o servidor em <strong>{host}</strong>.
            {wsEverOpened ? ' A conexão caiu.' : ''}
          </p>
          <ul>
            <li>Confira se o servidor está rodando no PC.</li>
            <li>O PC e o dispositivo remoto precisam estar na mesma rede local.</li>
            <li>Use o endereço ou o QR code mostrado na tela do PC.</li>
          </ul>
          <p className="dim">
            {secs !== null && secs > 0 ? `Nova tentativa em ${secs} s` : 'Tentando de novo…'}
          </p>
          <div className="status-actions" data-no-gesture>
            <button type="button" className="btn" onClick={retryServerNow}>
              Tentar agora
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => startMock(false)}>
              Ver demonstração
            </button>
          </div>
        </>
      )}
      {kind === 'noConsole' && (
        <>
          <h1>{conn ? link.title : 'Servidor ok, console não conectado'}</h1>
          {conn && link.detail && <p>{link.detail}</p>}
          <ul>
            <li>PS5 ligado e na mesma rede (Wi-Fi) que este PC.</li>
            <li>Gran Turismo 7 aberto numa pista (no menu o PS5 não envia dados).</li>
            <li>Porta UDP {GT7_CLIENT_PORT} liberada no Firewall do Windows (rede privada).</li>
          </ul>
          <div className="status-actions" data-no-gesture>
            <button type="button" className="btn" onClick={() => void rescanConsole()}>
              Procurar de novo
            </button>
            <button type="button" className="btn btn-ghost" onClick={openConnectionPanel}>
              Detalhes
            </button>
          </div>
          {serverStatus && (
            <p className="dim num">
              Pacotes recebidos: {serverStatus.ingestor.received}. Formato pedido:{' '}
              {serverStatus.ingestor.format}
            </p>
          )}
        </>
      )}
      {kind === 'menu' && (
        <>
          <h1>No menu</h1>
          <p>O painel volta sozinho quando o carro estiver na pista.</p>
        </>
      )}
      <p className="status-foot dim">Segure a tela para escolher as telas e ajustes.</p>
    </div>
  );
}
