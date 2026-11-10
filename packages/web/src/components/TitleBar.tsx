/**
 * Barra de título do app para Windows. O Electron esconde a barra nativa e pinta só os botões
 * (minimizar/maximizar/fechar) com o tema; esta faixa ocupa o resto: marca + nome, e serve de área
 * de arraste (duplo clique maximiza). Fora do app (navegador, tablet) ou em tela cheia ela não
 * existe: `navigator.windowControlsOverlay.visible` é falso.
 */

import { PRODUCT_NAME } from '@gt7/shared';
import { useEffect, useState } from 'react';

interface WindowControlsOverlay extends EventTarget {
  visible: boolean;
}

function overlay(): WindowControlsOverlay | undefined {
  return (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlay })
    .windowControlsOverlay;
}

/** True enquanto a barra própria está visível. Também liga `html[data-titlebar]` (CSS reserva o espaço). */
export function useTitleBar(): boolean {
  const [visible, setVisible] = useState(() => !!overlay()?.visible);
  useEffect(() => {
    const wco = overlay();
    if (!wco) return;
    const sync = () => setVisible(wco.visible);
    wco.addEventListener('geometrychange', sync);
    sync();
    return () => wco.removeEventListener('geometrychange', sync);
  }, []);
  useEffect(() => {
    const el = document.documentElement;
    if (visible) el.dataset.titlebar = '1';
    else delete el.dataset.titlebar;
    return () => {
      delete el.dataset.titlebar;
    };
  }, [visible]);
  return visible;
}

export function TitleBar() {
  const visible = useTitleBar();
  if (!visible) return null;
  return (
    <div className="titlebar" data-no-gesture>
      <img className="titlebar-mark" src="/favicon.svg" alt="" width={18} height={18} />
      <span className="titlebar-name">{PRODUCT_NAME}</span>
    </div>
  );
}
