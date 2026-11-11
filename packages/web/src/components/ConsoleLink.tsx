/**
 * "Conexão com o PS5": the discreet indicator (live panel + analysis header), the details panel
 * (modal, also used inline in the settings) with "Procurar de novo" / "Usar outro IP" /
 * "Voltar ao automático".
 */

import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  agoText,
  describeLink,
  hostsProbedText,
  ipSourceLabel,
  isValidIpv4,
  type LinkTone,
} from '../lib/consoleLink.ts';
import { t as uiText } from '../lib/i18n.ts';
import { backToAutomatic, pinConsoleIp, rescanConsole } from '../net/consoleActions.ts';
import {
  closeConnectionPanel,
  openConnectionPanel,
  useConsoleConnection,
} from '../state/consoleLink.ts';
import { useUi } from '../state/uiStore.ts';
import { Icon } from './ui/Icon.tsx';
import { Modal } from './ui/Modal.tsx';

/** Tom do link (lib/consoleLink) → tom do ponto e do cartão no design system. */
const DOT_TONE: Record<LinkTone, string> = {
  ok: 'gain',
  busy: 'accent',
  info: 'accent',
  warn: 'warn',
  bad: 'loss',
};

export function LinkDot({ tone, busy }: { tone: LinkTone; busy?: boolean }) {
  return (
    <span
      className="ui-dot cx-dot"
      data-tone={DOT_TONE[tone]}
      data-busy={busy ? '1' : '0'}
      aria-hidden="true"
    />
  );
}

/**
 * Small indicator that opens the details panel. In the live panel it shrinks to a dot while
 * telemetry is arriving, so it never competes with the numbers.
 */
export function ConsoleChip({ variant }: { variant: 'live' | 'bar' }) {
  const conn = useConsoleConnection();
  const view = describeLink(conn);
  const quiet = variant === 'live' && conn?.state === 'receiving';
  return (
    <button
      type="button"
      className="cx-chip"
      data-variant={variant}
      data-quiet={quiet ? '1' : '0'}
      data-tone={view.tone}
      data-no-gesture
      aria-label={uiText('Conexão com o PS5: {0}. Abrir detalhes.', view.title)}
      title={view.title}
      onClick={openConnectionPanel}
    >
      <LinkDot tone={view.tone} busy={view.busy} />
      {!quiet && <span className="cx-chip-text">{view.short}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------

/** "Usar outro IP": optional field with IPv4 validation. */
export function IpForm({ onDone, autoFocus }: { onDone?: () => void; autoFocus?: boolean }) {
  const [ip, setIp] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const valid = isValidIpv4(ip);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    const ok = await pinConsoleIp(ip);
    setBusy(false);
    if (ok) {
      setIp('');
      setTouched(false);
      onDone?.();
    }
  };
  const bad = touched && !valid;
  return (
    <form className="cx-ipform" onSubmit={submit} noValidate>
      <label className="ui-field">
        <span className="ui-label">{uiText('Endereço IP do PS5')}</span>
        <input
          ref={inputRef}
          className="ui-input cx-input"
          value={ip}
          placeholder="192.168.0.20"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={bad}
          aria-describedby="cx-ip-help"
          onChange={(e) => setIp(e.target.value)}
        />
      </label>
      <button type="submit" className="ui-btn" disabled={busy || ip.trim() === ''}>
        {uiText('Usar este IP')}
      </button>
      <p id="cx-ip-help" className={bad ? 'ui-error' : 'ui-help'}>
        {bad
          ? uiText('Digite quatro números de 0 a 255 separados por pontos, como 192.168.0.20.')
          : uiText('No PS5: Configurações › Rede › Ver status da conexão › Endereço IPv4.')}
      </p>
    </form>
  );
}

/** Status, facts and the three actions. Used in the modal and inline in the settings. */
export function ConnectionDetails() {
  const conn = useConsoleConnection();
  const mock = useUi((s) => s.source === 'mock');
  const view = describeLink(conn);
  const [busy, setBusy] = useState(false);
  const [showIp, setShowIp] = useState(false);

  const run = async (fn: () => Promise<boolean>) => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cx-details">
      <div className="ui-card cx-status" data-tone={DOT_TONE[view.tone]} role="status">
        <LinkDot tone={view.tone} busy={view.busy} />
        <div>
          <strong>{view.title}</strong>
          {view.detail && <p>{view.detail}</p>}
        </div>
      </div>

      {conn && (
        <dl className="cx-facts">
          <div>
            <dt>{uiText('Endereço do PS5')}</dt>
            <dd>
              {conn.consoleIp ? (
                <>
                  <span className="num">{conn.consoleIp}</span>{' '}
                  <span className="cx-muted">({ipSourceLabel(conn.source)})</span>
                </>
              ) : (
                <span className="cx-muted">{uiText('ainda não encontrado')}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{uiText('Redes verificadas')}</dt>
            <dd>
              {conn.subnets.length > 0 ? (
                <span className="num">{conn.subnets.join(', ')}</span>
              ) : (
                <span className="cx-muted">{uiText('nenhuma rede local encontrada neste PC')}</span>
              )}
            </dd>
          </div>
          {conn.state === 'searching' && (
            <div>
              <dt>{uiText('Busca')}</dt>
              <dd>{hostsProbedText(conn.hostsProbed)}</dd>
            </div>
          )}
          <div>
            <dt>{uiText('Último sinal')}</dt>
            <dd>{agoText(conn.lastPacketAt)}</dd>
          </div>
          <div>
            <dt>{uiText('Última busca')}</dt>
            <dd>{agoText(conn.lastScanAt)}</dd>
          </div>
        </dl>
      )}

      <div className="cx-actions">
        <button
          type="button"
          className="ui-btn"
          disabled={busy || (!mock && !conn)}
          onClick={() => run(rescanConsole)}
        >
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
          {uiText('Usar outro IP')}
        </button>
        {conn?.source === 'manual' && (
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            disabled={busy}
            onClick={() => run(backToAutomatic)}
          >
            {uiText('Voltar ao automático')}
          </button>
        )}
      </div>
      {showIp && <IpForm autoFocus onDone={() => setShowIp(false)} />}
      <p className="ui-help">
        {uiText(
          'Você não precisa informar o IP: o app procura o PS5 sozinho. Use “Usar outro IP” só se a busca automática não achar o console.',
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

/** Modal with the details; mounted once per app area, opened by {@link openConnectionPanel}. */
export function ConsolePanelHost() {
  const open = useUi((s) => s.connectionPanelOpen);
  return (
    <Modal
      open={open}
      onClose={closeConnectionPanel}
      className="bn-modal-text"
      title={uiText('Conexão com o PS5')}
      subtitle="O app procura o console sozinho. Aqui você acompanha e corrige, se precisar."
    >
      <ConnectionDetails />
    </Modal>
  );
}
