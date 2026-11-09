import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { BOOT_WAIT_MS, bootTarget, openedWithoutRoute } from './lib/boot.ts';
import { isAnalysisRoute, navigate, parseRoute, type Route, routes } from './lib/route.ts';
import { setupKeepAwake } from './lib/wakeLock.ts';
import { startConnection } from './net/connection.ts';
import { addNotice, useUi } from './state/uiStore.ts';
import './styles/index.css';
import './styles/views-extra.css';

/** Analysis & settings area: separate chunk, so the live dashboard bundle stays light. */
const AnalysisApp = lazy(() => import('./analysis/AnalysisApp.tsx'));

startConnection();
setupKeepAwake((mode) => {
  useUi.setState({ keepAwake: mode });
  if (mode !== 'wakeLock' && !isAnalysisRoute(parseRoute(location.hash))) {
    addNotice('info', 'Dica: desative o bloqueio automático da tela para ela não apagar.', 7000);
  }
});

function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/**
 * Opening without a route: waits (briefly) for the server to say whether a race is on. Racing or
 * demo = live dashboard; otherwise the history home. Explicit routes (`#/painel`, `#/inicio`, ...)
 * and `?mock=1` are never redirected.
 */
function useBootGate(): boolean {
  const [deciding, setDeciding] = useState(() =>
    openedWithoutRoute(location.hash, location.search),
  );
  useEffect(() => {
    if (!deciding) return;
    let timedOut = false;
    let done = false;
    const check = () => {
      if (done) return;
      const s = useUi.getState();
      const target = bootTarget({
        source: s.source,
        wsStatus: s.wsStatus,
        liveState: s.liveState,
        serverStatus: s.serverStatus,
        timedOut,
      });
      if (target === 'wait') return;
      done = true;
      if (target === 'home') navigate(routes.home(), true);
      setDeciding(false);
    };
    const unsub = useUi.subscribe(check);
    const timer = setTimeout(() => {
      timedOut = true;
      check();
    }, BOOT_WAIT_MS);
    check();
    return () => {
      done = true;
      unsub();
      clearTimeout(timer);
    };
  }, [deciding]);
  return deciding;
}

function Root() {
  const route = useHashRoute();
  const deciding = useBootGate();
  if (deciding) return <div className="area-loading">Conectando ao servidor…</div>;
  if (!isAnalysisRoute(route)) return <App />;
  return (
    <Suspense fallback={<div className="area-loading">Carregando a análise…</div>}>
      <AnalysisApp route={route} />
    </Suspense>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
