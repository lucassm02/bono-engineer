/**
 * Race bookkeeping from the packet (spec 21), measured on two real Sport Mode races (PS5).
 *
 * What the packet says in a race:
 * - `totalLaps` is 0 outside a race and N from the countdown on; at the chequered flag it goes back
 *   to 0 while `lapCount` becomes N + 1 ("lap 5 of 4").
 * - `preRacePosition` / `numCarsPreRace` are the driver's position and the cars still in the race,
 *   live during the whole race. Before the start they count the lobby filling up (9…15).
 * - About a second after the flag the packet looks like a grid again (handbrake, speed 0,
 *   `lapCount` 0, position 2): that is the results screen, so a race starts from `totalLaps`
 *   (0 → N), never from the grid, and the flag latches until the car leaves the track.
 * - A contact or a hit shows as a jump of 100-260 m/s² in the velocity vector between two
 *   packets (normal driving: median 5.6, p99 22) followed by a loss of speed.
 *
 * Pure and deterministic: the engine feeds one input per packet and reacts to the signals.
 */

import { raceLapDisplay } from '@gt7/shared';

/** Acceleration jump (m/s²) that makes a contact candidate. */
export const IMPACT_ACCEL_MS2 = 80;
/** The candidate counts when the speed fell by at least this much (km/h)… */
export const IMPACT_DROP_KMH = 6;
/** …between the 0.5 s before and the 0.3 s after the jump. */
export const IMPACT_BEFORE_S = 0.5;
export const IMPACT_AFTER_S = 0.3;
/** Impacts closer than this are one (ms). */
export const IMPACT_MERGE_MS = 3000;
/** Packets farther apart than this are a gap, not a jump (s). */
export const MAX_PACKET_DT_S = 0.05;
/** A position counts for the panel after being held this long (ms). */
export const POSITION_STABLE_MS = 2000;
/** The flag latch is released after the car stayed off the track this long (ms). */
export const FINISH_LATCH_RELEASE_MS = 5000;
/** The race starts moving above this speed (m/s). */
const MOVING_MPS = 3;
/** No impacts right after the start: the launch and the loading flicker (ms). */
const START_QUIET_MS = 3000;

export interface RaceInput {
  /** Epoch ms of the packet. */
  at: number;
  /** Seconds this packet covers (packets × ms per packet / 1000). */
  dtS: number;
  totalLaps: number;
  lapCount: number;
  /** `preRacePosition`. */
  position: number;
  /** `numCarsPreRace`. */
  cars: number;
  speedMps: number;
  velocity: { x: number; y: number; z: number };
  /** Car on the track and not loading. */
  onTrack: boolean;
  loading: boolean;
  paused: boolean;
  /** Distance along the lap in meters, null when unknown. */
  distanceM: number | null;
}

export type RaceSignal =
  | {
      type: 'start';
      at: number;
      totalLaps: number;
      /** What the lobby showed (the final slot arrives about a second later). */
      lobby: { position: number | null; cars: number | null };
      /** The race was joined after the start. */
      midRace: boolean;
    }
  | { type: 'startPosition'; at: number; position: number; cars: number | null }
  | {
      type: 'position';
      at: number;
      from: number;
      to: number;
      lap: number;
      distanceM: number | null;
      /** Held for `POSITION_STABLE_MS`; the raw changes (false) flicker side by side. */
      stable: boolean;
    }
  | { type: 'cars'; at: number; from: number; to: number; lap: number; distanceM: number | null }
  | {
      type: 'impact';
      at: number;
      lap: number;
      distanceM: number | null;
      dvMs2: number;
      speedBeforeKmh: number;
      speedAfterKmh: number;
    }
  | { type: 'finish'; at: number; position: number | null; cars: number | null; totalLaps: number };

export type RaceState = 'idle' | 'racing' | 'finished';

interface SpeedSample {
  at: number;
  kmh: number;
}

interface PendingImpact {
  at: number;
  lap: number;
  distanceM: number | null;
  dv: number;
  before: number;
}

export class RaceTracker {
  #state: RaceState = 'idle';
  #totalLaps = 0;
  #prevTotal: number | null = null;
  #lobby: { position: number | null; cars: number | null } = { position: null, cars: null };
  #startedAt = 0;
  #startPosition: number | null = null;
  #startPositionSet = false;
  #pos: number | null = null;
  #cars: number | null = null;
  #stablePos: number | null = null;
  #cand: { pos: number; since: number } | null = null;
  #lastChange: { from: number; to: number; at: number } | null = null;
  #impacts = 0;
  #lastImpactAt = Number.NEGATIVE_INFINITY;
  #pending: PendingImpact | null = null;
  #speeds: SpeedSample[] = [];
  #prevV: { x: number; y: number; z: number } | null = null;
  #offSince: number | null = null;

  get state(): RaceState {
    return this.#state;
  }

  /** The flag fell and the car has not left the track yet: no session may open from this. */
  get latched(): boolean {
    return this.#state === 'finished';
  }

  /** Laps of the race while one is running or just finished, else null. */
  get totalLaps(): number | null {
    return this.#state === 'idle' ? null : this.#totalLaps;
  }

  /** The lap counter as shown to the driver: never past the laps of the race. */
  displayLap(lapCount: number): number {
    if (this.#state === 'finished') return this.#totalLaps; // the results screen sends lapCount 0
    return this.#state === 'idle' ? lapCount : raceLapDisplay(lapCount, this.#totalLaps);
  }

  get impacts(): number {
    return this.#impacts;
  }

  /** What the live panel shows; null outside a race. */
  get live(): {
    state: 'racing' | 'finished';
    totalLaps: number;
    position: number | null;
    cars: number | null;
    startPosition: number | null;
    gained: number | null;
    impacts: number;
    lastChange: { from: number; to: number; at: number } | null;
  } | null {
    if (this.#state === 'idle') return null;
    const position = this.#stablePos ?? this.#pos;
    return {
      state: this.#state,
      totalLaps: this.#totalLaps,
      position,
      cars: this.#cars,
      startPosition: this.#startPosition,
      gained:
        this.#startPosition !== null && position !== null ? this.#startPosition - position : null,
      impacts: this.#impacts,
      lastChange: this.#lastChange,
    };
  }

  /** Forgets the race (stream reset, replay mode, shutdown). */
  reset(): void {
    this.#state = 'idle';
    this.#totalLaps = 0;
    this.#prevTotal = null;
    this.#lobby = { position: null, cars: null };
    this.#startPosition = null;
    this.#startPositionSet = false;
    this.#pos = null;
    this.#cars = null;
    this.#stablePos = null;
    this.#cand = null;
    this.#lastChange = null;
    this.#impacts = 0;
    this.#lastImpactAt = Number.NEGATIVE_INFINITY;
    this.#pending = null;
    this.#speeds = [];
    this.#prevV = null;
    this.#offSince = null;
  }

  /** Feeds one packet. Returns what happened, in order. */
  update(i: RaceInput): RaceSignal[] {
    const out: RaceSignal[] = [];
    const prevTotal = this.#prevTotal;
    this.#prevTotal = i.totalLaps;

    if (this.#state === 'idle') {
      if (i.onTrack && i.position > 0 && i.cars > 0) {
        this.#lobby = { position: i.position, cars: i.cars };
      }
      if (i.totalLaps > 0 && (prevTotal === null || prevTotal <= 0) && i.onTrack) {
        this.#begin(i, out);
      }
      this.#remember(i);
      return out;
    }

    if (this.#state === 'finished') {
      // latch: the results screen looks like a grid; wait for the car to leave the track
      if (i.onTrack) this.#offSince = null;
      else this.#offSince ??= i.at;
      if (this.#offSince !== null && i.at - this.#offSince >= FINISH_LATCH_RELEASE_MS) {
        this.reset();
      } else if (i.totalLaps > 0 && (prevTotal === null || prevTotal <= 0) && i.onTrack) {
        this.reset();
        this.#begin(i, out);
      }
      this.#remember(i);
      return out;
    }

    // racing
    if (i.totalLaps < 0) {
      // the menu: the race was left before the flag
      this.reset();
      this.#prevTotal = i.totalLaps;
      return out;
    }
    if (i.totalLaps <= 0 && (prevTotal ?? 0) > 0 && i.lapCount > this.#totalLaps) {
      out.push({
        type: 'finish',
        at: i.at,
        position: this.#stablePos ?? this.#pos,
        cars: this.#cars,
        totalLaps: this.#totalLaps,
      });
      this.#state = 'finished';
      this.#offSince = null;
      this.#pending = null;
      this.#remember(i);
      return out;
    }
    if (i.totalLaps > 0 && i.totalLaps !== this.#totalLaps) this.#totalLaps = i.totalLaps;

    this.#track(i, out);
    this.#remember(i);
    return out;
  }

  #begin(i: RaceInput, out: RaceSignal[]): void {
    this.#state = 'racing';
    this.#totalLaps = i.totalLaps;
    this.#startedAt = i.at;
    this.#startPosition = null;
    this.#startPositionSet = false;
    this.#pos = i.position > 0 ? i.position : this.#lobby.position;
    this.#cars = i.cars > 0 ? i.cars : this.#lobby.cars;
    this.#stablePos = null;
    this.#cand = null;
    this.#lastChange = null;
    this.#impacts = 0;
    this.#lastImpactAt = Number.NEGATIVE_INFINITY;
    this.#pending = null;
    this.#offSince = null;
    const midRace = i.lapCount > 1;
    if (midRace) this.#startPositionSet = true;
    out.push({
      type: 'start',
      at: i.at,
      totalLaps: i.totalLaps,
      lobby: { position: this.#lobby.position, cars: this.#lobby.cars },
      midRace,
    });
  }

  #track(i: RaceInput, out: RaceSignal[]): void {
    // start position: the slot settles about a second after the countdown appears, once the
    // loading flicker is over; the race is under way when the car moves
    if (!this.#startPositionSet && !i.loading && i.speedMps > MOVING_MPS && i.position > 0) {
      this.#startPositionSet = true;
      this.#startPosition = i.position;
      this.#stablePos = i.position;
      this.#pos = i.position;
      this.#cand = null;
      if (i.cars > 0) this.#cars = i.cars;
      out.push({
        type: 'startPosition',
        at: i.at,
        position: i.position,
        cars: this.#cars,
      });
    }

    if (!i.loading && i.position > 0) {
      if (this.#startPositionSet && this.#pos !== null && i.position !== this.#pos) {
        out.push({
          type: 'position',
          at: i.at,
          from: this.#pos,
          to: i.position,
          lap: i.lapCount,
          distanceM: i.distanceM,
          stable: false,
        });
      }
      this.#pos = i.position;
      // stable position
      if (this.#cand === null || this.#cand.pos !== i.position) {
        this.#cand = { pos: i.position, since: i.at };
      }
      if (
        this.#startPositionSet &&
        this.#cand.pos !== this.#stablePos &&
        i.at - this.#cand.since >= POSITION_STABLE_MS
      ) {
        const from = this.#stablePos;
        this.#stablePos = this.#cand.pos;
        if (from !== null) {
          this.#lastChange = { from, to: this.#stablePos, at: i.at };
          out.push({
            type: 'position',
            at: i.at,
            from,
            to: this.#stablePos,
            lap: i.lapCount,
            distanceM: i.distanceM,
            stable: true,
          });
        }
      }
    }

    if (!i.loading && i.cars > 0) {
      if (this.#cars !== null && i.cars !== this.#cars && this.#startPositionSet) {
        out.push({
          type: 'cars',
          at: i.at,
          from: this.#cars,
          to: i.cars,
          lap: i.lapCount,
          distanceM: i.distanceM,
        });
      }
      this.#cars = i.cars;
    }

    this.#impact(i, out);
  }

  #impact(i: RaceInput, out: RaceSignal[]): void {
    const kmh = i.speedMps * 3.6;
    this.#speeds.push({ at: i.at, kmh });
    const horizon = i.at - (IMPACT_BEFORE_S + IMPACT_AFTER_S + 0.5) * 1000;
    while (this.#speeds.length > 0 && this.#speeds[0]!.at < horizon) this.#speeds.shift();

    const p = this.#pending;
    if (p && i.at >= p.at + IMPACT_AFTER_S * 1000) {
      this.#pending = null;
      let after = Number.POSITIVE_INFINITY;
      for (const s of this.#speeds)
        if (s.at >= p.at && s.at <= p.at + IMPACT_AFTER_S * 1000) after = Math.min(after, s.kmh);
      if (Number.isFinite(after) && p.before - after >= IMPACT_DROP_KMH) {
        this.#impacts++;
        this.#lastImpactAt = p.at;
        out.push({
          type: 'impact',
          at: p.at,
          lap: p.lap,
          distanceM: p.distanceM,
          dvMs2: Math.round(p.dv),
          speedBeforeKmh: Math.round(p.before),
          speedAfterKmh: Math.round(after),
        });
      }
    }

    const prev = this.#prevV;
    this.#prevV = { ...i.velocity };
    if (
      prev === null ||
      this.#pending !== null ||
      !i.onTrack ||
      i.loading ||
      i.paused ||
      i.dtS <= 0 ||
      i.dtS > MAX_PACKET_DT_S ||
      i.at - this.#startedAt < START_QUIET_MS ||
      i.at - this.#lastImpactAt < IMPACT_MERGE_MS
    ) {
      return;
    }
    const dv =
      Math.hypot(i.velocity.x - prev.x, i.velocity.y - prev.y, i.velocity.z - prev.z) / i.dtS;
    if (dv < IMPACT_ACCEL_MS2) return;
    let before = 0;
    for (const s of this.#speeds) {
      if (s.at >= i.at - IMPACT_BEFORE_S * 1000 && s.at <= i.at) before = Math.max(before, s.kmh);
    }
    this.#pending = { at: i.at, lap: i.lapCount, distanceM: i.distanceM, dv, before };
  }

  #remember(i: RaceInput): void {
    if (this.#state === 'idle' || this.#state === 'finished') this.#prevV = { ...i.velocity };
  }
}
