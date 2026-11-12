/**
 * Gran Turismo 7 Daily Races (A, B and C of the week) as the app shows them: the rules of each race
 * and a few aggregate numbers (medal cut-off times, top 100 / top 1000, most used cars).
 *
 * Source: DG EDGE (https://www.dg-edge.com/events/dailies), fetched from the user's own PC and
 * cached there. No player names or leaderboard rows are kept. Every race carries the link back to
 * the source so the user can read the full page.
 */

export const DAILY_SOURCE_NAME = 'DG EDGE';
export const DAILY_SOURCE_URL = 'https://www.dg-edge.com/events/dailies';

export type DailyRaceType = 'A' | 'B' | 'C';

export interface DailyMedal {
  /** Cut-off lap time (ms). */
  timeMs: number;
  /** Share of the players who reached this medal (0-100). */
  percentPlayers: number;
}

export interface DailyCarUsage {
  name: string;
  /** Share of the players using this car (0-100). */
  percent: number;
}

export interface DailyRace {
  /** Id on the source (stable). */
  id: number;
  type: DailyRaceType;
  week: number;
  year: number;
  /** ISO 8601 UTC of the week's start and end. */
  from: string;
  to: string;
  /** Track as the Bono catalogue names it, or a readable version of the source's name. */
  trackName: string;
  /** Id of the layout in the Bono catalogue (to link to the user's history), when matched. */
  trackLayoutId: string | null;
  /** Specific car ("Honda Integra Type R (DC2) '95") or class ("Gr.3"). */
  carLabel: string;
  /** Class when the race is open to a category ("Gr.3"), otherwise null. */
  carClass: string | null;
  laps: number;
  /** Tyre codes ("RM", "CS"...). */
  tyres: string[];
  timeOfDay: string | null;
  /** Fuel and tyre wear multipliers. */
  fuelRate: number | null;
  tyreWear: number | null;
  bop: boolean | null;
  damage: string | null;
  startType: 'rolling' | 'grid' | null;
  tuningAllowed: boolean | null;
  slipstream: string | null;
  /** A race starts every `everyMinutes`, at `offsetMinutes` past the hour. */
  everyMinutes: number | null;
  offsetMinutes: number | null;
  players: number | null;
  top100Ms: number | null;
  top1000Ms: number | null;
  medals: {
    platinum: DailyMedal;
    gold: DailyMedal;
    silver: DailyMedal;
    bronze: DailyMedal;
  } | null;
  mostUsedCars: DailyCarUsage[];
  /**
   * First place of the ranking, as the race page shows it. Only this row is kept (the rest of the
   * ranking is the source's own service): it is what the reference capture asks for.
   */
  leader: DailyLeader | null;
  /** Page of this race on the source. */
  url: string;
}

export interface DailyLeader {
  /** Name as published on the ranking. */
  name: string;
  /** Country code of the player ("JP"), when shown. */
  country: string | null;
  timeMs: number;
  /** Car of the fastest lap. */
  car: string | null;
}

export interface DailyWeek {
  week: number;
  year: number;
  from: string;
  to: string;
}

/** Past races: only what is needed to remember "when did this track last run". */
export interface DailyPastRace {
  id: number;
  type: DailyRaceType;
  week: number;
  year: number;
  trackName: string;
  trackLayoutId: string | null;
  carLabel: string;
  laps: number;
  players: number | null;
  url: string;
}

export interface ApiDailyRaces {
  /** The user turned the integration off. Nothing is fetched. */
  enabled: boolean;
  source: { name: string; url: string };
  /** When the data was fetched from the source (ms), null if never. */
  fetchedAt: number | null;
  /** The cached data is older than the refresh interval or the last attempt failed. */
  stale: boolean;
  /** Human-readable reason of the last failed attempt, if any. */
  error: string | null;
  week: DailyWeek | null;
  /** The three races of the current week. */
  races: DailyRace[];
  /** The previous weeks (newest first). */
  past: DailyPastRace[];
  /** Earliest moment a manual refresh is accepted (ms). */
  nextRefreshAt: number;
}
