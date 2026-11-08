/**
 * Comparison track map (canvas): track outline, reference line, your line coloured by microsector
 * gain/loss, corner labels (click = zoom into the corner), brake-point markers and the hover marker
 * shared with the charts (CursorBus). Zooms to the chart range when one is selected.
 */

import type { MapCorner, MicrosectorColor } from '@gt7/shared';
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from 'react';
import { type Bounds, boundsOf, fitScale, mapX, mapY } from '../../lib/mapMath.ts';
import { CANVAS_COLORS as C, useCanvasSize } from '../../widgets/useCanvas.ts';
import { colorAt, gridIndex, type Series, valueAt } from '../lib/chartData.ts';
import type { CursorBus } from '../lib/cursorBus.ts';

export interface MapLine {
  id: string;
  color: string;
  x: Series;
  z: Series;
  /** Microsector colours (your line only). */
  colors?: MicrosectorColor[] | null;
  width?: number;
  dash?: number[];
}

export interface BrakeMarker {
  lineId: string;
  distanceM: number;
  color: string;
  label: string;
}

interface Props {
  /** Track outline (closed), may be null (lines only). */
  outline: { x: number[]; z: number[] } | null;
  /** Distance grid of the lines. */
  distanceM: number[];
  lines: MapLine[];
  corners: MapCorner[];
  brakeMarkers: BrakeMarker[];
  range: [number, number] | null;
  focusCorner: string | null;
  bus: CursorBus | null;
  onCorner?: (cornerId: string) => void;
  className?: string;
}

const TONE: Record<MicrosectorColor['tone'], string> = {
  gain: C.gain,
  loss: C.loss,
  neutral: '#c9d1d8',
  // 'best' = equals the best microsector of a 2-lap set, i.e. you gained there: same as gain.
  best: C.gain,
};

interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function CompareMap({
  outline,
  distanceM,
  lines,
  corners,
  brakeMarkers,
  range,
  focusCorner,
  bus,
  onCorner,
  className = '',
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitsRef = useRef<Hit[]>([]);
  const projRef = useRef<{ k: number; ox: number; oy: number } | null>(null);
  const frame = useRef(0);
  const propsRef = useRef({ outline, distanceM, lines, corners, brakeMarkers, range, focusCorner });
  propsRef.current = { outline, distanceM, lines, corners, brakeMarkers, range, focusCorner };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads refs only (size, props)
  const draw = useCallback(() => {
    const c = canvasRef.current;
    const s = sizeRef.current;
    if (!c || s.w <= 1) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    const p = propsRef.current;
    const subject = p.lines[0];

    // Bounds: the selected range of the lines, else the outline (or the lines).
    let b: Bounds | null = null;
    if (p.range && subject) {
      const xs: number[] = [];
      const zs: number[] = [];
      for (const ln of p.lines) {
        const i0 = Math.max(0, gridIndex(p.distanceM, p.range[0]));
        const i1 = Math.max(i0, gridIndex(p.distanceM, p.range[1]));
        for (let i = i0; i <= i1; i++) {
          const x = ln.x[i];
          const z = ln.z[i];
          if (x !== null && x !== undefined && z !== null && z !== undefined) {
            xs.push(x);
            zs.push(z);
          }
        }
      }
      b = boundsOf(xs, zs);
      if (b) {
        const padX = Math.max(25, (b.maxX - b.minX) * 0.15);
        const padY = Math.max(25, (b.maxY - b.minY) * 0.15);
        b = { minX: b.minX - padX, maxX: b.maxX + padX, minY: b.minY - padY, maxY: b.maxY + padY };
      }
    }
    if (!b && p.outline) b = boundsOf(p.outline.x, p.outline.z);
    if (!b && subject) {
      b = boundsOf(
        subject.x.map((v) => v ?? Number.NaN),
        subject.z.map((v) => v ?? Number.NaN),
      );
    }
    if (!b) {
      ctx.fillStyle = C.dim;
      ctx.font = `14px ${C.font}`;
      ctx.textAlign = 'center';
      ctx.fillText('Sem traçado da pista', s.w / 2, s.h / 2);
      return;
    }
    const vp = { w: s.w, h: s.h, pad: 18 };
    const k = fitScale(b, vp);
    const ox = s.w / 2 - ((b.minX + b.maxX) / 2) * k;
    const oy = s.h / 2 - ((b.minY + b.maxY) / 2) * k;
    projRef.current = { k, ox, oy };
    const toX = (x: number) => ox + mapX(x) * k;
    const toY = (z: number) => oy + mapY(z) * k;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Outline (track width ~12 m).
    if (p.outline && p.outline.x.length > 1) {
      ctx.strokeStyle = '#1b232a';
      ctx.lineWidth = Math.min(46, Math.max(7, 12 * k));
      ctx.beginPath();
      p.outline.x.forEach((x, i) => {
        const px = toX(x);
        const py = toY(p.outline!.z[i]!);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.stroke();
    }

    // Lines: reference(s) first, subject on top.
    for (let li = p.lines.length - 1; li >= 0; li--) {
      const ln = p.lines[li]!;
      const w = ln.width ?? (li === 0 ? 3.2 : 2);
      ctx.lineWidth = w;
      ctx.setLineDash(ln.dash ?? []);
      if (ln.colors?.length) {
        // Per-segment colour from the microsector the segment starts in.
        let prev: [number, number] | null = null;
        for (let i = 0; i < p.distanceM.length; i++) {
          const x = ln.x[i];
          const z = ln.z[i];
          if (x === null || x === undefined || z === null || z === undefined) {
            prev = null;
            continue;
          }
          const pt: [number, number] = [toX(x), toY(z)];
          if (prev) {
            const mc = colorAt(ln.colors, p.distanceM[i]!);
            ctx.strokeStyle = mc ? TONE[mc.tone] : ln.color;
            ctx.globalAlpha = mc ? 0.55 + 0.45 * mc.intensity : 1;
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(pt[0], pt[1]);
            ctx.stroke();
          }
          prev = pt;
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = ln.color;
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i < p.distanceM.length; i++) {
          const x = ln.x[i];
          const z = ln.z[i];
          if (x === null || x === undefined || z === null || z === undefined) {
            pen = false;
            continue;
          }
          if (!pen) ctx.moveTo(toX(x), toY(z));
          else ctx.lineTo(toX(x), toY(z));
          pen = true;
        }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Start / finish.
    if (subject) {
      const x0 = subject.x[0];
      const z0 = subject.z[0];
      if (x0 !== null && x0 !== undefined && z0 !== null && z0 !== undefined) {
        ctx.fillStyle = C.text;
        ctx.fillRect(toX(x0) - 3, toY(z0) - 3, 6, 6);
      }
    }

    // Brake markers.
    const zoomed = !!p.range;
    for (const m of p.brakeMarkers) {
      const ln = p.lines.find((l) => l.id === m.lineId);
      if (!ln) continue;
      const x = valueAt(p.distanceM, ln.x, m.distanceM);
      const z = valueAt(p.distanceM, ln.z, m.distanceM);
      if (x === null || z === null) continue;
      const r = zoomed ? 6 : 3.5;
      ctx.strokeStyle = m.color;
      ctx.fillStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(toX(x), toY(z), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (zoomed) {
        ctx.fillStyle = m.color;
        ctx.font = `600 11px ${C.font}`;
        // Your markers labelled to the right, the reference's to the left (they are often close).
        const mine = m.lineId === subject?.id;
        ctx.textAlign = mine ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.label, toX(x) + (mine ? 9 : -9), toY(z));
      }
    }

    // Corner labels.
    const hits: Hit[] = [];
    ctx.font = `600 12px ${C.font}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const cn of p.corners) {
      if (!Number.isFinite(cn.apexX) || !Number.isFinite(cn.apexZ)) continue;
      const ax = toX(cn.apexX);
      const ay = toY(cn.apexZ);
      if (ax < -20 || ay < -20 || ax > s.w + 20 || ay > s.h + 20) continue;
      const text = zoomed && cn.name ? `${cn.id} ${cn.name}` : cn.id;
      const w = ctx.measureText(text).width + 10;
      const h = 18;
      // Offset away from the map centre so the label does not cover the line.
      const dx = ax - s.w / 2;
      const dy = ay - s.h / 2;
      const len = Math.hypot(dx, dy) || 1;
      const lx = Math.min(s.w - w / 2 - 2, Math.max(w / 2 + 2, ax + (dx / len) * 18));
      const ly = Math.min(s.h - h / 2 - 2, Math.max(h / 2 + 2, ay + (dy / len) * 18));
      const focus = cn.id === p.focusCorner;
      ctx.fillStyle = focus ? C.accent : 'rgba(12,17,21,0.88)';
      ctx.strokeStyle = focus ? C.accent : 'rgba(255,178,30,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(lx - w / 2, ly - h / 2, w, h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = focus ? '#000' : C.accent;
      ctx.fillText(text, lx, ly + 0.5);
      hits.push({ id: cn.id, x: lx - w / 2, y: ly - h / 2, w, h });
    }
    hitsRef.current = hits;

    // Hover marker.
    const d = bus?.distance ?? null;
    if (d !== null) {
      p.lines.forEach((ln, li) => {
        const x = valueAt(p.distanceM, ln.x, d);
        const z = valueAt(p.distanceM, ln.z, d);
        if (x === null || z === null) return;
        ctx.fillStyle = ln.color;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(toX(x), toY(z), li === 0 ? 7 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
  }, [bus]);

  const sizeRef = useCanvasSize(canvasRef, draw);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }, [draw]);

  // Data changes draw synchronously (rAF does not run while the page is in the background);
  // only the high-rate hover marker goes through requestAnimationFrame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw when inputs change
  useEffect(() => {
    draw();
  }, [outline, distanceM, lines, corners, brakeMarkers, range, focusCorner, draw]);

  useEffect(() => (bus ? bus.subscribe(() => schedule()) : undefined), [bus, schedule]);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  const pointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top] as const;
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const pr = projRef.current;
    const subject = lines[0];
    if (!pr || !subject || !bus) return;
    const [sx, sy] = pointer(e);
    const onLabel = hitsRef.current.some(
      (h) => sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h,
    );
    e.currentTarget.style.cursor = onLabel ? 'pointer' : 'crosshair';
    // Nearest point of your line in screen space (only within 28 px).
    let best = -1;
    let bestD = 28 * 28;
    for (let i = 0; i < distanceM.length; i++) {
      const x = subject.x[i];
      const z = subject.z[i];
      if (x === null || x === undefined || z === null || z === undefined) continue;
      const dx = pr.ox + mapX(x) * pr.k - sx;
      const dy = pr.oy + mapY(z) * pr.k - sy;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    bus.set(best >= 0 ? (distanceM[best] ?? null) : null, 'map');
  };

  const onClick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const [sx, sy] = pointer(e);
    const hit = hitsRef.current.find(
      (h) => sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h,
    );
    if (hit) onCorner?.(hit.id);
  };

  return (
    <canvas
      ref={canvasRef}
      className={`a-map ${className}`}
      onPointerMove={onMove}
      onPointerLeave={() => bus?.set(null, 'map')}
      onPointerUp={onClick}
      aria-label="Mapa da pista com os traçados"
      role="img"
    />
  );
}
