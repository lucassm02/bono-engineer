/**
 * Shared hover position (lap distance) between the synced charts and the track map, outside React
 * (hover changes at mouse rate must not re-render the page).
 */

export type CursorSource = 'chart' | 'map';

export class CursorBus {
  distance: number | null = null;
  source: CursorSource = 'chart';
  #listeners = new Set<(d: number | null, source: CursorSource) => void>();

  set(d: number | null, source: CursorSource): void {
    if (
      d === this.distance ||
      (d !== null && this.distance !== null && Math.abs(d - this.distance) < 1e-6)
    ) {
      return;
    }
    this.distance = d;
    this.source = source;
    for (const fn of this.#listeners) fn(d, source);
  }

  subscribe(fn: (d: number | null, source: CursorSource) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
}
