/** Small always-mounted UI pieces: overlay header, dots, lock, notices, demo badge, arrows. */

import { useRef, useState } from 'react';
import { TIMINGS } from '../config.ts';
import { CONNECTION_STATE_LABELS, DELTA_REFERENCE_LABELS, VIEW_LABELS } from '../lib/labels.ts';
import { goToView, setLocked } from '../state/actions.ts';
import { addNotice, dismissNotice, useUi } from '../state/uiStore.ts';
import { CaptureStatus, SessionSavedToast } from './CaptureStatus.tsx';
import { animateStep } from './Carousel.tsx';
import { ConsoleChip } from './ConsoleLink.tsx';
import { ReplayNotice } from './ReplayNotice.tsx';
import { Icon } from './ui/Icon.tsx';

export function OverlayHeader() {
  const visible = useUi((s) => s.overlayVisible);
  const views = useUi((s) => s.profile.views);
  const current = useUi((s) => s.currentView);
  const reference = useUi((s) => s.profile.deltaReference);
  const source = useUi((s) => s.source);
  const latency = useUi((s) => s.latencyMs);
  const format = useUi((s) => s.frameFormat);
  const liveState = useUi((s) => s.liveState);
  const idx = views.indexOf(current);
  return (
    <div className="overlay-header" data-visible={visible ? '1' : '0'} aria-live="polite">
      <div className="overlay-title">
        <span className="overlay-name">{VIEW_LABELS[current]}</span>
        <span className="overlay-pos num">
          {idx + 1}/{views.length}
        </span>
      </div>
      <div className="overlay-ref">
        Delta contra <strong>{DELTA_REFERENCE_LABELS[reference]}</strong>
        <span className="dim"> (toque duplo troca)</span>
      </div>
      <div className="overlay-link">
        <span className="ui-badge" data-tone={source === 'mock' ? 'accent' : undefined}>
          {source === 'mock' ? 'Demonstração' : 'Servidor'}
        </span>
        {liveState && <span className="ui-badge">{CONNECTION_STATE_LABELS[liveState]}</span>}
        {format && <span className="ui-badge">Pacote {format}</span>}
        {latency !== null && <span className="ui-badge">Latência {latency} ms</span>}
      </div>
    </div>
  );
}

export function Dots() {
  const views = useUi((s) => s.profile.views);
  const current = useUi((s) => s.currentView);
  const locked = useUi((s) => s.profile.locked);
  if (views.length <= 1) return null;
  return (
    <nav className="dots" data-no-gesture aria-label="Telas">
      {views.map((v) => (
        <button
          key={v}
          type="button"
          className="dot"
          aria-label={VIEW_LABELS[v]}
          aria-current={v === current ? 'page' : undefined}
          disabled={locked}
          onClick={() => goToView(v, 'picker')}
        />
      ))}
    </nav>
  );
}

export function EdgeArrows() {
  const locked = useUi((s) => s.profile.locked);
  const count = useUi((s) => s.profile.views.length);
  if (locked || count <= 1) return null;
  return (
    <>
      <button
        type="button"
        className="ui-icon-btn edge-arrow edge-prev"
        data-no-gesture
        aria-label="Tela anterior"
        onClick={() => animateStep(-1)}
      >
        <Icon name="back" size={24} />
      </button>
      <button
        type="button"
        className="ui-icon-btn edge-arrow edge-next"
        data-no-gesture
        aria-label="Próxima tela"
        onClick={() => animateStep(1)}
      >
        <Icon name="chevron-right" size={24} />
      </button>
    </>
  );
}

/** Tap = lock. While locked only a long press on the padlock unlocks. */
export function LockButton() {
  const locked = useUi((s) => s.profile.locked);
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };

  return (
    <button
      type="button"
      className="ui-icon-btn lock-btn"
      data-no-gesture
      data-locked={locked ? '1' : '0'}
      data-holding={holding ? '1' : '0'}
      aria-label={locked ? 'Destravar gestos (segure)' : 'Travar gestos'}
      aria-pressed={locked}
      style={{ ['--hold-ms' as string]: `${TIMINGS.longPressMs}ms` }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={() => {
        fired.current = false;
        if (!locked) return;
        setHolding(true);
        timer.current = setTimeout(() => {
          fired.current = true;
          clear();
          setLocked(false);
        }, TIMINGS.longPressMs);
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onClick={() => {
        if (fired.current) return;
        if (!locked) setLocked(true);
        else addNotice('info', 'Segure o cadeado para destravar.', 2000);
      }}
    >
      <Icon name={locked ? 'lock' : 'unlock'} />
    </button>
  );
}

export function Notices() {
  const notices = useUi((s) => s.notices);
  return (
    <div className="notices" data-no-gesture aria-live="polite">
      {notices.map((n) => (
        <button
          key={n.id}
          type="button"
          className="ui-toast notice"
          data-level={n.level}
          onClick={() => dismissNotice(n.id)}
        >
          <Icon name={n.level === 'info' ? 'info' : 'alert'} size={18} />
          <span>{n.message}</span>
        </button>
      ))}
    </div>
  );
}

export function SourceBadge() {
  const source = useUi((s) => s.source);
  const auto = useUi((s) => s.mockAuto);
  const state = useUi((s) => s.liveState);
  return (
    <div className="badges" aria-live="polite">
      <ConsoleChip variant="live" />
      <CaptureStatus variant="live" />
      <SessionSavedToast />
      {source === 'mock' && (
        <span className="ui-badge" data-tone="accent">
          {auto ? 'Demonstração (sem servidor)' : 'Demonstração'}
        </span>
      )}
      {state === 'replay' && (
        <span className="ui-badge" data-tone="info">
          REPLAY
        </span>
      )}
      <ReplayNotice />
    </div>
  );
}
