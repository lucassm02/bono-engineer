/**
 * Track map of the lap replay (canvas): the outline, the lap line (the part already driven in full
 * colour), the corner labels (click = go there) and ONE dot that moves with the replay clock, plus
 * the ghost dot of the reference when there is one. Clicking the line seeks to that point.
 *
 * It draws straight from the player (outside React): the dot moves at frame rate without
 * re-rendering the page.
 */

import type { MapCorner } from '@gt7/shared';
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from 'react';
import { t as uiText } from '../../lib/i18n.ts';
import { boundsOf, fitScale, mapX, mapY } from '../../lib/mapMath.ts';
import { THEME, withAlpha } from '../../lib/theme.ts';
import { useCanvasSize } from '../../widgets/useCanvas.ts';
import type { Series } from '../lib/chartData.ts';

export interface ReplayMapLine {
  x: Series;
  z: Series;
  color: string;
}

export interface MapDots {
  subject: { x: number; z: number } | null;
  ghost: { x: number; z: number } | null;
  /** Lap distance of the subject: the line is drawn in full colour up to here. */
  distanceM: number;
}

interface Props {
  outline: { x: number[]; z: number[] } | null;
  /** Distance grid of the lines. */
  gridM: number[];
  subject: ReplayMapLine;
  ghost: ReplayMapLine | null;
  corners: MapCorner[];
  focusCorner: string | null;
  /** Registers the function that redraws the dots (called by the page at every frame). */
  bindDraw: (draw: (dots: MapDots) => void) => () => void;
  initial: MapDots;
  onCorner: (cornerId: string) => void;
  onSeek: (distanceM: number) => void;
}

interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function ReplayMap({
  outline,
  gridM,
  subject,
  ghost,
  corners,
  focusCorner,
  bindDraw,
  initial,
  onCorner,
  onSeek,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitsRef = useRef<Hit[]>([]);
  const projRef = useRef<{ k: number; ox: number; oy: number } | null>(null);
  const dotsRef = useRef<MapDots>(initial);
  const props = useRef({ outline, gridM, subject, ghost, corners, focusCorner });
  props.current = { outline, gridM, subject, ghost, corners, focusCorner };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads refs only (size, props, dots)
  const draw = useCallback(() => {
    const c = canvasRef.current;
    const s = sizeRef.current;
    if (!c || s.w <= 1) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    const p = props.current;
    const dots = dotsRef.current;

    const b =
      (p.outline && boundsOf(p.outline.x, p.outline.z)) ||
      boundsOf(
        p.subject.x.map((v) => v ?? Number.NaN),
        p.subject.z.map((v) => v ?? Number.NaN),
      );
    if (!b) {
      ctx.fillStyle = THEME.text3;
      ctx.font = `14px ${THEME.font}`;
      ctx.textAlign = 'center';
      ctx.fillText(uiText('Sem traçado da pista'), s.w / 2, s.h / 2);
      return;
    }
    const k = fitScale(b, { w: s.w, h: s.h, pad: 22 });
    const ox = s.w / 2 - ((b.minX + b.maxX) / 2) * k;
    const oy = s.h / 2 - ((b.minY + b.maxY) / 2) * k;
    projRef.current = { k, ox, oy };
    const toX = (x: number) => ox + mapX(x) * k;
    const toY = (z: number) => oy + mapY(z) * k;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (p.outline && p.outline.x.length > 1) {
      ctx.strokeStyle = THEME.surface4;
      ctx.lineWidth = Math.min(40, Math.max(7, 12 * k));
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

    const trace = (ln: ReplayMapLine, upTo: number, from = 0) => {
      ctx.beginPath();
      let pen = false;
      for (let i = from; i < p.gridM.length && p.gridM[i]! <= upTo; i++) {
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
    };
    const end = p.gridM[p.gridM.length - 1] ?? 0;

    if (p.ghost) {
      ctx.strokeStyle = withAlpha(p.ghost.color, 0.45);
      ctx.lineWidth = 2;
      trace(p.ghost, end);
    }
    // The lap: faint ahead of the car, full colour behind it.
    ctx.strokeStyle = withAlpha(p.subject.color, 0.32);
    ctx.lineWidth = 3;
    trace(p.subject, end);
    ctx.strokeStyle = p.subject.color;
    ctx.lineWidth = 3.4;
    trace(p.subject, dots.distanceM);

    // Start / finish.
    const x0 = p.subject.x[0];
    const z0 = p.subject.z[0];
    if (x0 !== null && x0 !== undefined && z0 !== null && z0 !== undefined) {
      ctx.fillStyle = THEME.text;
      ctx.fillRect(toX(x0) - 3, toY(z0) - 3, 6, 6);
    }

    // Corner labels.
    const hits: Hit[] = [];
    ctx.font = `600 12px ${THEME.font}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const cn of p.corners) {
      if (!Number.isFinite(cn.apexX) || !Number.isFinite(cn.apexZ)) continue;
      const ax = toX(cn.apexX);
      const ay = toY(cn.apexZ);
      const w = ctx.measureText(cn.id).width + 10;
      const h = 18;
      const dx = ax - s.w / 2;
      const dy = ay - s.h / 2;
      const len = Math.hypot(dx, dy) || 1;
      const lx = Math.min(s.w - w / 2 - 2, Math.max(w / 2 + 2, ax + (dx / len) * 18));
      const ly = Math.min(s.h - h / 2 - 2, Math.max(h / 2 + 2, ay + (dy / len) * 18));
      const focus = cn.id === p.focusCorner;
      ctx.fillStyle = focus ? THEME.accent : withAlpha(THEME.surface1, 0.9);
      ctx.strokeStyle = focus ? THEME.accent : THEME.lineStrong;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(lx - w / 2, ly - h / 2, w, h, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = focus ? THEME.surface0 : THEME.text;
      ctx.fillText(cn.id, lx, ly + 0.5);
      hits.push({ id: cn.id, x: lx - w / 2, y: ly - h / 2, w, h });
    }
    hitsRef.current = hits;

    // The dots: the reference as a ring (so it stays visible when both are at the same spot), the
    // car as the filled dot on top.
    if (dots.ghost) {
      const gx = toX(dots.ghost.x);
      const gy = toY(dots.ghost.z);
      ctx.fillStyle = withAlpha(p.ghost?.color ?? THEME.chart2, 0.35);
      ctx.strokeStyle = p.ghost?.color ?? THEME.chart2;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(gx, gy, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (dots.subject) {
      ctx.fillStyle = p.subject.color;
      ctx.strokeStyle = THEME.surface0;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(toX(dots.subject.x), toY(dots.subject.z), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, []);

  const sizeRef = useCanvasSize(canvasRef, draw);

  useEffect(
    () =>
      bindDraw((dots) => {
        dotsRef.current = dots;
        draw();
      }),
    [bindDraw, draw],
  );

  // Data changes redraw at once (the page is not playing then, or the next frame follows).
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw when inputs change
  useEffect(() => {
    draw();
  }, [outline, gridM, subject, ghost, corners, focusCorner, draw]);

  const pointer = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top] as const;
  };

  const labelAt = (sx: number, sy: number) =>
    hitsRef.current.find((h) => sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h);

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const [sx, sy] = pointer(e);
    e.currentTarget.style.cursor = labelAt(sx, sy) ? 'pointer' : 'crosshair';
  };

  const onClick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const [sx, sy] = pointer(e);
    const hit = labelAt(sx, sy);
    if (hit) {
      onCorner(hit.id);
      return;
    }
    const pr = projRef.current;
    if (!pr) return;
    // Nearest point of the lap line in screen space (within 32 px).
    let best = -1;
    let bestD = 32 * 32;
    for (let i = 0; i < gridM.length; i++) {
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
    if (best >= 0) onSeek(gridM[best]!);
  };

  return (
    <canvas
      ref={canvasRef}
      className="a-map rp-map"
      onPointerMove={onMove}
      onPointerUp={onClick}
      role="img"
      aria-label={uiText(
        'Mapa da pista com o carro do replay. Use a barra de tempo ou os botões de curva para mover.',
      )}
    />
  );
}
