/**
 * Always-visible way out of the live dashboard: a menu button next to the padlock opens a sheet with
 * shortcuts to every other area (history, compare, reference capture, coach, guide, settings) and
 * to the dashboard's own screen picker. Keyboard: M toggles it, Esc closes it.
 */

import { useEffect, useRef } from 'react';
import { routes } from '../lib/route.ts';
import { closeMenu, openPicker } from '../state/actions.ts';
import { useUi } from '../state/uiStore.ts';
import { EngineerControls } from './EngineerControls.tsx';
import { FullscreenButton } from './FullscreenButton.tsx';
import { ProductBrand } from './ProductBrand.tsx';

interface Entry {
  label: string;
  hint: string;
  go: () => void;
}

const goTo = (hash: string) => () => {
  closeMenu();
  location.hash = hash;
};

const ENTRIES: readonly Entry[] = [
  { label: 'Início', hint: 'Suas pistas, sessões e voltas', go: goTo(routes.home()) },
  { label: 'Comparar voltas', hint: 'Curva a curva, com gráficos', go: goTo(routes.compare({})) },
  {
    label: 'Captura de referência',
    hint: 'Gravar a volta de um replay',
    go: goTo(routes.capture()),
  },
  { label: 'Coach de IA', hint: 'Análise e dicas da sua sessão', go: goTo(routes.coach()) },
  { label: 'Guia de pilotagem', hint: 'Técnicas por classe de carro', go: goTo(routes.guide()) },
  { label: 'Configurações', hint: 'Console, dispositivos, dados e IA', go: goTo(routes.config()) },
];

function MenuGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="live-menu-glyph">
      <path d="M5 7h14M5 12h14M5 17h14" />
    </svg>
  );
}

/** Floating button, left of the padlock. */
export function MenuButton() {
  const open = useUi((s) => s.menuOpen);
  return (
    <button
      type="button"
      className="live-menu-btn"
      data-no-gesture
      aria-label="Menu: histórico, comparação, captura e ajustes"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => useUi.setState({ menuOpen: !open, overlayVisible: false })}
    >
      <MenuGlyph />
    </button>
  );
}

export function LiveMenuSheet() {
  const open = useUi((s) => s.menuOpen);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="live-menu-backdrop"
      data-no-gesture
      onPointerDown={(e) => e.target === e.currentTarget && closeMenu()}
    >
      <div className="live-menu" role="dialog" aria-modal="true" aria-label="Menu do app">
        <header className="live-menu-head">
          <ProductBrand />
          <FullscreenButton className="btn btn-ghost" />
          <button type="button" className="btn btn-ghost" ref={closeRef} onClick={closeMenu}>
            Voltar ao painel
          </button>
        </header>
        <a
          className="live-menu-item live-menu-remote"
          href={routes.config('acesso-remoto')}
          onClick={closeMenu}
        >
          <span className="live-menu-label">Dispositivo remoto</span>
          <span className="live-menu-hint">Abrir QR Code e endereço do painel</span>
        </a>
        <EngineerControls />
        <ul className="live-menu-list">
          {ENTRIES.map((e) => (
            <li key={e.label}>
              <button type="button" className="live-menu-item" onClick={e.go}>
                <span className="live-menu-label">{e.label}</span>
                <span className="live-menu-hint">{e.hint}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="live-menu-item live-menu-item-alt"
              onClick={() => {
                closeMenu();
                openPicker();
              }}
            >
              <span className="live-menu-label">Telas do painel ao vivo</span>
              <span className="live-menu-hint">Escolher e ordenar as telas deste aparelho</span>
            </button>
          </li>
        </ul>
        <p className="live-menu-keys">Atalho: tecla M abre e fecha este menu.</p>
      </div>
    </div>
  );
}
