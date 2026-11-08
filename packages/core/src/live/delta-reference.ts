/** A stored lap prepared for live delta lookups (time at distance) and sector comparisons. */

import type { Id, Lap, LapTrace } from '@gt7/shared';
import { upperIndex } from '../util/math.ts';

export interface StoredLap {
  lap: Lap;
  trace: LapTrace;
}

export class DeltaReference {
  readonly lap: Lap;
  readonly trace: LapTrace;
  /** Non-decreasing distance grid. */
  readonly dist: Float64Array;
  readonly time: Float64Array;
  readonly speedMps: Float64Array;
  readonly lengthM: number;

  constructor(stored: StoredLap) {
    this.lap = stored.lap;
    this.trace = stored.trace;
    const n = stored.trace.length;
    const d = stored.trace.channels.distanceM;
    const t = stored.trace.channels.tMs;
    const v = stored.trace.channels.speedKmh;
    this.dist = new Float64Array(n);
    this.time = new Float64Array(n);
    this.speedMps = new Float64Array(n);
    let maxD = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const di = Number(d[i]);
      maxD = Math.max(maxD, Number.isFinite(di) ? di : maxD);
      this.dist[i] = Number.isFinite(maxD) ? maxD : 0;
      this.time[i] = Number(t[i]);
      this.speedMps[i] = Number(v[i]) / 3.6;
    }
    this.lengthM = n ? this.dist[n - 1]! : 0;
  }

  get lapId(): Id {
    return this.lap.id;
  }

  get timeMs(): number {
    return this.lap.timeMs;
  }

  /** Reference elapsed time (ms) at distance d, extrapolated with the edge speed. */
  timeAt(d: number): number {
    const n = this.dist.length;
    if (n === 0) return Number.NaN;
    if (d <= this.dist[0]!) {
      const v = Math.max(1, this.speedMps[0]!);
      return this.time[0]! - ((this.dist[0]! - d) / v) * 1000;
    }
    if (d >= this.dist[n - 1]!) {
      const v = Math.max(1, this.speedMps[n - 1]!);
      return Math.min(this.lap.timeMs, this.time[n - 1]! + ((d - this.dist[n - 1]!) / v) * 1000);
    }
    const i = upperIndex(this.dist, d);
    const d0 = this.dist[i]!;
    const d1 = this.dist[i + 1]!;
    const t0 = this.time[i]!;
    const t1 = this.time[i + 1]!;
    return d1 > d0 ? t0 + ((t1 - t0) * (d - d0)) / (d1 - d0) : t0;
  }

  /** Index of the sample at/just before distance d. */
  indexAt(d: number): number {
    return Math.max(0, upperIndex(this.dist, d));
  }
}
