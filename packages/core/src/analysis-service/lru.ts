/** Minimal LRU cache (Map insertion order) with optional size accounting. */
export class LruCache<K, V> {
  readonly maxEntries: number;
  #map = new Map<K, V>();
  hits = 0;
  misses = 0;

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get size(): number {
    return this.#map.size;
  }

  get(key: K): V | undefined {
    const v = this.#map.get(key);
    if (v === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.#map.delete(key);
    this.#map.set(key, v);
    return v;
  }

  has(key: K): boolean {
    return this.#map.has(key);
  }

  set(key: K, value: V): void {
    if (this.#map.has(key)) this.#map.delete(key);
    this.#map.set(key, value);
    while (this.#map.size > this.maxEntries) {
      const oldest = this.#map.keys().next().value as K;
      this.#map.delete(oldest);
    }
  }

  delete(key: K): boolean {
    return this.#map.delete(key);
  }

  /** Deletes every entry whose key matches. */
  deleteWhere(pred: (key: K, value: V) => boolean): number {
    let n = 0;
    for (const [k, v] of [...this.#map]) {
      if (pred(k, v)) {
        this.#map.delete(k);
        n++;
      }
    }
    return n;
  }

  clear(): void {
    this.#map.clear();
  }
}
