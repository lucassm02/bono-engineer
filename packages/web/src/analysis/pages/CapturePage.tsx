/**
 * #/captura — one-click reference capture from a Time Trial ranking replay (Onda 10a).
 *
 * The app detects the replay, the car (from `carCode`) and the track (from the position) by
 * itself, so the only things left to type are optional: the ranking time (validates the lap)
 * and the driver's name. Everything else (car, track, notes) hides under "Mais detalhes". Live
 * status comes from the WebSocket (`status.capture`), with REST polling as the fallback; the
 * saved references are listed below, grouped by track.
 */

import { type Lap, makerOfCar, type ReferenceCaptureStatus, type Track } from '@gt7/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { routes } from '../../lib/route.ts';
import { useUi } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { BrandLogo } from '../components/BrandLogo.tsx';
import { CarSelect } from '../components/CarSelect.tsx';
import { ReferenceList } from '../components/ReferenceList.tsx';
import { Card, ErrorBox, PageHead, useTitle } from '../components/ui.tsx';
import {
  type CarChoice,
  carChoiceValue,
  carDisplayName,
  carRequestFields,
  type DetectionView,
  detectionView,
  discardKey,
  driverSuggestions,
  parseCarChoice,
  parseRankingTime,
  progressView,
  resolvedCarName,
  signedMs,
  timeOriginLabel,
  visibleIssues,
} from '../lib/captureForm.ts';
import { captureIssueLabel } from '../lib/labels.ts';
import { formatLapTimeInput } from '../lib/lapTime.ts';
import { useLiveCar } from '../lib/useLiveCar.ts';
import { useFetch } from '../useFetch.ts';

type Phase = 'form' | 'running' | 'saved' | 'stopped';

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------

function CarChip({ carCode, text }: { carCode: number | null; text: string }) {
  const maker = makerOfCar(carCode);
  return (
    <span className="cap-chip">
      {maker && <BrandLogo maker={maker} size={24} />}
      <span className="cap-chip-text">{text}</span>
    </span>
  );
}

/** Live "what the app detected" strip at the top of the page. */
function DetectionBanner({ view }: { view: DetectionView }) {
  return (
    <section className="cap-detect" data-tone={view.tone} aria-live="polite">
      <span className="cap-detect-dot" aria-hidden="true" />
      <div className="cap-detect-body">
        <p className="cap-detect-title">
          <strong>{view.title}</strong>
          {view.trackName && <span className="cap-detect-part"> · {view.trackName}</span>}
          {view.carName && (
            <span className="cap-detect-part">
              {' · '}
              <CarChip carCode={view.carCode} text={view.carName} />
            </span>
          )}
        </p>
        <p className="cap-detect-msg">{view.message}</p>
      </div>
    </section>
  );
}

/** One bar with the four steps; the "Gravando" segment fills with the lap. */
function ProgressBar({ status }: { status: ReferenceCaptureStatus }) {
  const p = progressView(status);
  return (
    <div className="cap-progress">
      <div
        className="cap-steps"
        role="progressbar"
        aria-label="Andamento da captura"
        aria-valuemin={1}
        aria-valuemax={p.steps.length}
        aria-valuenow={p.step + 1}
        aria-valuetext={`Passo ${p.step + 1} de ${p.steps.length}: ${p.steps[p.step]?.label}`}
      >
        {p.steps.map((s, i) => (
          <div
            key={s.label}
            className="cap-step"
            data-state={s.state}
            data-rec={i === 2 && status.state === 'recording' ? '1' : undefined}
          >
            <span
              className="cap-seg"
              style={
                i === 2 ? { ['--fill' as string]: `${p.recordingFraction * 100}%` } : undefined
              }
            />
            <span className="cap-seg-label">{s.label}</span>
          </div>
        ))}
      </div>
      <p className="cap-clock num" data-on={p.clock ? '1' : undefined} aria-live="off">
        {p.clock || '—:——'}
        {p.estimate && <span className="cap-clock-est"> {p.estimate}</span>}
      </p>
      <p className="cap-now" data-tone={p.tone}>
        {p.headline}
      </p>
      <p className="cap-now-text">{p.text}</p>
    </div>
  );
}

function Issues({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="a-rejected" role="alert">
      <strong>A última volta foi descartada:</strong>
      <ul>
        {issues.map((i) => (
          <li key={i}>{captureIssueLabel(i)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Result card: times (measured × typed), car, driver, track and the next steps. */
function SavedCard({
  lap,
  status,
  trackName,
  myBest,
  onAgain,
}: {
  lap: Lap | null;
  status: ReferenceCaptureStatus | null;
  trackName: string | null;
  myBest: Lap | null;
  onAgain: () => void;
}) {
  const meta = lap?.referenceMeta ?? null;
  const measured = status?.measuredLapMs ?? meta?.measuredTimeMs ?? null;
  const typed = status?.rankingTimeMs ?? meta?.rankingTimeMs ?? null;
  const diff = status?.diffMs ?? (measured != null && typed != null ? measured - typed : null);
  const carText = meta?.carName || (lap ? carDisplayName(lap.carCode) : null);
  return (
    <div className="cap-saved" role="status">
      <p className="cap-saved-head">
        <span className="cap-ok" aria-hidden="true">
          ✓
        </span>
        Volta salva como referência
      </p>
      <p className="cap-saved-time num">{lap ? formatLapTime(lap.timeMs) : '…'}</p>
      <dl className="cap-facts">
        <div>
          <dt>Piloto</dt>
          <dd>{meta?.driverName ?? status?.driverName ?? '—'}</dd>
        </div>
        <div>
          <dt>Carro</dt>
          <dd>{lap && carText ? <CarChip carCode={lap.carCode} text={carText} /> : '—'}</dd>
        </div>
        <div>
          <dt>Pista</dt>
          <dd>{trackName ?? status?.trackName ?? '—'}</dd>
        </div>
        <div>
          <dt>Origem do tempo</dt>
          <dd>{timeOriginLabel(meta)}</dd>
        </div>
      </dl>
      {measured != null && (
        <dl className="a-timecheck num">
          <div>
            <dt>Estimado pela telemetria</dt>
            <dd>{formatLapTime(measured)}</dd>
          </div>
          {typed != null && (
            <>
              <div>
                <dt>Digitado (ranking)</dt>
                <dd>{formatLapTime(typed)}</dd>
              </div>
              <div>
                <dt>Diferença</dt>
                <dd>{diff != null ? signedMs(diff) : '—'}</dd>
              </div>
            </>
          )}
        </dl>
      )}
      {typed == null && measured != null && (
        <p className="dim a-small">
          O tempo salvo é uma estimativa entre as duas passagens pela linha de chegada.
        </p>
      )}
      <div className="a-actions">
        {lap && myBest ? (
          <a className="a-btn cap-btn" href={routes.compare({ lap: myBest.id, ref: lap.id })}>
            Comparar com o meu melhor ({formatLapTime(myBest.timeMs)})
          </a>
        ) : lap?.trackId ? (
          <a className="a-btn cap-btn" href={routes.track(lap.trackId)}>
            Ver a pista
          </a>
        ) : null}
        <button type="button" className="a-btn a-btn-ghost cap-btn" onClick={onAgain}>
          Capturar outra
        </button>
      </div>
      {lap && !myBest && (
        <p className="dim a-small">
          Ainda não há volta sua válida com este carro nesta pista para comparar.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

export function CapturePage() {
  useTitle('Capturar referência');
  const [driver, setDriver] = useState('');
  const [rankingText, setRankingText] = useState('');
  const [carChoice, setCarChoice] = useState<CarChoice>('auto');
  const [trackId, setTrackId] = useState('');
  const [notes, setNotes] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wsStatus = useUi((s) => s.wsStatus);
  const serverStatus = useUi((s) => s.serverStatus);
  const [polled, setPolled] = useState<ReferenceCaptureStatus | null>(null);
  const [savedLap, setSavedLap] = useState<Lap | null>(null);
  const [myBest, setMyBest] = useState<Lap | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [discards, setDiscards] = useState(0);
  const seenActive = useRef(false);
  const lastDiscard = useRef<string | null>(null);
  const liveCar = useLiveCar();
  const refs = useFetch('capture:refs', () => api.references());
  const reloadRefs = refs.reload;

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
      reloadRefs();
    } else {
      setPhase('stopped');
    }
  }, [status, phase, reloadRefs]);

  // How many laps this run threw away (the explanation only shows while it is current).
  useEffect(() => {
    if (!status || phase !== 'running') return;
    const key = discardKey(status);
    if (key && key !== lastDiscard.current) {
      lastDiscard.current = key;
      setDiscards((n) => n + 1);
    }
  }, [status, phase]);

  const ranking = parseRankingTime(rankingText);
  const drivers = useMemo(() => driverSuggestions(refs.data ?? []), [refs.data]);

  const detection = detectionView({
    online: wsStatus === 'open' || polled !== null,
    connection,
    liveState: liveCar.state,
    carCode: liveCar.carCode,
    capture: status,
  });

  const detectedCar = liveCar.carCode;
  const detectedCarName =
    resolvedCarName(detectedCar) ?? (detectedCar ? `Carro #${detectedCar}` : null);
  const effectiveCar: number | null =
    carChoice === 'auto' ? detectedCar : carChoice === 'none' ? null : carChoice;
  const effectiveCarText =
    carChoice === 'none'
      ? null
      : carChoice === 'auto'
        ? detectedCarName
        : carDisplayName(carChoice);
  const chosenTrack = tracks.find((t) => t.id === trackId);
  const trackLabel = (t: Pick<Track, 'name' | 'layout'>) =>
    t.layout ? `${t.name} — ${t.layout}` : t.name;

  const start = async () => {
    setError(null);
    if (ranking.kind === 'invalid') {
      setError(ranking.message);
      return;
    }
    setBusy(true);
    try {
      const s = await api.startCapture({
        ...(driver.trim() ? { driverName: driver.trim() } : {}),
        ...carRequestFields(carChoice, liveCar.carCode),
        ...(ranking.kind === 'ok' ? { rankingTimeMs: ranking.ms } : {}),
        ...(trackId ? { trackId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setPolled(s);
      // The run counts as finished only after the server reported an active state.
      seenActive.current = s.state !== 'idle';
      lastDiscard.current = null;
      setDiscards(0);
      setSavedLap(null);
      setMyBest(null);
      setPhase('running');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      setPolled(await api.stopCapture(true));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    setRankingText('');
    setNotes('');
    setError(null);
    setPhase('form');
  };

  const active = !!status && status.state !== 'idle';
  const issues = status ? visibleIssues(status) : [];
  const trackNameOf = (id: string | null) => {
    const t = tracks.find((x) => x.id === id);
    return t ? trackLabel(t) : null;
  };

  return (
    <div className="cap-page">
      <PageHead
        title="Capturar referência"
        sub="Assista ao replay de um piloto do topo no jogo e grave a volta dele como referência para o delta ao vivo, a comparação e o coach."
      />

      <DetectionBanner view={detection} />

      {phase === 'saved' ? (
        <Card title="Resultado">
          <SavedCard
            lap={savedLap}
            status={status}
            trackName={trackNameOf(savedLap?.trackId ?? null)}
            myBest={myBest}
            onAgain={again}
          />
        </Card>
      ) : phase === 'running' ? (
        <Card title="Capturando">
          {status ? (
            !active ? (
              <p className="cap-now">Iniciando a captura…</p>
            ) : (
              <>
                <ProgressBar status={status} />
                {status.trackName && (
                  <p className="dim a-small">
                    Pista: <strong>{status.trackName}</strong>
                  </p>
                )}
                <Issues issues={issues} />
                {status.state === 'recording' && discards > 0 && (
                  <p className="dim a-small">
                    Uma tentativa anterior foi descartada; esta é a próxima volta, gravando sozinho.
                  </p>
                )}
                {status.state === 'waitingLapStart' && issues.length > 0 && (
                  <p className="dim a-small">O app vai gravar a próxima volta sozinho.</p>
                )}
              </>
            )
          ) : (
            <ErrorBox
              error="Sem resposta do servidor: a captura precisa do app rodando no PC."
              compact
            />
          )}
          {error && <p className="a-form-error">{error}</p>}
          <div className="a-actions cap-stop">
            <button
              type="button"
              className="a-btn a-btn-ghost cap-btn"
              disabled={busy}
              onClick={stop}
            >
              Parar a captura
            </button>
          </div>
        </Card>
      ) : (
        <Card title="Capturar esta volta">
          <form
            className="cap-form"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <label className="cap-field" htmlFor="cap-ranking">
              Tempo do ranking <span className="cap-opt">(opcional)</span>
              <input
                id="cap-ranking"
                className="a-input num"
                value={rankingText}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="1:30.960"
                aria-invalid={ranking.kind === 'invalid'}
                aria-describedby="cap-ranking-help"
                onChange={(e) => setRankingText(e.target.value)}
                onBlur={() => {
                  if (ranking.kind === 'ok') setRankingText(formatLapTimeInput(ranking.ms));
                }}
              />
              <span
                id="cap-ranking-help"
                className="a-help"
                role={ranking.kind === 'invalid' ? 'alert' : undefined}
              >
                {ranking.kind === 'invalid'
                  ? ranking.message
                  : ranking.kind === 'ok'
                    ? `Vamos salvar ${ranking.shown} se a estimativa da telemetria ficar a até 0,3 s desse tempo.`
                    : 'Copie o tempo oficial do jogo (ex.: 1:30.960). Se deixar em branco, salvamos a estimativa da telemetria.'}
              </span>
            </label>

            <label className="cap-field" htmlFor="cap-driver">
              Piloto <span className="cap-opt">(opcional)</span>
              <input
                id="cap-driver"
                className="a-input"
                list="cap-drivers"
                value={driver}
                maxLength={80}
                autoComplete="off"
                placeholder="Piloto do replay"
                onChange={(e) => setDriver(e.target.value)}
              />
              <datalist id="cap-drivers">
                {drivers.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </label>

            <ul className="cap-auto" aria-label="Detectado automaticamente">
              <li>
                <span className="cap-auto-k">Carro</span>
                {effectiveCarText ? (
                  <CarChip carCode={effectiveCar} text={effectiveCarText} />
                ) : (
                  <span className="dim">
                    {carChoice === 'none' ? 'não informado' : 'será reconhecido pelo replay'}
                  </span>
                )}
                {carChoice === 'auto' && detectedCar !== null && (
                  <span className="cap-auto-tag">detectado</span>
                )}
              </li>
              <li>
                <span className="cap-auto-k">Pista</span>
                {chosenTrack ? (
                  <span>{trackLabel(chosenTrack)}</span>
                ) : status?.trackName ? (
                  <span>
                    {status.trackName} <span className="cap-auto-tag">detectada</span>
                  </span>
                ) : (
                  <span className="dim">será reconhecida pela posição do carro</span>
                )}
              </li>
            </ul>

            <details
              className="cap-more"
              open={moreOpen}
              onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}
            >
              <summary>Mais detalhes (corrigir carro ou pista, notas)</summary>
              <div className="cap-more-body">
                <label className="cap-field" htmlFor="cap-car">
                  Carro
                  <CarSelect
                    id="cap-car"
                    value={carChoiceValue(carChoice)}
                    onChange={(v) => setCarChoice(parseCarChoice(v))}
                    describedBy="cap-car-help"
                    lead={[
                      {
                        value: 'auto',
                        label: detectedCarName
                          ? `Detectado: ${detectedCarName}`
                          : 'Automático (pelo carro do replay)',
                      },
                      { value: 'none', label: 'Não informar' },
                    ]}
                  />
                  <span id="cap-car-help" className="a-help">
                    Só mude se o detectado estiver errado. Ao escolher um carro, a volta só vale se
                    o replay for desse carro.
                  </span>
                </label>
                <label className="cap-field" htmlFor="cap-track">
                  Escolher outra pista
                  <select
                    id="cap-track"
                    className="a-input"
                    value={trackId}
                    onChange={(e) => setTrackId(e.target.value)}
                  >
                    <option value="">Descobrir sozinho (recomendado)</option>
                    {tracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {trackLabel(t)}
                      </option>
                    ))}
                  </select>
                  <span className="a-help">
                    O app só reconhece pistas em que você já completou uma volta ao vivo.
                  </span>
                </label>
                <label className="cap-field" htmlFor="cap-notes">
                  Notas
                  <textarea
                    id="cap-notes"
                    className="a-input"
                    rows={2}
                    maxLength={500}
                    value={notes}
                    placeholder="acerto, pneus, condições…"
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
              </div>
            </details>

            {error && (
              <p className="a-form-error" role="alert">
                {error}
              </p>
            )}
            {phase === 'stopped' && (
              <div className="cap-stopped">
                <p className="dim">A captura terminou sem salvar nenhuma volta.</p>
                {status && <Issues issues={status.issues} />}
              </div>
            )}
            <button type="submit" className="cap-go" disabled={busy}>
              Capturar esta volta
            </button>
            <p className="dim a-small cap-go-help">
              {detection.kind === 'replay' || detection.kind === 'replayUnknownTrack'
                ? 'Replay pronto: toque e deixe tocar, sem pausar nem avançar.'
                : 'Pode tocar agora: o app espera o replay começar e grava a próxima volta completa.'}
            </p>
          </form>
        </Card>
      )}

      <details className="cap-how">
        <summary>Como funciona e limites</summary>
        <ol className="a-steps-howto">
          <li>
            No jogo, abra o <strong>replay da volta</strong> (Time Trial › Ranking › Replay) e dê
            play. O app percebe sozinho.
          </li>
          <li>
            Deixe tocar a <strong>1×</strong>: <strong>não pause, não volte e não avance</strong>.
            Qualquer salto descarta a volta.
          </li>
          <li>O app grava a volta entre duas passagens pela linha de largada e salva sozinho.</li>
        </ol>
        <p className="dim a-small">
          Se o replay começar no meio da volta, a parte inicial é ignorada e a próxima volta
          completa é gravada. Replays são suavizados: ótimos para aprender frenagens e traçado, não
          para contar milésimos.
        </p>
      </details>

      <ReferenceList
        refs={refs.data}
        error={refs.error}
        loading={refs.loading}
        tracks={tracks}
        drivers={drivers}
        onReload={reloadRefs}
      />
    </div>
  );
}
