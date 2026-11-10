/**
 * Live panel while the game plays a replay (state 'replay', Onda 9a): the "REPLAY" seal is the badge in
 * Chrome.tsx; this is the discreet notice next to it — replays are not driving sessions — with a way
 * into the reference capture page. The live
 * widgets keep working with the replay's data (speed, pedals, map).
 */

import { routes } from '../lib/route.ts';
import { useUi } from '../state/uiStore.ts';
import '../styles/capture-status.css';

export function ReplayNotice() {
  const state = useUi((s) => s.liveState);
  const source = useUi((s) => s.source);
  const capture = useUi((s) => s.serverStatus?.capture ?? null);
  if (state !== 'replay') return null;
  const armed = !!capture && capture.state !== 'idle';
  return (
    <div className="replay-notice" data-no-gesture role="status">
      <span className="ui-dot" data-tone="accent" aria-hidden="true" />
      <span className="replay-text">
        {armed
          ? (capture?.hint ?? 'Captura de referência em andamento.')
          : 'Não conta como sessão: nada é gravado nos seus tempos.'}
      </span>
      {source === 'server' && (
        <a className="replay-link" href={routes.capture()}>
          {armed ? 'Ver a captura' : 'Capturar esta volta como referência'}
        </a>
      )}
    </div>
  );
}
