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
import { Icon } from '../../components/ui/Icon.tsx';
import { humanizeError } from '../../lib/copy.ts';
import { formatLapTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { parseRoute, routes } from '../../lib/route.ts';
import { useUi } from '../../state/uiStore.ts';
import '../../styles/dailies.css';
import { api } from '../api.ts';
import { BrandLogo } from '../components/BrandLogo.tsx';
import { CarSelect } from '../components/CarSelect.tsx';
import { Panel } from '../components/Panel.tsx';
import { ReferenceList } from '../components/ReferenceList.tsx';
import { ErrorBox, PageHead, useTitle } from '../components/ui.tsx';
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
import { leaderTimeText, matchSavedTrack } from '../lib/dailies.ts';
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

const DETECT_TONE = { ok: 'gain', warn: 'warn', idle: undefined } as const;
const DETECT_BADGE = {
  get ok() {
    return uiText('Pronto');
  },
  get warn() {
    return uiText('Atenção');
  },
  get idle() {
    return uiText('Aguardando');
  },
} as const;

/** Estado do replay: detectado, aguardando ou com problema. */
function DetectionBanner({ view }: { view: DetectionView }) {
  const tone = DETECT_TONE[view.tone];
  return (
    <section className="ui-card cap-detect" data-tone={tone} aria-live="polite">
      <span className="ui-dot" data-tone={tone} aria-hidden="true" />
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
      <span className="ui-badge" data-tone={tone}>
        {DETECT_BADGE[view.tone]}
      </span>
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
        aria-label={uiText('Andamento da captura')}
        aria-valuemin={1}
        aria-valuemax={p.steps.length}
        aria-valuenow={p.step + 1}
        aria-valuetext={uiText(
          'Passo {0} de {1}: {2}',
          p.step + 1,
          p.steps.length,
          uiText(p.steps[p.step]?.label ?? ''),
        )}
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
            <span className="cap-seg-label">{uiText(s.label)}</span>
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
    <div className="ui-card cap-rejected" data-tone="loss" role="alert">
      <strong>{uiText('A última volta foi descartada:')}</strong>
      <ul>
        {issues.map((i) => (
          <li key={i}>{captureIssueLabel(i)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Result: times (measured × typed), car, driver, track and the next steps. */
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
          <Icon name="check" size={16} />
        </span>
        {uiText('Volta salva como referência')}
      </p>
      <p className="cap-saved-time num">{lap ? formatLapTime(lap.timeMs) : '…'}</p>
      <dl className="cap-facts">
        <div>
          <dt>{uiText('Piloto')}</dt>
          <dd>{meta?.driverName ?? status?.driverName ?? '—'}</dd>
        </div>
        <div>
          <dt>{uiText('Carro')}</dt>
          <dd>{lap && carText ? <CarChip carCode={lap.carCode} text={carText} /> : '—'}</dd>
        </div>
        <div>
          <dt>{uiText('Pista')}</dt>
          <dd>{trackName ?? status?.trackName ?? '—'}</dd>
        </div>
        <div>
          <dt>{uiText('Origem do tempo')}</dt>
          <dd>{timeOriginLabel(meta)}</dd>
        </div>
      </dl>
      {measured != null && (
        <dl className="cap-facts cap-timecheck num">
          <div>
            <dt>{uiText('Estimado pela telemetria')}</dt>
            <dd>{formatLapTime(measured)}</dd>
          </div>
          {typed != null && (
            <>
              <div>
                <dt>{uiText('Digitado (ranking)')}</dt>
                <dd>{formatLapTime(typed)}</dd>
              </div>
              <div>
                <dt>{uiText('Diferença')}</dt>
                <dd>{diff != null ? signedMs(diff) : '—'}</dd>
              </div>
            </>
          )}
        </dl>
      )}
      {typed == null && measured != null && (
        <p className="cap-saved-note">
          {uiText('O tempo salvo é uma estimativa entre as duas passagens pela linha de chegada.')}
        </p>
      )}
      <div className="cap-saved-actions">
        {lap && myBest ? (
          <a className="ui-btn" href={routes.compare({ lap: myBest.id, ref: lap.id })}>
            {uiText('Comparar com o meu melhor (')}
            {formatLapTime(myBest.timeMs)})
          </a>
        ) : lap?.trackId ? (
          <a className="ui-btn" href={routes.track(lap.trackId)}>
            {uiText('Ver a pista')}
          </a>
        ) : null}
        <button type="button" className="ui-btn" data-variant="secondary" onClick={onAgain}>
          {uiText('Capturar outra')}
        </button>
      </div>
      {lap && !myBest && (
        <p className="cap-saved-note">
          {uiText('Ainda não há volta sua válida com este carro nesta pista para comparar.')}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

export function CapturePage() {
  useTitle(uiText('Gravar volta de replay'));
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

  // "Usar como referência" on a Daily Race (#/captura?daily=<id>): fills in the first place of the
  // ranking (driver and time) and, when the pilot already has that track saved, selects it.
  const dailyId = useMemo(() => {
    const n = Number(parseRoute(location.hash).query.daily);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, []);
  const daily = useFetch(dailyId === null ? 'capture:no-daily' : 'capture:daily', () =>
    dailyId === null ? Promise.resolve(null) : api.dailyRaces(),
  );
  const dailyRace = useMemo(
    () => (dailyId === null ? null : (daily.data?.races.find((r) => r.id === dailyId) ?? null)),
    [dailyId, daily.data],
  );
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !dailyRace?.leader) return;
    prefilled.current = true;
    setDriver((d) => d || dailyRace.leader!.name);
    setRankingText((t) => t || leaderTimeText(dailyRace.leader!.timeMs));
  }, [dailyRace]);
  useEffect(() => {
    if (!dailyRace || trackId || tracks.length === 0) return;
    const match = matchSavedTrack(dailyRace, tracks);
    if (match) setTrackId(match.id);
  }, [dailyRace, tracks, trackId]);

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
    resolvedCarName(detectedCar) ?? (detectedCar ? uiText('Carro #{0}', detectedCar) : null);
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
      setError(humanizeError(e).text);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      setPolled(await api.stopCapture(true));
    } catch (e) {
      setError(humanizeError(e).text);
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
        title={uiText('Gravar volta de replay')}
        sub={uiText(
          'Assista ao replay de um piloto do topo no jogo e grave a volta dele como referência para o delta ao vivo, a comparação e o coach.',
        )}
      />

      <DetectionBanner view={detection} />

      {phase === 'saved' ? (
        <Panel title={uiText('Resultado')} tone="gain">
          <SavedCard
            lap={savedLap}
            status={status}
            trackName={trackNameOf(savedLap?.trackId ?? null)}
            myBest={myBest}
            onAgain={again}
          />
        </Panel>
      ) : phase === 'running' ? (
        <Panel
          title={uiText('Capturando')}
          description={uiText(
            'Deixe o replay tocar a 1×, sem pausar. O app grava e salva sozinho.',
          )}
          tone="accent"
        >
          {status ? (
            !active ? (
              <p className="cap-now">{uiText('Iniciando a captura…')}</p>
            ) : (
              <>
                <ProgressBar status={status} />
                {status.trackName && (
                  <p className="cap-running-meta">
                    {`${uiText('Pista:')} `}
                    <strong>{status.trackName}</strong>
                  </p>
                )}
                <Issues issues={issues} />
                {status.state === 'recording' && discards > 0 && (
                  <p className="cap-running-meta">
                    {uiText(
                      'Uma tentativa anterior foi descartada; esta é a próxima volta, gravando sozinho.',
                    )}
                  </p>
                )}
                {status.state === 'waitingLapStart' && issues.length > 0 && (
                  <p className="cap-running-meta">
                    {uiText('O app vai gravar a próxima volta sozinho.')}
                  </p>
                )}
              </>
            )
          ) : (
            <ErrorBox
              error="Sem resposta do servidor: a captura precisa do app rodando no PC."
              compact
            />
          )}
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <div className="cap-stop">
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              disabled={busy}
              onClick={stop}
            >
              {uiText('Parar a captura')}
            </button>
          </div>
        </Panel>
      ) : (
        <>
          {dailyRace?.leader && (
            <Panel
              tone="accent"
              title={uiText('Referência da Corrida diária {0}', dailyRace.type)}
              description={uiText(
                '1º lugar: {0} · {1}',
                dailyRace.leader.name,
                formatLapTime(dailyRace.leader.timeMs),
              )}
            >
              <ol className="cap-daily-steps">
                <li>
                  {uiText('No jogo, abra a Corrida diária {0} e entre em Ranking.', dailyRace.type)}
                </li>
                <li>{uiText('Escolha o 1º lugar e toque em Replay.')}</li>
                <li>
                  {uiText(
                    'Volte aqui e toque em Capturar esta volta. O piloto e o tempo já estão preenchidos.',
                  )}
                </li>
              </ol>
              <a href={dailyRace.url} target="_blank" rel="noopener noreferrer">
                {uiText('Ver a corrida no DG EDGE')}
              </a>
            </Panel>
          )}
          <Panel
            title={uiText('Capturar esta volta')}
            description={uiText(
              'Três passos curtos. O app reconhece replay, carro e pista sozinho; o tempo do ranking e o piloto são opcionais.',
            )}
          >
            <form
              className="cap-form"
              onSubmit={(e) => {
                e.preventDefault();
                void start();
              }}
            >
              <section className="cap-block" aria-labelledby="cap-s1">
                <h3 className="cap-block-title" id="cap-s1">
                  <span className="cap-n" aria-hidden="true">
                    1
                  </span>
                  {uiText('Dados do ranking')}
                  <span className="ui-badge">{uiText('opcional')}</span>
                </h3>
                <div className="cap-fields">
                  <div className="ui-field">
                    <label className="ui-label" htmlFor="cap-ranking">
                      {uiText('Tempo do ranking')}
                    </label>
                    <input
                      id="cap-ranking"
                      className="ui-input num"
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
                      className={ranking.kind === 'invalid' ? 'ui-error' : 'ui-help'}
                      role={ranking.kind === 'invalid' ? 'alert' : undefined}
                    >
                      {ranking.kind === 'invalid'
                        ? ranking.message
                        : ranking.kind === 'ok'
                          ? uiText(
                              'Vamos salvar {0} se a estimativa da telemetria ficar a até 0,3 s desse tempo.',
                              ranking.shown,
                            )
                          : uiText(
                              'Copie o tempo oficial do jogo (ex.: 1:30.960). Se deixar em branco, salvamos a estimativa da telemetria.',
                            )}
                    </span>
                  </div>

                  <div className="ui-field">
                    <label className="ui-label" htmlFor="cap-driver">
                      {uiText('Piloto')}
                    </label>
                    <input
                      id="cap-driver"
                      className="ui-input"
                      list="cap-drivers"
                      value={driver}
                      maxLength={80}
                      autoComplete="off"
                      placeholder={uiText('Piloto do replay')}
                      onChange={(e) => setDriver(e.target.value)}
                    />
                    <datalist id="cap-drivers">
                      {drivers.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                    <span className="ui-help">
                      {uiText('Nome que aparece na lista de referências.')}
                    </span>
                  </div>
                </div>
              </section>

              <section className="cap-block" aria-labelledby="cap-s2">
                <h3 className="cap-block-title" id="cap-s2">
                  <span className="cap-n" aria-hidden="true">
                    2
                  </span>
                  {uiText('Detectado automaticamente')}
                </h3>
                <ul className="cap-auto" aria-label={uiText('Detectado automaticamente')}>
                  <li>
                    <span className="cap-auto-k">{uiText('Carro')}</span>
                    {effectiveCarText ? (
                      <CarChip carCode={effectiveCar} text={effectiveCarText} />
                    ) : (
                      <span className="cap-auto-muted">
                        {carChoice === 'none'
                          ? uiText('não informado')
                          : uiText('será reconhecido pelo replay')}
                      </span>
                    )}
                    {carChoice === 'auto' && detectedCar !== null && (
                      <span className="ui-badge" data-tone="gain">
                        {uiText('detectado')}
                      </span>
                    )}
                  </li>
                  <li>
                    <span className="cap-auto-k">{uiText('Pista')}</span>
                    {chosenTrack ? (
                      <span>{trackLabel(chosenTrack)}</span>
                    ) : status?.trackName ? (
                      <>
                        <span>{status.trackName}</span>
                        <span className="ui-badge" data-tone="gain">
                          {uiText('detectada')}
                        </span>
                      </>
                    ) : (
                      <span className="cap-auto-muted">
                        {uiText('será reconhecida pela posição do carro')}
                      </span>
                    )}
                  </li>
                </ul>

                <details
                  className="cap-more"
                  open={moreOpen}
                  onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary>{uiText('Mais detalhes (corrigir carro ou pista, notas)')}</summary>
                  <div className="cap-more-body">
                    <div className="ui-field">
                      <label className="ui-label" htmlFor="cap-car">
                        {uiText('Carro')}
                      </label>
                      <CarSelect
                        id="cap-car"
                        value={carChoiceValue(carChoice)}
                        onChange={(v) => setCarChoice(parseCarChoice(v))}
                        describedBy="cap-car-help"
                        lead={[
                          {
                            value: 'auto',
                            label: detectedCarName
                              ? uiText('Detectado: {0}', detectedCarName)
                              : uiText('Automático (pelo carro do replay)'),
                          },
                          { value: 'none', label: uiText('Não informar') },
                        ]}
                      />
                      <span id="cap-car-help" className="ui-help">
                        {uiText(
                          'Só mude se o detectado estiver errado. Ao escolher um carro, a volta só vale se o replay for desse carro.',
                        )}
                      </span>
                    </div>
                    <div className="ui-field">
                      <label className="ui-label" htmlFor="cap-track">
                        {uiText('Escolher outra pista')}
                      </label>
                      <select
                        id="cap-track"
                        className="ui-select"
                        value={trackId}
                        onChange={(e) => setTrackId(e.target.value)}
                      >
                        <option value="">{uiText('Descobrir sozinho (recomendado)')}</option>
                        {tracks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {trackLabel(t)}
                          </option>
                        ))}
                      </select>
                      <span className="ui-help">
                        {uiText(
                          'O app só reconhece pistas em que você já completou uma volta ao vivo.',
                        )}
                      </span>
                    </div>
                    <div className="ui-field">
                      <label className="ui-label" htmlFor="cap-notes">
                        {uiText('Notas')}
                      </label>
                      <textarea
                        id="cap-notes"
                        className="ui-input"
                        rows={2}
                        maxLength={500}
                        value={notes}
                        placeholder={uiText('acerto, pneus, condições…')}
                        onChange={(e) => setNotes(e.target.value)}
                      />
                    </div>
                  </div>
                </details>
              </section>

              <section className="cap-block" aria-labelledby="cap-s3">
                <h3 className="cap-block-title" id="cap-s3">
                  <span className="cap-n" aria-hidden="true">
                    3
                  </span>
                  {uiText('Iniciar a captura')}
                </h3>
                {error && (
                  <p className="ui-error" role="alert">
                    {error}
                  </p>
                )}
                {phase === 'stopped' && (
                  <div className="cap-stopped">
                    <p>{uiText('A captura terminou sem salvar nenhuma volta.')}</p>
                    {status && <Issues issues={status.issues} />}
                  </div>
                )}
                <button type="submit" className="ui-btn cap-go" data-size="lg" disabled={busy}>
                  {uiText('Capturar esta volta')}
                </button>
                <p className="cap-go-help">
                  {detection.kind === 'replay' || detection.kind === 'replayUnknownTrack'
                    ? uiText('Replay pronto: toque e deixe tocar, sem pausar nem avançar.')
                    : uiText(
                        'Pode tocar agora: o app espera o replay começar e grava a próxima volta completa.',
                      )}
                </p>
              </section>
            </form>
          </Panel>
        </>
      )}

      <details className="cap-how">
        <summary>{uiText('Como funciona e limites')}</summary>
        <div className="cap-how-body">
          <ol className="cap-howto">
            <li>
              {`${uiText('No jogo, abra o')} `}
              <strong>{uiText('replay da volta')}</strong>
              {` ${uiText('(Time Trial › Ranking › Replay) e dê play. O app percebe sozinho.')}`}
            </li>
            <li>
              {`${uiText('Deixe tocar a')} `}
              <strong>1×</strong>: <strong>{uiText('não pause, não volte e não avance')}</strong>
              {uiText('. Qualquer salto descarta a volta.')}
            </li>
            <li>
              {uiText(
                'O app grava a volta entre duas passagens pela linha de largada e salva sozinho.',
              )}
            </li>
          </ol>
          <p className="cap-limits">
            {uiText(
              'Se o replay começar no meio da volta, a parte inicial é ignorada e a próxima volta completa é gravada. Replays são suavizados: ótimos para aprender frenagens e traçado, não para contar milésimos.',
            )}
          </p>
        </div>
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
