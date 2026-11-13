import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal.tsx';
import { t as uiText } from '../../lib/i18n.ts';
import { retryTaskVoice, setTaskVoiceEnabled, useTasks } from '../../state/tasks.ts';
import { formatBytes } from '../lib/bytes.ts';

export function TaskVoiceApproval({
  onClose,
  onApprove,
}: {
  onClose: () => void;
  onApprove: () => void;
}) {
  const voice = useTasks((s) => s.voice);
  const [request, setRequest] = useState<'idle' | 'starting' | 'failed'>('idle');
  const [approveWhenReady, setApproveWhenReady] = useState(false);
  const ready = voice?.status === 'ready';
  const downloading = voice?.status === 'downloading';
  const unavailable = voice?.status === 'unavailable';
  const failed = request === 'failed' || voice?.status === 'failed';
  const starting = request === 'starting';
  const percent = Math.round((voice?.progress ?? 0) * 100);

  useEffect(() => {
    if (ready && approveWhenReady) onApprove();
  }, [ready, approveWhenReady, onApprove]);

  const download = async () => {
    setRequest('starting');
    const result = await (voice?.enabled ? retryTaskVoice() : setTaskVoiceEnabled(true));
    setApproveWhenReady(result?.status === 'ready' || result?.status === 'downloading');
    setRequest(result ? 'idle' : 'failed');
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      className="tk-approval-modal"
      title={uiText('Áudio das tarefas')}
      footer={
        <>
          {downloading && !approveWhenReady && !starting && (
            <button type="button" className="ui-btn" onClick={() => setApproveWhenReady(true)}>
              {uiText('Aprovar quando terminar')}
            </button>
          )}
          {ready ? (
            <button type="button" className="ui-btn" onClick={onApprove}>
              {uiText('Aprovar')}
            </button>
          ) : (
            !unavailable &&
            !downloading && (
              <button
                type="button"
                className="ui-btn"
                disabled={starting}
                onClick={() => void download()}
              >
                {failed
                  ? uiText('Tentar de novo')
                  : voice?.bytes
                    ? uiText('Baixar e aprovar ({0})', formatBytes(voice.bytes))
                    : uiText('Baixar e aprovar')}
              </button>
            )
          )}
          {!ready && (
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              disabled={starting}
              onClick={onApprove}
            >
              {uiText('Aprovar sem áudio')}
            </button>
          )}
          <button type="button" className="ui-btn" data-variant="ghost" onClick={onClose}>
            {uiText('Cancelar')}
          </button>
        </>
      }
    >
      <div className="tk-voice" role="status">
        {ready ? (
          <span>{uiText('Pronta')}</span>
        ) : unavailable ? (
          <span>{uiText('Esta voz ainda não tem tarefas faladas.')}</span>
        ) : downloading ? (
          <>
            <span>{uiText('Baixando… {0}%', percent)}</span>
            <span className="tk-bar" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </span>
            {approveWhenReady && (
              <span className="dim">
                {uiText('A tarefa será aprovada quando o áudio estiver pronto.')}
              </span>
            )}
          </>
        ) : starting ? (
          <span>{uiText('Iniciando download…')}</span>
        ) : failed ? (
          <span className="ui-error">{uiText('Não foi possível baixar.')}</span>
        ) : (
          <span>
            {uiText(
              'O Bono baixa o áudio da voz em uso para o engenheiro falar esta tarefa no rádio.',
            )}
          </span>
        )}
      </div>
    </Modal>
  );
}
