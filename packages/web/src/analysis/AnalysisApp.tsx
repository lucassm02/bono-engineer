/**
 * "Início & Análise" area (lazy chunk): history home by track, sessions, lap comparison, track
 * page, reference capture, settings and the AI coach. Sidebar on the PC, bottom bar on the phone.
 */

import { Component, type ReactNode, useEffect } from 'react';
import { CaptureStatus, SessionSavedToast } from '../components/CaptureStatus.tsx';
import { ConsoleChip, ConsolePanelHost } from '../components/ConsoleLink.tsx';
import { ProductBrand } from '../components/ProductBrand.tsx';
import { UpdateNotice } from '../components/UpdateNotice.tsx';
import { Icon, type IconName } from '../components/ui/Icon.tsx';
import { t as uiText } from '../lib/i18n.ts';
import type { Route } from '../lib/route.ts';
import { navigate, routes } from '../lib/route.ts';
import { dismissNotice, useUi } from '../state/uiStore.ts';
import { CapturePage } from './pages/CapturePage.tsx';
import { CoachPage } from './pages/CoachPage.tsx';
import { ComparePage } from './pages/ComparePage.tsx';
import { ConfigPage } from './pages/ConfigPage.tsx';
import { GuidePage } from './pages/GuidePage.tsx';
import { HelpPage } from './pages/HelpPage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { SessionPage } from './pages/SessionPage.tsx';
import { SessionsPage } from './pages/SessionsPage.tsx';
import { TrackPage } from './pages/TrackPage.tsx';
import '../styles/analysis.css';
import '../styles/home.css';
import '../styles/cars.css';
import '../styles/tracks.css';
import '../styles/capture.css';
import '../styles/compare.css';
import '../styles/track-page.css';
import '../styles/capture-page.css';
import '../styles/config.css';
import '../styles/coach.css';
import '../styles/help.css';

interface NavItem {
  icon: IconName;
  /** Routes where this item is highlighted. */
  names: Route['name'][];
  href: string;
  label: string;
  /** Short label for the phone bottom bar. */
  short: string;
  /** `data-tour` anchor of the guided tour. */
  tour?: string;
}

const LIVE: NavItem = {
  icon: 'live',
  names: [],
  href: routes.live(),
  get label() {
    return uiText('Ao vivo');
  },
  get short() {
    return uiText('Ao vivo');
  },
};

const MAIN_NAV: NavItem[] = [
  {
    icon: 'home',
    names: ['home', 'sessions', 'session', 'track'],
    href: routes.home(),
    get label() {
      return uiText('Início');
    },
    get short() {
      return uiText('Início');
    },
  },
  {
    icon: 'compare',
    tour: 'nav-compare',
    names: ['compare'],
    href: routes.compare({}),
    get label() {
      return uiText('Comparar voltas');
    },
    get short() {
      return uiText('Comparar');
    },
  },
  {
    icon: 'capture',
    tour: 'nav-capture',
    names: ['capture'],
    href: routes.capture(),
    get label() {
      return uiText('Gravar volta de replay');
    },
    get short() {
      return uiText('Gravar');
    },
  },
  {
    icon: 'coach',
    names: ['coach'],
    href: routes.coach(),
    get label() {
      return uiText('Coach IA');
    },
    short: 'Coach',
  },
  {
    icon: 'guide',
    names: ['guide'],
    href: routes.guide(),
    get label() {
      return uiText('Guia de pilotagem');
    },
    get short() {
      return uiText('Guia');
    },
  },
];

/** Desktop: above Settings, at the foot of the sidebar. Phone: a button in the header (the bottom bar keeps its 7 items). */
const HELP: NavItem = {
  icon: 'help',
  tour: 'nav-help',
  names: ['help'],
  href: routes.help(),
  get label() {
    return uiText('Ajuda');
  },
  get short() {
    return uiText('Ajuda');
  },
};

const SETTINGS: NavItem = {
  icon: 'config',
  names: ['config'],
  href: routes.config(),
  get label() {
    return uiText('Configurações');
  },
  get short() {
    return uiText('Ajustes');
  },
};

class PageBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="ui-card a-error" data-tone="loss" role="alert">
          <strong>{uiText('Esta página falhou ao desenhar')}</strong>
          <p>
            {uiText(
              'Tente recarregar. Se continuar, abra o detalhe técnico ao relatar o problema.',
            )}
          </p>
          <details className="a-error-detail">
            <summary>{uiText('Detalhe técnico')}</summary>
            <code>{this.state.error.message}</code>
          </details>
          <button type="button" className="a-btn a-btn-ghost" onClick={() => location.reload()}>
            {uiText('Recarregar')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Server + console link in one clickable indicator (details panel on click). */
function ConnectionPill() {
  const ws = useUi((s) => s.wsStatus);
  const source = useUi((s) => s.source);
  if (source !== 'mock' && ws !== 'open') {
    return (
      <span className="a-pill" data-state="bad">
        {uiText('Sem servidor')}
      </span>
    );
  }
  return (
    <div className="cs-row">
      <ConsoleChip variant="bar" />
      <CaptureStatus variant="bar" />
    </div>
  );
}

function Toasts() {
  const notices = useUi((s) => s.notices);
  if (!notices.length) return null;
  return (
    <div className="a-toasts" aria-live="polite">
      {notices.map((n) => (
        <button
          key={n.id}
          type="button"
          className="ui-toast"
          data-level={n.level}
          onClick={() => dismissNotice(n.id)}
        >
          {n.message}
        </button>
      ))}
    </div>
  );
}

function NotFound() {
  return (
    <div className="ui-empty a-empty">
      <h1>{uiText('Página não encontrada')}</h1>
      <p>{uiText('Esse endereço não existe na área de análise.')}</p>
      <div className="a-actions">
        <a className="a-btn" href={routes.home()}>
          {uiText('Ir para o início')}
        </a>
        <a className="a-btn a-btn-ghost" href={routes.live()}>
          {uiText('Voltar à tela ao vivo')}
        </a>
      </div>
    </div>
  );
}

function page(route: Route): ReactNode {
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'sessions':
      return <SessionsPage route={route} />;
    case 'session':
      return <SessionPage id={route.params.id!} />;
    case 'compare':
      return <ComparePage route={route} />;
    case 'track':
      return <TrackPage id={route.params.id!} route={route} />;
    case 'capture':
      return <CapturePage />;
    case 'config':
      return <ConfigPage route={route} />;
    case 'coach':
      return <CoachPage route={route} />;
    case 'guide':
      return <GuidePage route={route} />;
    case 'help':
      return <HelpPage route={route} />;
    default:
      return <NotFound />;
  }
}

function NavLink({ item, route, className }: { item: NavItem; route: Route; className?: string }) {
  return (
    <a
      href={item.href}
      className={className}
      aria-current={item.names.includes(route.name) ? 'page' : undefined}
      data-live={item.icon === 'live' ? '1' : undefined}
      data-tour={item.tour}
    >
      <Icon name={item.icon} size={22} />
      <span className="a-nav-label">{item.label}</span>
      <span className="a-nav-short">{item.short}</span>
    </a>
  );
}

/** `?` opens the help center, the same key as in the live dashboard (not while typing). */
function useHelpKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (
        e.target instanceof HTMLElement &&
        e.target.closest('input, textarea, select, [contenteditable]')
      )
        return;
      navigate(routes.help());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function AnalysisApp({ route }: { route: Route }) {
  useHelpKey();
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.area = 'analysis';
    return () => {
      delete el.dataset.area;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to top on page change only
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.name, route.params.id]);

  return (
    <div className="a-app">
      <aside className="a-side">
        <a className="a-brand" href={routes.home()}>
          <ProductBrand />
        </a>
        <nav className="a-nav" data-tour="nav" aria-label={uiText('Seções')}>
          <NavLink item={LIVE} route={route} />
          <p className="a-nav-group" aria-hidden="true">
            {uiText('Histórico e análise')}
          </p>
          {MAIN_NAV.map((n) => (
            <NavLink key={n.label} item={n} route={route} />
          ))}
          <NavLink item={HELP} route={route} className="a-nav-end a-nav-help" />
          <NavLink item={SETTINGS} route={route} />
        </nav>
        <div className="a-side-foot">
          <ConnectionPill />
        </div>
      </aside>
      <header className="a-mtop">
        <a className="a-brand" href={routes.home()}>
          <ProductBrand />
        </a>
        <ConnectionPill />
        <a
          className="ui-icon-btn a-help-btn"
          href={HELP.href}
          data-tour={HELP.tour}
          aria-label={uiText('Abrir a ajuda')}
          aria-current={route.name === 'help' ? 'page' : undefined}
        >
          <Icon name="help" size={22} />
        </a>
      </header>
      <main className="a-main">
        <PageBoundary resetKey={`${route.name}/${route.params.id ?? ''}`}>
          {page(route)}
        </PageBoundary>
      </main>
      <Toasts />
      <SessionSavedToast />
      <ConsolePanelHost />
      <UpdateNotice />
    </div>
  );
}
