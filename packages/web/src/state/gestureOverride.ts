/**
 * Lets the visible view claim a global gesture. The Mapa view claims the double tap while zoomed
 * (it resets the zoom instead of cycling the delta reference).
 */

type Handler = () => boolean;

let doubleTap: Handler | null = null;

/** Registers (or clears with null) the double-tap handler; it returns true when it handled it. */
export function setDoubleTapOverride(h: Handler | null): void {
  doubleTap = h;
}

export function clearDoubleTapOverride(h: Handler): void {
  if (doubleTap === h) doubleTap = null;
}

/** True when the visible view consumed the double tap. */
export function handleDoubleTapOverride(): boolean {
  return doubleTap?.() ?? false;
}
