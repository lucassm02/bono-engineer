/** Discreet "Nova versão — atualizar" pill (see lib/swUpdate.ts). */

import { applySwUpdate, dismissSwUpdate, useSwUpdate } from '../lib/swUpdate.ts';
import '../styles/update-notice.css';

export function UpdateNotice() {
  const show = useSwUpdate((s) => s.available && !s.dismissed);
  if (!show) return null;
  return (
    <div className="update-notice" role="status">
      <span>Nova versão disponível</span>
      <button type="button" className="update-notice-go" onClick={applySwUpdate}>
        Atualizar
      </button>
      <button
        type="button"
        className="update-notice-x"
        onClick={dismissSwUpdate}
        aria-label="Dispensar o aviso de nova versão"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
