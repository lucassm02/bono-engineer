/**
 * #/analysis/compare?lap=&ref=&extra=&corner= — the learning page: summary, synced traces by
 * distance, track map coloured by microsectors, corner table and ranked findings.
 */

import type {
  ApiComparison,
  ApiLapDrivingEvents,
  ApiMicrosectors,
  ApiTraces,
  ApiTrackAnalysis,
  COMPARISON_REFERENCE_KINDS,
  DrivingEvent,
  EngineerRadioLog,
  Lap,
  MapColorMode,
  MapCorner,
} from '@gt7/shared';
import { lateralDifference, lateralMarkers, lateralSide, seriesRange } from '@gt7/shared';
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/ui/Icon.tsx';
import { humanizeError } from '../../lib/copy.ts';
import { formatDelta, formatFixed, formatLapTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { navigate, type Route, routes } from '../../lib/route.ts';
import { THEME } from '../../lib/theme.ts';
import { startDrill, useDrill } from '../../state/drill.ts';
import { flushEngineerJournal } from '../../state/engineerJournal.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api, urls } from '../api.ts';
import { CarName } from '../components/CarName.tsx';
import {
  type BrakeMarker,
  CompareMap,
  type MapLine,
  type OverlayMarker,
} from '../components/CompareMap.tsx';
import { ComparePicker } from '../components/ComparePicker.tsx';
import { CornerLossPanel } from '../components/CornerLossPanel.tsx';
import { CornerTable } from '../components/CornerTable.tsx';
import { DrivingEventsPanel } from '../components/DrivingEventsPanel.tsx';
import { EngineerRadioReview } from '../components/EngineerRadioReview.tsx';
import { FindingsPanel } from '../components/FindingsPanel.tsx';
import { Panel } from '../components/Panel.tsx';
import { type ChartLap, SyncCharts } from '../components/SyncCharts.tsx';
import { ErrorBox, Loading, PageHead, useTitle } from '../components/ui.tsx';
import {
  COMPARE_TRACE_CHANNELS,
  cornerLabel,
  cornerRange,
  EVENT_TRACE_CHANNELS,
  eventRange,
  lapSeries,
  mergeEventTraces,
  timeTone,
} from '../lib/chartData.ts';
import { CursorBus } from '../lib/cursorBus.ts';
import { formatDateTime, REFERENCE_KIND_LABELS } from '../lib/labels.ts';
import { type MapRamp, type RampMode, rampGradient } from '../lib/mapRamp.ts';
import { useFetch } from '../useFetch.ts';

type RefKind = (typeof COMPARISON_REFERENCE_KINDS)[number];
const REF_KINDS: RefKind[] = ['auto', 'bestReference', 'personalBest', 'sessionBest'];

/** Volta analisada = ciano, referência = roxo, extras = laranja e azul (SERIES_COLORS). */
export const LAP_COLORS = {
  subject: THEME.chart1,
  reference: THEME.chart2,
  extra: [THEME.chart3, THEME.chart4, THEME.chart5],
} as const;

const MAX_EXTRA = 2;

/** Per-sample colouring of your line on the map, plus the lateral difference to the reference. */
interface MapOverlay {
  diff: (number | null)[];
  values?: (number | null)[];
  ramp?: MapRamp;
}

/** What the colour of your line on the map can show (spec 17). */
const MAP_MODES: { id: MapColorMode; label: string }[] = [
  {
    id: 'time',
    get label() {
      return uiText('Ganho e perda');
    },
  },
  {
    id: 'lines',
    get label() {
      return uiText('Linhas');
    },
  },
  {
    id: 'speed',
    get label() {
      return uiText('Velocidade');
    },
  },
  {
    id: 'brake',
    get label() {
      return uiText('Freio');
    },
  },
  {
    id: 'throttle',
    get label() {
      return uiText('Acelerador');
    },
  },
  {
    id: 'diff',
    get label() {
      return uiText('Diferença de linha');
    },
  },
];

/** The ends of the colour legend, in the unit of the channel. */
function rampEnd(mode: RampMode, end: 'lo' | 'hi', v: number): string {
  if (mode === 'speed') return `${Math.round(v)} km/h`;
  if (mode === 'diff') return end === 'lo' ? '0 m' : `${formatFixed(v, 1)} m`;
  return `${Math.round(v * 100)}%`;
}

export interface CompareData {
  cmp: ApiComparison;
  traces: ApiTraces | null;
  track: ApiTrackAnalysis | null;
  micro: ApiMicrosectors | null;
  theoretical: { theoreticalBestMs: number; bestLapMs: number; laps: number } | null;
  radio?: EngineerRadioLog[];
  /** Driving events of the subject lap (null while loading or unavailable). */
  events?: ApiLapDrivingEvents | null;
}

function lapOptionLabel(l: Lap): string {
  const who = l.isReference
    ? `ref ${l.referenceMeta?.driverName ?? ''}`.trim()
    : `volta ${l.number} · ${formatDateTime(l.startedAt)}`;
  return `${formatLapTime(l.timeMs)} · ${who}${l.valid ? '' : uiText(' (inválida)')}`;
}

function lapTitle(l: Lap): string {
  if (l.isReference) {
    return `${l.referenceMeta?.driverName ?? uiText('Referência')}${l.flags.includes('replay') ? ' (replay)' : ''}`;
  }
  return uiText('Volta {0}', l.number);
}

export function ComparePage({ route }: { route: Route }) {
  const lapId = route.query.lap ?? '';
  const ref = route.query.ref || 'auto';
  const extra = useMemo(
    () => (route.query.extra ?? '').split(',').filter(Boolean).slice(0, MAX_EXTRA),
    [route.query.extra],
  );
  useTitle(uiText('Comparação de voltas'));

  const cmp = useFetch(lapId ? `cmp:${lapId}:${ref}` : null, () => api.compare(lapId, ref));
  const radio = useFetch(lapId ? `radio:${lapId}` : null, async () => {
    await flushEngineerJournal();
    return api.engineerRadio(lapId);
  });
  const refId = cmp.data?.referenceLap.id ?? null;
  const trackId = cmp.data?.lap.trackId ?? null;
  const lapIds = useMemo(
    () => (refId ? [lapId, refId, ...extra.filter((e) => e !== lapId && e !== refId)] : []),
    [lapId, refId, extra],
  );
  const traces = useFetch(refId ? `tr:${lapIds.join(',')}` : null, () =>
    api.traces(lapIds, COMPARE_TRACE_CHANNELS, refId!),
  );
  const track = useFetch(trackId ? `ta:${trackId}` : null, () => api.trackAnalysis(trackId!));
  const micro = useFetch(refId ? `ms:${lapId}:${refId}` : null, () =>
    api.microsectors([lapId], refId!),
  );
  const sessionId = cmp.data?.lap.sessionId ?? null;
  const theo = useFetch(sessionId ? `theo:${sessionId}` : null, async () => {
    const s = await api.session(sessionId!);
    const ids = s.laps
      .filter((l) => l.valid && !l.isReference)
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, 20)
      .map((l) => l.id);
    if (ids.length === 0) return null;
    const m = await api.microsectors(ids);
    return {
      theoreticalBestMs: m.report.theoreticalBestMs,
      bestLapMs: m.report.bestLapMs,
      laps: ids.length,
    };
  });
  const events = useFetch(lapId ? `ev:${lapId}` : null, () => api.lapEvents(lapId));
  const trackLaps = useFetch(trackId ? `tl:${trackId}` : null, () =>
    api.trackLaps(trackId!, { orderBy: 'time', limit: 80 }),
  );

  if (!lapId) {
    return (
      <>
        <PageHead
          title={uiText('Comparação de voltas')}
          back={{ href: routes.home(), label: uiText('Suas pistas') }}
        />
        <ComparePicker />
      </>
    );
  }
  if (cmp.error && !cmp.data) {
    return (
      <>
        <PageHead
          title={uiText('Comparação de voltas')}
          back={{ href: routes.home(), label: uiText('Suas pistas') }}
        />
        <ErrorBox error={cmp.error} onRetry={cmp.reload} />
        {ref !== 'auto' && (
          <p>
            <a
              className="ui-btn"
              data-variant="secondary"
              href={routes.compare({ lap: lapId, ref: 'auto', extra })}
            >
              {uiText('Tentar com a referência automática')}
            </a>
          </p>
        )}
      </>
    );
  }
  if (!cmp.data) return <Loading text={uiText('Comparando as voltas…')} />;

  return (
    <CompareView
      data={{
        cmp: cmp.data,
        traces: traces.data,
        track: track.data,
        micro: micro.data,
        theoretical: theo.data ?? null,
        radio: radio.data ?? undefined,
        events: events.data,
      }}
      tracesError={traces.error ? humanizeError(traces.error).text : null}
      trackLaps={trackLaps.data ?? []}
      refParam={ref}
      extra={extra}
      initialCorner={route.query.corner ?? null}
    />
  );
}

export function CompareView({
  data,
  tracesError,
  trackLaps,
  refParam,
  extra,
  initialCorner,
  demo = false,
}: {
  data: CompareData;
  tracesError: string | null;
  trackLaps: Lap[];
  refParam: string;
  extra: string[];
  initialCorner: string | null;
  demo?: boolean;
}) {
  const { cmp, traces, track, micro, theoretical, radio, events } = data;
  const c = cmp.comparison;
  const lap = cmp.lap;
  const refLap = cmp.referenceLap;
  const bus = useMemo(() => new CursorBus(), []);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const lengthM = c.lengthM ?? track?.polyline.lengthM ?? traces?.toM ?? 0;
  const [selectedEvent, setSelectedEvent] = useState<DrivingEvent | null>(null);
  const [eventTracesOn, setEventTracesOn] = useState(false);
  const traceLapIds = useMemo(() => traces?.laps.map((l) => l.lapId) ?? [], [traces]);
  // Yaw and wheel slip load on the first "Ver traços", on the same grid as the other charts.
  const eventTraces = useFetch(
    eventTracesOn && !demo && traceLapIds.length ? `etr:${traceLapIds.join(',')}` : null,
    () => api.traces(traceLapIds, EVENT_TRACE_CHANNELS, refLap.id),
  );
  const chartTraces = useMemo(
    () => (traces ? mergeEventTraces(traces, eventTraces.data) : null),
    [traces, eventTraces.data],
  );
  const radioMarkers = useMemo(
    () =>
      radio
        ?.filter((log) => log.referenceLapId === refLap.id)
        .flatMap((log) => log.calls.map((call) => call.distanceM)),
    [radio, refLap.id],
  );

  const corners: MapCorner[] = useMemo(() => {
    if (track?.corners.length) return track.corners;
    return c.rows.map((r) => ({ ...r.corner, apexX: Number.NaN, apexZ: Number.NaN }));
  }, [track, c.rows]);

  const zoomCorner = useCallback(
    (id: string) => {
      const row = c.rows.find((r) => r.corner.id === id);
      const corner = row?.corner ?? corners.find((x) => x.id === id);
      if (!corner) return;
      setFocus(id);
      setRange(cornerRange(corner, row, lengthM));
      document.querySelector('.cmp-visual')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [c.rows, corners, lengthM],
  );

  // ?corner= deep link (from the coach / track page).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per comparison
  useEffect(() => {
    if (initialCorner && c.rows.some((r) => r.corner.id === initialCorner)) {
      const row = c.rows.find((r) => r.corner.id === initialCorner)!;
      setFocus(initialCorner);
      setRange(cornerRange(row.corner, row, lengthM));
    }
  }, [c.lapA, c.lapB]);

  const onRange = useCallback((r: [number, number] | null) => {
    setRange(r);
    if (!r) {
      setFocus(null);
      setSelectedEvent(null);
    }
  }, []);

  const openEvent = useCallback(
    (e: DrivingEvent) => {
      setSelectedEvent(e);
      setEventTracesOn(true);
      setFocus(e.cornerId);
      setRange(eventRange(e, lengthM));
      document.querySelector('.cmp-visual')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    [lengthM],
  );

  const extraLaps = useMemo(
    () =>
      extra
        .map((id) => trackLaps.find((l) => l.id === id))
        .filter((l): l is Lap => !!l && l.id !== lap.id && l.id !== refLap.id),
    [extra, trackLaps, lap.id, refLap.id],
  );

  const chartLaps: ChartLap[] = useMemo(
    () => [
      {
        id: lap.id,
        label: uiText('Você · {0} · {1}', lapTitle(lap), formatLapTime(lap.timeMs)),
        color: LAP_COLORS.subject,
      },
      {
        id: refLap.id,
        label: uiText('Ref · {0} · {1}', lapTitle(refLap), formatLapTime(refLap.timeMs)),
        color: LAP_COLORS.reference,
      },
      ...extra
        .filter((id) => id !== lap.id && id !== refLap.id)
        .map((id, k) => {
          const l = trackLaps.find((x) => x.id === id);
          return {
            id,
            label: l ? `${lapTitle(l)} · ${formatLapTime(l.timeMs)}` : uiText('Volta {0}', id),
            color: LAP_COLORS.extra[k] ?? THEME.text3,
            dash: [5, 4],
          };
        }),
    ],
    [lap, refLap, extra, trackLaps],
  );

  const [mapMode, setMapMode] = useState<MapColorMode>('time');
  // What the colour of your line shows (spec 17): the channel values, scaled to a ramp.
  const overlay = useMemo((): MapOverlay | null => {
    if (!traces) return null;
    const diff = lateralDifference(
      lapSeries(traces, lap.id, 'offset'),
      lapSeries(traces, refLap.id, 'offset'),
    );
    const series = (key: string, scale = 1) => lapSeries(traces, lap.id, key, scale);
    if (mapMode === 'speed') {
      const values = series('speed');
      const r = seriesRange(values);
      return r ? { values, ramp: { mode: 'speed', lo: r[0], hi: r[1] }, diff } : { diff };
    }
    if (mapMode === 'brake') {
      return { values: series('brake'), ramp: { mode: 'brake', lo: 0, hi: 1 }, diff };
    }
    if (mapMode === 'throttle') {
      return { values: series('throttle'), ramp: { mode: 'throttle', lo: 0, hi: 1 }, diff };
    }
    if (mapMode === 'diff') {
      const r = seriesRange(
        diff.map((v) => (v === null ? null : Math.abs(v))),
        0,
        98,
      );
      return { values: diff, ramp: { mode: 'diff', lo: 0, hi: Math.max(1, r?.[1] ?? 1) }, diff };
    }
    return { diff };
  }, [traces, mapMode, lap.id, refLap.id]);

  const mapLines: MapLine[] = useMemo(() => {
    if (!traces) return [];
    const subjectColors =
      mapMode === 'time' ? (micro?.colors.find((x) => x.lapId === lap.id)?.colors ?? null) : null;
    return chartLaps.slice(0, 2).map((l, i) => ({
      id: l.id,
      color: l.color,
      x: lapSeries(traces, l.id, 'x'),
      z: lapSeries(traces, l.id, 'z'),
      colors: i === 0 ? subjectColors : null,
      ...(i === 0 && overlay?.ramp ? { values: overlay.values, ramp: overlay.ramp } : {}),
      width: i === 0 ? 3.4 : 2,
    }));
  }, [traces, micro, chartLaps, lap.id, mapMode, overlay]);

  // The larger differences get a text label, so the map does not rely on colour alone.
  const diffMarkers = useMemo(
    () =>
      overlay && traces && mapMode === 'diff' ? lateralMarkers(traces.distanceM, overlay.diff) : [],
    [overlay, traces, mapMode],
  );
  const overlayMarkers: OverlayMarker[] = useMemo(
    () =>
      diffMarkers.map((m) => {
        const s = lateralSide(m.diffM);
        return {
          distanceM: m.distanceM,
          label: uiText(
            s.side === 'left' ? '{0} m à esquerda' : '{0} m à direita',
            formatFixed(s.meters, 1),
          ),
        };
      }),
    [diffMarkers],
  );

  const brakeMarkers: BrakeMarker[] = useMemo(() => {
    const out: BrakeMarker[] = [];
    for (const r of c.rows) {
      if (r.a.brakePointM !== null) {
        out.push({
          lineId: lap.id,
          distanceM: r.a.brakePointM,
          color: LAP_COLORS.subject,
          label: `F ${r.corner.id}`,
        });
      }
      if (r.b.brakePointM !== null) {
        out.push({
          lineId: refLap.id,
          distanceM: r.b.brakePointM,
          color: LAP_COLORS.reference,
          label: uiText('F ref'),
        });
      }
    }
    return out;
  }, [c.rows, lap.id, refLap.id]);

  const setRef = (v: string) => navigate(routes.compare({ lap: lap.id, ref: v, extra }), true);
  const addExtra = (id: string) =>
    navigate(
      routes.compare({ lap: lap.id, ref: refParam, extra: [...extra, id].slice(0, MAX_EXTRA) }),
      true,
    );
  const removeExtra = (id: string) =>
    navigate(
      routes.compare({ lap: lap.id, ref: refParam, extra: extra.filter((x) => x !== id) }),
      true,
    );

  const findings = c.keyFindings?.length ? c.keyFindings : (c.findings ?? []);
  const sectorDeltas = c.sectorDeltasMs ?? [];
  const isReplay = !!c.referenceIsReplay;
  const otherLaps = trackLaps.filter((l) => l.id !== lap.id);
  const [drilling, setDrilling] = useState<string | null>(null);
  const drillCorner = useCallback(async (cornerId: string) => {
    setDrilling(cornerId);
    await startDrill(cornerId, null);
    setDrilling(null);
    if (useDrill.getState().drill?.cornerId === cornerId) {
      addNotice(
        'info',
        uiText('Treino de {0} iniciado. Volte à tela ao vivo e passe pela curva.', cornerId),
        7000,
      );
    }
  }, []);
  const resetRange = () => {
    setRange(null);
    setFocus(null);
    setSelectedEvent(null);
  };
  const warnings = [
    ...c.warnings,
    ...(isReplay && !c.warnings.some((w) => /replay/i.test(w))
      ? [uiText('Referência de replay: entradas suavizadas, precisão de alguns metros.')]
      : []),
  ];

  return (
    <div className="cmp-page">
      <PageHead
        back={{ href: routes.session(lap.sessionId), label: uiText('Sessão') }}
        title={
          <>
            {`${uiText('Comparação')} `}
            <span className="dim">· {track?.track.name ?? lap.trackId ?? ''}</span>
          </>
        }
        sub={
          <>
            <CarName carCode={lap.carCode} logoSize={20} />
            {lap.carCode !== refLap.carCode && (
              <>
                {' × '}
                <CarName
                  carCode={refLap.carCode}
                  name={refLap.referenceMeta?.carName}
                  logoSize={20}
                />
              </>
            )}{' '}
            {`${uiText('· referência:')} `}
            {REFERENCE_KIND_LABELS[cmp.referenceKind]}
            {demo && (
              <>
                {' '}
                <span className="ui-badge" data-tone="warn">
                  {uiText('demonstração')}
                </span>
              </>
            )}
          </>
        }
        actions={
          !demo && (
            <>
              <a
                className="ui-btn"
                data-variant="secondary"
                href={urls.chartPng(lap.id, refLap.id, focus ?? undefined)}
                target="_blank"
                rel="noopener"
              >
                {uiText('Gerar gráfico (PNG)')}
              </a>
              <a
                className="ui-btn"
                data-variant="secondary"
                href={routes.replay(lap.id, { ref: refLap.id })}
              >
                {uiText('Ver replay da volta')}
              </a>
              <a
                className="ui-btn"
                href={routes.coach({
                  session: lap.sessionId,
                  lap: lap.id,
                  ref: refLap.id,
                  corner: focus ?? undefined,
                })}
              >
                {uiText('Debrief com IA')}
              </a>
            </>
          )
        }
      />

      <Panel
        title={uiText('Voltas comparadas')}
        description={uiText(
          'A volta analisada fica fixa. Escolha contra qual referência medir e, se quiser, sobreponha até duas outras voltas nos gráficos.',
        )}
      >
        <div className="cmp-picker-grid">
          <div className="ui-field">
            <span className="ui-label">{uiText('Volta analisada')}</span>
            <div className="cmp-lapbox">
              <i className="cmp-swatch" style={{ background: LAP_COLORS.subject }} />
              <span className="cmp-lapbox-text">
                <strong>{lapTitle(lap)}</strong>
                <span className="cmp-lapbox-time">{formatLapTime(lap.timeMs)}</span>
                {!lap.valid && (
                  <span className="ui-badge" data-tone="loss">
                    {uiText('inválida')}
                  </span>
                )}
              </span>
              <a
                className="ui-btn"
                data-variant="ghost"
                data-size="sm"
                href={routes.session(lap.sessionId)}
              >
                {uiText('Trocar')}
              </a>
            </div>
          </div>
          <label className="ui-field">
            <span className="ui-label">{uiText('Referência')}</span>
            <select className="ui-select" value={refParam} onChange={(e) => setRef(e.target.value)}>
              {REF_KINDS.map((k) => (
                <option key={k} value={k}>
                  {REFERENCE_KIND_LABELS[k]}
                </option>
              ))}
              {!REF_KINDS.includes(refParam as RefKind) &&
                !otherLaps.some((l) => l.id === refParam) && (
                  <option value={refParam}>{lapOptionLabel(refLap)}</option>
                )}
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
            <span className="ui-help">
              <i className="cmp-swatch" style={{ background: LAP_COLORS.reference }} />{' '}
              {lapTitle(refLap)} · {formatLapTime(refLap.timeMs)}
            </span>
          </label>
          {!demo && extra.length < MAX_EXTRA && otherLaps.length > 0 && (
            <label className="ui-field">
              <span className="ui-label">{uiText('Sobrepor outra volta')}</span>
              <select
                className="ui-select"
                value=""
                onChange={(e) => e.target.value && addExtra(e.target.value)}
              >
                <option value="">{uiText('Escolher…')}</option>
                {otherLaps
                  .filter((l) => l.id !== refLap.id && !extra.includes(l.id))
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {lapOptionLabel(l)}
                    </option>
                  ))}
              </select>
              <span className="ui-help">
                {`${uiText('Aparece tracejada nos gráficos (até')} `}
                {MAX_EXTRA}).
              </span>
            </label>
          )}
        </div>
        {extraLaps.length > 0 && (
          <div className="cmp-extras">
            {extraLaps.map((l, k) => (
              <span key={l.id} className="cmp-chip">
                <i
                  className="cmp-swatch"
                  style={{ backgroundColor: LAP_COLORS.extra[k] }}
                  data-dash="1"
                />
                {lapTitle(l)} · {formatLapTime(l.timeMs)}
                <button
                  type="button"
                  aria-label={uiText('Remover {0} do gráfico', lapTitle(l))}
                  onClick={() => removeExtra(l.id)}
                >
                  <Icon name="close" size={14} />
                </button>
              </span>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={uiText('Resumo da comparação')}>
        <div className="cmp-stats">
          <div className="ui-stat cmp-stat" data-series style={seriesStyle(LAP_COLORS.subject)}>
            <span className="ui-stat-label">
              {`${uiText('Você ·')} `}
              {lapTitle(lap)}
            </span>
            <span className="ui-stat-value num">{formatLapTime(c.lapATimeMs)}</span>
            {!lap.valid && (
              <span className="ui-badge" data-tone="loss">
                {uiText('inválida')}
              </span>
            )}
          </div>
          <div className="ui-stat cmp-stat" data-series style={seriesStyle(LAP_COLORS.reference)}>
            <span className="ui-stat-label">
              {`${uiText('Referência ·')} `}
              {lapTitle(refLap)}
            </span>
            <span className="ui-stat-value num">{formatLapTime(c.lapBTimeMs)}</span>
          </div>
          <div className="ui-stat cmp-stat">
            <span className="ui-stat-label">{uiText('Delta total')}</span>
            <span className="ui-stat-value num" data-tone={timeTone(c.totalDeltaMs)}>
              {formatDelta(c.totalDeltaMs)}
            </span>
            <span className="cmp-stat-sub num">
              {`${uiText('retas')} `}
              {formatDelta(c.straightsDeltaMs)}
            </span>
          </div>
          {sectorDeltas.length > 0 && (
            <div className="ui-stat cmp-stat">
              <span className="ui-stat-label">{uiText('Delta por setor')}</span>
              <span className="cmp-sectors">
                {sectorDeltas.map((d, k) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: sector index
                  <span key={k} className="cmp-sector" data-tone={timeTone(d)}>
                    <small>S{k + 1}</small>
                    {formatDelta(d)}
                  </span>
                ))}
              </span>
            </div>
          )}
          {theoretical && (
            <div
              className="ui-stat cmp-stat"
              title={uiText(
                'Soma dos melhores microssetores de {0} voltas válidas da sessão',
                theoretical.laps,
              )}
            >
              <span className="ui-stat-label">{uiText('Volta ideal da sessão')}</span>
              <span className="ui-stat-value num">
                {formatLapTime(theoretical.theoreticalBestMs)}
              </span>
              <span className="cmp-stat-sub num">
                {formatDelta(theoretical.theoreticalBestMs - theoretical.bestLapMs)}
                {` ${uiText('vs sua melhor')}`}
              </span>
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title={uiText('Onde você perde tempo')}
        description={uiText(
          'As curvas que mais custam tempo contra a referência, com a causa provável.',
        )}
        className="cmp-loss"
      >
        <CornerLossPanel
          comparison={c}
          onZoom={zoomCorner}
          onDrill={demo ? undefined : drillCorner}
          busyCorner={drilling}
        />
      </Panel>

      {warnings.length > 0 && (
        <section className="ui-card cmp-warn" data-tone="warn" role="note">
          <Icon name="alert" size={20} />
          <ul>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="cmp-visual">
        <div className="cmp-charts-col">
          {chartTraces ? (
            <SyncCharts
              radioMarkers={radioMarkers}
              highlight={selectedEvent ? [selectedEvent.startM, selectedEvent.endM] : null}
              traces={chartTraces}
              laps={chartLaps}
              refId={refLap.id}
              corners={corners}
              range={range}
              onRange={onRange}
              bus={bus}
              focusCorner={focus}
              toolbar={
                range && (
                  <span className="cmp-zoom">
                    {focus
                      ? cornerLabel(
                          corners.find((x) => x.id === focus) ?? { id: focus, name: null },
                        )
                      : uiText('Trecho')}
                    : {Math.round(range[0])}–{Math.round(range[1])} m
                    <button
                      type="button"
                      className="ui-btn"
                      data-variant="secondary"
                      data-size="sm"
                      onClick={resetRange}
                    >
                      {uiText('Volta inteira')}
                    </button>
                  </span>
                )
              }
            />
          ) : tracesError ? (
            <ErrorBox error={tracesError} compact />
          ) : (
            <Loading text={uiText('Carregando os traces…')} />
          )}
        </div>
        <aside className="cmp-side">
          <section className="ui-card cmp-mapbox" aria-label={uiText('Mapa da pista')}>
            <fieldset className="cmp-modes" aria-label={uiText('O que a cor da sua volta mostra')}>
              {MAP_MODES.map((m) => (
                <label key={m.id} className="ui-chip" data-on={mapMode === m.id ? '1' : '0'}>
                  <input
                    type="radio"
                    name="map-mode"
                    checked={mapMode === m.id}
                    onChange={() => setMapMode(m.id)}
                  />
                  {m.label}
                </label>
              ))}
            </fieldset>
            <CompareMap
              outline={track ? { x: track.polyline.x, z: track.polyline.z } : null}
              distanceM={traces?.distanceM ?? []}
              lines={mapLines}
              corners={corners}
              brakeMarkers={brakeMarkers}
              overlayMarkers={overlayMarkers}
              range={range}
              focusCorner={focus}
              bus={bus}
              onCorner={zoomCorner}
            />
            {overlay?.ramp && (
              <div className="cmp-ramp">
                <span
                  className="cmp-ramp-bar"
                  style={{ background: rampGradient(overlay.ramp.mode) }}
                />
                <span className="cmp-ramp-ends num">
                  <span>{rampEnd(overlay.ramp.mode, 'lo', overlay.ramp.lo)}</span>
                  <span>{rampEnd(overlay.ramp.mode, 'hi', overlay.ramp.hi)}</span>
                </span>
              </div>
            )}
            {diffMarkers.length > 0 && (
              <ul className="cmp-diff-list">
                {diffMarkers.map((m) => {
                  const s = lateralSide(m.diffM);
                  return (
                    <li key={m.distanceM}>
                      <span className="num">{Math.round(m.distanceM)} m</span>{' '}
                      {uiText(
                        s.side === 'left'
                          ? 'Você passa {0} m à esquerda da referência'
                          : 'Você passa {0} m à direita da referência',
                        formatFixed(s.meters, 1),
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="cmp-map-legend">
              <span>
                <i style={{ background: LAP_COLORS.subject }} />
                {` ${uiText('você')}`}
              </span>
              <span>
                <i style={{ background: LAP_COLORS.reference }} />
                {` ${uiText('referência')}`}
              </span>
              {mapMode === 'time' && (
                <>
                  <span>
                    <i style={{ background: THEME.gain }} />
                    {` ${uiText('ganha tempo')}`}
                  </span>
                  <span>
                    <i style={{ background: THEME.loss }} />
                    {` ${uiText('perde tempo')}`}
                  </span>
                </>
              )}
              <span>
                <i className="cmp-map-ring" />
                {` ${uiText('frenagem')}`}
              </span>
            </div>
          </section>
        </aside>
      </div>

      <Panel
        title={uiText('O que treinar')}
        description={uiText('As curvas que mais custam tempo, com uma ação para cada.')}
        className="cmp-findings"
      >
        <FindingsPanel
          findings={findings}
          corners={corners}
          referenceIsReplay={isReplay}
          onCorner={zoomCorner}
        />
      </Panel>

      {events && (
        <Panel
          title={uiText('Eventos de pilotagem')}
          description={uiText(
            'Momentos da volta em que o carro escapou ou o piloto deixou tempo na pista.',
          )}
          className="cmp-events"
        >
          <DrivingEventsPanel
            events={events.events}
            corners={corners}
            selectedId={selectedEvent?.id ?? null}
            onOpen={openEvent}
            warnings={events.warnings}
          />
          {eventTraces.error && <ErrorBox error={eventTraces.error} compact />}
        </Panel>
      )}

      <Panel
        title={uiText('Curva a curva')}
        description={uiText('Clique numa curva para dar zoom nos gráficos e no mapa.')}
      >
        {c.rows.length ? (
          <CornerTable rows={c.rows} focusCorner={focus} onCorner={zoomCorner} />
        ) : (
          <p className="pn-desc">{uiText('Esta pista ainda não tem curvas detectadas.')}</p>
        )}
      </Panel>
      {radio && (
        <EngineerRadioReview
          lapId={lap.id}
          referenceId={refLap.id}
          logs={radio}
          rows={c.rows}
          onCorner={zoomCorner}
        />
      )}
    </div>
  );
}

function seriesStyle(color: string): CSSProperties {
  return { ['--series' as string]: color };
}
