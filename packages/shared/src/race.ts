/**
 * Races and session kinds (spec 21): what the live frame says about the race in progress and what
 * the API returns for a finished one.
 *
 * The packet of a Sport Mode race carries the driver's own position and the number of cars still
 * in the race (`preRacePosition` / `numCarsPreRace`, live during the race despite their names),
 * the number of laps (`totalLaps`) and nothing about the other cars. Pure types (isomorphic).
 */

import type { Id, Session, SessionEvent, SessionKind } from './domain.ts';

interface RaceFinishPosition {
  at: number;
  position: number | null;
  gainedOnFinalLap?: number;
}

/** The race in progress (or just finished) as shown by the live panel. */
export interface LiveRace {
  state: 'racing' | 'finished';
  /** Epoch ms of this attempt, including a restart on the same grid. */
  startedAt?: number;
  /** Position when the car crossed the finish line, before the official result settles. */
  chequered?: RaceFinishPosition;
  /** Same confirmed result that is saved with the race. */
  result?: RaceFinishPosition;
  /** Laps of the race, held after the flag (the game resets its own to 0). */
  totalLaps: number;
  /** Position held for at least 2 s (side by side it flips every second); null while unknown. */
  position: number | null;
  /** Cars still in the race. */
  cars: number | null;
  /** Where the race started. Null when joined after the start. */
  startPosition: number | null;
  /** Places gained since the start (+ better, − worse); null without a start position. */
  gained: number | null;
  /** Impacts detected so far. */
  impacts: number;
  /** Timestamp of the last confirmed abrupt loss of speed. */
  lastImpactAt?: number;
  /** The last stable change of position, for the arrow of the panel. */
  lastChange: { from: number; to: number; at: number } | null;
}

/** `GET /api/sessions/:id/race`: the result of a race and what happened on the way. */
export interface ApiSessionRace {
  session: Session;
  events: SessionEvent[];
}

/** `PATCH /api/sessions/:id` body. */
export interface ApiSessionPatch {
  /** Null clears the kind ("sem etiqueta"). */
  kind: SessionKind | null;
}

/** `PATCH /api/sessions` body: the same kind for several sessions. */
export interface ApiSessionsKindBatch {
  ids: Id[];
  kind: SessionKind | null;
}

/** Setting: what to do when a session that is not a race closes. */
export type SessionKindDefault = 'ask' | 'practice' | 'qualifying';

export const SESSION_KIND_DEFAULTS: readonly SessionKindDefault[] = [
  'ask',
  'practice',
  'qualifying',
] as const;

/** Lap counter as shown to the driver: never past the laps of the race. */
export function raceLapDisplay(lapCount: number, totalLaps: number | null): number {
  if (totalLaps && totalLaps > 0) return Math.max(0, Math.min(lapCount, totalLaps));
  return lapCount;
}
