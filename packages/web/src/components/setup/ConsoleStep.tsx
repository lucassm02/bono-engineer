/**
 * Step 2 · Conectar o PS5. Live search with the checklist after 40 s (PS5 and network, game open,
 * Windows firewall, no other telemetry program) and the IP typed by hand as the last resort. The
 * shell moves on by itself a moment after the console is found. Without a PS5 at hand the demo
 * button skips the step and lets the tour run on simulated data.
 */

import type { ApiStatus } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { api } from '../../analysis/api.ts';
import { copyText } from '../../analysis/components/ui.tsx';
import {
  agoText,
  describeLink,
  hostsProbedText,
  ipSourceLabel,
  isLinkFound,
} from '../../lib/consoleLink.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { GT7_INTEGRATION } from '../../lib/integrations.ts';
import { HELP_AFTER_MS, needsHelp } from '../../lib/onboarding.ts';
import { rescanConsole } from '../../net/consoleActions.ts';
import { useConsoleConnection } from '../../state/consoleLink.ts';
import { IpForm, LinkDot } from '../ConsoleLink.tsx';
import { Icon } from '../ui/Icon.tsx';
import { useStepControl } from './ctx.ts';

function Radar({ found }: { found: boolean }) {
  return (
    <div className="ob-radar" data-found={found ? '1' : '0'} aria-hidden="true">
      <span className="ob-ring" />
      <span className="ob-ring" />
      <span className="ob-ring" />
      <div className="ob-radar-core">
        <Icon name={found ? 'check' : 'remote'} size={34} className={found ? 'ob-check' : ''} />
      </div>
    </div>
  );
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function HelpChecklist({ status }: { status: ApiStatus | null }) {
  const [showIp, setShowIp] = useState(false);
  const fw = status?.firewall;
  return (
    <section
      className="ui-card ob-help"
      data-tone="warn"
      aria-label={uiText('Ajuda para achar o PS5')}
    >
      <h3 className="ui-card-title">{uiText('Ainda não achei o PS5. Vamos conferir:')}</h3>
      <ul>
        <li>
          <strong>{uiText('PS5 ligado e na mesma rede.')}</strong>
          {' ' +
            uiText(
              'Ele precisa estar no mesmo Wi-Fi (ou no mesmo roteador) que este PC. Evite a rede “convidado”.',
            )}
        </li>
        <li>
          <strong>{uiText('Gran Turismo 7 aberto numa pista.')}</strong>
          {' ' +
            uiText('No menu o PS5 não envia dados. Entre num Time Trial, treino livre ou replay.')}
        </li>
        <li>
          <strong>{uiText('Firewall do Windows.')}</strong>{' '}
          {!fw ? (
            uiText('Verificando…')
          ) : fw.state === 'ok' ? (
            uiText('Tudo liberado ✓')
          ) : (
            <>
              {fw.message}
              {fw.powershellCommands.length > 0 && (
                <>
                  <pre className="ob-code">{fw.powershellCommands.join('\n')}</pre>
                  <button
                    type="button"
                    className="ui-btn"
                    data-variant="secondary"
                    data-size="sm"
                    onClick={() => void copyText(fw.powershellCommands.join('\n'))}
                  >
                    <Icon name="copy" size={16} />
                    {uiText('Copiar comandos')}
                  </button>
                </>
              )}
            </>
          )}
        </li>
        <li>
          <strong>{uiText('Nenhum outro programa de telemetria aberto')}</strong>
          {` ${uiText('(SimHub, GT7 Dashboard…): só um deles pode falar com o PS5 por vez.')}`}
        </li>
      </ul>
      <div className="cx-actions">
        <button type="button" className="ui-btn" onClick={() => void rescanConsole()}>
          <Icon name="refresh" size={18} />
          {uiText('Procurar de novo')}
        </button>
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          aria-expanded={showIp}
          onClick={() => setShowIp((v) => !v)}
        >
          {uiText('Último recurso: informar o IP')}
        </button>
      </div>
      {showIp && <IpForm autoFocus />}
    </section>
  );
}

export function ConsoleStep({
  onDemo,
}: {
  /** "Experimentar com a demonstração": skips the step. */
  onDemo: () => void;
}) {
  const conn = useConsoleConnection();
  const view = describeLink(conn);
  const found = isLinkFound(conn?.state ?? null);
  const [startedAt] = useState(() => Date.now());
  const now = useNow(1000);
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const help = needsHelp(now - startedAt, conn?.state ?? null);
  useStepControl({ canContinue: found });

  useEffect(() => {
    if (!help) return;
    let alive = true;
    const load = () =>
      api
        .status()
        .then((s) => alive && setStatus(s))
        .catch(() => {});
    void load();
    const t = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [help]);

  return (
    <div className="su-step su-console">
      <Radar found={found} />
      {found ? (
        <p className="su-lead">
          {conn?.consoleIp ? (
            <>
              {`${uiText('Console em')} `}
              <span className="num">{conn.consoleIp}</span> ({ipSourceLabel(conn.source)}).
            </>
          ) : (
            uiText('Console encontrado.')
          )}{' '}
          {conn?.state === 'receiving'
            ? uiText('Os dados já estão chegando.')
            : uiText('Assim que você entrar numa pista, os dados começam a chegar.')}
        </p>
      ) : (
        <p className="su-lead">
          {`${uiText('No PS5,')} `}
          <strong>{uiText('abra o {0} e entre em uma pista', GT7_INTEGRATION.name)}</strong>
          {` ${uiText('(ou num replay). O resto é comigo.')}`}
        </p>
      )}
      <div className="ui-card ob-live" data-tone={view.tone} role="status" aria-live="polite">
        <LinkDot tone={view.tone} busy={view.busy} />
        <div>
          <strong>{conn?.state === 'found' ? uiText('Aguardando o jogo') : view.title}</strong>
          {conn && conn.state === 'searching' && (
            <span className="ob-live-sub">
              {conn.hostsProbed > 0 ? `${hostsProbedText(conn.hostsProbed)} · ` : ''}
              {agoText(conn.lastScanAt) === 'nunca'
                ? uiText('começando…')
                : uiText('varredura {0}', agoText(conn.lastScanAt))}
            </span>
          )}
        </div>
      </div>
      {!found && (
        <>
          <div className="ob-progress" aria-hidden="true">
            <span />
          </div>
          {!help && (
            <p className="ui-help">
              {uiText(
                'Pode levar alguns segundos. Se demorar mais de {0} s, eu mostro o que conferir.',
                Math.round(HELP_AFTER_MS / 1000),
              )}
            </p>
          )}
          {help && <HelpChecklist status={status} />}
          <div className="su-demo">
            <p className="ui-help">{uiText('Sem o PS5 à mão? Veja o Bono com dados simulados.')}</p>
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              data-size="sm"
              onClick={onDemo}
            >
              {uiText('Experimentar com a demonstração')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
