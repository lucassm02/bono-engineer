/**
 * Replay status next to the badge. Return to the tyre controls without changing the game state.
 */

import { t as uiText } from '../lib/i18n.ts';
import { routes } from '../lib/route.ts';
import { useUi } from '../state/uiStore.ts';
import { Icon } from './ui/Icon.tsx';
import '../styles/capture-status.css';

export function ReplayNotice() {
  const state = useUi((s) => s.liveState);
  const source = useUi((s) => s.source);
  const capture = useUi((s) => s.serverStatus?.capture ?? null);
  const watching = useUi((s) => s.showReplayTelemetry);
  const armed = !!capture && capture.state !== 'idle';
  if (state !== 'replay') return null;
  return (
    <div className="replay-notice" data-no-gesture role="status">
      <span className="ui-dot" data-tone="accent" aria-hidden="true" />
      <span className="replay-text">
        {armed
          ? (capture?.hint ?? uiText('Gravação da volta de replay em andamento.'))
          : uiText('Não conta como sessão: nada é gravado nos seus tempos.')}
      </span>
      {source === 'server' && (!watching || armed) && (
        <a className="replay-link" href={routes.capture()}>
          {armed ? uiText('Ver a captura') : uiText('Capturar esta volta como referência')}
        </a>
      )}
      {watching && (
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          data-size="sm"
          onClick={() => useUi.setState({ showReplayTelemetry: false })}
        >
          <Icon name="back" size={15} />
          {uiText('Voltar à pré-corrida')}
        </button>
      )}
    </div>
  );
}
