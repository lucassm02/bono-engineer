/**
 * Automatic session capture, visible and discreet: a small chip next to the PS5 connection chip
 * (live panel + analysis) saying what the app is doing with no click needed ("Aguardando pista",
 * "Gravando · 4 voltas", "Pausado"…), and a short toast when a session is saved.
 * There is no "start" button on purpose: sessions open and close by themselves.
 */

import type { SessionSavedMessage } from '@gt7/shared';
import { create } from 'zustand';
import { describeCapture, describeReferenceCapture, savedToastText } from '../lib/captureStatus.ts';
import { routes } from '../lib/route.ts';
import { useUi } from '../state/uiStore.ts';
import '../styles/capture-status.css';

const TOAST_MS = 15_000;

interface SavedToast {
  id: number;
  message: string;
  sessionId: string;
}

const useSavedToast = create<{ toast: SavedToast | null }>()(() => ({ toast: null }));

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function dismissSessionSaved(): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  useSavedToast.setState({ toast: null });
}

/** Called when the server says a session with laps was saved. */
export function showSessionSaved(m: SessionSavedMessage): void {
  const id = ++toastSeq;
  useSavedToast.setState({
    toast: { id, message: savedToastText(m), sessionId: m.sessionId },
  });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (useSavedToast.getState().toast?.id === id) dismissSessionSaved();
  }, TOAST_MS);
}

/** The chip. `live` = compact, status only (no navigation by accident while driving). */
export function CaptureStatus({ variant }: { variant: 'live' | 'bar' }) {
  const mock = useUi((s) => s.source === 'mock');
  const capture = useUi((s) => s.serverStatus?.sessionCapture ?? null);
  const reference = useUi((s) => s.serverStatus?.capture ?? null);
  // an armed reference capture is what the driver is waiting on: it takes the chip over
  const view = describeReferenceCapture(reference) ?? describeCapture(capture);
  if (mock) {
    return (
      <span
        className="cs-chip"
        data-variant={variant}
        data-tone="off"
        data-no-gesture
        title="Demonstração: nada é gravado."
      >
        <span className="cs-dot" data-tone="off" aria-hidden="true" />
        <span className="cs-text">Demo · não grava</span>
      </span>
    );
  }
  if (!view) return null;
  const inner = (
    <>
      <span
        className="cs-dot"
        data-tone={view.tone}
        data-pulse={view.pulse ? '1' : '0'}
        aria-hidden="true"
      />
      <span className="cs-text">{view.label}</span>
    </>
  );
  if (view.reference && variant === 'bar') {
    return (
      <a
        className="cs-chip"
        data-variant={variant}
        data-tone={view.tone}
        data-no-gesture
        href={routes.capture()}
        title={`${view.title} Abrir a captura de referência.`}
      >
        {inner}
      </a>
    );
  }
  if (view.sessionId && variant === 'bar') {
    return (
      <a
        className="cs-chip"
        data-variant={variant}
        data-tone={view.tone}
        data-no-gesture
        href={routes.session(view.sessionId)}
        title={`${view.title} Abrir a sessão em andamento.`}
      >
        {inner}
      </a>
    );
  }
  return (
    <span
      className="cs-chip"
      data-variant={variant}
      data-tone={view.tone}
      data-no-gesture
      role="status"
      title={view.title}
    >
      {inner}
    </span>
  );
}

/** "Sessão salva: Pista X, 5 voltas, melhor 1:23,456 — ver". Mount once per area. */
export function SessionSavedToast() {
  const toast = useSavedToast((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="cs-toast" data-no-gesture role="status" aria-live="polite">
      <span>{toast.message}</span>
      <a
        className="cs-toast-link"
        href={routes.session(toast.sessionId)}
        onClick={dismissSessionSaved}
      >
        ver
      </a>
      <button
        type="button"
        className="cs-toast-x"
        aria-label="Fechar aviso"
        onClick={dismissSessionSaved}
      >
        ×
      </button>
    </div>
  );
}
