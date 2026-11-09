/**
 * "Início & Análise" area (lazy chunk): history home by track, sessions, lap comparison, track
 * page, reference capture, settings and the AI coach. Sidebar on the PC, bottom bar on the phone.
 */

import { Component, type ReactNode, useEffect } from 'react';
import { CaptureStatus, SessionSavedToast } from '../components/CaptureStatus.tsx';
import { ConsoleChip, ConsolePanelHost } from '../components/ConsoleLink.tsx';
import { ProductBrand } from '../components/ProductBrand.tsx';
import { UpdateNotice } from '../components/UpdateNotice.tsx';
import type { Route } from '../lib/route.ts';
import { routes } from '../lib/route.ts';
import { dismissNotice, useUi } from '../state/uiStore.ts';
import { CapturePage } from './pages/CapturePage.tsx';
import { CoachPage } from './pages/CoachPage.tsx';
import { ComparePage } from './pages/ComparePage.tsx';
import { ConfigPage } from './pages/ConfigPage.tsx';
import { GuidePage } from './pages/GuidePage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { SessionPage } from './pages/SessionPage.tsx';
import { SessionsPage } from './pages/SessionsPage.tsx';
import { TrackPage } from './pages/TrackPage.tsx';
import '../styles/analysis.css';
import '../styles/home.css';
import '../styles/cars.css';
import '../styles/tracks.css';
import '../styles/capture.css';

type IconName = 'live' | 'home' | 'compare' | 'capture' | 'coach' | 'guide' | 'config';

interface NavItem {
  icon: IconName;
  /** Routes where this item is highlighted. */
  names: Route['name'][];
  href: string;
  label: string;
  /** Short label for the phone bottom bar. */
  short: string;
}

const NAV: NavItem[] = [
  { icon: 'live', names: [], href: routes.live(), label: 'Ao vivo', short: 'Ao vivo' },
  {
    icon: 'home',
    names: ['home', 'sessions', 'session', 'track'],
    href: routes.home(),
    label: 'Início · Pistas',
    short: 'Início',
  },
  {
    icon: 'compare',
    names: ['compare'],
    href: routes.compare({}),
    label: 'Comparar',
    short: 'Comparar',
  },
  {
    icon: 'capture',
    names: ['capture'],
    href: routes.capture(),
    label: 'Captura de referência',
    short: 'Captura',
  },
  { icon: 'coach', names: ['coach'], href: routes.coach(), label: 'Coach IA', short: 'Coach' },
  {
    icon: 'guide',
    names: ['guide'],
    href: routes.guide(),
    label: 'Guia de pilotagem',
    short: 'Guia',
  },
  {
    icon: 'config',
    names: ['config'],
    href: routes.config(),
    label: 'Configurações',
    short: 'Ajustes',
  },
];

/** 22px line icons (stroke = currentColor). */
function NavIcon({ name }: { name: IconName }) {
  const p = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  return (
    <svg className="a-nav-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {name === 'live' && (
        <>
          <path {...p} d="M4 17a8 8 0 1 1 16 0" />
          <path {...p} d="M12 17l4-6" />
          <circle {...p} cx="12" cy="17" r="1.2" />
        </>
      )}
      {name === 'home' && (
        <>
          <path {...p} d="M5 5c4-2 9 0 11 3s-1 5-4 6-5 3-3 5 6 2 9-1" />
          <circle {...p} cx="5" cy="5" r="1.2" />
        </>
      )}
      {name === 'compare' && (
        <>
          <path {...p} d="M4 18l5-7 4 4 7-9" />
          <path {...p} d="M4 6l5 4 4-2 7 5" opacity="0.55" />
        </>
      )}
      {name === 'capture' && (
        <>
          <circle {...p} cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.2" fill="currentColor" />
        </>
      )}
      {name === 'coach' && (
        <>
          <path {...p} d="M5 6h14v9H11l-4 3v-3H5z" />
          <path {...p} d="M9 10h6" />
        </>
      )}
      {name === 'guide' && (
        <>
          <path {...p} d="M5 5.5C5 4.7 5.7 4 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5z" />
          <path {...p} d="M5 18.5A1.5 1.5 0 0 0 6.5 20H19v-3M9 8h6" />
        </>
      )}
      {name === 'config' && (
        <>
          <path {...p} d="M5 8h9M18 8h1M5 16h1M10 16h9" />
          <circle {...p} cx="16" cy="8" r="2" />
          <circle {...p} cx="8" cy="16" r="2" />
        </>
      )}
    </svg>
  );
}

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
        <div className="a-error" role="alert">
          <strong>Esta página falhou ao desenhar</strong>
          <p>{this.state.error.message}</p>
          <button type="button" className="a-btn a-btn-ghost" onClick={() => location.reload()}>
            Recarregar
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
        Sem servidor
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
          className="a-toast"
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
    <div className="a-empty">
      <h1>Página não encontrada</h1>
      <p>
        <a href={routes.home()}>Ir para o início</a> ·{' '}
        <a href={routes.live()}>Voltar ao painel ao vivo</a>
      </p>
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
    default:
      return <NotFound />;
  }
}

export default function AnalysisApp({ route }: { route: Route }) {
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
        <nav className="a-nav" aria-label="Seções">
          {NAV.map((n) => (
            <a
              key={n.label}
              href={n.href}
              aria-current={n.names.includes(route.name) ? 'page' : undefined}
              data-live={n.icon === 'live' ? '1' : undefined}
            >
              <NavIcon name={n.icon} />
              <span className="a-nav-label">{n.label}</span>
              <span className="a-nav-short">{n.short}</span>
            </a>
          ))}
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
