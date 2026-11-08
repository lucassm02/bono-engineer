/**
 * "Análise & Configurações" area (lazy chunk): sessions, lap comparison, track page, reference
 * capture, settings and the AI coach. Desktop-first, responsive down to a phone in portrait.
 */

import { Component, type ReactNode, useEffect } from 'react';
import { CONNECTION_STATE_LABELS } from '../lib/labels.ts';
import type { Route } from '../lib/route.ts';
import { routes } from '../lib/route.ts';
import { dismissNotice, useUi } from '../state/uiStore.ts';
import { CapturePage } from './pages/CapturePage.tsx';
import { CoachPage } from './pages/CoachPage.tsx';
import { ComparePage } from './pages/ComparePage.tsx';
import { ConfigPage } from './pages/ConfigPage.tsx';
import { SessionPage } from './pages/SessionPage.tsx';
import { SessionsPage } from './pages/SessionsPage.tsx';
import { TrackPage } from './pages/TrackPage.tsx';
import '../styles/analysis.css';

const NAV: { name: Route['name'][]; href: string; label: string }[] = [
  { name: ['sessions', 'session', 'compare', 'track'], href: routes.sessions(), label: 'Sessões' },
  { name: ['capture'], href: routes.capture(), label: 'Captura' },
  { name: ['coach'], href: routes.coach(), label: 'Coach IA' },
  { name: ['config'], href: routes.config(), label: 'Configurações' },
];

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

function ConnectionPill() {
  const ws = useUi((s) => s.wsStatus);
  const source = useUi((s) => s.source);
  const status = useUi((s) => s.serverStatus);
  const live = useUi((s) => s.liveState);
  if (source === 'mock') {
    return (
      <span className="a-pill" data-state="warn" title="O painel está em modo demonstração">
        Demonstração
      </span>
    );
  }
  if (ws !== 'open') {
    return (
      <span className="a-pill" data-state="bad">
        Sem servidor
      </span>
    );
  }
  const conn = live ?? status?.connection ?? null;
  return (
    <span className="a-pill" data-state={conn === 'onTrack' || conn === 'replay' ? 'ok' : 'idle'}>
      {conn ? CONNECTION_STATE_LABELS[conn] : 'Servidor conectado'}
    </span>
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
        <a href={routes.sessions()}>Ir para as sessões</a> ·{' '}
        <a href={routes.live()}>Voltar ao painel ao vivo</a>
      </p>
    </div>
  );
}

function page(route: Route): ReactNode {
  switch (route.name) {
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
      <header className="a-top">
        <a className="a-brand" href={routes.sessions()}>
          <span className="a-brand-mark" aria-hidden="true" />
          GT7 Engenheiro
        </a>
        <nav className="a-nav" aria-label="Seções">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              aria-current={n.name.includes(route.name) ? 'page' : undefined}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="a-top-right">
          <ConnectionPill />
          <a className="a-btn a-btn-sm" href={routes.live()}>
            Painel ao vivo
          </a>
        </div>
      </header>
      <main className="a-main">
        <PageBoundary resetKey={`${route.name}/${route.params.id ?? ''}`}>
          {page(route)}
        </PageBoundary>
      </main>
      <Toasts />
    </div>
  );
}
