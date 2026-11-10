/** Canvas sizing helper for rAF renderers: keeps the backing store at CSS size × DPR (≤ 2). */

import { type RefObject, useEffect, useRef } from 'react';
import { THEME } from '../lib/theme.ts';

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

/** Colours shared by canvas renderers (derived from the design tokens in lib/theme.ts). */
export const CANVAS_COLORS = {
  text: THEME.text,
  dim: THEME.text2,
  faint: THEME.text3,
  line: THEME.line,
  panel: THEME.surface2,
  track: THEME.lineStrong,
  accent: THEME.accent,
  gain: THEME.gain,
  loss: THEME.loss,
  neutral: THEME.text3,
  purple: THEME.purple,
  font: THEME.font,
} as const;
