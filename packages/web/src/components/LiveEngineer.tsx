import {
  type EngineerStatusView,
  engineerDisplay,
  engineerStatusView,
  type LiveFrame,
  localizedRadioUtterance,
  type RadioStepEnv,
} from '@gt7/shared';
import { useCallback, useEffect, useState } from 'react';
import { getLanguage, t as uiText } from '../lib/i18n.ts';
import { RADIO_MODE_LABELS } from '../lib/radioLabels.ts';
import { type RadioUtterance, utteranceKeys } from '../lib/radioPhrases.ts';
import { routes } from '../lib/route.ts';
import { live } from '../live/liveStore.ts';
import { useLiveRender } from '../live/raf.ts';
import { toggleMenu } from '../state/actions.ts';
import {
  playEngineerVoice,
  stopEngineerPreview,
  stopEngineerVoice,
  toggleEngineerHud,
  useEngineer,
} from '../state/engineer.ts';
import { recordEngineerCall } from '../state/engineerJournal.ts';
import { TRAINING_LAPS, useEngineerTraining } from '../state/engineerTraining.ts';
import { radioEngine } from '../state/radio.ts';
import { useUi } from '../state/uiStore.ts';
import { Icon } from './ui/Icon.tsx';

const STALE_MS = 450;
/**
 * What the card says about the engineer (spec 05 item 2): one table for every mode, so "pronto" is
 * only shown when the engineer really is (frame status `ready`). See `engineerStatusView`.
 */
const NO_SIGNAL_VIEW = engineerStatusView({
  enabled: true,
  noSignal: true,
  status: undefined,
  context: undefined,
});
const WAITING_VIEW = engineerStatusView({
  enabled: true,
  noSignal: false,
  status: 'suspended',
  context: undefined,
});
const NO_SIGNAL_REASONS = new Set(['amostra velha', 'sem sinal', 'página oculta']);

type Display = ReturnType<typeof engineerDisplay>;

export function LiveEngineer() {
  const enabled = useEngineer((s) => s.enabled);
  return enabled ? <EngineerHud /> : null;
}

export function EngineerHudButton() {
  const enabled = useEngineer((s) => s.enabled);
  const visible = useEngineer((s) => s.hudVisible);
  if (!enabled) return null;
  return (
    <button
      type="button"
      className="ui-icon-btn engineer-hud-btn"
      data-no-gesture
      aria-label={uiText('Cartão do engenheiro')}
      aria-pressed={visible}
      title={
        visible ? uiText('Ocultar cartão do engenheiro') : uiText('Mostrar cartão do engenheiro')
      }
      onClick={toggleEngineerHud}
    >
      <Icon name="radio" />
    </button>
  );
}

function EngineerHud() {
  const [view, setView] = useState<EngineerStatusView>(WAITING_VIEW);
  const [display, setDisplay] = useState<Display>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const visible = useEngineer((s) => s.hudVisible);
  const muted = useEngineer((s) => s.muted);
  const controls = useEngineer((s) => s.controls);
  const deviceId = useUi((s) => s.profile.deviceId);
  const audioDevice = useUi((s) => s.serverStatus?.engineerAudioDeviceId);
  const audioHere = !audioDevice || audioDevice === deviceId;
  const training = useEngineerTraining((s) => s.run);
  const voiceError = useEngineer((s) => s.voiceError);
  const voiceLoading = useEngineer((s) => s.voiceLoading);
  const trainingEnabled = controls.mode === 'training';
  const cornerCalls = trainingEnabled && controls.trainingProfile === 'learnTrack';
  const canRequestSummary =
    trainingEnabled && controls.trainingProfile !== 'free' && controls.summary === 'onDemand';

  const suspend = useCallback((reason: string, next = NO_SIGNAL_VIEW) => {
    if (radioEngine.suspend(reason)) stopEngineerVoice();
    setView(next);
    setDisplay(null);
    setPending(false);
  }, []);

  useLiveRender((f, now) => {
    if (document.hidden) {
      suspend('página oculta');
      return;
    }
    const ui = useUi.getState();
    const run = useEngineerTraining.getState().run;
    const inTraining =
      trainingEnabled &&
      run &&
      run.laps.length < TRAINING_LAPS &&
      (!run.sessionId || run.sessionId === f.sessionId);
    const engineer = f.engineer;
    const focusCornerIds = inTraining
      ? run.trackId === f.track?.id &&
        run.carCode === f.car.carCode &&
        engineer?.status === 'ready' &&
        run.referenceId === engineer.referenceLapId
        ? run.corners.map((corner) => corner.id)
        : []
      : null;
    const env: RadioStepEnv = {
      audio:
        muted ||
        !audioHere ||
        controls.volume === 0 ||
        voiceError ||
        typeof AudioContext === 'undefined'
          ? 'off'
          : voiceLoading || ui.menuOpen || ui.onboarding === 'active'
            ? 'wait'
            : 'ready',
      sampleAgeMs: now - live.receivedAt,
      focusCornerIds,
      assistCornerIds: cornerCalls ? focusCornerIds : null,
    };
    const out = radioEngine.step(f, env);
    if (out.stop) stopEngineerVoice();
    const language = getLanguage();
    const panel = out.panel;
    setNote(
      panel?.utterance?.length && language !== 'pt-BR'
        ? localizedRadioUtterance(panel.utterance, language)
        : (panel?.label ?? null),
    );

    const statusView = engineerStatusView({
      enabled: true,
      noSignal: false,
      status: engineer?.status,
      context: f.trackContext,
    });
    if (out.suspended) {
      setView(NO_SIGNAL_REASONS.has(out.suspended) ? NO_SIGNAL_VIEW : WAITING_VIEW);
      setDisplay(null);
      setPending(false);
    } else if (cornerCalls) {
      setView(statusView);
      setPending(engineer?.status === 'ready' && engineer.pendingReference);
      const cues =
        engineer?.status === 'ready'
          ? engineer.cues.filter(
              (cue) => !focusCornerIds || (cue.cornerId && focusCornerIds.includes(cue.cornerId)),
            )
          : [];
      const next = engineerDisplay(cues, f.car, controls.learningBrakePercent);
      setDisplay((last) =>
        last?.label === next?.label && last?.meters === next?.meters ? last : next,
      );
    } else {
      setView(statusView);
      setDisplay(null);
      setPending(false);
    }

    const speech = out.speak;
    if (!speech) return;
    const started = playEngineerVoice(speech.utterance, false, undefined, () => {
      if (speech.cueId) journal(f, speech.cueId, speech.utterance, deviceId);
    });
    if (!started) radioEngine.playbackFailed();
  });

  useEffect(() => {
    if (!audioHere || muted || controls.volume === 0) stopEngineerVoice();
  }, [audioHere, muted, controls.volume]);

  useEffect(() => {
    const visibility = () => {
      if (document.hidden) {
        suspend('página oculta');
        stopEngineerPreview();
      }
    };
    const timer = setInterval(() => {
      if (!live.frame || performance.now() - live.receivedAt > STALE_MS) suspend('sem sinal');
    }, 125);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      radioEngine.suspend('rádio desligado');
      stopEngineerVoice();
    };
  }, [suspend]);

  // Hide only the overlay. This component still receives frames and plays the radio.
  if (!visible) return null;

  const mode = RADIO_MODE_LABELS[controls.mode];
  const brakePercent = display?.label.match(/^Freio · (\d+)%$/)?.[1];
  const callLabel = brakePercent
    ? uiText('Freio · {0}%', brakePercent)
    : uiText(display?.label ?? note ?? view.text);
  return (
    <aside
      className="engineer-hud"
      data-action={display?.kind}
      aria-label={uiText('Engenheiro ao vivo')}
    >
      <div className="engineer-hud-heading">
        <span className="engineer-hud-mode">
          {!audioHere
            ? uiText('{0} · áudio em outro aparelho', mode)
            : muted || controls.volume === 0
              ? uiText('{0} · sem som', mode)
              : voiceError
                ? uiText('{0} · áudio indisponível', mode)
                : uiText('Engenheiro · {0}', mode)}
        </span>
        <button
          type="button"
          data-no-gesture
          className="ui-btn engineer-hud-settings"
          data-variant="secondary"
          data-size="sm"
          onClick={toggleMenu}
        >
          {uiText('Ajustar engenheiro')}
        </button>
      </div>
      <div className="engineer-hud-call">
        <strong>{callLabel}</strong>
        {display?.meters != null && <b className="engineer-hud-distance">{display.meters} m</b>}
      </div>
      {display && note && <small>{uiText(note)}</small>}
      {!display && view.detail && <small>{uiText(view.detail)}</small>}
      {!display && view.action === 'recordReplay' && (
        <a
          className="ui-btn engineer-hud-settings"
          data-variant="secondary"
          data-size="sm"
          data-no-gesture
          href={routes.capture()}
        >
          {uiText('Gravar volta de replay')}
        </a>
      )}
      {!display && view.action === 'pickReference' && (
        <button
          type="button"
          data-no-gesture
          className="ui-btn engineer-hud-settings"
          data-variant="secondary"
          data-size="sm"
          onClick={toggleMenu}
        >
          {uiText('Escolher outra referência')}
        </button>
      )}
      {pending && !display && <small>{uiText('Nova referência na próxima volta')}</small>}
      {training && trainingEnabled && controls.trainingProfile !== 'free' && (
        <small>
          {`${uiText('Treino ·')} `}
          {training.laps.length}/{TRAINING_LAPS}
          {` ${uiText('voltas válidas')}`}
        </small>
      )}
      {canRequestSummary && (
        <button
          type="button"
          data-no-gesture
          className="ui-btn engineer-hud-settings"
          data-variant="secondary"
          data-size="sm"
          disabled={view.key === 'noSignal' || view.key === 'waitingLap'}
          onClick={() => radioEngine.requestSummary()}
        >
          {uiText('Pedir resumo')}
        </button>
      )}
    </aside>
  );
}

/** Journal the corner call once it actually starts, if the lap and cue are still current. */
function journal(f: LiveFrame, cueId: string, utterance: RadioUtterance, deviceId: string): void {
  const latest = live.frame;
  const latestEngineer = latest?.engineer;
  if (
    !latest ||
    latest.sessionId !== f.sessionId ||
    latest.lap.startedAt !== f.lap.startedAt ||
    latestEngineer?.status !== 'ready'
  )
    return;
  const cue = latestEngineer.cues.find((c) => c.id === cueId);
  if (cue) recordEngineerCall(latest, cue, utteranceKeys(utterance).join(' '), deviceId);
}
