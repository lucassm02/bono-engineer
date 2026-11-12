/** Lap-time goals (spec 13): validation, the suggested target and the progress towards it (pure). */

import type { ApiGoalSuggestion } from './api.ts';
import { GOAL_RANGE_MS } from './domain.ts';

export type GoalCheck =
  | { ok: true; targetMs: number }
  /** `invalid`: not a usable time; `slower`: slower than the driver's best lap. */
  | { ok: false; reason: 'invalid' | 'slower' };

/**
 * A goal is a time between 10 s and 1 hour. A target slower than the best lap is refused unless
 * the driver insists (it is a goal for later, but usually a typing mistake).
 */
export function checkGoal(
  targetMs: unknown,
  bestLapMs: number | null,
  allowSlower = false,
): GoalCheck {
  if (typeof targetMs !== 'number' || !Number.isFinite(targetMs)) {
    return { ok: false, reason: 'invalid' };
  }
  const ms = Math.round(targetMs);
  if (ms < GOAL_RANGE_MS[0] || ms > GOAL_RANGE_MS[1]) return { ok: false, reason: 'invalid' };
  if (!allowSlower && bestLapMs !== null && ms >= bestLapMs) {
    return { ok: false, reason: 'slower' };
  }
  return { ok: true, targetMs: ms };
}

/** Share of the best lap a suggested goal asks for (0.5 %). */
export const GOAL_SUGGEST_SHAVE = 0.005;

/**
 * A realistic target: the ideal lap (sum of the best sectors) or the best lap minus 0.5 %,
 * whichever is slower, so the suggestion never goes past what the driver already did in parts.
 * Null without a best lap, or when the best lap is already at the ideal.
 */
export function suggestGoal(
  bestLapMs: number | null,
  idealLapMs: number | null,
): ApiGoalSuggestion | null {
  if (bestLapMs === null || bestLapMs <= 0) return null;
  const shaved = Math.round(bestLapMs * (1 - GOAL_SUGGEST_SHAVE));
  const ideal = idealLapMs !== null && idealLapMs > 0 && idealLapMs < bestLapMs ? idealLapMs : null;
  if (ideal !== null && ideal >= shaved) {
    return { targetMs: Math.round(ideal), basis: 'idealLap', idealLapMs: Math.round(ideal) };
  }
  return {
    targetMs: shaved,
    basis: 'bestLap',
    idealLapMs: ideal === null ? null : Math.round(ideal),
  };
}

export interface GoalProgress {
  /** Gap from the best lap to the goal (ms, > 0 while it is not reached; 0 once reached). */
  remainingMs: number;
  /** 0–1 of the way from the starting lap to the goal; 1 once reached. Null without a start. */
  fraction: number | null;
  reached: boolean;
}

/** Where the driver stands: `startMs` is the best lap when the goal was set. */
export function goalProgress(
  targetMs: number,
  bestLapMs: number,
  startMs: number | null,
): GoalProgress {
  const reached = bestLapMs <= targetMs;
  const remainingMs = Math.max(0, bestLapMs - targetMs);
  if (reached) return { remainingMs: 0, fraction: 1, reached };
  if (startMs === null || startMs <= targetMs) return { remainingMs, fraction: null, reached };
  const fraction = (startMs - bestLapMs) / (startMs - targetMs);
  return { remainingMs, fraction: Math.min(1, Math.max(0, fraction)), reached };
}
