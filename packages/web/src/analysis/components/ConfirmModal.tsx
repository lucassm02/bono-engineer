/** Confirmação de ação destrutiva: modal pequeno com Cancelar e botão de perigo. */

import type { ReactNode } from 'react';
import { Modal } from '../../components/ui/Modal.tsx';
import { t as uiText } from '../../lib/i18n.ts';

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = uiText('Apagar'),
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <button type="button" className="ui-btn" data-variant="secondary" onClick={onClose}>
            {uiText('Cancelar')}
          </button>
          <button
            type="button"
            className="ui-btn"
            data-variant="danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="pn-confirm">{message}</div>
    </Modal>
  );
}
