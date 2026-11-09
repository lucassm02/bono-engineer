/**
 * Remembered window size/position. Pure functions: the Electron side only feeds them the saved
 * JSON and the displays' work areas.
 */

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_WINDOW: WindowState = { width: 1280, height: 800, maximized: false };
export const MIN_SIZE = { width: 800, height: 560 };
const MAX_DIM = 20_000;
/** At least this much of the window must stay on some screen, or it is moved back (centered). */
const MIN_VISIBLE = { width: 160, height: 80 };

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validates what was read from disk; anything odd → null (defaults). */
export function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.width) || !finite(r.height)) return null;
  const width = Math.round(r.width);
  const height = Math.round(r.height);
  if (width < MIN_SIZE.width || height < MIN_SIZE.height || width > MAX_DIM || height > MAX_DIM) {
    return null;
  }
  const state: WindowState = { width, height, maximized: r.maximized === true };
  if (finite(r.x) && finite(r.y) && Math.abs(r.x) <= MAX_DIM && Math.abs(r.y) <= MAX_DIM) {
    state.x = Math.round(r.x);
    state.y = Math.round(r.y);
  }
  return state;
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, w), height: Math.max(0, h) };
}

/**
 * The state to open the window with: the saved size (shrunk to the biggest screen) and position
 * (dropped, so the OS centers it, when the screen it was on is gone — unplugged monitor).
 */
export function fitWindowState(saved: WindowState | null, workAreas: Rect[]): WindowState {
  const base = saved ?? DEFAULT_WINDOW;
  const out: WindowState = { width: base.width, height: base.height, maximized: base.maximized };
  const biggest = workAreas.reduce<Rect | null>(
    (best, a) => (!best || a.width * a.height > best.width * best.height ? a : best),
    null,
  );
  if (biggest) {
    out.width = Math.min(out.width, biggest.width);
    out.height = Math.min(out.height, biggest.height);
  }
  if (base.x !== undefined && base.y !== undefined) {
    const rect: Rect = { x: base.x, y: base.y, width: out.width, height: out.height };
    const visible = workAreas.some((a) => {
      const o = overlap(rect, a);
      return o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height;
    });
    if (visible) {
      out.x = base.x;
      out.y = base.y;
    }
  }
  return out;
}
