import { useEffect, useState } from 'react';
import { t as uiText } from '../lib/i18n.ts';
import { Icon } from './ui/Icon.tsx';

/** Botão de ícone para entrar e sair da tela cheia (some quando o navegador não suporta). */
export function FullscreenButton({ className }: { className?: string }) {
  const [active, setActive] = useState(() => !!document.fullscreenElement);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    function sync() {
      setActive(!!document.fullscreenElement);
      setFailed(false);
    }
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  if (!document.fullscreenEnabled) return null;

  async function toggle() {
    setFailed(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFailed(true);
    }
  }

  const label = active ? uiText('Sair da tela cheia') : uiText('Tela cheia');
  return (
    <div className="bn-fs">
      <button
        type="button"
        className={`ui-icon-btn${className ? ` ${className}` : ''}`}
        data-no-gesture
        aria-label={label}
        aria-pressed={active}
        title={label}
        onClick={() => void toggle()}
      >
        <Icon name="fullscreen" />
      </button>
      {failed && (
        <p role="status" className="bn-fs-error ui-error">
          {uiText('Não foi possível alternar a tela cheia neste aparelho.')}
        </p>
      )}
    </div>
  );
}
