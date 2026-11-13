/**
 * Corridas diárias: pequenas funções puras da tela (sem React) para casar a corrida com uma pista
 * que o piloto já tem, dizer onde a melhor volta dele cai nas medalhas e listar os horários.
 */

import { type DailyRace, getTrackLayout, normalizeTrackText } from '@gt7/shared';

const key = (s: string): string => normalizeTrackText(s).replace(/[^a-z0-9]+/g, '');

/** Names a saved track may carry for the same layout (source tracks use the catalogue's naming). */
function layoutKeys(race: Pick<DailyRace, 'trackName' | 'trackLayoutId'>): Set<string> {
  const keys = new Set<string>([key(race.trackName)]);
  const layout = getTrackLayout(race.trackLayoutId);
  if (layout) {
    keys.add(key(layout.officialName));
    keys.add(key(layout.displayName));
    keys.add(key(`${layout.venue}${layout.layout}`));
    if (!layout.layoutLabel) keys.add(key(layout.venue));
  }
  return keys;
}

/** The saved track of the pilot that is the same circuit (and layout) as the race, if any. */
export function matchSavedTrack<
  T extends { name: string; layout?: string | null; lapCount?: number },
>(race: Pick<DailyRace, 'trackName' | 'trackLayoutId'>, tracks: readonly T[]): T | null {
  const keys = layoutKeys(race);
  const hits = tracks.filter((t) => {
    const full = key(`${t.name}${t.layout ?? ''}`);
    return keys.has(full) || keys.has(key(t.name));
  });
  // Reverse layouts share the venue name: prefer the exact full-name match, then the most laps.
  hits.sort((a, b) => (b.lapCount ?? 0) - (a.lapCount ?? 0));
  const exact = hits.find((t) => keys.has(key(`${t.name}${t.layout ?? ''}`)));
  return exact ?? hits[0] ?? null;
}

export type MedalName = 'platinum' | 'gold' | 'silver' | 'bronze';

export interface MedalStatus {
  /** Best medal the time already reaches, or null when it is slower than bronze. */
  reached: MedalName | null;
  /** The next medal up and how far it is (ms), or null at platinum. */
  next: { medal: MedalName; gapMs: number } | null;
}

const ORDER: readonly MedalName[] = ['platinum', 'gold', 'silver', 'bronze'];

/** Where a lap time falls among the medal cut-offs (a lower time is better). */
export function medalStatus(timeMs: number, medals: NonNullable<DailyRace['medals']>): MedalStatus {
  let reached: MedalName | null = null;
  for (const name of ORDER) {
    if (timeMs <= medals[name].timeMs) {
      reached = name;
      break;
    }
  }
  if (reached === 'platinum') return { reached, next: null };
  const idx = reached ? ORDER.indexOf(reached) - 1 : ORDER.length - 1;
  const medal = ORDER[idx]!;
  return { reached, next: { medal, gapMs: timeMs - medals[medal].timeMs } };
}

/** Minutes past the hour at which a race starts: every 20 min from :10 gives [10, 30, 50]. */
export function raceMinutes(everyMinutes: number | null, offsetMinutes: number | null): number[] {
  if (!everyMinutes || everyMinutes < 1 || everyMinutes > 60) return [];
  const first = (((offsetMinutes ?? 0) % everyMinutes) + everyMinutes) % everyMinutes;
  const out: number[] = [];
  for (let m = first; m < 60; m += everyMinutes) out.push(m);
  return out;
}

/** ":10 :30 :50". */
export function formatRaceMinutes(minutes: readonly number[]): string {
  return minutes.map((m) => `:${String(m).padStart(2, '0')}`).join(' ');
}

/** ms as "1:59,089" (comma, pt-BR) or "1:59.089" for the capture form field. */
export function leaderTimeText(ms: number): string {
  const total = Math.round(ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

export interface DailyGoalSuggestion {
  /** The race of the week whose medal is the target. */
  race: Pick<DailyRace, 'id' | 'type' | 'carLabel' | 'trackName'>;
  /** The next medal above the driver's best lap on this track. */
  medal: MedalName;
  /** Cut-off time of that medal (ms): the suggested goal. */
  targetMs: number;
  /** How far the best lap is from it (ms, > 0). */
  gapMs: number;
  /** The medal the best lap already reaches, null when slower than bronze. */
  reached: MedalName | null;
}

/**
 * A goal from this week's Daily Races: the next medal above the best lap, on a race that runs on
 * this track. With several races on the same track the closest medal wins. Null without a race on
 * the track, without medal times, without a best lap, or when the best lap is already platinum.
 */
export function dailyGoalSuggestion<T extends { name: string; layout?: string | null }>(
  track: T,
  bestLapMs: number | null,
  races: readonly DailyRace[],
): DailyGoalSuggestion | null {
  if (bestLapMs === null || bestLapMs <= 0) return null;
  let best: DailyGoalSuggestion | null = null;
  for (const race of races) {
    if (!race.medals || !matchSavedTrack(race, [track])) continue;
    const status = medalStatus(bestLapMs, race.medals);
    if (!status.next) continue;
    const candidate: DailyGoalSuggestion = {
      race: { id: race.id, type: race.type, carLabel: race.carLabel, trackName: race.trackName },
      medal: status.next.medal,
      targetMs: race.medals[status.next.medal].timeMs,
      gapMs: status.next.gapMs,
      reached: status.reached,
    };
    if (!best || candidate.gapMs < best.gapMs) best = candidate;
  }
  return best;
}
