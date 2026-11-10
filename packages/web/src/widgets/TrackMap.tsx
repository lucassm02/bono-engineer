/**
 * Canvas track map: outline coloured by live microsector gain/loss vs the delta reference, car
 * position + heading, a fading ~10 s trail, the next corner and its reference brake point.
 *
 * Interactive mode (Mapa view): two-finger pinch zooms (touch events, non-passive, so the carousel
 * does not scroll during the pinch); one finger only pans when zoomed in, otherwise it is left to
 * the carousel (swipe = change view). Mouse: wheel zooms at the cursor (vertical wheel / trackpad
 * pinch only; horizontal wheel still scrolls the carousel), drag pans when zoomed. While zoomed the
 * double tap resets the zoom (instead of cycling the delta reference).
 */

import type { LiveFrame } from '@gt7/shared';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { setAttr } from '../lib/dom.ts';
import {
  type Bounds,
  boundsOf,
  followPoint,
  initialView,
  isZoomed,
  lowerIndex,
  type MapViewState,
  mapX,
  mapY,
  panBy,
  pinchView,
  projection,
  toScreen,
  type Viewport,
  zoomAt,
} from '../lib/mapMath.ts';
import { microTone } from '../lib/microsectors.ts';
import { THEME } from '../lib/theme.ts';
import type { TrackGeometry } from '../lib/trackOutline.ts';
import { derived } from '../live/derived.ts';
import { live } from '../live/liveStore.ts';
import { useLiveRender, ViewActiveContext } from '../live/raf.ts';
import { clearDoubleTapOverride, setDoubleTapOverride } from '../state/gestureOverride.ts';
import { beginDraw, CANVAS_COLORS as C, type CanvasSize, useCanvasSize } from './useCanvas.ts';

const TONE_COLOR = { gain: C.gain, loss: C.loss, neutral: THEME.text2, none: '' } as const;

interface Props {
  interactive?: boolean;
  /** Corner labels and brake marker (off in the tiny widget). */
  details?: boolean;
  className?: string;
}

export interface MapUiState {
  zoomed: boolean;
  follow: boolean;
}

function viewportOf(s: CanvasSize): Viewport {
  return { w: s.w, h: s.h, pad: Math.max(6, Math.min(s.w, s.h) * 0.06) };
}

/** Point index for a lap distance on the geometry. */
function pointAt(g: TrackGeometry, d: number): number {
  return lowerIndex(g.d, d);
}

export function TrackMap({ interactive = false, details = true, className = '' }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<MapViewState | null>(null);
  const boundsRef = useRef<{ version: number; b: Bounds | null }>({ version: -1, b: null });
  const [ui, setUi] = useState<MapUiState>({ zoomed: false, follow: true });
  const uiRef = useRef(ui);
  const active = useContext(ViewActiveContext);

  const syncUi = useCallback(() => {
    const v = viewRef.current;
    const next = { zoomed: !!v && isZoomed(v), follow: v?.follow ?? true };
    if (next.zoomed !== uiRef.current.zoomed || next.follow !== uiRef.current.follow) {
      uiRef.current = next;
      setUi(next);
    }
  }, []);

  const vp = (): Viewport => viewportOf(size.current);

  const draw = (f: LiveFrame | null) => {
    const ctx = beginDraw(canvasRef.current, size.current);
    const g = derived.geometry();
    setAttr(wrapRef.current, 'data-state', g ? (g.closed ? 'ready' : 'building') : 'empty');
    if (!ctx || !g) return;
    const version = derived.geometryVersion;
    if (boundsRef.current.version !== version) {
      const b = boundsOf(g.x, g.z);
      const prev = boundsRef.current.b;
      boundsRef.current = { version, b };
      // New/grown outline: refit unless the user is zoomed in.
      if (b && (!viewRef.current || !isZoomed(viewRef.current) || !prev)) {
        viewRef.current = { ...initialView(b), follow: viewRef.current?.follow ?? true };
      }
    }
    const b = boundsRef.current.b;
    if (!b) return;
    let view = viewRef.current ?? initialView(b);
    if (f) view = followPoint(view, b, mapX(f.position.x), mapY(f.position.z));
    viewRef.current = view;
    const port = vp();
    const p = projection(view, b, port);
    const n = Math.min(g.x.length, g.z.length);
    const minSide = Math.min(port.w, port.h);
    const lw =
      Math.max(3, minSide * (details ? 0.022 : 0.03)) * Math.min(2.2, Math.sqrt(view.zoom));
    const stride = Math.max(1, Math.floor(n / (1600 * view.zoom)));
    const px = (i: number) => p.ox + mapX(g.x[i]!) * p.k;
    const py = (i: number) => p.oy + mapY(g.z[i]!) * p.k;

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Base outline.
    ctx.beginPath();
    for (let i = 0; i < n; i += stride) {
      if (i === 0) ctx.moveTo(px(i), py(i));
      else ctx.lineTo(px(i), py(i));
    }
    ctx.lineTo(px(n - 1), py(n - 1));
    if (g.closed) ctx.closePath();
    ctx.strokeStyle = C.track;
    ctx.lineWidth = lw;
    ctx.stroke();

    // Microsector colours (only on a closed, distance-aligned outline).
    const micro = derived.micro;
    const L = f?.track?.lengthM ?? g.lengthM;
    if (g.closed && L > 0) {
      ctx.lineWidth = lw * 0.5;
      let runTone = '';
      let runStale = false;
      let started = false;
      const flush = () => {
        if (started && runTone) {
          ctx.strokeStyle = runTone;
          ctx.globalAlpha = runStale ? 0.4 : 1;
          ctx.stroke();
        }
        started = false;
      };
      for (let i = 0; i < n; i += stride) {
        const k = Math.min(micro.count - 1, Math.floor((g.d[i]! / L) * micro.count));
        const v = micro.value(k);
        const color = TONE_COLOR[microTone(v.ms)];
        if (color !== runTone || v.stale !== runStale || !started) {
          if (started) {
            ctx.lineTo(px(i), py(i));
            flush();
          }
          runTone = color;
          runStale = v.stale;
          ctx.beginPath();
          ctx.moveTo(px(i), py(i));
          started = true;
        } else {
          ctx.lineTo(px(i), py(i));
        }
      }
      if (started) {
        ctx.lineTo(px(0), py(0));
        flush();
      }
      ctx.globalAlpha = 1;
    }

    // Start/finish line.
    if (n > 2) {
      const dx = px(Math.min(n - 1, stride)) - px(0);
      const dy = py(Math.min(n - 1, stride)) - py(0);
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * lw * 1.1;
      const ny = (dx / len) * lw * 1.1;
      ctx.beginPath();
      ctx.moveTo(px(0) - nx, py(0) - ny);
      ctx.lineTo(px(0) + nx, py(0) + ny);
      ctx.strokeStyle = C.text;
      ctx.lineWidth = Math.max(2, lw * 0.3);
      ctx.stroke();
    }

    const next = f?.nextCorner ?? null;
    if (details) {
      // Corner labels.
      const fontPx = Math.max(10, Math.min(15, minSide * 0.035));
      ctx.font = `600 ${fontPx}px ${C.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // The next corner first, then the others unless they would overlap a placed label.
      const placed: [number, number][] = [];
      const ordered = [...g.corners].sort(
        (a, b) => Number(b.id === next?.cornerId) - Number(a.id === next?.cornerId),
      );
      for (const c of ordered) {
        const i = pointAt(g, c.apexM);
        const j = Math.min(n - 1, i + 3);
        const tx = px(j) - px(i);
        const ty = py(j) - py(i);
        const tl = Math.hypot(tx, ty) || 1;
        // Label on the outside of the turn.
        const side = c.direction === 'left' ? 1 : -1;
        const off = lw * 1.2 + fontPx;
        const lx = px(i) + (ty / tl) * off * side;
        const ly = py(i) - (tx / tl) * off * side;
        const isNext = next?.cornerId === c.id;
        if (placed.some(([x, y]) => Math.abs(x - lx) < fontPx * 2 && Math.abs(y - ly) < fontPx))
          continue;
        placed.push([lx, ly]);
        ctx.fillStyle = isNext ? C.accent : C.dim;
        ctx.fillText(isNext && view.zoom > 1.5 && c.name ? c.name : c.id, lx, ly);
      }
      // Reference brake point of the next corner.
      if (next?.referenceBrakePointM != null && g.d.length > 0) {
        const i = pointAt(g, next.referenceBrakePointM);
        const [bx, by] = [px(i), py(i)];
        ctx.beginPath();
        ctx.arc(bx, by, lw * 0.75, 0, Math.PI * 2);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = Math.max(2, lw * 0.28);
        ctx.stroke();
      }
    }

    // Trail (oldest faint → newest strong).
    const tr = derived.trail;
    const m = tr.size;
    if (m > 2) {
      const chunks = 5;
      const per = Math.ceil(m / chunks);
      ctx.lineWidth = Math.max(2, lw * 0.32);
      ctx.strokeStyle = C.accent;
      for (let c = 0; c < chunks; c++) {
        const a = c * per;
        const z = Math.min(m - 1, a + per);
        if (z <= a) continue;
        ctx.beginPath();
        for (let j = a; j <= z; j++) {
          const k = tr.at(j);
          const [sx, sy] = toScreen(p, mapX(tr.x[k]!), mapY(tr.z[k]!));
          if (j === a) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.globalAlpha = 0.12 + (0.75 * (c + 1)) / chunks;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Car.
    if (f && (f.state === 'onTrack' || f.state === 'replay' || f.state === 'paused')) {
      const [cx, cy] = toScreen(p, mapX(f.position.x), mapY(f.position.z));
      const r = Math.max(5, lw * 0.85);
      const hx = Math.sin(f.headingRad);
      const hy = -Math.cos(f.headingRad);
      ctx.beginPath();
      ctx.moveTo(cx + hx * r * 2.1, cy + hy * r * 2.1);
      ctx.lineTo(cx - hy * r * 0.9, cy + hx * r * 0.9);
      ctx.lineTo(cx + hy * r * 0.9, cy - hx * r * 0.9);
      ctx.closePath();
      ctx.fillStyle = C.accent;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = C.accent;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = THEME.surface0;
      ctx.stroke();
    }
  };

  const size = useCanvasSize(canvasRef, () => draw(live.frame));
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useLiveRender((f) => draw(f));

  /** Applies a view change from an interaction and redraws immediately. */
  const applyView = useCallback(
    (fn: (v: MapViewState, b: Bounds, port: Viewport) => MapViewState) => {
      const b = boundsRef.current.b;
      const v = viewRef.current;
      if (!b || !v) return;
      viewRef.current = fn(v, b, viewportOf(size.current));
      drawRef.current(live.frame);
      syncUi();
    },
    [syncUi, size],
  );

  // Double tap resets the zoom while zoomed (only for the visible map).
  useEffect(() => {
    if (!interactive || !active) return;
    const h = () => {
      const v = viewRef.current;
      if (!v || !isZoomed(v)) return false;
      applyView((_v, b) => ({ ...initialView(b), follow: true }));
      return true;
    };
    setDoubleTapOverride(h);
    return () => clearDoubleTapOverride(h);
  }, [interactive, active, applyView]);

  // Touch / mouse interaction.
  useEffect(() => {
    const c = canvasRef.current;
    if (!interactive || !c) return;
    let mode: 'none' | 'pan' | 'pinch' = 'none';
    let start: MapViewState | null = null;
    let s0: { a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
    let last = { x: 0, y: 0 };
    const local = (t: { clientX: number; clientY: number }) => {
      const r = c.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const begin = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        mode = 'pinch';
        start = viewRef.current;
        s0 = { a: local(e.touches[0]!), b: local(e.touches[1]!) };
        e.preventDefault();
      } else if (e.touches.length === 1 && viewRef.current && isZoomed(viewRef.current)) {
        mode = 'pan';
        last = local(e.touches[0]!);
      } else {
        mode = 'none';
      }
    };
    const move = (e: TouchEvent) => {
      if (mode === 'pinch' && e.touches.length >= 2 && start && s0) {
        if (e.cancelable) e.preventDefault();
        const a1 = local(e.touches[0]!);
        const b1 = local(e.touches[1]!);
        const st = start;
        const g0 = s0;
        applyView((_v, b, port) => pinchView(st, b, port, g0.a, g0.b, a1, b1));
      } else if (mode === 'pan' && e.touches.length === 1) {
        if (e.cancelable) e.preventDefault();
        const pt = local(e.touches[0]!);
        const dx = pt.x - last.x;
        const dy = pt.y - last.y;
        last = pt;
        applyView((v, b, port) => panBy(v, b, port, dx, dy));
      }
    };
    const end = (e: TouchEvent) => {
      if (e.touches.length === 0) mode = 'none';
      else begin(e);
    };
    const wheel = (e: WheelEvent) => {
      // Horizontal wheel = carousel scroll; vertical wheel or trackpad pinch (ctrl) = zoom.
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const pt = local(e);
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      applyView((v, b, port) => zoomAt(v, b, port, factor, pt.x, pt.y));
    };
    let dragging: number | null = null;
    const pdown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      if (!viewRef.current || !isZoomed(viewRef.current)) return;
      dragging = e.pointerId;
      last = local(e);
      c.setPointerCapture(e.pointerId);
    };
    const pmove = (e: PointerEvent) => {
      if (dragging !== e.pointerId) return;
      const pt = local(e);
      const dx = pt.x - last.x;
      const dy = pt.y - last.y;
      last = pt;
      applyView((v, b, port) => panBy(v, b, port, dx, dy));
    };
    const pup = (e: PointerEvent) => {
      if (dragging === e.pointerId) dragging = null;
    };
    c.addEventListener('touchstart', begin, { passive: false });
    c.addEventListener('touchmove', move, { passive: false });
    c.addEventListener('touchend', end);
    c.addEventListener('touchcancel', end);
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('pointerdown', pdown);
    c.addEventListener('pointermove', pmove);
    c.addEventListener('pointerup', pup);
    c.addEventListener('pointercancel', pup);
    return () => {
      c.removeEventListener('touchstart', begin);
      c.removeEventListener('touchmove', move);
      c.removeEventListener('touchend', end);
      c.removeEventListener('touchcancel', end);
      c.removeEventListener('wheel', wheel);
      c.removeEventListener('pointerdown', pdown);
      c.removeEventListener('pointermove', pmove);
      c.removeEventListener('pointerup', pup);
      c.removeEventListener('pointercancel', pup);
    };
  }, [interactive, applyView]);

  const zoomBy = (factor: number) =>
    applyView((v, b, port) => zoomAt(v, b, port, factor, port.w / 2, port.h / 2));

  return (
    <div
      className={`track-map ${className}`}
      ref={wrapRef}
      data-state="empty"
      data-zoomed={ui.zoomed ? '1' : '0'}
    >
      <canvas ref={canvasRef} className="track-map-canvas" />
      <div className="track-map-empty">
        {details ? 'Sem traçado ainda: dirija uma volta para desenhar o mapa' : 'Sem mapa'}
      </div>
      {interactive && (
        <div className="map-controls" data-no-gesture>
          <button
            type="button"
            className="ui-icon-btn"
            aria-label="Aproximar"
            onClick={() => zoomBy(1.6)}
          >
            +
          </button>
          <button
            type="button"
            className="ui-icon-btn"
            aria-label="Afastar"
            disabled={!ui.zoomed}
            onClick={() => zoomBy(1 / 1.6)}
          >
            −
          </button>
          {ui.zoomed && (
            <button
              type="button"
              className="ui-icon-btn map-follow"
              aria-pressed={ui.follow}
              aria-label="Seguir o carro"
              title="Seguir o carro"
              onClick={() => applyView((v) => ({ ...v, follow: !v.follow }))}
            >
              ◎
            </button>
          )}
          {ui.zoomed && (
            <button
              type="button"
              className="ui-icon-btn"
              aria-label="Ver a pista toda"
              title="Ver a pista toda"
              onClick={() => applyView((_v, b) => ({ ...initialView(b), follow: true }))}
            >
              ⤢
            </button>
          )}
        </div>
      )}
    </div>
  );
}
