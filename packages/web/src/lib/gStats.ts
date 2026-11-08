/** G-force trail and peaks (pure, allocation-free per sample). */

export interface GPeaks {
  /** Max lateral to the left (g, ≥ 0). */
  left: number;
  right: number;
  /** Max longitudinal acceleration (g, ≥ 0). */
  accel: number;
  /** Max braking deceleration (g, ≥ 0). */
  brake: number;
  /** Max combined √(lat² + lon²). */
  combined: number;
  /** Max |vertical − 1| (g), null when the channel is unavailable. */
  vertical: number | null;
}

/** Samples above this (g) are treated as spikes (crash, teleport) and ignored for peaks. */
export const G_SPIKE = 6;

export function emptyPeaks(): GPeaks {
  return { left: 0, right: 0, accel: 0, brake: 0, combined: 0, vertical: null };
}

function addPeak(p: GPeaks, lat: number, lon: number, vert: number | null): void {
  if (lat > p.left) p.left = lat;
  if (-lat > p.right) p.right = -lat;
  if (lon > p.accel) p.accel = lon;
  if (-lon > p.brake) p.brake = -lon;
  const c = Math.hypot(lat, lon);
  if (c > p.combined) p.combined = c;
  if (vert !== null && Number.isFinite(vert)) {
    const v = Math.abs(vert - 1);
    if (p.vertical === null || v > p.vertical) p.vertical = v;
  }
}

export class GStats {
  readonly capacity: number;
  /** Trail ring (oldest → newest via {@link forEachTrail}). */
  private readonly lat: Float32Array;
  private readonly lon: Float32Array;
  private head = 0;
  private count = 0;
  lap: GPeaks = emptyPeaks();
  session: GPeaks = emptyPeaks();
  /** Peaks of the previous lap (shown at the start of a new lap). */
  lastLap: GPeaks | null = null;
  private lapNo: number | null = null;

  constructor(capacity = 90) {
    this.capacity = capacity;
    this.lat = new Float32Array(capacity);
    this.lon = new Float32Array(capacity);
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.lap = emptyPeaks();
    this.session = emptyPeaks();
    this.lastLap = null;
    this.lapNo = null;
  }

  push(lat: number, lon: number, vertical: number | null, lap: number): void {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (this.lapNo !== lap) {
      if (this.lapNo !== null) this.lastLap = this.lap;
      this.lap = emptyPeaks();
      this.lapNo = lap;
    }
    this.lat[this.head] = lat;
    this.lon[this.head] = lon;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    if (Math.abs(lat) > G_SPIKE || Math.abs(lon) > G_SPIKE) return;
    addPeak(this.lap, lat, lon, vertical);
    addPeak(this.session, lat, lon, vertical);
  }

  get size(): number {
    return this.count;
  }

  /** Calls `fn(lat, lon, age)` oldest first; age 1 = oldest … 0 = newest (fraction). */
  forEachTrail(fn: (lat: number, lon: number, age: number) => void): void {
    const n = this.count;
    for (let j = 0; j < n; j++) {
      const i = (this.head - n + j + this.capacity) % this.capacity;
      fn(this.lat[i]!, this.lon[i]!, n <= 1 ? 0 : 1 - j / (n - 1));
    }
  }
}

/** Circle full scale (g): 2 g, expanding in 0.5 g steps when the session peak exceeds it. */
export function gScale(sessionPeak: number): number {
  return Math.max(2, Math.ceil((sessionPeak * 1.05) / 0.5) * 0.5);
}
