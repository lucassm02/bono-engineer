import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { api } from './analysis/api.ts';
import { BOOT_WAIT_MS, bootTarget, openedWithoutRoute } from './lib/boot.ts';
import { decideOnboarding, ONBOARDING_KEY, ONBOARDING_WAIT_MS } from './lib/onboarding.ts';
import { isAnalysisRoute, navigate, parseRoute, type Route, routes } from './lib/route.ts';
import { loadString } from './lib/storage.ts';
import { startSwUpdateWatch } from './lib/swUpdate.ts';
import { setupKeepAwake } from './lib/wakeLock.ts';
import { startConnection } from './net/connection.ts';
import { addNotice, useUi } from './state/uiStore.ts';
import './styles/connection.css';
import './styles/index.css';
import './styles/live-menu.css';
import './styles/engineer.css';
import './styles/views-extra.css';

/** Analysis & settings area: separate chunk, so the live dashboard bundle stays light. */
const AnalysisApp = lazy(() => import('./analysis/AnalysisApp.tsx'));
/** First-run assistant: only downloaded when it is going to be shown. */
const Onboarding = lazy(() => import('./components/Onboarding.tsx'));

startConnection();
startSwUpdateWatch();
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

/**
 * Decides once whether the first-run assistant shows: never raced here (empty history), console not
 * found yet, real server. `?onboarding=1` forces it (preview). Finished/skipped is kept in
 * localStorage.
 */
function useOnboardingGate(): void {
  useEffect(() => {
    const forced = new URLSearchParams(location.search).get('onboarding') === '1';
    const done = loadString(ONBOARDING_KEY) === '1';
    if (done && !forced) {
      useUi.setState({ onboarding: 'off' });
      return;
    }
    let sessionCount: number | null = null;
    let fetching = false;
    let timedOut = false;
    let decided = false;
    const evaluate = () => {
      if (decided) return;
      const s = useUi.getState();
      const link =
        s.source === 'mock' ? s.mockConnection : (s.serverStatus?.consoleConnection ?? null);
      if (!fetching && s.source === 'server' && s.wsStatus === 'open' && link) {
        fetching = true;
        api
          .sessions({ limit: 1 })
          .then((r) => {
            sessionCount = r.length;
          })
          // Unknown history (e.g. no permission): do not nag.
          .catch(() => {
            sessionCount = 1;
          })
          .finally(evaluate);
      }
      const decision = decideOnboarding({
        done: false,
        forced,
        source: s.source,
        wsOpen: s.wsStatus === 'open',
        linkState: link?.state ?? null,
        simulator: link?.source === 'simulator',
        sessionCount,
        timedOut,
      });
      if (decision === 'wait') return;
      decided = true;
      useUi.setState({ onboarding: decision === 'show' ? 'active' : 'off' });
    };
    const unsub = useUi.subscribe(evaluate);
    const timer = setTimeout(() => {
      timedOut = true;
      evaluate();
    }, ONBOARDING_WAIT_MS);
    evaluate();
    return () => {
      decided = true;
      unsub();
      clearTimeout(timer);
    };
  }, []);
}

function Root() {
  const route = useHashRoute();
  const deciding = useBootGate();
  useOnboardingGate();
  const onboarding = useUi((s) => s.onboarding === 'active');
  if (deciding) return <div className="area-loading">Conectando ao servidor…</div>;
  return (
    <>
      {!isAnalysisRoute(route) ? (
        <App />
      ) : (
        <Suspense fallback={<div className="area-loading">Carregando a análise…</div>}>
          <AnalysisApp route={route} />
        </Suspense>
      )}
      {onboarding && (
        <Suspense fallback={null}>
          <Onboarding />
        </Suspense>
      )}
    </>
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
