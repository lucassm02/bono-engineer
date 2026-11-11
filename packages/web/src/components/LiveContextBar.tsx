/**
 * Context bar of the live panel (spec 05): a thin line that always answers "em que pista estou?",
 * "que carro?" and "o engenheiro está pronto?", plus what is needed to act on it without leaving
 * the wheel: the opening chip (spec 06), the learning guide of a new track and the notice that the
 * track the driver chose did not match. Nothing here asks anything while the car is moving.
 *
 *   [● Trial Mountain Circuit] [Huracán Gr.4] [● Engenheiro: pronto]
 *
 * `variant="menu"` is the same line, static, for the head of the menu drawer (it only reads the
 * store; the live variant feeds it from the frames).
 */

import { engineerStatusView, learningGuideText } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { useSafeToPrompt } from '../hooks/useSafeToPrompt.ts';
import { t as uiText } from '../lib/i18n.ts';
import {
  barTrackView,
  carText,
  demoPromptsAllowed,
  guideVisibility,
  isDemoSource,
  mismatchText,
} from '../lib/liveContext.ts';
import { live } from '../live/liveStore.ts';
import { useLiveRender } from '../live/raf.ts';
import { useEngineer } from '../state/engineer.ts';
import {
  chooseTrack,
  dismissMismatch,
  ensureSavedTracks,
  feedLiveContext,
  openTrackPicker,
  useLiveContext,
  useSavedTracks,
} from '../state/liveContext.ts';
import { useUi } from '../state/uiStore.ts';
import { TrackPickerSheet } from './TrackPickerSheet.tsx';

/** Hooks shared by the bar variants: is there something to show, and in which state. */
function useBarData() {
  // the frames are fresher; the status (sessionCapture) covers the moments without one
  const frameCtx = useLiveContext((s) => s.ctx);
  const statusCtx = useUi((s) => s.serverStatus?.sessionCapture?.track ?? null);
  const ctx = frameCtx ?? statusCtx;
  const frameCar = useLiveContext((s) => s.carCode);
  const statusCar = useUi((s) => s.serverStatus?.sessionCapture?.carCode ?? null);
  const carCode = frameCar ?? statusCar;
  const engineerStatus = useLiveContext((s) => s.engineerStatus);
  const sessionId = useLiveContext((s) => s.sessionId);
  const savedCount = useSavedTracks((s) => s.tracks?.length ?? 0);
  const enabled = useEngineer((s) => s.enabled);
  const source = useUi((s) => s.source);
  const link = useUi((s) => s.serverStatus?.consoleConnection ?? null);
  const liveState = useUi((s) => s.liveState);
  const noSignal = useUi((s) => s.serverStatus?.sessionCapture?.detail === 'noSignal');
  const demo = isDemoSource(source, source === 'mock' ? null : link);
  const demoOk = typeof location !== 'undefined' && demoPromptsAllowed(location.search);
  const hasData = liveState !== null && liveState !== 'disconnected' && liveState !== 'connecting';
  const visible = hasData && liveState !== 'replay' && (!demo || demoOk);
  const track = barTrackView({
    ctx,
    sessionOpen: sessionId !== null,
    hasSavedTracks: savedCount > 0,
  });
  const engineer = engineerStatusView({ enabled, noSignal, status: engineerStatus, context: ctx });
  return { ctx, carCode, track, engineer, visible, sessionId };
}

function Dot({ tone, pulse }: { tone: string | null; pulse?: boolean }) {
  return (
    <span
      className="ui-dot lc-dot"
      data-tone={tone ?? undefined}
      data-pulse={pulse ? '1' : '0'}
      aria-hidden="true"
    />
  );
}

const ENGINEER_DOT: Record<string, string | null> = {
  ok: 'gain',
  warn: 'warn',
  wait: null,
  off: null,
};

function BarItems({ variant }: { variant: 'live' | 'menu' }) {
  const { ctx, carCode, track, engineer } = useBarData();
  const car = carText(carCode);
  const chipUntil = useLiveContext((s) => s.chipUntil);
  const picker = useLiveContext((s) => s.picker);
  const safe = useSafeToPrompt();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (chipUntil === null) return;
    const left = chipUntil - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => setNow(Date.now()), left + 20);
    return () => clearTimeout(id);
  }, [chipUntil]);
  const chip = chipUntil !== null && now < chipUntil && safe && !picker && !ctx?.hint;

  const tapTrack = () => {
    if (track.action) openTrackPicker(track.action === 'naming' ? 'name' : 'choose');
  };
  const trackBody = (
    <>
      <Dot tone={track.tone} pulse={track.pulse} />
      <span className="lc-name">{track.label}</span>
      {track.note && (
        <span className="lc-note" data-warn={track.kind === 'new' ? '1' : '0'}>
          {`· ${track.note}`}
        </span>
      )}
    </>
  );
  const label = `${uiText('Pista')}: ${track.label}`;
  return (
    <>
      {track.action ? (
        <button
          type="button"
          className="lc-item lc-track"
          data-kind={track.kind}
          data-action="1"
          data-no-gesture
          title={track.title}
          aria-label={`${label}. ${track.title}`}
          onClick={tapTrack}
        >
          {trackBody}
        </button>
      ) : (
        <span
          className="lc-item lc-track"
          data-kind={track.kind}
          data-no-gesture
          title={track.title}
        >
          {trackBody}
        </span>
      )}
      {car && (
        <span className="lc-item lc-car" data-no-gesture title={car}>
          <span className="lc-name">{car}</span>
        </span>
      )}
      <span
        className="lc-item lc-engineer"
        data-tone={engineer.tone}
        data-no-gesture
        title={
          engineer.detail
            ? `${uiText(engineer.text)}. ${uiText(engineer.detail)}`
            : uiText(engineer.text)
        }
      >
        <Dot tone={ENGINEER_DOT[engineer.tone] ?? null} pulse={engineer.tone === 'wait'} />
        <span className="lc-name">
          <span className="lc-prefix">{`${uiText('Engenheiro')}: `}</span>
          {uiText(engineer.short)}
        </span>
      </span>
      {chip && variant === 'live' && (
        <button
          type="button"
          className="lc-chip"
          data-no-gesture
          onClick={() => openTrackPicker('choose')}
        >
          {uiText('Pista de hoje? Toque para escolher')}
        </button>
      )}
    </>
  );
}

/** Learning guide of a new track (spec 05 item 3): three steps, never in the way of the driving. */
function LearningGuide() {
  const ctx = useLiveContext((s) => s.ctx);
  const enabled = useEngineer((s) => s.enabled);
  const mode = useEngineer((s) => s.controls.mode);
  const guide = learningGuideText(ctx?.learning, ctx?.corners ?? null);
  if (!guide) return null;
  const reduced = guideVisibility({ engineerOn: enabled, mode }) === 'reduced';
  if (reduced) {
    if (guide.stage < 3) return null;
    return (
      <div
        className="status-banner learning-guide"
        data-reduced="1"
        data-stage={guide.stage}
        role="status"
      >
        <span className="ui-dot" data-tone="gain" aria-hidden="true" />
        <strong>{uiText('Pista aprendida')}</strong>
      </div>
    );
  }
  return (
    <div
      className="status-banner learning-guide"
      data-stage={guide.stage}
      role="status"
      data-no-gesture
    >
      <ol className="lg-steps">
        {guide.steps.map((s) => (
          <li
            key={s.n}
            data-state={s.state}
            aria-current={s.state === 'current' ? 'step' : undefined}
          >
            <span className="lg-n" aria-hidden="true">
              {s.state === 'done' ? '✓' : s.n}
            </span>
            <span className="lg-label">{uiText(s.label)}</span>
          </li>
        ))}
      </ol>
      <p className="lg-message">{uiText(guide.message)}</p>
      {guide.invalidMessage && <p className="lg-invalid">{uiText(guide.invalidMessage)}</p>}
    </div>
  );
}

/** "Isso não parece X. Troquei para Y." — only with the car stopped. */
function MismatchNotice() {
  const mismatch = useLiveContext((s) => s.mismatch);
  const safe = useSafeToPrompt();
  if (!mismatch || !safe) return null;
  const { info, detectedIsNew } = mismatch;
  return (
    <div className="status-banner lc-mismatch" role="alert" data-no-gesture>
      <span className="ui-dot" data-tone="warn" aria-hidden="true" />
      <span className="status-banner-text">
        <strong>{mismatchText(info, detectedIsNew)}</strong>
        <span>{uiText('Nenhuma volta foi perdida: elas já estão na pista certa.')}</span>
      </span>
      <span className="lc-mismatch-actions">
        <button type="button" className="ui-btn" data-size="sm" onClick={dismissMismatch}>
          {uiText('Entendi')}
        </button>
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          data-size="sm"
          onClick={() => {
            dismissMismatch();
            void chooseTrack(info.hintedTrackId, true);
          }}
        >
          {uiText('Manter {0}', info.hintedTrackName)}
        </button>
      </span>
    </div>
  );
}

export function LiveContextBar({ variant = 'live' }: { variant?: 'live' | 'menu' }) {
  const { visible, ctx } = useBarData();

  // live variant only: feed the store from the frames and keep the saved tracks in sync
  useLiveRender((f) => {
    if (variant === 'live') feedLiveContext(f);
  });
  const sessionId = useLiveContext((s) => s.sessionId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload on every new session
  useEffect(() => {
    if (variant === 'live') void ensureSavedTracks();
  }, [variant, sessionId]);
  // the frame may already be there when the bar mounts (opened mid-session)
  useEffect(() => {
    if (variant === 'live' && live.frame) feedLiveContext(live.frame);
  }, [variant]);

  if (variant === 'menu') {
    if (!visible) return null;
    return (
      <div
        className="live-context"
        data-variant="menu"
        role="status"
        aria-label={uiText('Contexto da sessão')}
      >
        <BarItems variant="menu" />
      </div>
    );
  }
  return (
    <>
      {visible && (
        <div
          className="live-context"
          data-variant="live"
          data-no-gesture
          role="status"
          aria-live="polite"
          aria-label={uiText('Contexto da sessão')}
        >
          <BarItems variant="live" />
        </div>
      )}
      {visible && ctx && <LearningGuide />}
      {visible && <MismatchNotice />}
      <TrackPickerSheet />
    </>
  );
}
