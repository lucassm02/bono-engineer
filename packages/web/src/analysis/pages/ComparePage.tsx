/**
 * #/analise/comparar?lap=&ref=&extra=&corner= — the learning page: summary, synced traces by
 * distance, track map coloured by microsectors, corner table and ranked findings.
 */

import type {
  ApiComparison,
  ApiMicrosectors,
  ApiTraces,
  ApiTrackAnalysis,
  COMPARISON_REFERENCE_KINDS,
  Lap,
  MapCorner,
} from '@gt7/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDelta, formatLapTime } from '../../lib/format.ts';
import { navigate, type Route, routes } from '../../lib/route.ts';
import { api, urls } from '../api.ts';
import { type BrakeMarker, CompareMap, type MapLine } from '../components/CompareMap.tsx';
import { CornerTable } from '../components/CornerTable.tsx';
import { FindingsPanel } from '../components/FindingsPanel.tsx';
import { type ChartLap, SyncCharts } from '../components/SyncCharts.tsx';
import { Card, Empty, ErrorBox, Loading, PageHead, Tag, useTitle } from '../components/ui.tsx';
import {
  COMPARE_TRACE_CHANNELS,
  cornerLabel,
  cornerRange,
  lapSeries,
  timeTone,
} from '../lib/chartData.ts';
import { CursorBus } from '../lib/cursorBus.ts';
import { carLabel, formatDateTime, REFERENCE_KIND_LABELS } from '../lib/labels.ts';
import { useFetch } from '../useFetch.ts';

type RefKind = (typeof COMPARISON_REFERENCE_KINDS)[number];
const REF_KINDS: RefKind[] = ['auto', 'bestReference', 'personalBest', 'sessionBest'];

export const LAP_COLORS = {
  subject: '#ff7a2f',
  reference: '#2fd3b0',
  extra: ['#7aa7ff', '#e08cff'],
} as const;

const MAX_EXTRA = 2;

export interface CompareData {
  cmp: ApiComparison;
  traces: ApiTraces | null;
  track: ApiTrackAnalysis | null;
  micro: ApiMicrosectors | null;
  theoretical: { theoreticalBestMs: number; bestLapMs: number; laps: number } | null;
}

function lapOptionLabel(l: Lap): string {
  const who = l.isReference
    ? `ref ${l.referenceMeta?.driverName ?? ''}`.trim()
    : `volta ${l.number} · ${formatDateTime(l.startedAt)}`;
  return `${formatLapTime(l.timeMs)} · ${who}${l.valid ? '' : ' (inválida)'}`;
}

function lapTitle(l: Lap): string {
  if (l.isReference) {
    return `${l.referenceMeta?.driverName ?? 'Referência'}${l.flags.includes('replay') ? ' (replay)' : ''}`;
  }
  return `Volta ${l.number}`;
}

export function ComparePage({ route }: { route: Route }) {
  const lapId = route.query.lap ?? '';
  const ref = route.query.ref || 'auto';
  const extra = useMemo(
    () => (route.query.extra ?? '').split(',').filter(Boolean).slice(0, MAX_EXTRA),
    [route.query.extra],
  );
  useTitle('Comparação de voltas');

  const cmp = useFetch(lapId ? `cmp:${lapId}:${ref}` : null, () => api.compare(lapId, ref));
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
  const trackLaps = useFetch(trackId ? `tl:${trackId}` : null, () =>
    api.trackLaps(trackId!, { orderBy: 'time', limit: 80 }),
  );

  if (!lapId) {
    return (
      <>
        <PageHead
          title="Comparação de voltas"
          back={{ href: routes.home(), label: 'Suas pistas' }}
        />
        <Empty>
          <p>Escolha uma volta para comparar com a sua melhor ou com a de um piloto do top.</p>
          <p>
            <a className="a-btn" href={routes.home()}>
              Escolher uma pista
            </a>
          </p>
        </Empty>
      </>
    );
  }
  if (cmp.error && !cmp.data) {
    return (
      <>
        <PageHead
          title="Comparação de voltas"
          back={{ href: routes.home(), label: 'Suas pistas' }}
        />
        <ErrorBox error={cmp.error} onRetry={cmp.reload} />
        {ref !== 'auto' && (
          <p>
            <a href={routes.compare({ lap: lapId, ref: 'auto', extra })}>
              Tentar com a referência automática
            </a>
          </p>
        )}
      </>
    );
  }
  if (!cmp.data) return <Loading text="Comparando as voltas…" />;

  return (
    <CompareView
      data={{
        cmp: cmp.data,
        traces: traces.data,
        track: track.data,
        micro: micro.data,
        theoretical: theo.data ?? null,
      }}
      tracesError={traces.error?.message ?? null}
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
  const { cmp, traces, track, micro, theoretical } = data;
  const c = cmp.comparison;
  const lap = cmp.lap;
  const refLap = cmp.referenceLap;
  const bus = useMemo(() => new CursorBus(), []);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const lengthM = c.lengthM ?? track?.polyline.lengthM ?? traces?.toM ?? 0;

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
      document
        .querySelector('.a-cmp-visual')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (!r) setFocus(null);
  }, []);

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
        label: `Você · ${lapTitle(lap)} · ${formatLapTime(lap.timeMs)}`,
        color: LAP_COLORS.subject,
      },
      {
        id: refLap.id,
        label: `Ref · ${lapTitle(refLap)} · ${formatLapTime(refLap.timeMs)}`,
        color: LAP_COLORS.reference,
      },
      ...extra
        .filter((id) => id !== lap.id && id !== refLap.id)
        .map((id, k) => {
          const l = trackLaps.find((x) => x.id === id);
          return {
            id,
            label: l ? `${lapTitle(l)} · ${formatLapTime(l.timeMs)}` : `Volta ${id}`,
            color: LAP_COLORS.extra[k] ?? '#aaa',
            dash: [5, 4],
          };
        }),
    ],
    [lap, refLap, extra, trackLaps],
  );

  const mapLines: MapLine[] = useMemo(() => {
    if (!traces) return [];
    const subjectColors = micro?.colors.find((x) => x.lapId === lap.id)?.colors ?? null;
    return chartLaps.slice(0, 2).map((l, i) => ({
      id: l.id,
      color: l.color,
      x: lapSeries(traces, l.id, 'x'),
      z: lapSeries(traces, l.id, 'z'),
      colors: i === 0 ? subjectColors : null,
      width: i === 0 ? 3.4 : 2,
    }));
  }, [traces, micro, chartLaps, lap.id]);

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
          label: 'F ref',
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

  return (
    <>
      <PageHead
        back={{ href: routes.session(lap.sessionId), label: 'Sessão' }}
        title={
          <>
            Comparação <span className="dim">· {track?.track.name ?? lap.trackId ?? ''}</span>
          </>
        }
        sub={
          <>
            {carLabel(lap.carCode)}
            {lap.carCode !== refLap.carCode && (
              <> × {carLabel(refLap.carCode, refLap.referenceMeta?.carName)}</>
            )}{' '}
            · referência: {REFERENCE_KIND_LABELS[cmp.referenceKind]}
            {demo && (
              <>
                {' '}
                <Tag tone="warn">demonstração</Tag>
              </>
            )}
          </>
        }
        actions={
          !demo && (
            <>
              <a
                className="a-btn a-btn-ghost"
                href={urls.chartPng(lap.id, refLap.id, focus ?? undefined)}
                target="_blank"
                rel="noopener"
              >
                Gerar gráfico (PNG)
              </a>
              <a
                className="a-btn"
                href={routes.coach({
                  session: lap.sessionId,
                  lap: lap.id,
                  ref: refLap.id,
                  corner: focus ?? undefined,
                })}
              >
                Debrief com IA
              </a>
            </>
          )
        }
      />

      <section className="a-summary">
        <div className="a-sum-lap" style={{ borderColor: LAP_COLORS.subject }}>
          <span className="a-sum-k">Você · {lapTitle(lap)}</span>
          <span className="a-sum-v num">{formatLapTime(c.lapATimeMs)}</span>
          {!lap.valid && <Tag tone="bad">inválida</Tag>}
        </div>
        <div className="a-sum-lap" style={{ borderColor: LAP_COLORS.reference }}>
          <span className="a-sum-k">Referência · {lapTitle(refLap)}</span>
          <span className="a-sum-v num">{formatLapTime(c.lapBTimeMs)}</span>
        </div>
        <div className="a-sum-lap">
          <span className="a-sum-k">Delta total</span>
          <span className="a-sum-v num" data-tone={timeTone(c.totalDeltaMs)}>
            {formatDelta(c.totalDeltaMs)}
          </span>
          <span className="dim a-small num">retas {formatDelta(c.straightsDeltaMs)}</span>
        </div>
        {sectorDeltas.length > 0 && (
          <div className="a-sum-lap">
            <span className="a-sum-k">Setores</span>
            <span className="a-sectors">
              {sectorDeltas.map((d, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: sector index
                <span key={k} className="a-sector num" data-tone={timeTone(d)}>
                  <small>S{k + 1}</small> {formatDelta(d)}
                </span>
              ))}
            </span>
          </div>
        )}
        {theoretical && (
          <div
            className="a-sum-lap"
            title={`Soma dos melhores microssetores de ${theoretical.laps} voltas válidas da sessão`}
          >
            <span className="a-sum-k">Volta ideal da sessão</span>
            <span className="a-sum-v num">{formatLapTime(theoretical.theoreticalBestMs)}</span>
            <span className="dim a-small num">
              {formatDelta(theoretical.theoreticalBestMs - theoretical.bestLapMs)} vs sua melhor
            </span>
          </div>
        )}
      </section>

      {(c.warnings.length > 0 || isReplay) && (
        <ul className="a-warnings">
          {c.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
          {isReplay && !c.warnings.some((w) => /replay/i.test(w)) && (
            <li>Referência de replay: entradas suavizadas, precisão de alguns metros.</li>
          )}
        </ul>
      )}

      <div className="a-controls">
        <label>
          Referência
          <select value={refParam} onChange={(e) => setRef(e.target.value)}>
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
              <optgroup label="Outra volta desta pista">
                {otherLaps.map((l) => (
                  <option key={l.id} value={l.id}>
                    {lapOptionLabel(l)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {!demo && extra.length < MAX_EXTRA && otherLaps.length > 0 && (
          <label>
            Sobrepor outra volta
            <select value="" onChange={(e) => e.target.value && addExtra(e.target.value)}>
              <option value="">Escolher…</option>
              {otherLaps
                .filter((l) => l.id !== refLap.id && !extra.includes(l.id))
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {lapOptionLabel(l)}
                  </option>
                ))}
            </select>
          </label>
        )}
        {extraLaps.map((l, k) => (
          <span key={l.id} className="a-chip" style={{ borderColor: LAP_COLORS.extra[k] }}>
            {lapTitle(l)} · {formatLapTime(l.timeMs)}
            <button type="button" aria-label="Remover do gráfico" onClick={() => removeExtra(l.id)}>
              ×
            </button>
          </span>
        ))}
        <span className="a-grow" />
        {range && (
          <span className="a-zoom-info num">
            {focus
              ? cornerLabel(corners.find((x) => x.id === focus) ?? { id: focus, name: null })
              : 'Trecho'}
            : {Math.round(range[0])}–{Math.round(range[1])} m
            <button
              type="button"
              className="a-btn a-btn-ghost a-btn-sm"
              onClick={() => {
                setRange(null);
                setFocus(null);
              }}
            >
              Volta inteira
            </button>
          </span>
        )}
      </div>

      <div className="a-cmp-visual">
        <div className="a-cmp-charts">
          {traces ? (
            <SyncCharts
              traces={traces}
              laps={chartLaps}
              refId={refLap.id}
              corners={corners}
              range={range}
              onRange={onRange}
              bus={bus}
              focusCorner={focus}
            />
          ) : tracesError ? (
            <ErrorBox error={tracesError} compact />
          ) : (
            <Loading text="Carregando os traces…" />
          )}
        </div>
        <aside className="a-cmp-side">
          <div className="a-map-box">
            <CompareMap
              outline={track ? { x: track.polyline.x, z: track.polyline.z } : null}
              distanceM={traces?.distanceM ?? []}
              lines={mapLines}
              corners={corners}
              brakeMarkers={brakeMarkers}
              range={range}
              focusCorner={focus}
              bus={bus}
              onCorner={zoomCorner}
            />
            <div className="a-map-legend a-small">
              <span>
                <i style={{ background: LAP_COLORS.subject }} /> você
              </span>
              <span>
                <i style={{ background: LAP_COLORS.reference }} /> referência
              </span>
              <span>
                <i style={{ background: 'var(--gain)' }} /> ganha
              </span>
              <span>
                <i style={{ background: 'var(--loss)' }} /> perde
              </span>
              <span>○ frenagem</span>
            </div>
          </div>
          <Card title="O que treinar" className="a-findings-card">
            <FindingsPanel
              findings={findings}
              corners={corners}
              referenceIsReplay={isReplay}
              onCorner={zoomCorner}
            />
          </Card>
        </aside>
      </div>

      <Card title="Curva a curva" className="a-mt">
        {c.rows.length ? (
          <CornerTable rows={c.rows} focusCorner={focus} onCorner={zoomCorner} />
        ) : (
          <p className="dim">Esta pista ainda não tem curvas detectadas.</p>
        )}
      </Card>
    </>
  );
}
