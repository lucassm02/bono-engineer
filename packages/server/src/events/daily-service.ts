/**
 * Daily Races from DG EDGE, fetched on the user's own PC and cached in the data folder.
 *
 * Politeness rules (all enforced here, none optional):
 *  - identifies itself (`User-Agent: BonoEngineer/<version> (+repository)`);
 *  - checks `robots.txt` for the paths it uses and stops if they are not allowed;
 *  - one request at a time, a pause between the race pages, a timeout and a size limit;
 *  - at most one fetch per hour (data is cached), six hours after a failure, and a manual refresh
 *    only every ten minutes;
 *  - same host only (a redirect elsewhere is refused);
 *  - off until the user says yes to a one-time question; can be turned off again at any time, and
 *    then nothing is requested.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type ApiDailyRaces,
  DAILY_SOURCE_NAME,
  DAILY_SOURCE_URL,
  type DailyPastRace,
  type DailyRace,
  type DailyWeek,
} from '@gt7/shared';
import {
  DailyParseError,
  DG_EDGE_DAILIES_PATH,
  DG_EDGE_ORIGIN,
  parseDailyDetail,
  parseDailyList,
  robotsAllows,
  withDetail,
} from './dg-edge.ts';

export const REFRESH_INTERVAL_MS = 60 * 60_000;
export const FAILURE_BACKOFF_MS = 6 * 60 * 60_000;
export const MANUAL_REFRESH_GAP_MS = 10 * 60_000;
const ROBOTS_TTL_MS = 24 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const DETAIL_PAUSE_MS = 1_500;
const MAX_BYTES = 4 * 1024 * 1024;
const FIRST_LOAD_WAIT_MS = 20_000;

interface CacheFile {
  version: 1;
  fetchedAt: number | null;
  lastAttemptAt: number;
  error: string | null;
  week: DailyWeek | null;
  races: DailyRace[];
  past: DailyPastRace[];
}

export interface DailyServiceOptions {
  /** Where `cache/daily-races.json` goes. `null` keeps everything in memory (tests, demo). */
  dataDir: string | null;
  appVersion: string;
  /**
   * Persisted answer (the settings table): `null` until the user answers the one-time question.
   * Nothing is requested unless it is `true`.
   */
  enabled: { get(): boolean | null; set(value: boolean): void };
  fetchFn?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  origin?: string;
}

export class DailyRacesService {
  readonly #opts: DailyServiceOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #origin: string;
  readonly #file: string | null;
  #cache: CacheFile;
  #inflight: Promise<void> | null = null;
  #robots: { at: number; body: string } | null = null;

  constructor(opts: DailyServiceOptions) {
    this.#opts = opts;
    this.#fetch = opts.fetchFn ?? fetch;
    this.#now = opts.now ?? Date.now;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#origin = opts.origin ?? DG_EDGE_ORIGIN;
    this.#file = opts.dataDir ? join(opts.dataDir, 'cache', 'daily-races.json') : null;
    this.#cache = this.#load();
  }

  #load(): CacheFile {
    const empty: CacheFile = {
      version: 1,
      fetchedAt: null,
      lastAttemptAt: 0,
      error: null,
      week: null,
      races: [],
      past: [],
    };
    if (!this.#file || !existsSync(this.#file)) return empty;
    try {
      const raw = JSON.parse(readFileSync(this.#file, 'utf8')) as CacheFile;
      return raw.version === 1 ? raw : empty;
    } catch {
      return empty;
    }
  }

  #save(): void {
    if (!this.#file) return;
    try {
      mkdirSync(dirname(this.#file), { recursive: true });
      const tmp = `${this.#file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.#cache));
      renameSync(tmp, this.#file);
    } catch {
      // the cache is a convenience; losing it only costs one more request
    }
  }

  get enabled(): boolean {
    return this.#opts.enabled.get() === true;
  }

  /** Whether the user already answered the one-time question. */
  get asked(): boolean {
    return this.#opts.enabled.get() !== null;
  }

  setEnabled(value: boolean): void {
    this.#opts.enabled.set(value);
  }

  #retryAt(): number {
    const c = this.#cache;
    const base = c.error ? FAILURE_BACKOFF_MS : REFRESH_INTERVAL_MS;
    return Math.max(c.lastAttemptAt, c.fetchedAt ?? 0) + base;
  }

  /** What the API answers: the cache and how fresh it is. */
  snapshot(): ApiDailyRaces {
    const now = this.#now();
    const c = this.#cache;
    return {
      enabled: this.enabled,
      asked: this.asked,
      source: { name: DAILY_SOURCE_NAME, url: DAILY_SOURCE_URL },
      fetchedAt: c.fetchedAt,
      stale: this.enabled && (c.fetchedAt === null || now - c.fetchedAt > REFRESH_INTERVAL_MS),
      error: c.error,
      week: c.week,
      races: c.races,
      past: c.past,
      nextRefreshAt: Math.max(now, c.lastAttemptAt + MANUAL_REFRESH_GAP_MS),
    };
  }

  /**
   * The cached data, refreshed in the background when it is old. The very first call (nothing
   * cached) waits for the fetch so the page has something to show.
   */
  async get(): Promise<ApiDailyRaces> {
    if (!this.enabled) return this.snapshot();
    const due = this.#now() >= this.#retryAt();
    if (this.#cache.fetchedAt === null && (due || this.#cache.lastAttemptAt === 0)) {
      // Nothing cached yet: wait for the first fetch, but not forever.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const giveUp = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FIRST_LOAD_WAIT_MS);
      });
      try {
        await Promise.race([this.#refresh(), giveUp]);
      } finally {
        clearTimeout(timer);
      }
    } else if (due) {
      void this.#refresh();
    }
    return this.snapshot();
  }

  /** Manual refresh: refused when the last attempt was less than ten minutes ago. */
  async refresh(): Promise<{ ok: boolean; reason?: 'disabled' | 'tooSoon'; data: ApiDailyRaces }> {
    if (!this.enabled) return { ok: false, reason: 'disabled', data: this.snapshot() };
    if (this.#now() < this.#cache.lastAttemptAt + MANUAL_REFRESH_GAP_MS) {
      return { ok: false, reason: 'tooSoon', data: this.snapshot() };
    }
    await this.#refresh();
    return { ok: true, data: this.snapshot() };
  }

  #refresh(): Promise<void> {
    this.#inflight ??= this.#run().finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  async #run(): Promise<void> {
    const now = this.#now();
    this.#cache.lastAttemptAt = now;
    try {
      if (!(await this.#robotsAllowed())) {
        throw new DailyParseError(
          'O site pediu para não ser consultado automaticamente (robots.txt). Nada foi buscado.',
        );
      }
      const listHtml = await this.#get(`${this.#origin}${DG_EDGE_DAILIES_PATH}`);
      const parsed = parseDailyList(listHtml, now);
      const races: DailyRace[] = [];
      for (const race of parsed.races) {
        let merged = race;
        try {
          await this.#sleep(DETAIL_PAUSE_MS);
          merged = withDetail(race, parseDailyDetail(await this.#get(race.url)));
        } catch {
          // the list numbers are still good; the medals just stay empty this time
        }
        races.push(merged);
      }
      this.#cache = {
        version: 1,
        fetchedAt: this.#now(),
        lastAttemptAt: now,
        error: null,
        week: parsed.week,
        races,
        past: parsed.past.slice(0, 12),
      };
    } catch (e) {
      this.#cache = { ...this.#cache, lastAttemptAt: now, error: describe(e) };
    }
    this.#save();
  }

  async #robotsAllowed(): Promise<boolean> {
    const now = this.#now();
    if (!this.#robots || now - this.#robots.at > ROBOTS_TTL_MS) {
      try {
        this.#robots = { at: now, body: await this.#get(`${this.#origin}/robots.txt`) };
      } catch {
        // no robots.txt to read: the site does not forbid anything we can see
        this.#robots = { at: now, body: '' };
      }
    }
    return robotsAllows(this.#robots.body, DG_EDGE_DAILIES_PATH);
  }

  async #get(url: string): Promise<string> {
    const origin = new URL(this.#origin).origin;
    if (new URL(url).origin !== origin)
      throw new DailyParseError('Endereço fora do site de origem.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await this.#fetch(url, {
        signal: ctrl.signal,
        headers: {
          'user-agent': `BonoEngineer/${this.#opts.appVersion} (+https://github.com/lucassm02/bono-engineer)`,
          accept: 'text/html,text/plain;q=0.9',
          'accept-language': 'en',
        },
      });
      if (res.url && new URL(res.url).origin !== origin) {
        throw new DailyParseError('O site redirecionou para outro endereço.');
      }
      if (res.status === 429 || res.status === 403) {
        throw new DailyParseError(
          'O site recusou o acesso automático. Tentaremos de novo mais tarde.',
        );
      }
      if (!res.ok) throw new DailyParseError(`O site respondeu ${res.status}.`);
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new DailyParseError('A página veio grande demais.');
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

function describe(e: unknown): string {
  if (e instanceof DailyParseError) return e.message;
  const err = e as Error;
  if (err?.name === 'AbortError') return 'O site demorou demais para responder.';
  return 'Não foi possível consultar o site agora.';
}
