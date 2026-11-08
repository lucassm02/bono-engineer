/**
 * Rolling history of a few channels for charts, without per-frame allocations.
 *
 * Each channel is a "double ring": every sample is written at `i` and `i + capacity`, so the last
 * N samples are always contiguous at `[head + capacity - N, head + capacity)` and can be handed to
 * uPlot as a `subarray` view.
 */

export const HISTORY_CHANNELS = ['t', 'throttle', 'brake', 'speed'] as const;
export type HistoryChannel = (typeof HISTORY_CHANNELS)[number];

export class RollingHistory {
  readonly capacity: number;
  private readonly data: Record<HistoryChannel, Float64Array>;
  private head = 0;
  private count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = {
      t: new Float64Array(capacity * 2),
      throttle: new Float64Array(capacity * 2),
      brake: new Float64Array(capacity * 2),
      speed: new Float64Array(capacity * 2),
    };
  }

  push(sample: Record<HistoryChannel, number>): void {
    const i = this.head;
    for (const c of HISTORY_CHANNELS) {
      const arr = this.data[c];
      arr[i] = sample[c];
      arr[i + this.capacity] = sample[c];
    }
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  /** Contiguous view of the last `n` samples (oldest first) of a channel. */
  view(channel: HistoryChannel, n = this.count): Float64Array {
    const k = Math.min(n, this.count);
    const end = this.head + this.capacity;
    return this.data[channel].subarray(end - k, end);
  }

  /** Number of trailing samples whose `t` is within `windowS` of the newest. */
  countWithin(windowS: number): number {
    if (this.count === 0) return 0;
    const t = this.view('t');
    const newest = t[t.length - 1]!;
    let lo = 0;
    let hi = t.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid]! < newest - windowS) lo = mid + 1;
      else hi = mid;
    }
    return t.length - lo;
  }
}
