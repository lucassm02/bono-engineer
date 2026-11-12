/**
 * Saída sempre disponível do painel ao vivo: o botão de menu ao lado do cadeado abre uma gaveta com
 * três abas — Navegar (as outras áreas do app), Engenheiro (rádio) e Painel (telas e comportamento).
 * Teclado: M abre/fecha; Esc, fundo e foco vêm do componente Modal.
 */

import { type KeyboardEvent, useEffect, useId, useMemo, useState } from 'react';
import { t as uiText } from '../lib/i18n.ts';
import { routes } from '../lib/route.ts';
import { bumpUsage, isNewcomer, loadMenuTab, type MenuTabId, saveMenuTab } from '../lib/usage.ts';
import {
  closeMenu,
  dispatchProfile,
  openLayoutEditor,
  openPicker,
  setLocked,
} from '../state/actions.ts';
import { useEngineer } from '../state/engineer.ts';
import { requestTour } from '../state/tour.ts';
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
      return uiText('Gravar volta de replay');
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
      return uiText('Console, aparelhos, dados e IA');
    },
    href: routes.config(),
  },
  {
    icon: 'remote',
    get label() {
      return uiText('Abrir em outro aparelho');
    },
    get hint() {
      return uiText('QR Code e endereço para abrir o ao vivo em outro aparelho');
    },
    href: routes.config('acesso-remoto'),
  },
];

type TabId = MenuTabId;
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
      return uiText('Ao vivo');
    },
  },
];

/** Botão flutuante, à esquerda do cadeado. */
export function MenuButton() {
  const open = useUi((s) => s.menuOpen);
  // na primeira semana o botão diz o que é (e a tecla); depois só o ícone
  const newcomer = useMemo(() => isNewcomer(), []);
  return (
    <button
      type="button"
      className="live-menu-btn"
      data-no-gesture
      data-tour="menu"
      aria-label={uiText('Menu: histórico, comparação, gravar volta e ajustes')}
      title={uiText('Menu (tecla M)')}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-keyshortcuts="M"
      onClick={() => useUi.setState({ menuOpen: !open, overlayVisible: false })}
    >
      <Icon name="menu" />
      {newcomer && (
        <span className="live-btn-label" aria-hidden="true">
          {uiText('Menu')}
        </span>
      )}
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

function HelpSection() {
  return (
    <section className="bn-section" aria-labelledby="bn-help">
      <h3 id="bn-help" className="ui-eyebrow">
        {uiText('Ajuda')}
      </h3>
      <ul className="ui-list">
        <li>
          <button
            type="button"
            className="ui-list-item"
            onClick={() => {
              closeMenu();
              requestTour('live');
            }}
          >
            <ListItemBody
              icon="info"
              title={uiText('Ver o tour')}
              hint={uiText('Gestos e botões do ao vivo, numa demonstração')}
            />
          </button>
        </li>
      </ul>
    </section>
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
      <HelpSection />
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
                title={uiText('Escolher as telas')}
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
  const [tab, setTab] = useState<TabId>(loadMenuTab);
  const engineerOn = useEngineer((s) => s.enabled);
  const base = useId();

  function selectTab(next: TabId) {
    setTab(next);
    saveMenuTab(next);
  }

  useEffect(() => {
    if (open) bumpUsage('menuOpens');
  }, [open]);

  function onTabKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length]!;
    selectTab(next.id);
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
            {uiText('Voltar à tela ao vivo')}
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
            onClick={() => selectTab(t.id)}
          >
            {t.label}
            {t.id === 'engineer' && (
              <span className="bn-tab-state" data-on={engineerOn ? '1' : '0'}>
                {engineerOn ? uiText('ligado') : uiText('desligado')}
              </span>
            )}
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
