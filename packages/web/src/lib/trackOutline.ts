/**
 * Track geometry used by the map, plus the progressive outline builder used when the server has
 * no centerline for the track (REST 404) or the track is unknown.
 */

import type { Corner } from '@gt7/shared';

/** Polyline of the track with the lap distance of every point (ascending). */
export interface TrackGeometry {
  /** Track id, null when built from live positions of an unidentified track. */
  trackId: string | null;
  x: ArrayLike<number>;
  z: ArrayLike<number>;
  /** Lap distance (m) of each point, ascending. */
  d: ArrayLike<number>;
  lengthM: number;
  corners: Corner[];
  /** Start distance of each sector (first = 0), empty when unknown. */
  sectorStartsM: number[];
  /** Where it came from: server analysis, the demo mock, or built from live positions. */
  source: 'server' | 'mock' | 'live';
  /** False while it is still an open, partial outline (first lap). */
  closed: boolean;
}

/** Shape of `GET /api/analysis/tracks/:trackId`. */
export interface TrackAnalysisResponse {
  track: { id: string; name?: string; lengthM?: number } & Record<string, unknown>;
  polyline: { x: number[]; z: number[]; stepM: number; lengthM?: number };
  corners: Corner[];
  sectorStartsM: number[];
}

/** Validates/converts the REST payload; null when malformed. */
export function geometryFromResponse(trackId: string, body: unknown): TrackGeometry | null {
  if (typeof body !== 'object' || body === null) return null;
  const r = body as Partial<TrackAnalysisResponse>;
  const p = r.polyline;
  if (!p || !Array.isArray(p.x) || !Array.isArray(p.z) || p.x.length < 10) return null;
  const n = Math.min(p.x.length, p.z.length);
  const step = typeof p.stepM === 'number' && p.stepM > 0 ? p.stepM : 1;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = i * step;
  const lengthM =
    typeof p.lengthM === 'number' && p.lengthM > 0
      ? p.lengthM
      : typeof r.track?.lengthM === 'number' && r.track.lengthM > 0
        ? r.track.lengthM
        : n * step;
  return {
    trackId,
    x: p.x.slice(0, n),
    z: p.z.slice(0, n),
    d,
    lengthM,
    corners: Array.isArray(r.corners) ? r.corners : [],
    sectorStartsM: Array.isArray(r.sectorStartsM) ? r.sectorStartsM : [],
    source: 'server',
    closed: true,
  };
}

/** Minimum spacing between stored outline points (m). */
const OUTLINE_STEP_M = 2;
/** A jump larger than this between two frames is a teleport (restart, rewind): start over. */
const TELEPORT_M = 60;
/** End-to-start gap (m) below which a lap outline counts as closed. */
const CLOSE_GAP_M = 40;
const MAX_POINTS = 20000;

interface Loop {
  x: Float32Array;
  z: Float32Array;
  d: Float32Array;
  lengthM: number;
  gapM: number;
}

/**
 * Builds the track outline from live positions. Points are kept every ≥ 2 m with their lap
 * distance; when a lap ends (lap number changes) and the path closes on itself it becomes a
 * candidate loop, and the best-closed loop (smallest end-to-start gap) is kept. Until then the
 * current partial path is exposed.
 */
export class TrackOutlineBuilder {
  private xs: number[] = [];
  private zs: number[] = [];
  private ds: number[] = [];
  private pathLen = 0;
  private lap: number | null = null;
  private best: Loop | null = null;
  /** Bumps whenever {@link geometry} would return something different. */
  version = 0;
  private cache: TrackGeometry | null = null;
  private cacheVersion = -1;

  reset(): void {
    this.xs = [];
    this.zs = [];
    this.ds = [];
    this.pathLen = 0;
    this.lap = null;
    this.best = null;
    this.version++;
  }

  get hasLoop(): boolean {
    return this.best !== null;
  }

  private restart(): void {
    this.xs = [];
    this.zs = [];
    this.ds = [];
    this.pathLen = 0;
  }

  private closeLap(expectedLengthM: number | null): void {
    const n = this.xs.length;
    if (n < 50 || this.pathLen < 400) return;
    const gap = Math.hypot(this.xs[0]! - this.xs[n - 1]!, this.zs[0]! - this.zs[n - 1]!);
    if (gap > CLOSE_GAP_M) return;
    if (expectedLengthM && Math.abs(this.pathLen - expectedLengthM) > expectedLengthM * 0.08)
      return;
    if (this.best && gap >= this.best.gapM) return;
    this.best = {
      x: Float32Array.from(this.xs),
      z: Float32Array.from(this.zs),
      d: Float32Array.from(this.ds),
      lengthM: expectedLengthM ?? this.pathLen + gap,
      gapM: gap,
    };
    this.version++;
  }

  /**
   * Feeds one on-track frame. `distanceM` = lap distance from the core when known (keeps the map
   * aligned with sectors/microsectors), else the travelled path length is used.
   */
  push(x: number, z: number, distanceM: number | null, lap: number, lengthM: number | null): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (this.lap !== lap) {
      if (this.lap !== null) this.closeLap(lengthM);
      this.lap = lap;
      this.restart();
    }
    const n = this.xs.length;
    if (n > 0) {
      const step = Math.hypot(x - this.xs[n - 1]!, z - this.zs[n - 1]!);
      if (step > TELEPORT_M) {
        this.restart();
      } else if (step < OUTLINE_STEP_M) {
        return;
      } else {
        this.pathLen += step;
      }
    }
    if (this.xs.length >= MAX_POINTS) return;
    let d = distanceM ?? this.pathLen;
    const last = this.ds[this.ds.length - 1];
    if (last !== undefined && d < last) d = last; // keep ascending for lookups
    this.xs.push(x);
    this.zs.push(z);
    this.ds.push(d);
    if (!this.best) this.version++;
  }

  /** Best closed loop, else the current partial path (null when too short to draw). */
  geometry(trackId: string | null): TrackGeometry | null {
    if (this.cacheVersion === this.version && this.cache?.trackId === trackId) return this.cache;
    let g: TrackGeometry | null = null;
    if (this.best) {
      g = {
        trackId,
        x: this.best.x,
        z: this.best.z,
        d: this.best.d,
        lengthM: this.best.lengthM,
        corners: [],
        sectorStartsM: [],
        source: 'live',
        closed: true,
      };
    } else if (this.xs.length >= 2) {
      g = {
        trackId,
        x: this.xs.slice(),
        z: this.zs.slice(),
        d: this.ds.slice(),
        lengthM: Math.max(1, this.pathLen),
        corners: [],
        sectorStartsM: [],
        source: 'live',
        closed: false,
      };
    }
    this.cache = g;
    this.cacheVersion = this.version;
    return g;
  }
}
