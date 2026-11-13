import type { DesktopUpdateBridge, DesktopUpdateStatus, ReleaseNote } from '@gt7/shared';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Markdown } from '../analysis/components/Markdown.tsx';
import { t as uiText } from '../lib/i18n.ts';
import { useUi } from '../state/uiStore.ts';
import { Icon } from './ui/Icon.tsx';
import '../styles/update-notice.css';

declare global {
  interface Window {
    bonoUpdates?: DesktopUpdateBridge;
  }
}

const useUpdates = create<{
  status: DesktopUpdateStatus | null;
  notes: 'available' | 'installed' | null;
}>(() => ({ status: null, notes: null }));

export function startDesktopUpdates(): void {
  const bridge = window.bonoUpdates;
  if (!bridge) return;
  let received = false;
  bridge.onStatus((status) => {
    received = true;
    useUpdates.setState({ status });
  });
  void bridge
    .get()
    .then((status) => {
      if (!received) useUpdates.setState({ status });
    })
    .catch(() => {});
}

function invoke(action: 'check' | 'download' | 'install' | 'dismiss' | 'markNotesRead'): void {
  void window.bonoUpdates?.[action]().catch(() => {});
}

function drivingOrCapturing(state: ReturnType<typeof useUi.getState>): boolean {
  const capture = state.serverStatus?.capture.state;
  const driving =
    state.wsStatus === 'open' && (state.liveState === 'onTrack' || state.liveState === 'paused');
  return driving || (capture !== undefined && capture !== 'idle');
}

function statusMessage(status: DesktopUpdateStatus): string {
  switch (status.phase) {
    case 'idle':
      return uiText('A verificação ainda não foi concluída.');
    case 'checking':
      return uiText('Verificando atualizações…');
    case 'current':
      return uiText('Você está na versão mais recente.');
    case 'available':
      return uiText('Versão {0} disponível.', status.target);
    case 'downloading':
      return uiText('Baixando atualização… {0}%', status.progress ?? 0);
    case 'ready':
      return uiText('Atualização pronta para instalar.');
    case 'saved':
      return uiText('Arquivo salvo. Feche o Bono e abra a nova versão portátil.');
    case 'installing':
      return uiText('Preparando para reiniciar e instalar…');
    case 'error':
      return '';
  }
}

function errorMessage(error: DesktopUpdateStatus['error']): string {
  switch (error) {
    case 'check':
      return uiText('Não foi possível verificar atualizações.');
    case 'download':
      return uiText('Não foi possível baixar a atualização.');
    case 'install':
      return uiText('Não foi possível iniciar a instalação.');
    case 'busy':
      return uiText('Aguarde o fim da pilotagem ou da captura para instalar.');
    default:
      return '';
  }
}

function DownloadButton({ status }: { status: DesktopUpdateStatus }) {
  if (
    !status.target ||
    status.error === 'check' ||
    !['available', 'error', 'saved'].includes(status.phase)
  )
    return null;
  return (
    <button type="button" className="ui-btn" onClick={() => invoke('download')}>
      {status.mode === 'portable' ? uiText('Baixar versão portátil') : uiText('Baixar atualização')}
    </button>
  );
}

export function DesktopUpdateControls() {
  const status = useUpdates((s) => s.status);
  const busy = useUi(drivingOrCapturing);
  if (!status) return null;
  const development = status.mode === 'development';
  const working = ['checking', 'downloading', 'installing'].includes(status.phase);
  const warning =
    errorMessage(status.error) ||
    (busy && status.phase === 'ready'
      ? uiText('Aguarde o fim da pilotagem ou da captura para instalar.')
      : '');
  return (
    <section className="desktop-update-controls" aria-labelledby="desktop-updates-title">
      <div className="desktop-update-status">
        <h3 className="ui-toggle-title" id="desktop-updates-title">
          {uiText('Atualizações')}
        </h3>
        <div role="status">
          {status.phase !== 'error' && (
            <p>
              {development
                ? uiText('Atualizações disponíveis no pacote do Windows.')
                : statusMessage(status)}
            </p>
          )}
          {warning && <p className="desktop-update-warning">{warning}</p>}
        </div>
        {status.checkedAt !== null && (
          <p className="desktop-update-meta">
            {uiText(
              'Última verificação: {0}',
              new Date(status.checkedAt).toLocaleString(
                document.documentElement.lang || undefined,
                {
                  dateStyle: 'short',
                  timeStyle: 'short',
                },
              ),
            )}
          </p>
        )}
      </div>
      {!development && (
        <div className="desktop-update-actions">
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            disabled={working}
            onClick={() => invoke('check')}
          >
            {uiText('Verificar atualizações')}
          </button>
          {status.target && (
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              onClick={() => useUpdates.setState({ notes: 'available' })}
            >
              {uiText('Ver o que mudou')}
            </button>
          )}
          <DownloadButton status={status} />
          {status.phase === 'ready' && (
            <button
              type="button"
              className="ui-btn"
              disabled={busy}
              onClick={() => invoke('install')}
            >
              {uiText('Reiniciar e instalar')}
            </button>
          )}
          {status.installedNotes.length > 0 && (
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              onClick={() => useUpdates.setState({ notes: 'installed' })}
            >
              {uiText('Notas da versão instalada')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Notes({ entries }: { entries: ReleaseNote[] }) {
  if (entries.length === 0) return <p>{uiText('Notas da versão indisponíveis.')}</p>;
  return entries.map((entry) => (
    <section key={entry.version} className="release-notes-entry">
      <header className="release-notes-meta">
        <h3 className="ui-badge">v{entry.version}</h3>
        <time dateTime={entry.date}>
          {new Date(entry.date + 'T00:00:00Z').toLocaleDateString(
            document.documentElement.lang || undefined,
            { dateStyle: 'medium', timeZone: 'UTC' },
          )}
        </time>
      </header>
      <Markdown text={entry.markdown.replace(/\]\((?!https:\/\/)[^)]*\)/gi, ']')} />
    </section>
  ));
}

export function DesktopUpdateNotice() {
  const status = useUpdates((s) => s.status);
  const selected = useUpdates((s) => s.notes);
  const busy = useUi((s) => drivingOrCapturing(s) || s.onboarding === 'active');
  const automatic = !busy && status?.showInstalledNotes ? 'installed' : null;
  const notes = selected ?? automatic;
  const dialog = useRef<HTMLDialogElement>(null);
  const [closed, setClosed] = useState(false);
  const modal =
    !!notes &&
    !!status &&
    (selected !== null || !closed) &&
    (notes !== 'available' || status.target !== null);
  const titleVersion = notes === 'installed' ? status?.version : status?.target;
  useEffect(() => {
    const element = dialog.current;
    if (modal && element && !element.open) element.showModal();
  }, [modal]);
  if (!status) return null;
  const close = () => {
    useUpdates.setState({ notes: null });
    if (notes === 'installed') {
      setClosed(true);
      invoke('markNotesRead');
    }
  };
  return (
    <>
      {!busy && !modal && status.target && status.phase === 'available' && !status.dismissed && (
        <div className="ui-toast update-notice" role="status">
          <span>{uiText('Versão {0} disponível.', status.target)}</span>
          <button
            type="button"
            className="ui-btn"
            data-size="sm"
            onClick={() => useUpdates.setState({ notes: 'available' })}
          >
            {uiText('Ver o que mudou')}
          </button>
          <button
            type="button"
            className="ui-btn"
            data-size="sm"
            data-variant="secondary"
            onClick={() => invoke('dismiss')}
          >
            {uiText('Agora não')}
          </button>
        </div>
      )}
      {modal && (
        <dialog
          ref={dialog}
          className="desktop-update-dialog"
          aria-labelledby="release-notes-title"
          onClose={close}
        >
          <header className="ui-modal-head">
            <h2 id="release-notes-title" className="ui-modal-title ui-modal-titles">
              {uiText('O que mudou na versão {0}', titleVersion)}
            </h2>
            <button
              type="button"
              className="ui-icon-btn"
              aria-label={uiText('Fechar')}
              onClick={() => dialog.current?.close()}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="ui-modal-body release-notes-body" tabIndex={0}>
            <Notes entries={notes === 'installed' ? status.installedNotes : status.notes} />
          </div>
          <footer className="ui-modal-foot desktop-update-actions">
            {notes === 'available' && <DownloadButton status={status} />}
            {notes === 'available' && status.phase === 'downloading' && (
              <span role="status">{statusMessage(status)}</span>
            )}
            {notes === 'available' && status.phase === 'ready' && (
              <button
                type="button"
                className="ui-btn"
                disabled={busy}
                onClick={() => invoke('install')}
              >
                {uiText('Reiniciar e instalar')}
              </button>
            )}
            {notes === 'available' && status.error && (
              <span role="status">{errorMessage(status.error)}</span>
            )}
            {notes === 'available' && !status.notesAvailable && (
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                disabled={status.phase === 'checking'}
                onClick={() => invoke('check')}
              >
                {uiText('Verificar atualizações')}
              </button>
            )}
            <form method="dialog">
              <button type="submit" className="ui-btn" data-variant="secondary">
                {uiText('Fechar')}
              </button>
            </form>
          </footer>
        </dialog>
      )}
    </>
  );
}
