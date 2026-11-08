import { VIEW_IDS, WS_PROTOCOL_VERSION } from '@gt7/shared';

/** Placeholder app shell. Later waves replace this with the live dashboard carousel. */
export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16, color: '#e6e6e6' }}>
      <h1>GT7 Race Engineer</h1>
      <p>Painel em construção (protocolo WS v{WS_PROTOCOL_VERSION}).</p>
      <p>Telas planejadas: {VIEW_IDS.join(', ')}</p>
    </main>
  );
}
