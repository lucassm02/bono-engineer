/**
 * "Alterar pasta dos dados" (app para Windows). O usuário escolhe uma pasta no seletor do sistema;
 * o diálogo mostra o que há nela e como seguir: copiar os dados de hoje, usar os que já estão lá
 * ou começar do zero. A pasta antiga nunca é apagada. Em pasta sincronizada (OneDrive...) avisa dos
 * riscos de abrir o Bono em dois PCs.
 */

import type {
  DesktopDataBridge,
  DesktopDataCurrent,
  DesktopDataFolderInfo,
  DesktopDataMode,
} from '@gt7/shared';
import { useEffect, useState } from 'react';
import { Modal } from '../../../components/ui/Modal.tsx';
import { t as uiText } from '../../../lib/i18n.ts';
import { Choice } from './Choice.tsx';

declare global {
  interface Window {
    bonoData?: DesktopDataBridge;
  }
}

export function DataFolderModal({
  bridge,
  onClose,
}: {
  bridge: DesktopDataBridge;
  onClose: () => void;
  cloudHint?: string | null;
}) {
  const [current, setCurrent] = useState<DesktopDataCurrent | null>(null);
  const [picked, setPicked] = useState<DesktopDataFolderInfo | null>(null);
  const [mode, setMode] = useState<DesktopDataMode>('copy');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void bridge
      .current()
      .then(setCurrent, () => setError(uiText('Não foi possível ler a pasta atual.')));
  }, [bridge]);

  /** Opens the system picker; the dialog then explains the folder that was chosen. */
  async function choose() {
    setError('');
    try {
      const info = await bridge.choose();
      if (!info) return;
      setPicked(info);
      setMode(info.hasData ? 'use' : 'copy');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function goDefault() {
    if (!current) return;
    setError('');
    try {
      const info = await bridge.inspect(current.defaultDir);
      setPicked({ ...info, dir: current.defaultDir });
      setMode(info.hasData ? 'use' : 'copy');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function apply() {
    if (!picked || !current) return;
    setBusy(true);
    setError('');
    try {
      await bridge.apply({
        dir: picked.dir === current.defaultDir ? null : picked.dir,
        mode,
      });
      // The window restarts the server and reloads this page on its own.
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
      setBusy(false);
    }
  }

  const blocked = picked ? !picked.writable : false;

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      size="md"
      title={uiText('Alterar a pasta dos dados')}
      subtitle={uiText('Escolha uma pasta no seu PC, por exemplo dentro do OneDrive.')}
      footer={
        <>
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            {uiText('Cancelar')}
          </button>
          {picked && (
            <button
              type="button"
              className="ui-btn"
              disabled={busy || blocked}
              onClick={() => void apply()}
            >
              {busy ? uiText('Aplicando…') : uiText('Mudar e reiniciar')}
            </button>
          )}
        </>
      }
    >
      <div className="dm-stack">
        <div className="ui-field">
          <span className="ui-label">{uiText('Pasta atual')}</span>
          <span className="num dm-path-text">{current?.dir ?? '…'}</span>
        </div>

        {!picked ? (
          <div className="dm-actions">
            <button type="button" className="ui-btn" onClick={() => void choose()}>
              {uiText('Escolher a nova pasta…')}
            </button>
            {current && !current.isDefault && (
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                onClick={() => void goDefault()}
              >
                {uiText('Voltar para a pasta padrão')}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="ui-field">
              <span className="ui-label">{uiText('Nova pasta')}</span>
              <div className="dm-path">
                <span className="num dm-path-text">{picked.dir}</span>
                {picked.cloudProvider && (
                  <span className="ui-badge" data-tone="warn">
                    {picked.cloudProvider}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="ui-btn dm-link"
                data-variant="ghost"
                data-size="sm"
                disabled={busy}
                onClick={() => void choose()}
              >
                {uiText('Escolher outra')}
              </button>
            </div>

            {blocked ? (
              <p className="ui-error" role="alert">
                {uiText('Não consigo gravar nessa pasta. Escolha outra.')}
              </p>
            ) : (
              <div
                className="dm-choices"
                role="radiogroup"
                aria-label={uiText('O que fazer com os dados')}
              >
                {picked.hasData ? (
                  <Choice
                    name="data-mode"
                    checked={mode === 'use'}
                    onChange={() => setMode('use')}
                    title={uiText('Usar os dados que já estão lá')}
                    description={uiText(
                      'Essa pasta já tem {0} sessões do Bono. Os dados atuais continuam na pasta antiga.',
                      picked.sessions,
                    )}
                  />
                ) : (
                  <>
                    <Choice
                      name="data-mode"
                      checked={mode === 'copy'}
                      onChange={() => setMode('copy')}
                      title={uiText('Copiar meus dados para lá')}
                      description={uiText(
                        'Recomendado. A pasta antiga fica como está; você apaga quando quiser.',
                      )}
                    />
                    <Choice
                      name="data-mode"
                      checked={mode === 'empty'}
                      onChange={() => setMode('empty')}
                      title={uiText('Começar do zero nessa pasta')}
                      description={uiText(
                        'Sem histórico. Seus dados atuais continuam na pasta antiga.',
                      )}
                    />
                  </>
                )}
              </div>
            )}

            {picked.hasOtherFiles && !picked.hasData && (
              <p className="ui-help">
                {uiText(
                  'Essa pasta tem outros arquivos. O Bono só cria os dele e não mexe nos seus.',
                )}
              </p>
            )}

            {picked.cloudProvider && (
              <div className="ui-card dm-note" data-tone="warn" role="note">
                <strong>{uiText('Pasta sincronizada pelo {0}', picked.cloudProvider)}</strong>
                <span>
                  {uiText(
                    'O Bono usa um modo de gravação mais seguro nessa pasta, mas use-o em um PC por vez e espere a sincronização terminar antes de abrir em outro. Para só guardar cópias, exporte um backup para essa pasta.',
                  )}
                </span>
              </div>
            )}
          </>
        )}

        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
