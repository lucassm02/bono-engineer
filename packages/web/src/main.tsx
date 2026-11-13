import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { api } from './analysis/api.ts';
import { TitleBar } from './components/TitleBar.tsx';
import { BOOT_WAIT_MS, bootTarget, openedWithoutRoute, tourFromSearch } from './lib/boot.ts';
import { applyDocumentLanguage, setLanguage, t as uiText, useLanguage } from './lib/i18n.ts';
import { isSafeToPrompt, SAFE_SPEED_KMH } from './lib/liveContext.ts';
import {
  decideSetup,
  loadSetupState,
  ONBOARDING_KEY,
  ONBOARDING_WAIT_MS,
} from './lib/onboarding.ts';
import {
  canonicalHash,
  isAnalysisRoute,
  navigate,
  parseRoute,
  type Route,
  routes,
} from './lib/route.ts';
import { loadString } from './lib/storage.ts';
import { startSwUpdateWatch } from './lib/swUpdate.ts';
import { DesktopUpdateNotice, startDesktopUpdates } from './components/DesktopUpdate.tsx';
import { UpdateNotice } from './components/UpdateNotice.tsx';
import { setupKeepAwake } from './lib/wakeLock.ts';
import { startConnection } from './net/connection.ts';
import { prepareSavedEngineerAudio } from './state/engineer.ts';
import { useLiveContext } from './state/liveContext.ts';
import { useSetupInvite } from './state/setup.ts';
import { startTasks } from './state/tasks.ts';
import { requestTour, useTour } from './state/tour.ts';
import { useHint } from './state/tourHints.ts';
import { addNotice, useUi } from './state/uiStore.ts';
import './styles/tokens.css';
import './styles/ui.css';
import './styles/connection.css';
import './styles/index.css';
import './styles/live-menu.css';
import './styles/engineer.css';
import './styles/views-extra.css';
import './styles/overlays.css';
import './styles/layout-editor.css';
import './styles/titlebar.css';
import './styles/live-context.css';

/** Analysis & settings area: separate chunk, so the live dashboard bundle stays light. */
const AnalysisApp = lazy(() => import('./analysis/AnalysisApp.tsx'));
/** First-run assistant, light invite and guided tour: only downloaded when they are going to be shown. */
const Onboarding = lazy(() => import('./components/Onboarding.tsx'));
const SetupInvite = lazy(() => import('./components/setup/SetupInvite.tsx'));
const Tour = lazy(() => import('./components/ui/Tour.tsx'));
const TourHint = lazy(() => import('./components/ui/TourHint.tsx'));

/** `?tour=live|analysis` of the address the page was opened with (read once, before any rerender). */
const URL_TOUR = tourFromSearch(location.search);
let urlTourStarted = false;

applyDocumentLanguage();
void window.bonoDesktop
  ?.getLanguage()
  .then((language) => {
    if (language) setLanguage(language);
  })
  .catch(() => {});
startConnection();
startTasks();
if (window.bonoUpdates) startDesktopUpdates();
else startSwUpdateWatch();
setupKeepAwake((mode) => {
  useUi.setState({ keepAwake: mode });
  // Sem a dica na demonstração (o tour roda sobre ela): o aviso cobriria o destaque do passo.
  if (
    mode !== 'wakeLock' &&
    useUi.getState().source !== 'mock' &&
    !isAnalysisRoute(parseRoute(location.hash))
  ) {
    addNotice(
      'info',
      uiText('Dica: desative o bloqueio automático da tela para ela não apagar.'),
      7000,
    );
  }
});

function readHashRoute(): Route {
  const hash = canonicalHash(location.hash);
  if (hash !== location.hash) {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${hash}`);
  }
  return parseRoute(hash);
}

function useHashRoute(): Route {
  const [route, setRoute] = useState(readHashRoute);
  useEffect(() => {
    const on = () => setRoute(readHashRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/**
 * Opening without a route: waits (briefly) for the server to say whether a race is on. Racing or
 * demo = live dashboard; otherwise the history home. Explicit routes (`#/live`, `#/home`, ...)
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
 * Decides once whether the first-run assistant shows (spec 03): the whole assistant for someone who
 * never raced or configured here, only a light invite for someone who already uses the app, and
 * nothing in the demos. Never with the car moving: it waits for a pause. `?onboarding=1` forces
 * the assistant (preview). What was done lives in `gt7.setup.v2`; the old key counts as
 * "configured".
 */
function useOnboardingGate(): void {
  useEffect(() => {
    // opened to test a tour: the assistant stays out of the way
    if (URL_TOUR) {
      useUi.setState({ onboarding: 'off' });
      return;
    }
    const forced = new URLSearchParams(location.search).get('onboarding') === '1';
    const state = loadSetupState();
    const legacyDone = loadString(ONBOARDING_KEY) === '1';
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
      const demo = s.source === 'mock' || link?.source === 'simulator';
      const stopped = useLiveContext.getState().stopped;
      const decision = decideSetup({
        state,
        legacyDone,
        forced,
        source: s.source,
        wsOpen: s.wsStatus === 'open',
        linkState: link?.state ?? null,
        simulator: link?.source === 'simulator',
        sessionCount,
        timedOut,
        safe:
          demo || isSafeToPrompt({ state: s.liveState, speedKmh: stopped ? 0 : SAFE_SPEED_KMH }),
      });
      if (decision === 'wait') return;
      decided = true;
      useUi.setState({ onboarding: decision === 'wizard' ? 'active' : 'off' });
      if (decision === 'invite') useSetupInvite.setState({ visible: true });
    };
    const unsub = useUi.subscribe(evaluate);
    const unsubCar = useLiveContext.subscribe(evaluate);
    const timer = setTimeout(() => {
      timedOut = true;
      evaluate();
    }, ONBOARDING_WAIT_MS);
    evaluate();
    return () => {
      decided = true;
      unsub();
      unsubCar();
      clearTimeout(timer);
    };
  }, []);
}

/**
 * `?tour=live` / `?tour=analysis`: once the first page is chosen, starts that tour (like
 * `?onboarding=1` forces the assistant). The parameter is removed from the address so a reload or a
 * language change does not start it again.
 */
function useUrlTour(ready: boolean): void {
  useEffect(() => {
    if (!URL_TOUR || !ready || urlTourStarted) return;
    urlTourStarted = true;
    const url = new URL(location.href);
    url.searchParams.delete('tour');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    // the analysis chunk and the first frames need a moment before the anchors exist
    // not cancelled on cleanup: StrictMode runs the effect twice and the flag above already guards it
    setTimeout(() => requestTour(URL_TOUR), 400);
  }, [ready]);
}

function Root() {
  const route = useHashRoute();
  const deciding = useBootGate();
  useEffect(() => {
    document.addEventListener('click', prepareSavedEngineerAudio);
    return () => document.removeEventListener('click', prepareSavedEngineerAudio);
  }, []);
  useOnboardingGate();
  useUrlTour(!deciding);
  const onboarding = useUi((s) => s.onboarding === 'active');
  const invite = useSetupInvite((s) => s.visible);
  const touring = useTour((s) => s.active !== null);
  const hint = useHint((s) => s.hint !== null);
  if (deciding)
    return (
      <>
        <TitleBar />
        <div className="area-loading">{uiText('Conectando ao servidor…')}</div>
      </>
    );
  return (
    <>
      <TitleBar />
      {!isAnalysisRoute(route) ? (
        <App />
      ) : (
        <Suspense fallback={<div className="area-loading">{uiText('Carregando a análise…')}</div>}>
          <AnalysisApp route={route} />
        </Suspense>
      )}
      {window.bonoUpdates ? <DesktopUpdateNotice /> : <UpdateNotice />}
      {onboarding && (
        <Suspense fallback={null}>
          <Onboarding />
        </Suspense>
      )}
      {invite && (
        <Suspense fallback={null}>
          <SetupInvite />
        </Suspense>
      )}
      {hint && (
        <Suspense fallback={null}>
          <TourHint />
        </Suspense>
      )}
      {touring && (
        <Suspense fallback={null}>
          <Tour />
        </Suspense>
      )}
    </>
  );
}

function LocalizedApp() {
  const language = useLanguage();
  return <Root key={language} />;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <LocalizedApp />
    </StrictMode>,
  );
}
