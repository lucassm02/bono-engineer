/**
 * Stints (spec 09): the stretches of a session between two visits to the pits.
 *
 * The packet has no "pit" field, but a visit to the pits has a clear signature (the game pauses,
 * loads, puts the car stopped in its box with the lap counter untouched, and the car drives off
 * a few seconds later). The live engine stores each visit as a `pit` event of the session; the
 * stints are derived from those events and the laps, so nothing else is stored (and nothing to
 * migrate). Pure functions (isomorphic).
 */

import type { Id, Lap, SessionEvent } from './domain.ts';

/** A stint of a session. */
export interface Stint {
  /** 1-based, in order. */
  number: number;
  /** Epoch ms. The first stint starts with the session; the next ones when the car leaves the box. */
  startedAt: number;
  /** Epoch ms of the visit to the pits that closed it; null for the last (open or ended with the session). */
  endedAt: number | null;
  /** How long the car stood in the pits before this stint (ms); null for the first. */
  pitMs: number | null;
  lapIds: Id[];
  lapCount: number;
  validLapCount: number;
  bestLapMs: number | null;
  /** Mean of the valid laps (ms), the ones in the box excluded; null without any. */
  avgLapMs: number | null;
  /** Standard deviation of the valid laps (ms); null with fewer than 3. */
  spreadMs: number | null;
}

/** The visits to the pits of a session, in order. */
export interface PitVisit {
  /** Epoch ms the car arrived in its box. */
  at: number;
  /** Epoch ms it left. */
  exitAt: number;
  /** Game lap counter at the time. */
  lap: number;
}

/** The pit events of a session as visits (ignores anything else, and malformed events). */
export function pitVisits(events: readonly SessionEvent[]): PitVisit[] {
  const out: PitVisit[] = [];
  for (const e of events) {
    if (e.kind !== 'pit') continue;
    const exitAt = typeof e.data.exitAt === 'number' ? e.data.exitAt : null;
    if (exitAt === null || exitAt < e.at) continue;
    out.push({ at: e.at, exitAt, lap: e.lap });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * The stints of a session. A lap belongs to the stint in which it started; the lap that was in
 * progress when the car went into the box is not saved by the engine, so no lap falls in between.
 * A stint without laps (a visit right at the start, or the car left standing in the box when the
 * session ended) says nothing, so it is left out and the numbers stay consecutive.
 */
export function deriveStints(
  sessionStartedAt: number,
  laps: readonly Lap[],
  events: readonly SessionEvent[],
): Stint[] {
  const visits = pitVisits(events);
  const bounds: { startedAt: number; endedAt: number | null; pitMs: number | null }[] = [];
  let start = sessionStartedAt;
  let pit: number | null = null;
  for (const v of visits) {
    bounds.push({ startedAt: start, endedAt: v.at, pitMs: pit });
    start = v.exitAt;
    pit = v.exitAt - v.at;
  }
  bounds.push({ startedAt: start, endedAt: null, pitMs: pit });

  const sorted = [...laps].sort((a, b) => a.startedAt - b.startedAt);
  const all = bounds.map((b) => {
    const mine = sorted.filter(
      (l) => l.startedAt >= b.startedAt && (b.endedAt === null || l.startedAt < b.endedAt),
    );
    const valid = mine.filter((l) => l.valid);
    const times = valid.map((l) => l.timeMs);
    const avg = times.length ? times.reduce((s, v) => s + v, 0) / times.length : null;
    const spread =
      avg !== null && times.length >= 3
        ? Math.sqrt(times.reduce((s, v) => s + (v - avg) ** 2, 0) / times.length)
        : null;
    return {
      number: 0,
      startedAt: b.startedAt,
      endedAt: b.endedAt,
      pitMs: b.pitMs,
      lapIds: mine.map((l) => l.id),
      lapCount: mine.length,
      validLapCount: valid.length,
      bestLapMs: times.length ? Math.min(...times) : null,
      avgLapMs: avg === null ? null : Math.round(avg),
      spreadMs: spread === null ? null : Math.round(spread),
    };
  });
  const kept = all.filter((s) => s.lapCount > 0);
  return (kept.length ? kept : all.slice(0, 1)).map((s, i) => ({ ...s, number: i + 1 }));
}

/** The stint number of each lap (by id). */
export function stintOfLaps(stints: readonly Stint[]): Map<Id, number> {
  const out = new Map<Id, number>();
  for (const s of stints) for (const id of s.lapIds) out.set(id, s.number);
  return out;
}
