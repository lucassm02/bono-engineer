/**
 * Track geometry for the map: `GET /api/analysis/tracks/:trackId` in server mode (shape
 * {@link TrackAnalysisResponse}), the mock's own polyline in demo mode. When the endpoint is
 * missing/404 the map falls back to the outline built from live positions (live/derived.ts).
 */

import { geometryFromResponse, type TrackGeometry } from '../lib/trackOutline.ts';

export type GeometryStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/** Minimum time between two attempts for a track whose endpoint failed. */
const RETRY_MS = 30_000;

export function trackGeometryUrl(trackId: string): string {
  return `/api/analysis/tracks/${encodeURIComponent(trackId)}`;
}

class TrackGeometryStore {
  geometry: TrackGeometry | null = null;
  trackId: string | null = null;
  status: GeometryStatus = 'idle';
  /** Bumps on every change (renderers compare it). */
  version = 0;
  private lastAttempt = 0;
  private mock = false;

  /** Demo mode: fixed geometry, no requests. */
  setMock(g: TrackGeometry): void {
    this.mock = true;
    this.geometry = g;
    this.trackId = g.trackId;
    this.status = 'ready';
    this.version++;
  }

  clear(): void {
    this.mock = false;
    this.geometry = null;
    this.trackId = null;
    this.status = 'idle';
    this.lastAttempt = 0;
    this.version++;
  }

  /** Called when the live track id changes (server mode). */
  request(trackId: string | null): void {
    if (this.mock) return;
    if (trackId === this.trackId && this.status !== 'unavailable') return;
    if (trackId !== this.trackId) {
      this.trackId = trackId;
      this.geometry = null;
      this.status = 'idle';
      this.lastAttempt = 0;
      this.version++;
    }
    if (trackId) void this.load(trackId);
  }

  /** Retries a failed track (e.g. after a lap closed, when the server may have built it). */
  retry(): void {
    if (this.status === 'unavailable' && this.trackId) void this.load(this.trackId);
  }

  private async load(trackId: string): Promise<void> {
    const now = Date.now();
    if (this.status === 'loading' || now - this.lastAttempt < RETRY_MS) return;
    this.lastAttempt = now;
    this.status = 'loading';
    let g: TrackGeometry | null = null;
    try {
      const res = await fetch(trackGeometryUrl(trackId), {
        headers: { accept: 'application/json' },
      });
      if (res.ok) g = geometryFromResponse(trackId, await res.json());
    } catch {
      g = null;
    }
    if (this.trackId !== trackId || this.mock) return;
    this.geometry = g;
    this.status = g ? 'ready' : 'unavailable';
    this.version++;
  }
}

export const trackGeometry = new TrackGeometryStore();
