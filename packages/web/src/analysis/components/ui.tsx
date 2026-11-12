/** Small building blocks of the analysis area (cards, states, confirm, copy). */

import { PRODUCT_NAME } from '@gt7/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/ui/Icon.tsx';
import { humanizeError } from '../../lib/copy.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { routes } from '../../lib/route.ts';
import type { ApiError } from '../api.ts';

export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${PRODUCT_NAME}`;
  }, [title]);
}

export function PageHead({
  title,
  sub,
  actions,
  back,
  eyebrow,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  eyebrow?: ReactNode;
}) {
  return (
    <header className="a-pagehead">
      <div className="a-pagehead-text">
        {back && (
          <a className="a-back" href={back.href}>
            <Icon name="back" size={16} />
            {back.label}
          </a>
        )}
        {eyebrow && <p className="a-eyebrow">{eyebrow}</p>}
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

export function Loading({ text = uiText('Carregando…') }: { text?: string }) {
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
  const human = humanizeError(typeof error === 'string' ? error : error.message);
  const msg = human.text;
  const offline = typeof error !== 'string' && (error as ApiError).offline;
  return (
    <div
      className={`ui-card a-error ${compact ? 'a-error-compact' : ''}`}
      data-tone="loss"
      role="alert"
    >
      <strong>{offline ? uiText('Servidor fora do ar') : uiText('Algo deu errado')}</strong>
      <p>{uiText(msg)}</p>
      {human.detail && (
        <details className="a-error-detail">
          <summary>{uiText('Detalhe técnico')}</summary>
          <code>{human.detail}</code>
        </details>
      )}
      {offline && !compact && (
        <p className="dim">
          {uiText('A tela ao vivo continua funcionando em modo demonstração (')}
          <a href="/?mock=1">{uiText('abrir')}</a>
          {uiText('), mas a análise precisa dos dados gravados no servidor.')}
        </p>
      )}
      {onRetry && (
        <button type="button" className="a-btn a-btn-ghost" onClick={onRetry}>
          {uiText('Tentar de novo')}
        </button>
      )}
    </div>
  );
}

/** Estado vazio: diz o que falta e, quando há o que fazer, oferece um único botão. */
export function Empty({
  children,
  action,
}: {
  children: ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  return (
    <div className="ui-empty a-empty">
      {children}
      {action &&
        (action.href ? (
          <a className="a-btn" href={action.href}>
            {action.label}
          </a>
        ) : (
          <button type="button" className="a-btn" onClick={action.onClick}>
            {action.label}
          </button>
        ))}
    </div>
  );
}

/** Two-step destructive button: first click asks, second confirms (no blocking dialogs). */
export function ConfirmButton({
  label,
  confirmLabel = uiText('Confirmar'),
  question = uiText('Tem certeza?'),
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
        {uiText('Cancelar')}
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

export function CopyButton({ text, label = uiText('Copiar') }: { text: string; label?: string }) {
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
      {state === 'ok'
        ? uiText('Copiado ✓')
        : state === 'fail'
          ? uiText('Selecione e copie')
          : label}
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
      {`${uiText('Configure a chave da API em')} `}
      <a href={routes.config('coach')}>{uiText('Configurações')}</a>.
    </p>
  );
}
