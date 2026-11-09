/**
 * Stack of uPlot charts by distance (speed, throttle, brake, gear, steering, delta) with a shared
 * cursor (uPlot sync), synced x zoom (drag to zoom, double-click to reset), corner bands labelled
 * on the top chart and a live value readout. The hover distance is published on a CursorBus so the
 * track map follows; the map can drive the cursor back.
 */

import type { ApiTraces, Corner } from '@gt7/shared';
import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { formatFixed } from '../../lib/format.ts';
import { COMPARE_PANELS, isAllNull, type PanelDef, panelData } from '../lib/chartData.ts';
import type { CursorBus } from '../lib/cursorBus.ts';
import { DOUBLE_TAP_MS, pinchRange } from '../lib/touchZoom.ts';

export interface ChartLap {
  id: string;
  label: string;
  color: string;
  dash?: number[];
}

interface Props {
  traces: ApiTraces;
  laps: ChartLap[];
  /** Laps without a delta series (the reference itself). */
  refId: string;
  corners: Corner[];
  /** Current x range (null = whole lap). */
  range: [number, number] | null;
  onRange: (r: [number, number] | null) => void;
  bus: CursorBus;
  focusCorner?: string | null;
}

const Y_AXIS = 54;
const GRID = '#1a2229';
const AXIS = '#8592a0';
const FONT = '12px Bahnschrift, "DIN Alternate", "Roboto Condensed", "Arial Narrow", sans-serif';

function same(a: [number, number] | null, b: [number, number] | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;
}

export function SyncCharts({
  traces,
  laps,
  refId,
  corners,
  range,
  onRange,
  bus,
  focusCorner,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotsRef = useRef<uPlot[]>([]);
  const readoutRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const syncingRef = useRef(false);
  const lastRangeRef = useRef<[number, number] | null>(range);
  const onRangeRef = useRef(onRange);
  onRangeRef.current = onRange;
  const focusRef = useRef(focusCorner ?? null);
  focusRef.current = focusCorner ?? null;
  const cornersRef = useRef(corners);
  cornersRef.current = corners;

  const syncKey = useMemo(() => `cmp-${Math.random().toString(36).slice(2)}`, []);
  const full: [number, number] = useMemo(
    () => [traces.distanceM[0] ?? 0, traces.distanceM[traces.distanceM.length - 1] ?? 1],
    [traces],
  );

  /** Panels with data for at least one lap (steering is absent in some formats). */
  const panels = useMemo(() => {
    return COMPARE_PANELS.map((p) => {
      const ids = p.key === 'delta' ? laps.filter((l) => l.id !== refId) : laps;
      const data = panelData(
        traces,
        p,
        ids.map((l) => l.id),
      );
      const empty = data.slice(1).every((s) => isAllNull(s));
      return { def: p, laps: ids, data, empty };
    });
  }, [traces, laps, refId]);

  const lapsKey = laps.map((l) => l.id + l.color).join('|');

  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt only when the data changes
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const visible = panels.filter((p) => !p.empty);
    const width = host.clientWidth || 240;
    const plots: uPlot[] = [];
    const xs = traces.distanceM;

    const bandsHook = (u: uPlot) => {
      const ctx = u.ctx;
      const { top, height } = u.bbox;
      ctx.save();
      for (const c of cornersRef.current) {
        const x0 = u.valToPos(c.entryM, 'x', true);
        const x1 = u.valToPos(c.exitM, 'x', true);
        if (x1 < u.bbox.left || x0 > u.bbox.left + u.bbox.width) continue;
        ctx.fillStyle =
          c.id === focusRef.current ? 'rgba(255,178,30,0.16)' : 'rgba(255,178,30,0.06)';
        const l = Math.max(x0, u.bbox.left);
        const r = Math.min(x1, u.bbox.left + u.bbox.width);
        ctx.fillRect(l, top, r - l, height);
      }
      ctx.restore();
    };

    const labelsHook = (u: uPlot) => {
      const ctx = u.ctx;
      const pr = uPlot.pxRatio;
      ctx.save();
      ctx.font = `${Math.round(11 * pr)}px Bahnschrift, "Roboto Condensed", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      let lastRight = -1e9;
      for (const c of cornersRef.current) {
        const xm = u.valToPos(c.apexM, 'x', true);
        if (xm < u.bbox.left || xm > u.bbox.left + u.bbox.width) continue;
        const zoomed = (u.scales.x?.max ?? 0) - (u.scales.x?.min ?? 0) < 1500;
        const text = zoomed && c.name ? `${c.id} ${c.name}` : c.id;
        const w = ctx.measureText(text).width + 8 * pr;
        if (xm - w / 2 < lastRight) continue;
        lastRight = xm + w / 2;
        ctx.fillStyle = c.id === focusRef.current ? '#ffb21e' : 'rgba(255,178,30,0.75)';
        ctx.fillText(text, xm, u.bbox.top + 3 * pr);
      }
      ctx.restore();
    };

    const zeroHook = (u: uPlot) => {
      const y = u.valToPos(0, 'y', true);
      if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) return;
      const ctx = u.ctx;
      ctx.save();
      ctx.strokeStyle = '#46515c';
      ctx.lineWidth = uPlot.pxRatio;
      ctx.beginPath();
      ctx.moveTo(u.bbox.left, y);
      ctx.lineTo(u.bbox.left + u.bbox.width, y);
      ctx.stroke();
      ctx.restore();
    };

    const updateReadout = (u: uPlot, p: (typeof visible)[number]) => {
      const i = u.cursor.idx;
      p.laps.forEach((l, k) => {
        const el = readoutRefs.current.get(`${p.def.key}:${l.id}`);
        if (!el) return;
        const v = i === null || i === undefined ? null : (p.data[k + 1]?.[i] ?? null);
        el.textContent =
          v === null
            ? '–'
            : p.def.key === 'delta'
              ? `${v > 0 ? '+' : ''}${formatFixed(v, 3)}`
              : formatFixed(v, p.def.digits);
      });
      const dEl = readoutRefs.current.get('distance');
      if (dEl && plots[0] === u) {
        dEl.textContent = i === null || i === undefined ? '' : `${Math.round(xs[i] ?? 0)} m`;
      }
    };

    visible.forEach((p, idx) => {
      const last = idx === visible.length - 1;
      const def: PanelDef = p.def;
      const el = host.querySelector<HTMLDivElement>(`[data-panel="${def.key}"] .a-chart-plot`);
      if (!el) return;
      el.innerHTML = '';
      const opts: uPlot.Options = {
        width,
        height: def.height + (last ? 28 : 0),
        cursor: {
          sync: { key: syncKey, setSeries: false },
          drag: { x: true, y: false, setScale: true },
          points: { size: 6 },
          y: false,
        },
        legend: { show: false },
        scales: {
          x: { time: false },
          y: def.range ? { range: def.range } : { auto: true },
        },
        axes: [
          {
            stroke: AXIS,
            font: FONT,
            grid: { stroke: GRID, width: 1 },
            ticks: { stroke: GRID, width: 1 },
            size: last ? 28 : 4,
            values: last
              ? (_u, splits) => splits.map((v) => `${Math.round(v)} m`)
              : (_u, splits) => splits.map(() => ''),
          },
          {
            stroke: AXIS,
            font: FONT,
            size: Y_AXIS,
            grid: { stroke: GRID, width: 1 },
            ticks: { stroke: GRID, width: 1 },
            values: (_u, splits) =>
              splits.map((v) =>
                def.key === 'delta' ? formatFixed(v, Math.abs(v) < 1 ? 2 : 1) : formatFixed(v, 0),
              ),
          },
        ],
        series: [
          {},
          ...p.laps.map((l) => ({
            label: l.label,
            stroke: l.color,
            width: l.id === refId ? 1.6 : 1.8,
            ...(l.dash ? { dash: l.dash } : {}),
            spanGaps: false,
            points: { show: false },
            ...(def.stepped ? { paths: uPlot.paths.stepped!({ align: 1 }) } : {}),
          })),
        ],
        hooks: {
          drawClear: [bandsHook],
          draw: [
            ...(idx === 0 ? [labelsHook] : []),
            ...(def.key === 'delta' || def.key === 'steering' ? [zeroHook] : []),
          ],
          setCursor: [
            (u) => {
              updateReadout(u, p);
              if (u === plots[0]) {
                const i = u.cursor.idx;
                bus.set(i === null || i === undefined ? null : (xs[i] ?? null), 'chart');
              }
            },
          ],
          setScale: [
            (u, key) => {
              if (key !== 'x' || syncingRef.current || !plots.includes(u)) return;
              const min = u.scales.x?.min ?? full[0];
              const max = u.scales.x?.max ?? full[1];
              syncingRef.current = true;
              for (const o of plots) if (o !== u) o.setScale('x', { min, max });
              syncingRef.current = false;
              const r: [number, number] | null =
                min <= full[0] + 1 && max >= full[1] - 1 ? null : [min, max];
              if (!same(r, lastRangeRef.current)) {
                lastRangeRef.current = r;
                onRangeRef.current(r);
              }
            },
          ],
        },
      };
      plots.push(new uPlot(opts, p.data as uPlot.AlignedData, el));
    });
    plotsRef.current = plots;
    // Initial range (e.g. ?corner=).
    const r = lastRangeRef.current;
    if (r && plots[0]) {
      syncingRef.current = true;
      for (const o of plots) o.setScale('x', { min: r[0], max: r[1] });
      syncingRef.current = false;
    }

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      if (!w) return;
      for (const [k, o] of plots.entries()) {
        const p = visible[k]!;
        if (Math.abs(o.width - w) > 1)
          o.setSize({ width: w, height: p.def.height + (k === visible.length - 1 ? 28 : 0) });
      }
    });
    ro.observe(host);

    const unsub = bus.subscribe((d, source) => {
      if (source !== 'map') return;
      for (const o of plots) {
        if (d === null) o.setCursor({ left: -10, top: -10 });
        else o.setCursor({ left: o.valToPos(d, 'x'), top: 8 });
      }
    });

    return () => {
      unsub();
      ro.disconnect();
      for (const o of plots) o.destroy();
      plotsRef.current = [];
    };
  }, [panels, lapsKey, refId, syncKey, bus, full]);

  // Touch: two fingers pinch/pan the shared x range, a double tap resets it (uPlot only drags with
  // a mouse). One finger keeps scrolling the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: listeners follow the data
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let start: {
      range: [number, number];
      d0: number;
      frac0: number;
    } | null = null;
    let lastTap = 0;
    const geometry = (t: TouchList) => {
      const a = t[0]!;
      const b = t[1]!;
      const over = plotsRef.current[0]?.over.getBoundingClientRect();
      if (!over || over.width < 10) return null;
      const mid = (a.clientX + b.clientX) / 2;
      return {
        d: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
        frac: Math.min(1, Math.max(0, (mid - over.left) / over.width)),
      };
    };
    const currentRange = (): [number, number] => {
      const sx = plotsRef.current[0]?.scales.x;
      return [sx?.min ?? full[0], sx?.max ?? full[1]];
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const g = geometry(e.touches);
        if (g) start = { range: currentRange(), d0: g.d, frac0: g.frac };
        e.preventDefault();
      } else if (e.touches.length === 1) {
        start = null;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      const g = geometry(e.touches);
      const first = plotsRef.current[0];
      if (!g || !first) return;
      e.preventDefault();
      const [min, max] = pinchRange(start.range, start.frac0, g.d / start.d0, g.frac, full);
      first.setScale('x', { min, max });
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
      if (e.touches.length === 0 && e.changedTouches.length === 1) {
        const now = Date.now();
        if (now - lastTap < DOUBLE_TAP_MS) {
          lastTap = 0;
          plotsRef.current[0]?.setScale('x', { min: full[0], max: full[1] });
        } else lastTap = now;
      }
    };
    host.addEventListener('touchstart', onStart, { passive: false });
    host.addEventListener('touchmove', onMove, { passive: false });
    host.addEventListener('touchend', onEnd);
    host.addEventListener('touchcancel', onEnd);
    return () => {
      host.removeEventListener('touchstart', onStart);
      host.removeEventListener('touchmove', onMove);
      host.removeEventListener('touchend', onEnd);
      host.removeEventListener('touchcancel', onEnd);
    };
  }, [full]);

  // External range changes (corner click, reset button).
  useEffect(() => {
    if (same(range, lastRangeRef.current)) return;
    lastRangeRef.current = range;
    const r = range ?? full;
    syncingRef.current = true;
    for (const o of plotsRef.current) o.setScale('x', { min: r[0], max: r[1] });
    syncingRef.current = false;
  }, [range, full]);

  // Focus highlight changes need a redraw.
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw trigger
  useEffect(() => {
    for (const o of plotsRef.current) o.redraw(false);
  }, [focusCorner, corners]);

  return (
    <div className="a-charts" ref={hostRef}>
      <div className="a-charts-legend">
        {laps.map((l) => (
          <span key={l.id} className="a-legend-item">
            <i style={{ background: l.color }} data-dash={l.dash ? '1' : '0'} />
            {l.label}
          </span>
        ))}
        <span
          className="a-legend-d num"
          ref={(el) => void (el && readoutRefs.current.set('distance', el))}
        />
        <span className="dim a-small a-legend-hint">
          Arraste (ou pince com dois dedos) para dar zoom · duplo clique/toque volta
        </span>
      </div>
      {panels.map((p) => (
        <div key={p.def.key} className="a-chart" data-panel={p.def.key} hidden={p.empty}>
          <div className="a-chart-head">
            <span className="a-chart-title">
              {p.def.label}
              {p.def.unit && <span className="dim"> ({p.def.unit})</span>}
            </span>
            <span className="a-chart-values num">
              {p.laps.map((l) => (
                <span
                  key={l.id}
                  style={{ color: l.color }}
                  ref={(el) => void (el && readoutRefs.current.set(`${p.def.key}:${l.id}`, el))}
                >
                  –
                </span>
              ))}
            </span>
          </div>
          <div className="a-chart-plot" />
        </div>
      ))}
      {panels.some((p) => p.empty) && (
        <p className="dim a-small">
          Sem dados de{' '}
          {panels
            .filter((p) => p.empty)
            .map((p) => p.def.label.toLowerCase())
            .join(', ')}{' '}
          neste formato de pacote.
        </p>
      )}
    </div>
  );
}
