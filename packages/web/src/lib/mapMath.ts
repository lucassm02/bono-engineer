/**
 * Track map projection and zoom/pan math (pure).
 *
 * Map plane: `mx = −x`, `my = −z` (north-up, fixed orientation: GT7 +Z is "up" on screen and +X is
 * to the LEFT). This is the same view as the MCP comparison PNG (chart.ts) and follows the shared
 * heading convention (θ = 0 → +Z, direction (sin θ, cos θ), + curvature = LEFT turn): with X
 * mirrored, a left turn is drawn counter-clockwise, i.e. it looks like a left turn.
 * The real game's handedness is still unverified (first PS5 test): if the maps look mirrored on
 * the console, flip `mapX` here and `vx` in chart.ts together.
 */

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Viewport {
  w: number;
  h: number;
  /** Padding (px) kept around the fitted track. */
  pad: number;
}

/** Zoom 1 = whole track fitted; `cx/cy` = map-plane point at the viewport centre. */
export interface MapViewState {
  zoom: number;
  cx: number;
  cy: number;
  /** When zoomed, keep the car centred (manual panning turns it off). */
  follow: boolean;
}

/** Screen = (ox + mx·k, oy + my·k). */
export interface Projection {
  k: number;
  ox: number;
  oy: number;
}

export const MAP_ZOOM_MIN = 1;
export const MAP_ZOOM_MAX = 12;
/** Zoom level above which the map "owns" one-finger drags and double tap. */
export const MAP_ZOOMED_EPS = 1.02;

export function mapX(x: number): number {
  return -x;
}

export function mapY(z: number): number {
  return -z;
}

/** Bounds of a polyline in the map plane (−x, −z); null when empty. */
export function boundsOf(xs: ArrayLike<number>, zs: ArrayLike<number>): Bounds | null {
  const n = Math.min(xs.length, zs.length);
  if (n === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const x = mapX(xs[i]!);
    const y = mapY(zs[i]!);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minY, maxY };
}

/** Pixels per metre that fit the bounds in the viewport (zoom 1). */
export function fitScale(b: Bounds, vp: Viewport): number {
  const w = Math.max(1, b.maxX - b.minX);
  const h = Math.max(1, b.maxY - b.minY);
  const aw = Math.max(1, vp.w - 2 * vp.pad);
  const ah = Math.max(1, vp.h - 2 * vp.pad);
  return Math.max(1e-6, Math.min(aw / w, ah / h));
}

export function initialView(b: Bounds): MapViewState {
  return { zoom: 1, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, follow: true };
}

export function isZoomed(v: MapViewState): boolean {
  return v.zoom > MAP_ZOOMED_EPS;
}

export function projection(v: MapViewState, b: Bounds, vp: Viewport): Projection {
  const k = fitScale(b, vp) * v.zoom;
  return { k, ox: vp.w / 2 - v.cx * k, oy: vp.h / 2 - v.cy * k };
}

export function toScreen(p: Projection, mx: number, my: number): [number, number] {
  return [p.ox + mx * p.k, p.oy + my * p.k];
}

export function toMap(p: Projection, sx: number, sy: number): [number, number] {
  return [(sx - p.ox) / p.k, (sy - p.oy) / p.k];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Clamps zoom and keeps the centre inside the track bounds; zoom 1 re-centres the whole track. */
export function clampView(v: MapViewState, b: Bounds): MapViewState {
  const zoom = clamp(v.zoom, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
  if (zoom <= MAP_ZOOMED_EPS) {
    return { zoom: 1, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, follow: v.follow };
  }
  return {
    zoom,
    cx: clamp(v.cx, b.minX, b.maxX),
    cy: clamp(v.cy, b.minY, b.maxY),
    follow: v.follow,
  };
}

/** Zooms by `factor` keeping the map point under the screen point (sx, sy) fixed. */
export function zoomAt(
  v: MapViewState,
  b: Bounds,
  vp: Viewport,
  factor: number,
  sx: number,
  sy: number,
): MapViewState {
  const [wx, wy] = toMap(projection(v, b, vp), sx, sy);
  const zoom = clamp(v.zoom * factor, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
  const k = fitScale(b, vp) * zoom;
  return clampView(
    { zoom, cx: wx - (sx - vp.w / 2) / k, cy: wy - (sy - vp.h / 2) / k, follow: v.follow },
    b,
  );
}

/** Drags the map by (dx, dy) screen pixels; manual panning stops following the car. */
export function panBy(
  v: MapViewState,
  b: Bounds,
  vp: Viewport,
  dx: number,
  dy: number,
): MapViewState {
  if (!isZoomed(v)) return v;
  const k = fitScale(b, vp) * v.zoom;
  return clampView({ zoom: v.zoom, cx: v.cx - dx / k, cy: v.cy - dy / k, follow: false }, b);
}

export interface Pt {
  x: number;
  y: number;
}

/**
 * Two-finger pinch from the state at gesture start: zoom by the finger distance ratio around the
 * initial midpoint, then translate by the midpoint motion.
 */
export function pinchView(
  start: MapViewState,
  b: Bounds,
  vp: Viewport,
  a0: Pt,
  b0: Pt,
  a1: Pt,
  b1: Pt,
): MapViewState {
  const d0 = Math.max(1, Math.hypot(a0.x - b0.x, a0.y - b0.y));
  const d1 = Math.max(1, Math.hypot(a1.x - b1.x, a1.y - b1.y));
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  const z = zoomAt(start, b, vp, d1 / d0, m0.x, m0.y);
  const moved = Math.hypot(m1.x - m0.x, m1.y - m0.y) > 0.5;
  return moved ? panBy(z, b, vp, m1.x - m0.x, m1.y - m0.y) : z;
}

/** Centres on the car when zoomed in follow mode. */
export function followPoint(v: MapViewState, b: Bounds, mx: number, my: number): MapViewState {
  if (!v.follow || !isZoomed(v)) return v;
  if (v.cx === mx && v.cy === my) return v;
  return clampView({ ...v, cx: mx, cy: my }, b);
}

/** Index of the last element ≤ `value` in an ascending array (0 when below the first). */
export function lowerIndex(sorted: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  if (hi < 0) return 0;
  if (value <= sorted[0]!) return 0;
  if (value >= sorted[hi]!) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sorted[mid]! <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Wraps a lap distance into [0, L). */
export function wrapDistance(d: number, lengthM: number): number {
  if (!(lengthM > 0)) return d;
  return ((d % lengthM) + lengthM) % lengthM;
}

/** Signed difference a − b on a closed lap, in (−L/2, L/2]. */
export function lapDiff(a: number, b: number, lengthM: number | null): number {
  const d = a - b;
  if (!lengthM || !(lengthM > 0)) return d;
  return d - Math.round(d / lengthM) * lengthM;
}
