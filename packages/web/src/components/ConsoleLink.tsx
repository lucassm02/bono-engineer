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
import { backToAutomatic, pinConsoleIp, rescanConsole } from '../net/consoleActions.ts';
import {
  closeConnectionPanel,
  openConnectionPanel,
  useConsoleConnection,
} from '../state/consoleLink.ts';
import { useUi } from '../state/uiStore.ts';

export function LinkDot({ tone, busy }: { tone: LinkTone; busy?: boolean }) {
  return (
    <span className="cx-dot" data-tone={tone} data-busy={busy ? '1' : '0'} aria-hidden="true" />
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
      aria-label={`Conexão com o PS5: ${view.title}. Abrir detalhes.`}
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
  return (
    <form className="cx-ipform" onSubmit={submit} noValidate>
      <label>
        Endereço IP do PS5
        <input
          ref={inputRef}
          className="cx-input"
          value={ip}
          placeholder="192.168.0.20"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={touched && !valid}
          aria-describedby="cx-ip-help"
          onChange={(e) => setIp(e.target.value)}
        />
      </label>
      <button type="submit" className="cx-btn" disabled={busy || ip.trim() === ''}>
        Usar este IP
      </button>
      <p id="cx-ip-help" className="cx-help" data-bad={touched && !valid ? '1' : '0'}>
        {touched && !valid
          ? 'Digite quatro números de 0 a 255 separados por pontos, como 192.168.0.20.'
          : 'No PS5: Configurações › Rede › Ver status da conexão › Endereço IPv4.'}
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
      <div className="cx-status" data-tone={view.tone} role="status">
        <LinkDot tone={view.tone} busy={view.busy} />
        <div>
          <strong>{view.title}</strong>
          {view.detail && <p>{view.detail}</p>}
        </div>
      </div>

      {conn && (
        <dl className="cx-facts">
          <div>
            <dt>Endereço do PS5</dt>
            <dd>
              {conn.consoleIp ? (
                <>
                  <span className="num">{conn.consoleIp}</span>{' '}
                  <span className="dim">({ipSourceLabel(conn.source)})</span>
                </>
              ) : (
                <span className="dim">ainda não encontrado</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Redes verificadas</dt>
            <dd>
              {conn.subnets.length > 0 ? (
                <span className="num">{conn.subnets.join(', ')}</span>
              ) : (
                <span className="dim">nenhuma rede local encontrada neste PC</span>
              )}
            </dd>
          </div>
          {conn.state === 'searching' && (
            <div>
              <dt>Busca</dt>
              <dd>{hostsProbedText(conn.hostsProbed)}</dd>
            </div>
          )}
          <div>
            <dt>Último sinal</dt>
            <dd>{agoText(conn.lastPacketAt)}</dd>
          </div>
          <div>
            <dt>Última busca</dt>
            <dd>{agoText(conn.lastScanAt)}</dd>
          </div>
        </dl>
      )}

      <div className="cx-actions">
        <button
          type="button"
          className="cx-btn"
          disabled={busy || (!mock && !conn)}
          onClick={() => run(rescanConsole)}
        >
          Procurar de novo
        </button>
        <button
          type="button"
          className="cx-btn cx-btn-ghost"
          aria-expanded={showIp}
          onClick={() => setShowIp((v) => !v)}
        >
          Usar outro IP
        </button>
        {conn?.source === 'manual' && (
          <button
            type="button"
            className="cx-btn cx-btn-ghost"
            disabled={busy}
            onClick={() => run(backToAutomatic)}
          >
            Voltar ao automático
          </button>
        )}
      </div>
      {showIp && <IpForm autoFocus onDone={() => setShowIp(false)} />}
      <p className="cx-help">
        Você não precisa informar o IP: o app procura o PS5 sozinho. Use “Usar outro IP” só se a
        busca automática não achar o console.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

/** Modal with the details; mounted once per app area, opened by {@link openConnectionPanel}. */
export function ConsolePanelHost() {
  const open = useUi((s) => s.connectionPanelOpen);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConnectionPanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="cx-backdrop"
      data-no-gesture
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeConnectionPanel();
      }}
    >
      <div className="cx-modal" role="dialog" aria-modal="true" aria-labelledby="cx-modal-title">
        <header className="cx-modal-head">
          <h2 id="cx-modal-title">Conexão com o PS5</h2>
          <button
            ref={closeRef}
            type="button"
            className="cx-close"
            aria-label="Fechar"
            onClick={closeConnectionPanel}
          >
            ×
          </button>
        </header>
        <ConnectionDetails />
      </div>
    </div>
  );
}
