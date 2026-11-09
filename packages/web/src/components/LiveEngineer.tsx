import type { LiveFrame } from '@gt7/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type EngineerCall, engineerCall, engineerDisplay, isBrake } from '../lib/engineerRadio.ts';
import { live } from '../live/liveStore.ts';
import { useLiveRender } from '../live/raf.ts';
import {
  engineerVoiceMs,
  playEngineerVoice,
  stopEngineerPreview,
  stopEngineerVoice,
  useEngineer,
} from '../state/engineer.ts';
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

    const { cues } = engineer;
    const ids = new Set(cues.map((c) => c.id));
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
      .filter((c) => !spoken.current.has(c.id) && (!imminentBrake || isBrake(c.kind)))
      .map((c) => engineerCall(c, f.car, engineerVoiceMs))
      .filter((c) => c !== null)
      .sort((a, b) => Number(b.brake) - Number(a.brake) || a.expiresInMs - b.expiresInMs);
    const call = calls[0];
    if (!call || (active.current && (!call.brake || active.current.brake))) return;

    const playing = { ...call, deadline: now + call.expiresInMs };
    active.current = playing;
    const started = playEngineerVoice(call.text, false, () => {
      if (active.current === playing) active.current = null;
    });
    if (started) spoken.current.add(call.id);
    else active.current = null;
  });

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
      <span className="engineer-hud-mode">
        {muted
          ? 'Engenheiro · sem som'
          : voiceError
            ? 'Engenheiro · voz indisponível'
            : 'Engenheiro ao vivo'}
      </span>
      <div className="engineer-hud-call">
        <strong>{display?.label ?? status}</strong>
        {display?.meters != null && <b className="engineer-hud-distance">{display.meters} m</b>}
      </div>
      {pending && !display && <small>Nova referência na próxima volta</small>}
    </aside>
  );
}
