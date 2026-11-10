import { useEffect, useState } from 'react';

export function FullscreenButton({ className }: { className: string }) {
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

  return (
    <div>
      <button type="button" className={className} data-no-gesture onClick={() => void toggle()}>
        {active ? 'Sair da tela cheia' : 'Tela cheia'}
      </button>
      {failed && <p role="status">Não foi possível alternar a tela cheia neste aparelho.</p>}
    </div>
  );
}
