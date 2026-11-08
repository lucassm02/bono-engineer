/** Small building blocks of the analysis area (cards, states, confirm, copy). */

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { routes } from '../../lib/route.ts';
import type { ApiError } from '../api.ts';

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · GT7 Engenheiro`;
  }, [title]);
}

export function PageHead({
  title,
  sub,
  actions,
  back,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="a-pagehead">
      <div className="a-pagehead-text">
        {back && (
          <a className="a-back" href={back.href}>
            ← {back.label}
          </a>
        )}
        <h1>{title}</h1>
        {sub && <p className="a-sub">{sub}</p>}
      </div>
      {actions && <div className="a-actions">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  actions,
  children,
  className = '',
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`a-card ${className}`} id={id}>
      {(title || actions) && (
        <header className="a-card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="a-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Loading({ text = 'Carregando…' }: { text?: string }) {
  return (
    <div className="a-loading" role="status">
      <span className="a-spinner" aria-hidden="true" />
      {text}
    </div>
  );
}

export function ErrorBox({
  error,
  onRetry,
  compact,
}: {
  error: ApiError | Error | string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const msg = typeof error === 'string' ? error : error.message;
  const offline = typeof error !== 'string' && (error as ApiError).offline;
  return (
    <div className={`a-error ${compact ? 'a-error-compact' : ''}`} role="alert">
      <strong>{offline ? 'Servidor fora do ar' : 'Algo deu errado'}</strong>
      <p>{msg}</p>
      {offline && !compact && (
        <p className="dim">
          O painel ao vivo continua funcionando em modo demonstração (<a href="/?mock=1">abrir</a>
          ), mas a análise precisa dos dados gravados no servidor.
        </p>
      )}
      {onRetry && (
        <button type="button" className="a-btn a-btn-ghost" onClick={onRetry}>
          Tentar de novo
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="a-empty">{children}</div>;
}

/** Two-step destructive button: first click asks, second confirms (no blocking dialogs). */
export function ConfirmButton({
  label,
  confirmLabel = 'Confirmar',
  question = 'Tem certeza?',
  onConfirm,
  className = 'a-btn a-btn-danger',
  disabled,
}: {
  label: ReactNode;
  confirmLabel?: string;
  question?: string;
  onConfirm: () => Promise<unknown> | undefined;
  className?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), 6000);
    return () => clearTimeout(t);
  }, [asking]);
  if (!asking) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled || busy}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="a-confirm">
      <span className="a-confirm-q">{question}</span>
      <button
        type="button"
        className="a-btn a-btn-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="a-btn a-btn-ghost" onClick={() => setAsking(false)}>
        Cancelar
      </button>
    </span>
  );
}

/** Copies text (Clipboard API needs a secure context; plain-http LAN pages use execCommand). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall back below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <button
      type="button"
      className="a-btn a-btn-ghost a-btn-sm"
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? 'ok' : 'fail');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 1800);
      }}
    >
      {state === 'ok' ? 'Copiado ✓' : state === 'fail' ? 'Selecione e copie' : label}
    </button>
  );
}

/** Code block with a copy button. */
export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="a-code">
      <div className="a-code-head">
        <span>{label}</span>
        <CopyButton text={code} />
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function Tag({
  children,
  tone,
  title,
}: {
  children: ReactNode;
  tone?: 'ref' | 'bad' | 'pb' | 'sb' | 'info' | 'warn';
  title?: string;
}) {
  return (
    <span className="a-tag" data-tone={tone} title={title}>
      {children}
    </span>
  );
}

export function NoKeyHint() {
  return (
    <p className="dim">
      Configure a chave da API em <a href={routes.config('coach')}>Configurações</a>.
    </p>
  );
}
