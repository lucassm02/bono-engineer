import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { isAnalysisRoute, parseRoute, type Route } from './lib/route.ts';
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

function Root() {
  const route = useHashRoute();
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
