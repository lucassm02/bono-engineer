/**
 * Weekly summary: what the driver did in a 7-day window, per track and car. Pure and deterministic:
 * the caller (core's analysis service) gathers the sessions and answers the two questions that need
 * the history — the best lap before the window and the active goal — so this stays testable.
 */

import type { Id, WeeklyGoalReached, WeeklySummary, WeeklyTrackRow } from '@gt7/shared';

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

export interface WeeklySessionInput {
  trackId: Id | null;
  carCode: number;
  startedAt: number;
  endedAt: number | null;
  /** The driver's own laps (no reference or replay laps). */
  laps: readonly { timeMs: number; valid: boolean }[];
}

export interface WeeklyInput {
  /** `weeksAgo` 0 = the 7 days ending at `now`, 1 = the 7 days before them... */
  weeksAgo: number;
  now: number;
  sessions: readonly WeeklySessionInput[];
  /** Best valid own lap on the track and car before the window, null when none. */
  previousBestMs: (trackId: Id, carCode: number) => number | null;
  /** The active goal of the track for the car (ms), null when none. */
  goalMs: (trackId: Id, carCode: number) => number | null;
  trackName: (trackId: Id) => string | null;
  goalsReached: readonly WeeklyGoalReached[];
}

/** The window of a week: [from, to). */
export function weekWindow(weeksAgo: number, now: number): { fromMs: number; toMs: number } {
  const toMs = now - weeksAgo * WEEK_MS;
  return { fromMs: toMs - WEEK_MS, toMs };
}

export function buildWeeklySummary(input: WeeklyInput): WeeklySummary {
  const { fromMs, toMs } = weekWindow(input.weeksAgo, input.now);
  const inWindow = input.sessions.filter((s) => s.startedAt >= fromMs && s.startedAt < toMs);

  // Group by track, then by the car used most (a track driven with two cars is two rows).
  const groups = new Map<string, WeeklySessionInput[]>();
  for (const s of inWindow) {
    if (!s.trackId) continue;
    const key = `${s.trackId}|${s.carCode}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  const tracks: WeeklyTrackRow[] = [];
  for (const list of groups.values()) {
    const first = list[0]!;
    const trackId = first.trackId!;
    const laps = list.flatMap((s) => s.laps);
    const valid = laps.filter((l) => l.valid);
    const bestMs = valid.length ? Math.min(...valid.map((l) => l.timeMs)) : null;
    const previousBestMs = input.previousBestMs(trackId, first.carCode);
    const deltaMs = bestMs !== null && previousBestMs !== null ? bestMs - previousBestMs : null;
    const overallBest =
      bestMs === null
        ? previousBestMs
        : previousBestMs === null
          ? bestMs
          : Math.min(bestMs, previousBestMs);
    const goalMs = input.goalMs(trackId, first.carCode);
    tracks.push({
      trackId,
      trackName: input.trackName(trackId),
      carCode: first.carCode,
      sessions: list.length,
      laps: laps.length,
      validLaps: valid.length,
      bestMs,
      previousBestMs,
      deltaMs,
      isRecord: bestMs !== null && previousBestMs !== null && bestMs < previousBestMs,
      firstTime: bestMs !== null && previousBestMs === null,
      goal:
        goalMs === null || overallBest === null
          ? null
          : {
              targetMs: goalMs,
              reached: overallBest <= goalMs,
              remainingMs: Math.max(0, overallBest - goalMs),
            },
    });
  }
  tracks.sort((a, b) => b.laps - a.laps || (a.bestMs ?? Infinity) - (b.bestMs ?? Infinity));

  const drivingMs = inWindow.reduce(
    (sum, s) => sum + (s.endedAt !== null && s.endedAt > s.startedAt ? s.endedAt - s.startedAt : 0),
    0,
  );
  return {
    weeksAgo: input.weeksAgo,
    fromMs,
    toMs,
    sessions: inWindow.length,
    laps: inWindow.reduce((n, s) => n + s.laps.length, 0),
    validLaps: inWindow.reduce((n, s) => n + s.laps.filter((l) => l.valid).length, 0),
    drivingMs,
    tracks,
    records: tracks.filter((t) => t.isRecord).length,
    goalsReached: input.goalsReached
      .filter((g) => g.achievedAt >= fromMs && g.achievedAt < toMs)
      .sort((a, b) => b.achievedAt - a.achievedAt),
  };
}
