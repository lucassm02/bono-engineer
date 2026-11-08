/** Canvas sizing helper for rAF renderers: keeps the backing store at CSS size × DPR (≤ 2). */

import { type RefObject, useEffect, useRef } from 'react';

export interface CanvasSize {
  /** CSS pixels. */
  w: number;
  h: number;
  dpr: number;
}

/**
 * Observes the canvas size; `onResize` runs after the backing store changed (redraw there, since
 * resizing clears the canvas).
 */
export function useCanvasSize(
  ref: RefObject<HTMLCanvasElement | null>,
  onResize: () => void,
): RefObject<CanvasSize> {
  const size = useRef<CanvasSize>({ w: 0, h: 0, dpr: 1 });
  const cb = useRef(onResize);
  cb.current = onResize;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const apply = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, c.clientWidth);
      const h = Math.max(1, c.clientHeight);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (c.width !== bw || c.height !== bh) {
        c.width = bw;
        c.height = bh;
      }
      size.current = { w, h, dpr };
      cb.current();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(c);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** 2D context scaled to CSS pixels and cleared; null when unavailable. */
export function beginDraw(
  c: HTMLCanvasElement | null,
  s: CanvasSize,
): CanvasRenderingContext2D | null {
  if (!c || s.w <= 1) return null;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.clearRect(0, 0, s.w, s.h);
  return ctx;
}

/** Colours shared by canvas renderers (mirror of the CSS tokens). */
export const CANVAS_COLORS = {
  text: '#f1f4f6',
  dim: '#8592a0',
  faint: '#46515c',
  line: '#222c34',
  panel: '#0c1115',
  track: '#2b343c',
  accent: '#ffb21e',
  gain: '#22e07a',
  loss: '#ff3d4a',
  neutral: '#7c8995',
  purple: '#b266ff',
  font: 'Bahnschrift, "DIN Alternate", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif',
} as const;
