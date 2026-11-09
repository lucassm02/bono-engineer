import type { LiveFrame } from '@gt7/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type EngineerCall, engineerCall, engineerDisplay, isBrake } from '../lib/engineerRadio.ts';
import { live } from '../live/liveStore.ts';
import { useLiveRender } from '../live/raf.ts';
import { toggleMenu } from '../state/actions.ts';
import {
  engineerVoiceMs,
  playEngineerVoice,
  stopEngineerPreview,
  stopEngineerVoice,
  useEngineer,
} from '../state/engineer.ts';
import { recordEngineerCall } from '../state/engineerJournal.ts';
import { TRAINING_LAPS, useEngineerTraining } from '../state/engineerTraining.ts';
import { useUi } from '../state/uiStore.ts';

const STALE_MS = 450;
const STATUS = {
  waitingTrack: 'Reconhecendo o traçado',
  waitingReference: 'Escolha uma volta de referência',
  incompatible: 'Use uma volta do mesmo carro e traçado',
  noCues: 'Referência sem pontos de orientação confiáveis',
  suspended: 'Aguardando volta em pista',
  ready: 'Rádio pronto',
};

export function LiveEngineer() {
  const enabled = useEngineer((s) => s.enabled);
  return enabled ? <EngineerHud /> : null;
}

function EngineerHud() {
  const [status, setStatus] = useState<string>(STATUS.suspended);
  const [display, setDisplay] = useState<ReturnType<typeof engineerDisplay>>(null);
  const [pending, setPending] = useState(false);
  const muted = useEngineer((s) => s.muted);
  const controls = useEngineer((s) => s.controls);
  const deviceId = useUi((s) => s.profile.deviceId);
  const audioDevice = useUi((s) => s.serverStatus?.engineerAudioDeviceId);
  const audioHere = !audioDevice || audioDevice === deviceId;
  const training = useEngineerTraining((s) => s.run);
  const voiceError = useEngineer((s) => s.voiceError);
  const voiceLoading = useEngineer((s) => s.voiceLoading);
  const active = useRef<(EngineerCall & { deadline: number }) | null>(null);
  const spoken = useRef(new Set<string>());
  const previous = useRef<LiveFrame | null>(null);

  const suspend = useCallback((message: string) => {
    stopEngineerVoice();
    active.current = null;
    previous.current = null;
    setStatus(message);
    setDisplay(null);
    setPending(false);
  }, []);

  useLiveRender((f, now) => {
    if (document.hidden || now - live.receivedAt > STALE_MS) {
      suspend('Aguardando telemetria');
      return;
    }
    const engineer = f.engineer;
    if (engineer?.status !== 'ready') {
      suspend(engineer ? STATUS[engineer.status] : 'Aguardando roteiro da referência');
      return;
    }
    if (active.current && now >= active.current.deadline) {
      stopEngineerVoice();
      active.current = null;
    }

    const before = previous.current;
    previous.current = f;
    const dt = before ? f.t - before.t : 0;
    const length = f.track?.lengthM;
    const offset = (f.distanceM ?? 0) - (before?.distanceM ?? 0);
    const advance = length ? offset - Math.round(offset / length) * length : offset;
    // Verify forward progress after reconnection/reacquisition. Keep deduplication across gaps.
    if (
      !before ||
      before.track?.id !== f.track?.id ||
      dt <= 0 ||
      dt > STALE_MS ||
      advance < -0.5 ||
      advance > 55
    ) {
      stopEngineerVoice();
      active.current = null;
      setDisplay(null);
      return;
    }

    const inTraining = training && training.laps.length < TRAINING_LAPS;
    const cues = inTraining
      ? engineer.cues.filter(
          (cue) =>
            training.trackId === f.track?.id &&
            training.carCode === f.car.carCode &&
            training.referenceId === engineer.referenceLapId &&
            training.corners.some((corner) => corner.id === cue.cornerId),
        )
      : engineer.cues;
    const ids = new Set(engineer.cues.map((c) => c.id));
    for (const id of spoken.current) if (!ids.has(id)) spoken.current.delete(id);
    setStatus(STATUS.ready);
    setPending(engineer.pendingReference);
    const next = engineerDisplay(cues, f.car);
    setDisplay((last) =>
      last?.label === next?.label && last?.meters === next?.meters ? last : next,
    );

    const ui = useUi.getState();
    if (
      muted ||
      !audioHere ||
      controls.volume === 0 ||
      voiceError ||
      voiceLoading ||
      ui.menuOpen ||
      ui.onboarding === 'active' ||
      advance <= 0
    )
      return;
    const imminentBrake = cues.some(
      (c) => isBrake(c.kind) && c.aheadM >= 0 && c.aheadM < f.car.speedKmh / 3.6,
    );
    const calls = cues
      .filter(
        (c) =>
          !spoken.current.has(c.id) &&
          (!imminentBrake || isBrake(c.kind)) &&
          (controls.detail === 'full' || c.kind === 'brake' || c.kind === 'brakeHard'),
      )
      .flatMap((cue) => {
        const call = engineerCall(cue, f.car, engineerVoiceMs, controls.anticipationMs);
        return call ? [{ ...call, cue }] : [];
      })
      .sort((a, b) => Number(b.brake) - Number(a.brake) || a.expiresInMs - b.expiresInMs);
    const call = calls[0];
    if (!call || (active.current && (!call.brake || active.current.brake))) return;

    const playing = { ...call, deadline: now + call.expiresInMs };
    active.current = playing;
    const started = playEngineerVoice(
      call.text,
      false,
      () => {
        if (active.current === playing) active.current = null;
      },
      () => {
        const latest = live.frame;
        const latestEngineer = latest?.engineer;
        if (
          active.current !== playing ||
          !latest ||
          latest.sessionId !== f.sessionId ||
          latest.lap.startedAt !== f.lap.startedAt ||
          latestEngineer?.status !== 'ready'
        )
          return;
        const latestCue = latestEngineer.cues.find((cue) => cue.id === call.id);
        if (latestCue) recordEngineerCall(latest, latestCue, call.text, deviceId);
      },
    );
    if (started) spoken.current.add(call.id);
    else active.current = null;
  });

  useEffect(() => {
    if (!audioHere || muted || controls.volume === 0) {
      stopEngineerVoice();
      active.current = null;
    }
  }, [audioHere, muted, controls.volume]);

  useEffect(() => {
    const visibility = () => {
      if (document.hidden) {
        suspend('Aguardando telemetria');
        stopEngineerPreview();
      }
    };
    const timer = setInterval(() => {
      const now = performance.now();
      if (!live.frame || now - live.receivedAt > STALE_MS) {
        suspend('Aguardando telemetria');
      } else if (active.current && now >= active.current.deadline) {
        stopEngineerVoice();
        active.current = null;
      }
    }, 125);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      stopEngineerVoice();
    };
  }, [suspend]);

  return (
    <aside className="engineer-hud" data-action={display?.kind} aria-label="Engenheiro ao vivo">
      <div className="engineer-hud-heading">
        <span className="engineer-hud-mode">
          {!audioHere
            ? 'Engenheiro · áudio em outro aparelho'
            : muted || controls.volume === 0
              ? 'Engenheiro · sem som'
              : voiceError
                ? 'Engenheiro · voz indisponível'
                : 'Engenheiro ao vivo'}
        </span>
        <button
          type="button"
          data-no-gesture
          className="engineer-hud-settings"
          onClick={toggleMenu}
        >
          Ajustar rádio
        </button>
      </div>
      <div className="engineer-hud-call">
        <strong>{display?.label ?? status}</strong>
        {display?.meters != null && <b className="engineer-hud-distance">{display.meters} m</b>}
      </div>
      {pending && !display && <small>Nova referência na próxima volta</small>}
      {training && (
        <small>
          Treino · {training.laps.length}/{TRAINING_LAPS} voltas válidas
        </small>
      )}
    </aside>
  );
}
