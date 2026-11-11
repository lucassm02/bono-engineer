/**
 * Saída sempre disponível do painel ao vivo: o botão de menu ao lado do cadeado abre uma gaveta com
 * três abas — Navegar (as outras áreas do app), Engenheiro (rádio) e Painel (telas e comportamento).
 * Teclado: M abre/fecha; Esc, fundo e foco vêm do componente Modal.
 */

import { type KeyboardEvent, useId, useState } from 'react';
import { t as uiText } from '../lib/i18n.ts';
import { routes } from '../lib/route.ts';
import {
  closeMenu,
  dispatchProfile,
  openLayoutEditor,
  openPicker,
  setLocked,
} from '../state/actions.ts';
import { useUi } from '../state/uiStore.ts';
import { EngineerControls } from './EngineerControls.tsx';
import { FullscreenButton } from './FullscreenButton.tsx';
import { LiveContextBar } from './LiveContextBar.tsx';
import { ProductBrand } from './ProductBrand.tsx';
import { ToggleRow } from './ToggleRow.tsx';
import { Icon, type IconName } from './ui/Icon.tsx';
import { Modal } from './ui/Modal.tsx';

interface Entry {
  icon: IconName;
  label: string;
  hint: string;
  href: string;
}

const AREAS: readonly Entry[] = [
  {
    icon: 'home',
    get label() {
      return uiText('Início');
    },
    get hint() {
      return uiText('Suas pistas, sessões e voltas');
    },
    href: routes.home(),
  },
  {
    icon: 'compare',
    get label() {
      return uiText('Comparar voltas');
    },
    get hint() {
      return uiText('Curva a curva, com gráficos');
    },
    href: routes.compare({}),
  },
  {
    icon: 'capture',
    get label() {
      return uiText('Captura de referência');
    },
    get hint() {
      return uiText('Gravar a volta de um replay');
    },
    href: routes.capture(),
  },
  {
    icon: 'coach',
    get label() {
      return uiText('Coach de IA');
    },
    get hint() {
      return uiText('Análise e dicas da sua sessão');
    },
    href: routes.coach(),
  },
  {
    icon: 'guide',
    get label() {
      return uiText('Guia de pilotagem');
    },
    get hint() {
      return uiText('Técnicas por classe de carro');
    },
    href: routes.guide(),
  },
];

const SETUP: readonly Entry[] = [
  {
    icon: 'config',
    get label() {
      return uiText('Configurações');
    },
    get hint() {
      return uiText('Console, dispositivos, dados e IA');
    },
    href: routes.config(),
  },
  {
    icon: 'remote',
    get label() {
      return uiText('Dispositivo remoto');
    },
    get hint() {
      return uiText('QR Code e endereço para abrir o painel em outro aparelho');
    },
    href: routes.config('acesso-remoto'),
  },
];

type TabId = 'nav' | 'engineer' | 'panel';
const TABS: readonly { id: TabId; label: string }[] = [
  {
    id: 'nav',
    get label() {
      return uiText('Navegar');
    },
  },
  {
    id: 'engineer',
    get label() {
      return uiText('Engenheiro');
    },
  },
  {
    id: 'panel',
    get label() {
      return uiText('Painel');
    },
  },
];

/** Botão flutuante, à esquerda do cadeado. */
export function MenuButton() {
  const open = useUi((s) => s.menuOpen);
  return (
    <button
      type="button"
      className="live-menu-btn"
      data-no-gesture
      aria-label={uiText('Menu: histórico, comparação, captura e ajustes')}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => useUi.setState({ menuOpen: !open, overlayVisible: false })}
    >
      <Icon name="menu" />
    </button>
  );
}

function ListItemBody({ icon, title, hint }: { icon: IconName; title: string; hint: string }) {
  return (
    <>
      <Icon name={icon} size={22} />
      <span className="ui-list-text">
        <span className="ui-list-title">{title}</span>
        <span className="ui-list-desc">{hint}</span>
      </span>
      <Icon name="chevron-right" size={18} className="bn-chev" />
    </>
  );
}

function LinkList({ entries }: { entries: readonly Entry[] }) {
  return (
    <ul className="ui-list">
      {entries.map((e) => (
        <li key={e.label}>
          <a className="ui-list-item" href={e.href} onClick={closeMenu}>
            <ListItemBody icon={e.icon} title={e.label} hint={e.hint} />
          </a>
        </li>
      ))}
    </ul>
  );
}

function NavigateTab() {
  return (
    <div className="bn-stack">
      <section className="bn-section" aria-labelledby="bn-areas">
        <h3 id="bn-areas" className="ui-eyebrow">
          {uiText('Áreas do app')}
        </h3>
        <LinkList entries={AREAS} />
      </section>
      <section className="bn-section" aria-labelledby="bn-setup">
        <h3 id="bn-setup" className="ui-eyebrow">
          {uiText('Aparelhos e ajustes')}
        </h3>
        <LinkList entries={SETUP} />
      </section>
    </div>
  );
}

function PanelTab() {
  const locked = useUi((s) => s.profile.locked);
  const popups = useUi((s) => s.profile.popupsEnabled);
  const hint = locked ? uiText('Destrave os gestos para abrir') : null;
  return (
    <div className="bn-stack">
      <section className="bn-section" aria-labelledby="bn-screens">
        <h3 id="bn-screens" className="ui-eyebrow">
          {uiText('Telas')}
        </h3>
        <ul className="ui-list">
          <li>
            <button
              type="button"
              className="ui-list-item"
              disabled={locked}
              onClick={() => {
                closeMenu();
                openPicker();
              }}
            >
              <ListItemBody
                icon="live"
                title={uiText('Telas do painel ao vivo')}
                hint={hint ?? uiText('Escolher e ordenar as telas deste aparelho')}
              />
            </button>
          </li>
          <li>
            <button
              type="button"
              className="ui-list-item"
              disabled={locked}
              onClick={() => {
                closeMenu();
                openLayoutEditor();
              }}
            >
              <ListItemBody
                icon="layout"
                title={uiText('Editar tela Personalizada')}
                hint={hint ?? uiText('Montar a sua grade de widgets')}
              />
            </button>
          </li>
        </ul>
      </section>
      <section className="ui-card bn-card" aria-labelledby="bn-behavior">
        <div className="ui-card-head">
          <h3 id="bn-behavior" className="ui-card-title">
            {uiText('Comportamento')}
          </h3>
        </div>
        <ToggleRow
          title={uiText('Travar gestos')}
          description={uiText('Evita trocar de tela sem querer. Segure o cadeado para destravar.')}
          checked={locked}
          onChange={setLocked}
        />
        <hr className="ui-divider" />
        <ToggleRow
          title={uiText('Cartão ao fechar a volta')}
          description={uiText('Mostra o tempo e os setores quando você completa uma volta.')}
          checked={popups}
          onChange={(enabled) => dispatchProfile({ type: 'setPopups', enabled })}
        />
      </section>
    </div>
  );
}

export function LiveMenuSheet() {
  const open = useUi((s) => s.menuOpen);
  const [tab, setTab] = useState<TabId>('nav');
  const base = useId();

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length]!;
    setTab(next.id);
    document.getElementById(`${base}-tab-${next.id}`)?.focus();
  }

  return (
    <Modal
      open={open}
      onClose={closeMenu}
      placement="side"
      className="bn-drawer"
      title={
        <>
          <span className="bn-sr-only">{`${uiText('Menu ·')} `}</span>
          <ProductBrand />
        </>
      }
      headerExtra={<FullscreenButton />}
      footer={
        <>
          <p className="bn-foot-hint">
            <kbd className="ui-kbd">M</kbd>
            {` ${uiText('abre e fecha o menu ·')} `}
            <kbd className="ui-kbd">Esc</kbd> {uiText('fecha')}
          </p>
          <button type="button" className="ui-btn" onClick={closeMenu}>
            {uiText('Voltar ao painel')}
          </button>
        </>
      }
    >
      <LiveContextBar variant="menu" />
      <div
        className="ui-tabs bn-tabs"
        role="tablist"
        aria-label={uiText('Seções do menu')}
        onKeyDown={onTabKey}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`${base}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${base}-panel-${tab}`}
        aria-labelledby={`${base}-tab-${tab}`}
        className="bn-tabpanel"
      >
        {tab === 'nav' && <NavigateTab />}
        {tab === 'engineer' && <EngineerControls />}
        {tab === 'panel' && <PanelTab />}
      </div>
    </Modal>
  );
}
