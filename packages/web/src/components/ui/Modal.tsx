/**
 * Modal / folha única do app. Substitui os diálogos feitos à mão (menu ao vivo, seletor de telas,
 * painel do console, editor de layout, assistente, escolha de carro...).
 *
 *  - `placement="center"` (padrão): janela central; no celular vira folha ancorada embaixo.
 *  - `placement="side"`: gaveta à direita (menus e painéis longos).
 *  - Esc fecha, clique no fundo fecha (`dismissOnBackdrop`), o foco fica preso dentro e volta ao
 *    elemento que abriu. A rolagem do fundo é travada.
 *  - `data-no-gesture` no fundo: os gestos do painel ao vivo ignoram tudo que acontece aqui.
 */

import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { t as uiText } from '../../lib/i18n.ts';
import { Icon } from './Icon.tsx';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Largura: sm 400, md 520 (padrão), lg 760, xl 980. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  placement?: 'center' | 'side';
  /** Rodapé fixo com as ações (Cancelar / Confirmar). */
  footer?: ReactNode;
  /** Conteúdo extra no cabeçalho, à esquerda do botão fechar (ex.: busca, marca). */
  headerExtra?: ReactNode;
  dismissOnBackdrop?: boolean;
  /** Esconde o botão X (ex.: assistente que força um passo). */
  hideClose?: boolean;
  className?: string;
  children: ReactNode;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  placement = 'center',
  footer,
  headerExtra,
  dismissOnBackdrop = true,
  hideClose = false,
  className,
  children,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusables = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null,
      );
    // Primeiro foco: o primeiro campo do corpo; senão o primeiro controle.
    const body = dialog?.querySelector<HTMLElement>('.ui-modal-body');
    const first = body?.querySelector<HTMLElement>(FOCUSABLE) ?? focusables()[0];
    (first ?? dialog)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const head = list[0]!;
      const tail = list[list.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === head || !dialog?.contains(active))) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (active === tail || !dialog?.contains(active))) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="ui-modal-backdrop"
      data-placement={placement}
      data-no-gesture
      onPointerDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`ui-modal${className ? ` ${className}` : ''}`}
        data-size={size}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="ui-modal-head">
          <div className="ui-modal-titles">
            <h2 id={titleId} className="ui-modal-title">
              {title}
            </h2>
            {subtitle && <p className="ui-modal-sub">{subtitle}</p>}
          </div>
          {headerExtra}
          {!hideClose && (
            <button
              type="button"
              className="ui-icon-btn"
              aria-label={uiText('Fechar')}
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          )}
        </header>
        <div className="ui-modal-body">{children}</div>
        {footer && <footer className="ui-modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
