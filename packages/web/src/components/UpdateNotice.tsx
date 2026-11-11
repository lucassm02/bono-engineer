/** Discreet "Nova versão — atualizar" toast (see lib/swUpdate.ts). */

import { t as uiText } from '../lib/i18n.ts';
import { applySwUpdate, dismissSwUpdate, useSwUpdate } from '../lib/swUpdate.ts';
import '../styles/update-notice.css';
import { Icon } from './ui/Icon.tsx';

export function UpdateNotice() {
  const show = useSwUpdate((s) => s.available && !s.dismissed);
  if (!show) return null;
  return (
    <div className="ui-toast update-notice" role="status">
      <Icon name="refresh" size={18} className="update-notice-icon" />
      <span>{uiText('Nova versão disponível')}</span>
      <button type="button" className="ui-btn" data-size="sm" onClick={applySwUpdate}>
        {uiText('Atualizar')}
      </button>
      <button
        type="button"
        className="ui-icon-btn"
        onClick={dismissSwUpdate}
        aria-label={uiText('Dispensar o aviso de nova versão')}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
