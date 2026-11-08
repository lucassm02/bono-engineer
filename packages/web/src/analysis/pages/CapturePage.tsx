/**
 * #/captura — guided reference capture from a Time Trial ranking replay (PLANO §4): form, steps,
 * start/stop, live state (WS `status.capture`, REST polling as fallback), result + next step.
 */

import type { Lap, ReferenceCaptureStatus } from '@gt7/shared';
import { useEffect, useRef, useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { CONNECTION_STATE_LABELS } from '../../lib/labels.ts';
import { routes } from '../../lib/route.ts';
import { useUi } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { Card, ErrorBox, PageHead, Tag, useTitle } from '../components/ui.tsx';
import { CAPTURE_STATE_LABELS, captureIssueLabel, carLabel } from '../lib/labels.ts';
import { parseLapTime } from '../lib/lapTime.ts';

const FORM_KEY = 'gt7.captureForm';

interface FormState {
  driverName: string;
  carName: string;
  rankingTime: string;
  notes: string;
}

function loadForm(): FormState {
  try {
    const raw = localStorage.getItem(FORM_KEY);
    if (raw) return { driverName: '', carName: '', rankingTime: '', notes: '', ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { driverName: '', carName: '', rankingTime: '', notes: '' };
}

type Phase = 'form' | 'running' | 'saved' | 'stopped';

const STEPS: { state: ReferenceCaptureStatus['state'][]; text: string }[] = [
  {
    state: ['switchingFormat'],
    text: 'Trocando o formato do pacote para B (replays não enviam o ~)',
  },
  { state: ['waitingLapStart'], text: 'Aguardando o replay cruzar a linha de chegada' },
  { state: ['recording'], text: 'Gravando a volta inteira' },
  { state: ['validating'], text: 'Validando distância, pacotes e tempo' },
];

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
  const seenActive = useRef(false);

  // Live status: WebSocket when connected, else REST polling (also right after a command).
  const status: ReferenceCaptureStatus | null =
    wsStatus === 'open' && serverStatus ? serverStatus.capture : polled;
  const connection = serverStatus?.connection ?? null;

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
  const stepIndex = status ? STEPS.findIndex((s) => s.state.includes(status.state)) : -1;
  const rejected = active && status!.issues.length > 0;

  return (
    <>
      <PageHead
        title="Captura de referência"
        sub="Grave a volta de um piloto do topo do ranking assistindo ao replay dele no Time Trial. A volta vira referência para o delta ao vivo, a comparação e o coach."
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
                    ? `= ${formatLapTime(rankingMs)} — a volta gravada precisa bater (±0,3 s)`
                    : 'Opcional, mas ajuda a validar a volta.'}
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
              Abra o <strong>Time Trial</strong> da pista, vá ao <strong>ranking</strong> e escolha
              o replay do piloto.
            </li>
            <li>
              Inicie a captura aqui <em>antes</em> de dar play (a troca de formato leva até ~15 s).
            </li>
            <li>
              Assista em <strong>velocidade 1×</strong>, do começo ao fim da volta.{' '}
              <strong>Não pule, não avance e não pause</strong>: qualquer salto invalida a volta.
            </li>
            <li>Mantenha a câmera no carro do piloto (no Time Trial só há um carro).</li>
            <li>
              Quando a volta fechar o app valida e salva sozinho; se for rejeitada, ele grava a
              próxima.
            </li>
          </ol>
          <p className="dim a-small">
            Replays são suavizados: pontos de frenagem e traçado ficam com precisão de alguns metros
            — ótimo para aprender, não para contar milésimos. Compare com o mesmo carro sempre que
            possível.
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
                    : CAPTURE_STATE_LABELS[status.state]
                  : '—'}
              </p>
              {connection && (
                <p className="dim a-small">
                  Console: {CONNECTION_STATE_LABELS[connection]}
                  {connection === 'replay' && ' (modo captura)'}
                </p>
              )}
              {active && (
                <ol className="a-steps">
                  {STEPS.map((s, i) => (
                    <li
                      key={s.text}
                      data-step={i < stepIndex ? 'done' : i === stepIndex ? 'now' : 'todo'}
                    >
                      {s.text}
                    </li>
                  ))}
                </ol>
              )}
              {rejected && (
                <div className="a-rejected" role="alert">
                  <strong>Volta rejeitada</strong> — continuamos gravando a próxima volta:
                  <ul>
                    {status!.issues.map((i) => (
                      <li key={i}>{captureIssueLabel(i)}</li>
                    ))}
                  </ul>
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
                        {carLabel(savedLap.carCode, savedLap.referenceMeta?.carName)}
                      </>
                    )}
                  </p>
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
