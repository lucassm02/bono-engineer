/**
 * Laps of the current session (low frequency, zustand) for the Tempos and Combustível views.
 *
 * Filled from `lapCompleted` events (WS or mock) and, in server mode, from REST on session change:
 * `GET /api/sessions/:id/laps` (fallback `GET /api/laps?sessionId=:id`), body `Lap[]` or
 * `{ laps: Lap[] }`. 404/errors are tolerated (events alone are enough).
 */

import type { Lap, LapCompletedEvent } from '@gt7/shared';
import { create } from 'zustand';
import { type LapRow, lapRowFromEvent, lapRowFromLap, mergeLapRows } from '../lib/lapStats.ts';

export interface SessionLapsState {
  sessionId: string | null;
  laps: LapRow[];
  /** All-time personal best seen (reference lap time while the delta is vs personal best). */
  personalBestMs: number | null;
  remote: 'idle' | 'loading' | 'loaded' | 'unavailable';
}

export const useSessionLaps = create<SessionLapsState>()(() => ({
  sessionId: null,
  laps: [],
  personalBestMs: null,
  remote: 'idle',
}));

/** Session laps endpoints tried in order (the server wave owns the final route). */
export function sessionLapsUrls(sessionId: string): string[] {
  const id = encodeURIComponent(sessionId);
  return [`/api/sessions/${id}/laps`, `/api/laps?sessionId=${id}`];
}

function parseLaps(body: unknown): Lap[] | null {
  const arr = Array.isArray(body)
    ? body
    : typeof body === 'object' && body !== null && Array.isArray((body as { laps?: unknown }).laps)
      ? (body as { laps: unknown[] }).laps
      : null;
  if (!arr) return null;
  return arr.filter(
    (l): l is Lap =>
      typeof l === 'object' &&
      l !== null &&
      typeof (l as Lap).id === 'string' &&
      typeof (l as Lap).timeMs === 'number' &&
      Array.isArray((l as Lap).sectorTimesMs),
  );
}

async function fetchLaps(sessionId: string): Promise<void> {
  useSessionLaps.setState({ remote: 'loading' });
  for (const url of sessionLapsUrls(sessionId)) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) continue;
      const laps = parseLaps(await res.json());
      if (!laps) continue;
      if (useSessionLaps.getState().sessionId !== sessionId) return;
      useSessionLaps.setState((s) => ({
        laps: mergeLapRows(s.laps, laps.filter((l) => !l.isReference).map(lapRowFromLap)),
        remote: 'loaded',
      }));
      return;
    } catch {
      // try the next route
    }
  }
  if (useSessionLaps.getState().sessionId === sessionId) {
    useSessionLaps.setState({ remote: 'unavailable' });
  }
}

/** New (or no) session: clears the table and optionally loads it from the server. */
export function setSessionId(sessionId: string | null, loadRemote: boolean): void {
  const s = useSessionLaps.getState();
  if (s.sessionId === sessionId) return;
  useSessionLaps.setState({ sessionId, laps: [], remote: 'idle' });
  if (sessionId && loadRemote) void fetchLaps(sessionId);
}

export function recordLap(e: LapCompletedEvent): void {
  const s = useSessionLaps.getState();
  if (s.sessionId !== e.sessionId) {
    useSessionLaps.setState({ sessionId: e.sessionId, laps: [], remote: 'idle' });
  }
  useSessionLaps.setState((st) => ({
    laps: mergeLapRows(st.laps, [lapRowFromEvent(e)]),
    personalBestMs:
      e.valid && e.isPersonalBest && (st.personalBestMs === null || e.timeMs < st.personalBestMs)
        ? e.timeMs
        : st.personalBestMs,
  }));
}

export function notePersonalBest(ms: number): void {
  if (useSessionLaps.getState().personalBestMs !== ms) {
    useSessionLaps.setState({ personalBestMs: ms });
  }
}

export function resetSessionLaps(): void {
  useSessionLaps.setState({ sessionId: null, laps: [], personalBestMs: null, remote: 'idle' });
}
