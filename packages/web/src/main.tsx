import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { setupKeepAwake } from './lib/wakeLock.ts';
import { startConnection } from './net/connection.ts';
import { addNotice, useUi } from './state/uiStore.ts';
import './styles/index.css';
import './styles/views-extra.css';

startConnection();
setupKeepAwake((mode) => {
  useUi.setState({ keepAwake: mode });
  if (mode !== 'wakeLock') {
    addNotice('info', 'Dica: desative o bloqueio automático da tela para ela não apagar.', 7000);
  }
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
