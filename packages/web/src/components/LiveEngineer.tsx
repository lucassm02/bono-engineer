import {
  engineerDisplay,
  type LiveFrame,
  localizedRadioUtterance,
  type RadioStepEnv,
} from '@gt7/shared';
import { useCallback, useEffect, useState } from 'react';
import { getLanguage, t as uiText } from '../lib/i18n.ts';
import { RADIO_MODE_LABELS } from '../lib/radioLabels.ts';
import { type RadioUtterance, utteranceKeys } from '../lib/radioPhrases.ts';
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
const STATUS = {
  get waitingTrack() {
    return uiText('Reconhecendo o traçado');
  },
  get waitingReference() {
    return uiText('Escolha uma volta de referência');
  },
  get incompatible() {
    return uiText('Use uma volta do mesmo carro e traçado');
  },
  get noCues() {
    return uiText('Referência sem pontos de orientação confiáveis');
  },
  get suspended() {
    return uiText('Aguardando volta em pista');
  },
  get ready() {
    return uiText('Rádio pronto');
  },
};
const WAITING_TELEMETRY = 'Aguardando telemetria';
const SUSPENDED: Record<string, string> = {
  'amostra velha': WAITING_TELEMETRY,
  'sem sinal': WAITING_TELEMETRY,
  'página oculta': WAITING_TELEMETRY,
};

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
      className="engineer-hud-btn"
      data-no-gesture
      aria-label={uiText('Cartão do rádio')}
      aria-pressed={visible}
      title={visible ? uiText('Ocultar cartão do rádio') : uiText('Mostrar cartão do rádio')}
      onClick={toggleEngineerHud}
    >
      <Icon name="radio" />
    </button>
  );
}

function EngineerHud() {
  const [status, setStatus] = useState<string>(STATUS.suspended);
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

  const suspend = useCallback((reason: string, message = WAITING_TELEMETRY) => {
    if (radioEngine.suspend(reason)) stopEngineerVoice();
    setStatus(message);
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

    if (out.suspended) {
      setStatus(SUSPENDED[out.suspended] ?? STATUS.suspended);
      setDisplay(null);
      setPending(false);
    } else if (cornerCalls) {
      setStatus(engineer ? STATUS[engineer.status] : uiText('Aguardando roteiro da referência'));
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
      setStatus(STATUS.ready);
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
    : uiText(display?.label ?? note ?? status);
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
          {uiText('Ajustar rádio')}
        </button>
      </div>
      <div className="engineer-hud-call">
        <strong>{callLabel}</strong>
        {display?.meters != null && <b className="engineer-hud-distance">{display.meters} m</b>}
      </div>
      {display && note && <small>{uiText(note)}</small>}
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
          disabled={status === WAITING_TELEMETRY || status === STATUS.suspended}
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
