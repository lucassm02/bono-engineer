/**
 * #/analysis/lap/:lapId?ref=&modo=&corner= — replay of ONE lap, like the Gran Turismo replay: a dot
 * runs the track while the brake, throttle and steering readouts and charts follow the clock. With
 * a reference (your best lap or a top lap) a ghost runs beside it, at the same distance or at the
 * same lap clock, and the live delta shows where the time goes. The moments the analysis found
 * (events, corners that lose or gain time) jump the replay to the spot.
 */

import type {
  ApiLapAnalysis,
  ApiLapDrivingEvents,
  ApiTraces,
  ApiTrackAnalysis,
  COMPARISON_REFERENCE_KINDS,
  Corner,
  Lap,
  LapComparison,
  MapCorner,
} from '@gt7/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { humanizeError } from '../../lib/copy.ts';
import { formatLapTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { navigate, type Route, routes } from '../../lib/route.ts';
import { THEME } from '../../lib/theme.ts';
import { api } from '../api.ts';
import { CarName } from '../components/CarName.tsx';
import { Panel } from '../components/Panel.tsx';
import { type MapDots, ReplayMap } from '../components/ReplayMap.tsx';
import { FindingList, Readout, type TimeTick, Transport } from '../components/ReplayPanels.tsx';
import { type ChartLap, SyncCharts } from '../components/SyncCharts.tsx';
import { ErrorBox, Loading, PageHead, useTitle } from '../components/ui.tsx';
import { cornerLabel, cornerRange, lapSeries, type PanelDef } from '../lib/chartData.ts';
import { CursorBus } from '../lib/cursorBus.ts';
import { fullTrackName } from '../lib/history.ts';
import { formatDateTime, REFERENCE_KIND_LABELS } from '../lib/labels.ts';
import {
  BIG_STEP_S,
  buildClock,
  DEFAULT_GHOST_MODE,
  followRange,
  frameAt,
  type GhostMode,
  type ReplayFrame,
  type ReplayLapData,
  ReplayPlayer,
  STEP_S,
  shiftSpeed,
  timeAtDistance,
} from '../lib/replay.ts';
import { buildFindings, cornerSeekM, type ReplayFinding } from '../lib/replayFindings.ts';
import { useFetch } from '../useFetch.ts';

type RefKind = (typeof COMPARISON_REFERENCE_KINDS)[number];
const REF_KINDS: RefKind[] = ['auto', 'bestReference', 'personalBest', 'sessionBest'];

/**
 * Channels of the replay (aliases of /api/analysis/traces); `time` is the lap clock per sample.
 * `delta` is added only with a reference (without one the server would pick an automatic one).
 */
export const REPLAY_TRACE_CHANNELS = [
  'speed',
  'throttle',
  'brake',
  'gear',
  'steering',
  'rpm',
  'time',
  'x',
  'z',
] as const;

const SERIES_KEYS = ['speed', 'throttle', 'brake', 'gear', 'steering', 'rpm', 'x', 'z'] as const;

/** Charts shown under the replay (stable reference for SyncCharts). */
const REPLAY_PANELS: readonly PanelDef['key'][] = [
  'speed',
  'brake',
  'throttle',
  'steering',
  'delta',
];

const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function lapTitle(l: Lap): string {
  if (l.isReference) {
    return `${l.referenceMeta?.driverName ?? uiText('Referência')}${l.flags.includes('replay') ? ' (replay)' : ''}`;
  }
  return uiText('Volta {0}', l.number);
}

function lapOptionLabel(l: Lap): string {
  const who = l.isReference
    ? `ref ${l.referenceMeta?.driverName ?? ''}`.trim()
    : `${uiText('volta')} ${l.number} · ${formatDateTime(l.startedAt)}`;
  return `${formatLapTime(l.timeMs)} · ${who}${l.valid ? '' : uiText(' (inválida)')}`;
}

/** One lap of the traces as clock + channels; null when it has no lap clock. */
function lapData(traces: ApiTraces, lapId: string): ReplayLapData | null {
  const clock = buildClock(traces.distanceM, lapSeries(traces, lapId, 'time'));
  if (!clock) return null;
  const series: ReplayLapData['series'] = {};
  for (const key of SERIES_KEYS) series[key] = lapSeries(traces, lapId, key);
  return { clock, series };
}

function hasData(s: ArrayLike<number | null> | undefined): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++)
    if (s[i] !== null && Number.isFinite(s[i] as number)) return true;
  return false;
}

function dotsOf(f: ReplayFrame): MapDots {
  const at = (s: ReplayFrame['subject'] | null) => {
    const x = s?.values.x;
    const z = s?.values.z;
    return x === null || x === undefined || z === null || z === undefined ? null : { x, z };
  };
  return { subject: at(f.subject), ghost: at(f.ghost), distanceM: f.subject.distanceM };
}

// ---------------------------------------------------------------------------------------------
// Page: data
// ---------------------------------------------------------------------------------------------

export function LapReplayPage({ lapId, route }: { lapId: string; route: Route }) {
  const refParam = route.query.ref ?? '';
  useTitle(uiText('Replay da volta'));

  const lap = useFetch(`lap:${lapId}`, () => api.lap(lapId));
  const cmp = useFetch(refParam ? `rcmp:${lapId}:${refParam}` : null, () =>
    api.compare(lapId, refParam),
  );
  // useFetch keeps the last data when its key turns null ("Sem comparação"): ignore it then.
  const cmpData = refParam ? cmp.data : null;
  const cmpError = refParam ? cmp.error : null;
  const refLap = cmpData?.referenceLap ?? null;
  const trackId = lap.data?.trackId ?? null;
  // Wait for the comparison (it resolves "melhor pessoal" etc. to a lap) before loading the traces.
  const readyForTraces = !!lap.data && (!refParam || !!cmpData || !!cmpError);
  const traces = useFetch(readyForTraces ? `rtr:${lapId}:${refLap?.id ?? '-'}` : null, () =>
    refLap
      ? api.traces([lapId, refLap.id], [...REPLAY_TRACE_CHANNELS, 'delta'], refLap.id)
      : api.traces([lapId], REPLAY_TRACE_CHANNELS),
  );
  const track = useFetch(trackId ? `ta:${trackId}` : null, () => api.trackAnalysis(trackId!));
  const events = useFetch(`ev:${lapId}`, () => api.lapEvents(lapId));
  const analysis = useFetch(`la:${lapId}`, () => api.lapAnalysis(lapId));
  const trackLaps = useFetch(trackId ? `tl:${trackId}` : null, () =>
    api.trackLaps(trackId!, { orderBy: 'time', limit: 80 }),
  );

  // Keeps the place in the lap while the reference (and so the traces) is swapped.
  const resumeAt = useRef(0);

  if (lap.error && !lap.data) {
    return (
      <>
        <PageHead
          title={uiText('Replay da volta')}
          back={{ href: routes.home(), label: uiText('Suas pistas') }}
        />
        <ErrorBox error={lap.error} onRetry={lap.reload} />
      </>
    );
  }
  if (!lap.data || !readyForTraces) return <Loading text={uiText('Carregando o replay…')} />;
  if (traces.error && !traces.data) {
    return (
      <>
        <PageHead
          title={uiText('Replay da volta')}
          back={{ href: routes.session(lap.data.sessionId), label: uiText('Sessão') }}
        />
        <ErrorBox error={traces.error} onRetry={traces.reload} />
      </>
    );
  }
  if (!traces.data) return <Loading text={uiText('Carregando a telemetria da volta…')} />;

  return (
    <ReplayView
      key={lapId}
      lap={lap.data}
      refLap={refLap}
      traces={traces.data}
      track={track.data}
      events={events.data}
      analysis={analysis.data}
      comparison={cmpData?.comparison ?? null}
      referenceError={cmpError ? humanizeError(cmpError).text : null}
      trackLaps={trackLaps.data ?? []}
      refParam={refParam}
      mode={route.query.mode === 'time' ? 'time' : DEFAULT_GHOST_MODE}
      initialCorner={route.query.corner ?? null}
      resumeAt={resumeAt}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------------------------

export function ReplayView({
  lap,
  refLap,
  traces,
  track,
  events,
  analysis,
  comparison,
  referenceError,
  trackLaps,
  refParam,
  mode,
  initialCorner,
  resumeAt,
}: {
  lap: Lap;
  refLap: Lap | null;
  traces: ApiTraces;
  track: ApiTrackAnalysis | null;
  events: ApiLapDrivingEvents | null;
  analysis: ApiLapAnalysis | null;
  comparison: LapComparison | null;
  referenceError: string | null;
  trackLaps: Lap[];
  refParam: string;
  mode: GhostMode;
  initialCorner: string | null;
  resumeAt: { current: number };
}) {
  const grid = traces.distanceM;
  const subject = useMemo(() => lapData(traces, lap.id), [traces, lap.id]);
  const ghost = useMemo(() => (refLap ? lapData(traces, refLap.id) : null), [traces, refLap]);
  const lengthM = track?.polyline.lengthM ?? traces.toM;

  if (!subject) {
    return (
      <>
        <PageHead
          title={uiText('Replay da volta')}
          back={{ href: routes.session(lap.sessionId), label: uiText('Sessão') }}
        />
        <div className="ui-empty">
          <strong>{uiText('Esta volta não tem o tempo de cada amostra')}</strong>
          <p>
            {uiText(
              'Sem o relógio da volta não dá para reproduzir. A comparação por distância continua disponível.',
            )}
          </p>
          <a className="ui-btn" href={routes.compare({ lap: lap.id, ref: 'auto' })}>
            {uiText('Comparar volta')}
          </a>
        </div>
      </>
    );
  }
  return (
    <ReplayStage
      lap={lap}
      refLap={ghost ? refLap : null}
      traces={traces}
      grid={grid}
      subject={subject}
      ghost={ghost}
      lengthM={lengthM}
      track={track}
      events={events}
      analysis={analysis}
      comparison={ghost ? comparison : null}
      referenceError={referenceError}
      trackLaps={trackLaps}
      refParam={refParam}
      mode={mode}
      initialCorner={initialCorner}
      resumeAt={resumeAt}
    />
  );
}

function ReplayStage({
  lap,
  refLap,
  traces,
  grid,
  subject,
  ghost,
  lengthM,
  track,
  events,
  analysis,
  comparison,
  referenceError,
  trackLaps,
  refParam,
  mode,
  initialCorner,
  resumeAt,
}: {
  lap: Lap;
  refLap: Lap | null;
  traces: ApiTraces;
  grid: number[];
  subject: ReplayLapData;
  ghost: ReplayLapData | null;
  lengthM: number;
  track: ApiTrackAnalysis | null;
  events: ApiLapDrivingEvents | null;
  analysis: ApiLapAnalysis | null;
  comparison: LapComparison | null;
  referenceError: string | null;
  trackLaps: Lap[];
  refParam: string;
  mode: GhostMode;
  initialCorner: string | null;
  resumeAt: { current: number };
}) {
  const bus = useMemo(() => new CursorBus(), []);
  const player = useMemo(
    () => new ReplayPlayer(subject.clock.durationS),
    [subject.clock.durationS],
  );
  const [range, setRange] = useState<[number, number] | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const corners: MapCorner[] = useMemo(() => {
    if (track?.corners.length) return track.corners;
    return (
      comparison?.rows.map((r) => ({ ...r.corner, apexX: Number.NaN, apexZ: Number.NaN })) ?? []
    );
  }, [track, comparison]);

  const frame = useCallback(
    (t: number) => frameAt(grid, subject, ghost, mode, t),
    [grid, subject, ghost, mode],
  );

  // Keeps the place in the lap when the reference changes; frees the player when leaving.
  useEffect(() => {
    player.seek(resumeAt.current);
    return () => {
      resumeAt.current = player.state.timeS;
      player.dispose();
    };
  }, [player, resumeAt]);

  // The map dots and the chart cursor follow the player (outside React: frame rate).
  const drawRef = useRef<((d: MapDots) => void) | null>(null);
  const bindDraw = useCallback((fn: (d: MapDots) => void) => {
    drawRef.current = fn;
    return () => {
      if (drawRef.current === fn) drawRef.current = null;
    };
  }, []);
  useEffect(() => {
    const apply = () => {
      const f = frame(player.state.timeS);
      drawRef.current?.(dotsOf(f));
      bus.set(f.subject.distanceM, 'map');
      if (player.state.playing && rangeRef.current) {
        const next = followRange(rangeRef.current, f.subject.distanceM, lengthM);
        if (next !== rangeRef.current) setRange(next);
      }
    };
    apply();
    return player.subscribe(apply);
  }, [player, frame, bus, lengthM]);

  // A new zoom range moves the x scale of the charts after this commit: put the cursor back on the
  // car so it does not stay where the old scale had it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: range is the trigger
  useEffect(() => {
    const id = setTimeout(() => {
      const d = frame(player.state.timeS).subject.distanceM;
      bus.set(null, 'map');
      bus.set(d, 'map');
    }, 0);
    return () => clearTimeout(id);
  }, [range, frame, player, bus]);

  const seekDistance = useCallback(
    (d: number) => player.seek(timeAtDistance(subject.clock, d)),
    [player, subject],
  );

  const scrollToStage = useCallback(() => {
    document
      .querySelector('.rp-stage')
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, []);

  const goToCorner = useCallback(
    (c: Corner) => {
      const row = comparison?.rows.find((r) => r.corner.id === c.id);
      player.pause();
      seekDistance(cornerSeekM(c, row?.zone, row?.a.brakePointM));
      setFocus(c.id);
      setSelected(null);
      setRange(cornerRange(c, row, lengthM));
    },
    [comparison, lengthM, player, seekDistance],
  );

  // ?corner= deep link: once per value, as soon as the corners are known (the track may load later).
  const appliedCorner = useRef<string | null>(null);
  useEffect(() => {
    if (!initialCorner || appliedCorner.current === initialCorner) return;
    const c = corners.find((x) => x.id === initialCorner);
    if (!c) return;
    appliedCorner.current = initialCorner;
    goToCorner(c);
  }, [initialCorner, corners, goToCorner]);

  const openFinding = useCallback(
    (f: ReplayFinding) => {
      player.pause();
      seekDistance(f.distanceM);
      setSelected(f.id);
      setFocus(f.cornerId);
      setRange(f.range);
    },
    [player, seekDistance],
  );

  const findings = useMemo(
    () =>
      buildFindings({
        lengthM,
        corners,
        events: events?.events ?? null,
        comparison,
        issues: analysis && !analysis.validity.valid ? analysis.validity.issues : null,
      }),
    [lengthM, corners, events, comparison, analysis],
  );
  const wrong = findings.filter((f) => f.tone !== 'good');
  const right = findings.filter((f) => f.tone === 'good');
  const ticks: TimeTick[] = useMemo(
    () =>
      findings.map((f) => ({
        timeS: timeAtDistance(subject.clock, f.distanceM),
        tone: f.tone,
      })),
    [findings, subject],
  );
  const timeOf = useCallback((d: number) => timeAtDistance(subject.clock, d), [subject]);

  // Keyboard: Space / K play-pause, ← → step (Shift = 1 s), [ ] speed, G ghost mode.
  const setMode = useCallback(
    (m: GhostMode) =>
      navigate(routes.replay(lap.id, { ref: refParam || undefined, mode: m }), true),
    [lap.id, refParam],
  );
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const hasGhost = !!ghost;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.closest('input, textarea, select, [contenteditable]')) return;
      const onControl = !!el?.closest('button, a, summary');
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === ' ' || key === 'k') {
        if (onControl) return;
        e.preventDefault();
        player.toggle();
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        e.preventDefault();
        player.pause();
        player.step((key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? BIG_STEP_S : STEP_S));
      } else if (key === '[' || key === ']') {
        player.setSpeed(shiftSpeed(player.state.speed, key === ']' ? 1 : -1));
      } else if (key === 'g' && hasGhost) {
        setMode(modeRef.current === 'time' ? 'distance' : 'time');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [player, hasGhost, setMode]);

  const setRef = (v: string) =>
    navigate(
      routes.replay(lap.id, { ref: v || undefined, mode: mode === 'time' ? 'time' : undefined }),
      true,
    );

  const chartLaps: ChartLap[] = useMemo(
    () => [
      {
        id: lap.id,
        label: uiText('Você · {0} · {1}', lapTitle(lap), formatLapTime(lap.timeMs)),
        color: THEME.chart1,
      },
      ...(refLap
        ? [
            {
              id: refLap.id,
              label: uiText('Ref · {0} · {1}', lapTitle(refLap), formatLapTime(refLap.timeMs)),
              color: THEME.chart2,
            },
          ]
        : []),
    ],
    [lap, refLap],
  );

  const onRange = useCallback((r: [number, number] | null) => {
    setRange(r);
    if (!r) {
      setFocus(null);
      setSelected(null);
    }
  }, []);

  const hasRpm = hasData(subject.series.rpm);
  const steerFullRad = useMemo(() => {
    let m = 0;
    for (const v of subject.series.steering ?? [])
      if (v !== null && Math.abs(v) > m) m = Math.abs(v);
    return Math.max(m, 0.5);
  }, [subject]);
  const otherLaps = trackLaps.filter((l) => l.id !== lap.id);
  const initialDots = useMemo(() => dotsOf(frame(player.state.timeS)), [frame, player]);
  const trackName = track ? fullTrackName(track.track) : (lap.trackId ?? '');

  return (
    <div className="rp-page">
      <PageHead
        back={{ href: routes.session(lap.sessionId), label: uiText('Sessão') }}
        title={
          <>
            {`${uiText('Replay')} `}
            <span className="dim">· {trackName}</span>
          </>
        }
        sub={
          <>
            <CarName carCode={lap.carCode} logoSize={20} /> {'· '}
            {lapTitle(lap)} · {formatLapTime(lap.timeMs)} · {formatDateTime(lap.startedAt)}
            {!lap.valid && (
              <>
                {' '}
                <span className="ui-badge" data-tone="loss">
                  {uiText('inválida')}
                </span>
              </>
            )}
          </>
        }
        actions={
          <a
            className="ui-btn"
            data-variant="secondary"
            href={routes.compare({ lap: lap.id, ref: refLap?.id ?? 'auto' })}
          >
            {uiText('Comparar volta')}
          </a>
        }
      />

      <Panel
        title={uiText('Comparar com')}
        description={uiText(
          'Escolha uma volta de referência para ver o fantasma dela correndo junto e o delta ao vivo.',
        )}
        className="rp-compare"
      >
        <div className="rp-compare-grid">
          <label className="ui-field">
            <span className="ui-label">{uiText('Referência')}</span>
            <select className="ui-select" value={refParam} onChange={(e) => setRef(e.target.value)}>
              <option value="">{uiText('Sem comparação')}</option>
              {REF_KINDS.map((k) => (
                <option key={k} value={k}>
                  {REFERENCE_KIND_LABELS[k]}
                </option>
              ))}
              {refParam &&
                !REF_KINDS.includes(refParam as RefKind) &&
                !otherLaps.some((l) => l.id === refParam) &&
                refLap && <option value={refParam}>{lapOptionLabel(refLap)}</option>}
              {otherLaps.length > 0 && (
                <optgroup label={uiText('Outra volta desta pista')}>
                  {otherLaps.map((l) => (
                    <option key={l.id} value={l.id}>
                      {lapOptionLabel(l)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {refLap && (
              <span className="ui-help">
                <i className="cmp-swatch" style={{ background: THEME.chart2 }} /> {lapTitle(refLap)}{' '}
                · {formatLapTime(refLap.timeMs)}
              </span>
            )}
          </label>
          {refLap && (
            <fieldset className="ui-field rp-mode">
              <legend className="ui-label">{uiText('Fantasma')}</legend>
              <div className="ui-segmented rp-mode-seg">
                <button
                  type="button"
                  aria-pressed={mode === 'distance'}
                  onClick={() => setMode('distance')}
                >
                  {uiText('Mesma distância')}
                </button>
                <button
                  type="button"
                  aria-pressed={mode === 'time'}
                  onClick={() => setMode('time')}
                >
                  {uiText('Mesmo tempo')}
                </button>
              </div>
              <span className="ui-help">
                {mode === 'distance'
                  ? uiText(
                      'A referência fica no mesmo ponto da pista: compara o que cada um fez ali.',
                    )
                  : uiText(
                      'A referência corre no mesmo relógio: mostra quem está à frente na pista.',
                    )}
              </span>
            </fieldset>
          )}
        </div>
        {referenceError && (
          <p className="a-note" role="note">
            {referenceError} {uiText('O replay segue sem referência.')}
          </p>
        )}
      </Panel>

      <div className="rp-stage">
        <section className="ui-card rp-mapbox" aria-label={uiText('Mapa e controles do replay')}>
          <ReplayMap
            outline={track ? { x: track.polyline.x, z: track.polyline.z } : null}
            gridM={grid}
            subject={{
              x: subject.series.x ?? [],
              z: subject.series.z ?? [],
              color: THEME.chart1,
            }}
            ghost={
              ghost
                ? { x: ghost.series.x ?? [], z: ghost.series.z ?? [], color: THEME.chart2 }
                : null
            }
            corners={corners}
            focusCorner={focus}
            bindDraw={bindDraw}
            initial={initialDots}
            onCorner={(id) => {
              const c = corners.find((x) => x.id === id);
              if (c) goToCorner(c);
            }}
            onSeek={seekDistance}
          />
          <Transport player={player} frameAt={frame} ticks={ticks} />
        </section>
        <section className="ui-card rp-readbox">
          <Readout
            player={player}
            frameAt={frame}
            hasRpm={hasRpm}
            steerFullRad={steerFullRad}
            mode={mode}
            subjectLabel={uiText('Você · {0}', lapTitle(lap))}
            ghostLabel={refLap ? uiText('Ref · {0}', lapTitle(refLap)) : null}
          />
        </section>
      </div>

      {corners.length > 0 && (
        <nav className="rp-corners" aria-label={uiText('Ir para uma curva')}>
          <span className="rp-corners-label">{uiText('Curvas')}</span>
          <ul>
            {corners.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="ui-chip"
                  aria-pressed={focus === c.id}
                  title={cornerLabel(c)}
                  onClick={() => goToCorner(c)}
                >
                  {c.id}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="rp-findings-grid">
        <Panel
          title={uiText('O que errou')}
          description={uiText(
            'Escapadas e curvas onde esta volta perdeu tempo. Toque para ir ao ponto.',
          )}
          className="rp-wrong"
        >
          <FindingList
            findings={wrong}
            selectedId={selected}
            timeOf={timeOf}
            onOpen={(f) => {
              openFinding(f);
              scrollToStage();
            }}
            empty={
              events || comparison
                ? uiText('Nada de errado encontrado nesta volta.')
                : uiText('Carregando a análise da volta…')
            }
          />
        </Panel>
        <Panel
          title={uiText('O que acertou')}
          description={uiText('Curvas em que esta volta ganhou tempo sobre a referência.')}
          className="rp-right"
        >
          <FindingList
            findings={right}
            selectedId={selected}
            timeOf={timeOf}
            onOpen={(f) => {
              openFinding(f);
              scrollToStage();
            }}
            empty={
              comparison
                ? uiText('Nenhuma curva ganhou tempo sobre a referência.')
                : uiText('Escolha uma referência para ver onde você ganhou tempo.')
            }
          />
        </Panel>
      </div>

      <div className="rp-charts">
        <SyncCharts
          traces={traces}
          laps={chartLaps}
          refId={refLap?.id ?? ''}
          corners={corners}
          range={range}
          onRange={onRange}
          bus={bus}
          focusCorner={focus}
          panelKeys={REPLAY_PANELS}
          onSeek={seekDistance}
          toolbar={
            range && (
              <span className="cmp-zoom">
                {focus
                  ? cornerLabel(corners.find((x) => x.id === focus) ?? { id: focus, name: null })
                  : uiText('Trecho')}
                : {Math.round(range[0])}–{Math.round(range[1])} m
                <button
                  type="button"
                  className="ui-btn"
                  data-variant="secondary"
                  data-size="sm"
                  onClick={() => onRange(null)}
                >
                  {uiText('Volta inteira')}
                </button>
              </span>
            )
          }
        />
        <p className="ui-help">
          {uiText('Toque ou clique num gráfico para levar o replay até aquele ponto.')}
        </p>
      </div>
    </div>
  );
}
