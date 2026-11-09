/**
 * #/captura — guided reference capture from a Time Trial ranking replay (PLANO §4, Onda 9a): form
 * (with an optional track), three short steps, start/stop, live progress (WS `status.capture`, REST
 * polling as fallback: waiting for the replay → start line → recording → validating) and the result
 * with measured vs typed time + next step. The packet format is not changed any more.
 */

import type { Lap, ReferenceCaptureStatus, Track } from '@gt7/shared';
import { useEffect, useRef, useState } from 'react';
import { clockText } from '../../lib/captureStatus.ts';
import { formatLapTime } from '../../lib/format.ts';
import { CONNECTION_STATE_LABELS } from '../../lib/labels.ts';
import { routes } from '../../lib/route.ts';
import { useUi } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { CarName } from '../components/CarName.tsx';
import { Card, ErrorBox, PageHead, Tag, useTitle } from '../components/ui.tsx';
import {
  CAPTURE_STATE_LABELS,
  CAPTURE_WAITING_LABELS,
  CAPTURE_WAITING_TITLES,
  captureIssueLabel,
} from '../lib/labels.ts';
import { parseLapTime } from '../lib/lapTime.ts';

const FORM_KEY = 'gt7.captureForm';

interface FormState {
  driverName: string;
  carName: string;
  rankingTime: string;
  notes: string;
  /** '' = the app finds the track from the replay's position. */
  trackId: string;
}

const EMPTY_FORM: FormState = {
  driverName: '',
  carName: '',
  rankingTime: '',
  notes: '',
  trackId: '',
};

function loadForm(): FormState {
  try {
    const raw = localStorage.getItem(FORM_KEY);
    if (raw) return { ...EMPTY_FORM, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...EMPTY_FORM };
}

type Phase = 'form' | 'running' | 'saved' | 'stopped';

/** Progress steps shown while a capture is armed (index = how far it got). */
const STEPS = [
  'Aguardando o replay e a pista',
  'Aguardando a linha de largada',
  'Gravando a volta',
  'Validando distância, pacotes e tempo',
] as const;

function stepOf(s: ReferenceCaptureStatus): number {
  switch (s.state) {
    case 'recording':
      return 2;
    case 'validating':
      return 3;
    case 'waitingLapStart':
      return s.waiting === 'startLine' ? 1 : 0;
    default:
      return 0;
  }
}

const signedMs = (ms: number) => `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms)} ms`;

/** Measured (packets) vs typed (ranking) time of the last lap that reached validation. */
function TimeCheck({ status }: { status: ReferenceCaptureStatus }) {
  if (status.measuredLapMs == null) return null;
  return (
    <dl className="a-timecheck num">
      <div>
        <dt>Medido pelos pacotes</dt>
        <dd>{formatLapTime(status.measuredLapMs)}</dd>
      </div>
      {status.rankingTimeMs != null && (
        <>
          <div>
            <dt>Digitado (ranking)</dt>
            <dd>{formatLapTime(status.rankingTimeMs)}</dd>
          </div>
          <div>
            <dt>Diferença</dt>
            <dd>{status.diffMs != null ? signedMs(status.diffMs) : '—'}</dd>
          </div>
        </>
      )}
    </dl>
  );
}

export function CapturePage() {
  useTitle('Captura de referência');
  const [form, setForm] = useState<FormState>(loadForm);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wsStatus = useUi((s) => s.wsStatus);
  const serverStatus = useUi((s) => s.serverStatus);
  const [polled, setPolled] = useState<ReferenceCaptureStatus | null>(null);
  const [savedLap, setSavedLap] = useState<Lap | null>(null);
  const [myBest, setMyBest] = useState<Lap | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const seenActive = useRef(false);

  // Live status: WebSocket when connected, else REST polling (also right after a command).
  const status: ReferenceCaptureStatus | null =
    wsStatus === 'open' && serverStatus ? serverStatus.capture : polled;
  const connection = serverStatus?.connection ?? null;

  useEffect(() => {
    let alive = true;
    api
      .tracks()
      .then((t) => alive && setTracks(t))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .capture()
        .then((s) => alive && setPolled(s))
        .catch(() => {});
    tick();
    const t = setInterval(tick, wsStatus === 'open' ? 5000 : 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [wsStatus]);

  // A capture already running when the page opens (e.g. started from another device), or one
  // that finished while this page was closed (the server keeps the last captured lap id).
  useEffect(() => {
    if (!status || phase !== 'form') return;
    if (status.state !== 'idle') setPhase('running');
    else if (status.lapId && savedLap === null) {
      setPhase('saved');
      api
        .lap(status.lapId)
        .then(setSavedLap)
        .catch(() => {});
    }
  }, [status, phase, savedLap]);

  // Your best lap on the captured lap's track + car, to compare against.
  useEffect(() => {
    if (!savedLap?.trackId) return;
    let alive = true;
    api
      .trackLaps(savedLap.trackId, {
        references: 'exclude',
        validOnly: true,
        orderBy: 'time',
        limit: 5,
        carCode: savedLap.carCode,
      })
      .then((mine) => alive && setMyBest(mine.find((l) => !l.flags.includes('replay')) ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [savedLap]);

  // Detect the end of a run.
  useEffect(() => {
    if (!status || phase !== 'running') return;
    if (status.state !== 'idle') {
      seenActive.current = true;
      return;
    }
    if (!seenActive.current) return;
    seenActive.current = false;
    if (status.lapId) {
      setPhase('saved');
      api
        .lap(status.lapId)
        .then(setSavedLap)
        .catch(() => {});
    } else {
      setPhase('stopped');
    }
  }, [status, phase]);

  const rankingMs = form.rankingTime.trim() ? parseLapTime(form.rankingTime) : null;
  const rankingInvalid = form.rankingTime.trim() !== '' && rankingMs === null;

  const start = async () => {
    setError(null);
    if (!form.driverName.trim()) {
      setError('Informe o nome do piloto do replay.');
      return;
    }
    if (rankingInvalid) {
      setError('Tempo do ranking inválido. Use o formato 1:30.960.');
      return;
    }
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify(form));
    } catch {
      // ignore
    }
    setBusy(true);
    try {
      const s = await api.startCapture({
        driverName: form.driverName.trim(),
        ...(form.carName.trim() ? { carName: form.carName.trim() } : {}),
        ...(rankingMs ? { rankingTimeMs: rankingMs } : {}),
        ...(form.trackId ? { trackId: form.trackId } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      setPolled(s);
      // The run counts as finished only after the server reported an active state.
      seenActive.current = s.state !== 'idle';
      setSavedLap(null);
      setMyBest(null);
      setPhase('running');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async (save: boolean) => {
    setBusy(true);
    try {
      setPolled(await api.stopCapture(save));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const active = !!status && status.state !== 'idle';
  const stepIndex = status ? stepOf(status) : -1;
  const rejected = active && status!.issues.length > 0;

  return (
    <>
      <PageHead
        title="Captura de referência"
        sub="Grave a volta de um piloto do topo do ranking assistindo ao replay dele no jogo. A volta vira referência para o delta ao vivo, a comparação e o coach."
      />
      <div className="a-capture-grid">
        <Card title="1. Dados da volta">
          <form
            className="a-form"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <label>
              Piloto *
              <input
                className="a-input"
                value={form.driverName}
                maxLength={80}
                placeholder="ex.: Kokichi"
                disabled={active}
                onChange={(e) => setForm({ ...form, driverName: e.target.value })}
              />
            </label>
            <label>
              Carro
              <input
                className="a-input"
                value={form.carName}
                maxLength={80}
                placeholder="ex.: Porsche 911 RSR"
                disabled={active}
                onChange={(e) => setForm({ ...form, carName: e.target.value })}
              />
            </label>
            <label>
              Tempo do ranking
              <input
                className="a-input num"
                value={form.rankingTime}
                inputMode="decimal"
                placeholder="1:30.960"
                disabled={active}
                aria-invalid={rankingInvalid}
                onChange={(e) => setForm({ ...form, rankingTime: e.target.value })}
              />
              <span className="a-help">
                {rankingInvalid
                  ? 'Formato: m:ss.mmm'
                  : rankingMs
                    ? `= ${formatLapTime(rankingMs)} — o tempo medido pelos pacotes precisa bater (±0,3 s)`
                    : 'Opcional, mas ajuda a validar a volta. Sem ele, vale o tempo medido pelos pacotes.'}
              </span>
            </label>
            <label>
              Pista
              <select
                className="a-input"
                value={form.trackId}
                disabled={active}
                onChange={(e) => setForm({ ...form, trackId: e.target.value })}
              >
                <option value="">Descobrir sozinho (pela posição do carro)</option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.layout ? ` — ${t.layout}` : ''}
                  </option>
                ))}
              </select>
              <span className="a-help">
                Opcional. O app só reconhece pistas em que você já completou uma volta ao vivo.
              </span>
            </label>
            <label>
              Notas
              <textarea
                className="a-input"
                rows={2}
                maxLength={500}
                value={form.notes}
                disabled={active}
                placeholder="acerto, pneus, condições…"
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
            {error && <p className="a-form-error">{error}</p>}
            <div className="a-actions">
              {!active ? (
                <button type="submit" className="a-btn" disabled={busy}>
                  Iniciar captura
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="a-btn"
                    disabled={busy}
                    onClick={() => stop(true)}
                  >
                    Parar
                  </button>
                  <button
                    type="button"
                    className="a-btn a-btn-danger"
                    disabled={busy}
                    onClick={() => stop(false)}
                  >
                    Cancelar e descartar
                  </button>
                </>
              )}
            </div>
          </form>
        </Card>

        <Card title="2. No jogo">
          <ol className="a-steps-howto">
            <li>
              Abra o <strong>replay da volta do piloto</strong> (Time Trial → ranking → replay) e
              inicie a captura aqui.
            </li>
            <li>
              Deixe <strong>reproduzir normalmente</strong>, em velocidade 1×:{' '}
              <strong>não pause, não volte e não avance</strong>. Qualquer salto descarta a volta.
            </li>
            <li>
              Digite o <strong>tempo do ranking</strong> ao lado para validar a volta (opcional).
            </li>
          </ol>
          <p className="dim a-small">
            O app mede a volta pelos pacotes entre duas passagens pela linha de largada. Se o replay
            começar no meio da volta, a volta parcial é ignorada e a próxima volta completa é
            gravada. A pista precisa ser uma em que você já completou uma volta ao vivo. Replays são
            suavizados: ótimo para aprender frenagens e traçado, não para contar milésimos.
          </p>
        </Card>

        <Card title="3. Status" className="a-capture-status">
          {!status && wsStatus !== 'open' && polled === null ? (
            <ErrorBox
              error="Sem resposta do servidor: a captura precisa do app rodando no PC."
              compact
            />
          ) : (
            <>
              <p className="a-capture-state" data-state={status?.state ?? 'idle'}>
                <span className="a-dot" aria-hidden="true" />
                {status
                  ? phase === 'running' && !active
                    ? 'Iniciando a captura…'
                    : status.state === 'waitingLapStart' && status.waiting
                      ? CAPTURE_WAITING_TITLES[status.waiting]
                      : CAPTURE_STATE_LABELS[status.state]
                  : '—'}
              </p>
              {connection && (
                <p className="dim a-small">
                  Console: {CONNECTION_STATE_LABELS[connection]}
                  {status?.replayDetected ? ' · replay detectado' : ''}
                  {status?.trackName ? ` · pista: ${status.trackName}` : ''}
                </p>
              )}
              {active && status && (
                <>
                  <ol className="a-steps">
                    {STEPS.map((text, i) => (
                      <li
                        key={text}
                        data-step={i < stepIndex ? 'done' : i === stepIndex ? 'now' : 'todo'}
                      >
                        {i === 2 && status.state === 'recording' && status.recordingMs != null
                          ? `Gravando a volta ${clockText(status.recordingMs)}`
                          : text}
                      </li>
                    ))}
                  </ol>
                  {status.state === 'recording' && status.lapFraction != null && (
                    <progress
                      className="a-progress"
                      max={1}
                      value={status.lapFraction}
                      aria-label="Progresso da volta"
                    />
                  )}
                  {status.state === 'waitingLapStart' && status.waiting && (
                    <p
                      className={status.waiting === 'unknownTrack' ? 'a-form-error' : 'dim'}
                      role="status"
                    >
                      {CAPTURE_WAITING_LABELS[status.waiting]}
                    </p>
                  )}
                </>
              )}
              {rejected && (
                <div className="a-rejected" role="alert">
                  <strong>Volta descartada</strong> — o app espera a próxima passagem pela linha:
                  <ul>
                    {status!.issues.map((i) => (
                      <li key={i}>{captureIssueLabel(i)}</li>
                    ))}
                  </ul>
                  <TimeCheck status={status!} />
                </div>
              )}
              {!active && status && status.issues.length > 0 && phase !== 'saved' && (
                <div className="a-rejected">
                  <strong>Problemas na última tentativa:</strong>
                  <ul>
                    {status.issues.map((i) => (
                      <li key={i}>{captureIssueLabel(i)}</li>
                    ))}
                  </ul>
                  <TimeCheck status={status} />
                </div>
              )}
              {phase === 'saved' && (
                <div className="a-saved">
                  <p>
                    <Tag tone="sb">salva</Tag> Volta de referência de{' '}
                    <strong>{status?.driverName ?? form.driverName}</strong>
                    {savedLap && (
                      <>
                        {' '}
                        em <span className="num">{formatLapTime(savedLap.timeMs)}</span> ·{' '}
                        <CarName
                          carCode={savedLap.carCode}
                          name={savedLap.referenceMeta?.carName}
                          logoSize={20}
                        />
                      </>
                    )}
                  </p>
                  {status && <TimeCheck status={status} />}
                  {status?.timeSource && (
                    <p className="dim a-small">
                      {status.timeSource === 'ranking'
                        ? 'Tempo salvo: o do ranking que você digitou (o medido pelos pacotes confere).'
                        : 'Tempo salvo: medido pelos pacotes (±1–2 pacotes, cerca de ±30 ms), pois nenhum tempo do ranking foi digitado.'}
                    </p>
                  )}
                  <div className="a-actions">
                    {savedLap && myBest ? (
                      <a
                        className="a-btn"
                        href={routes.compare({ lap: myBest.id, ref: savedLap.id })}
                      >
                        Comparar com o seu melhor ({formatLapTime(myBest.timeMs)})
                      </a>
                    ) : savedLap?.trackId ? (
                      <a className="a-btn" href={routes.track(savedLap.trackId)}>
                        Ver a pista
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="a-btn a-btn-ghost"
                      onClick={() => setPhase('form')}
                    >
                      Capturar outra
                    </button>
                  </div>
                  {savedLap && !myBest && (
                    <p className="dim a-small">
                      Ainda não há volta sua válida com este carro nesta pista para comparar.
                    </p>
                  )}
                </div>
              )}
              {phase === 'stopped' && !active && (
                <p className="dim">Captura encerrada sem volta salva.</p>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
