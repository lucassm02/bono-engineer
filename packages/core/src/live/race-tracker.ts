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

import { type LiveRace, raceLapDisplay } from '@gt7/shared';

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
/**
 * After the flag the position still moves while the other cars finish (P7 → P6 three seconds
 * later in a measured race): the result is fixed when the results screen begins, or after this long (ms).
 */
export const FINISH_SETTLE_MAX_MS = 45_000;
/** The flag latch is released after the car stayed off the track this long (ms). */
export const FINISH_LATCH_RELEASE_MS = 5000;
/** The race starts moving above this speed (m/s). */
const MOVING_MPS = 3;
/** No impacts right after the start: the launch and the loading flicker (ms). */
const START_QUIET_MS = 3000;
/** A loading flicker up to this long before the start still counts as the start's (ms). */
const START_LOAD_WINDOW_MS = 5000;
/**
 * A loading flicker this long after the start, before the first crossing of the line (the lap
 * counter still 0), is a restart: the counter has nothing to fall from.
 */
const RESTART_BEFORE_LINE_MS = 6000;

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
      /**
       * The driver restarted the race (the lap counter fell back to 0 with the same totalLaps):
       * the attempt that ended here had reached this lap.
       */
      restartedFromLap: number | null;
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
  | {
      type: 'finish';
      /** When the result was fixed (the results screen began). */
      at: number;
      /** When the lap counter passed the laps of the race (the chequered flag). */
      flagAt: number;
      position: number | null;
      cars: number | null;
      totalLaps: number;
    };

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
  /** The highest lap counter seen in this race (a drop means the race was restarted). */
  #lapMax = 0;
  /** When the last loading screen flicker was seen: the grid slot is read after it. */
  #loadAt = Number.NEGATIVE_INFINITY;
  /** When the lap counter passed the laps of the race. */
  #flagAt = 0;
  /** The result of the race was fixed (the `finish` signal went out). */
  #result: LiveRace['result'];
  #finalLapPosition: number | null = null;
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
  get live(): LiveRace | null {
    if (this.#state === 'idle') return null;
    const position = this.#result
      ? this.#result.position
      : this.#state === 'finished'
        ? this.#pos
        : (this.#stablePos ?? this.#pos);
    return {
      state: this.#state,
      startedAt: this.#startedAt,
      ...(this.#result ? { result: this.#result } : {}),
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
    this.#flagAt = 0;
    this.#result = undefined;
    this.#finalLapPosition = null;
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
    if (i.loading) this.#loadAt = i.at;
    this.#prevTotal = i.totalLaps;

    if (this.#state === 'idle') {
      if (i.onTrack && i.position > 0 && i.cars > 0) {
        this.#lobby = { position: i.position, cars: i.cars };
      }
      // a counter past the laps of the race is the stale stream of a race that just ended (it comes
      // interleaved with the menu: totalLaps flips between -1 and N), never a race that begins
      if (
        i.totalLaps > 0 &&
        (prevTotal === null || prevTotal <= 0) &&
        i.onTrack &&
        i.lapCount <= i.totalLaps
      ) {
        this.#begin(i, out);
      }
      this.#remember(i);
      return out;
    }

    if (this.#state === 'finished') {
      if (!this.#result) {
        // the position still moves while the others finish; the result is what the game shows when
        // the results begin (online: totalLaps back to 0; against the AI: the car leaves the track)
        const zeroed = i.totalLaps <= 0 && (prevTotal ?? 0) > 0;
        if (zeroed || !i.onTrack || i.at - this.#flagAt >= FINISH_SETTLE_MAX_MS) {
          out.push(this.#finish(i.at, this.#pos));
        } else if (i.totalLaps === this.#totalLaps && i.position > 0) {
          // still the race stream (the results screen sends lap 0, totalLaps 0 and a grid slot)
          this.#pos = i.position;
          if (i.cars > 0) this.#cars = i.cars;
        }
      }
      // latch: the results screen looks like a grid; wait for the car to leave the track
      if (i.onTrack) this.#offSince = null;
      else this.#offSince ??= i.at;
      if (this.#offSince !== null && i.at - this.#offSince >= FINISH_LATCH_RELEASE_MS) {
        this.reset();
      } else if (
        i.totalLaps > 0 &&
        (prevTotal === null || prevTotal <= 0) &&
        i.onTrack &&
        i.lapCount <= 1
      ) {
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
    // The driver restarted the race: the lap counter falls back to 0 (the race keeps its totalLaps),
    // the position goes to the last grid slot and the car comes back at the rolling-start speed
    // (measured: lap 5 → 0, P3 → P16, totalLaps 5 → 5). Packets of the replay that plays after the
    // flag also say lap 0, but never carry the car on the track.
    if (
      i.onTrack &&
      i.totalLaps === this.#totalLaps &&
      this.#lapMax >= 1 &&
      i.lapCount < this.#lapMax &&
      i.lapCount <= 1
    ) {
      const from = this.#lapMax;
      this.#begin(i, out, from);
      this.#remember(i);
      return out;
    }
    // A restart before the first crossing of the line: the lap counter was 0 and stays 0, so only the
    // loading flicker (the car back at the rolling start) says so.
    if (
      i.onTrack &&
      i.totalLaps === this.#totalLaps &&
      this.#lapMax === 0 &&
      i.lapCount === 0 &&
      this.#loadAt > this.#startedAt + RESTART_BEFORE_LINE_MS
    ) {
      this.#begin(i, out, 0);
      this.#remember(i);
      return out;
    }
    if (i.lapCount > this.#lapMax) {
      if (i.lapCount === this.#totalLaps && this.#lapMax >= 1)
        this.#finalLapPosition = this.#stablePos ?? this.#pos;
      this.#lapMax = i.lapCount;
    }
    // The flag: the lap counter passes the laps of the race. In an online race the game also zeroes
    // totalLaps at that moment; in a race against the AI it keeps N until the results screen.
    if (i.lapCount > this.#totalLaps && (i.totalLaps <= 0 || i.totalLaps === this.#totalLaps)) {
      this.#state = 'finished';
      this.#flagAt = i.at;
      this.#offSince = null;
      this.#pending = null;
      if (i.onTrack && i.position > 0) this.#pos = i.position;
      if (i.totalLaps <= 0) {
        // the game zeroed totalLaps with the flag: the result is already what it shows
        out.push(this.#finish(i.at, this.#stablePos ?? this.#pos));
      }
      this.#remember(i);
      return out;
    }
    if (i.totalLaps > 0 && i.totalLaps !== this.#totalLaps) this.#totalLaps = i.totalLaps;

    this.#track(i, out);
    this.#remember(i);
    return out;
  }

  #finish(at: number, position: number | null): RaceSignal {
    this.#result = {
      at,
      position,
      ...(position !== null && this.#finalLapPosition !== null
        ? { gainedOnFinalLap: this.#finalLapPosition - position }
        : {}),
    };
    return {
      type: 'finish',
      at,
      position,
      flagAt: this.#flagAt,
      cars: this.#cars,
      totalLaps: this.#totalLaps,
    };
  }

  #begin(i: RaceInput, out: RaceSignal[], restartedFromLap: number | null = null): void {
    this.#state = 'racing';
    this.#totalLaps = i.totalLaps;
    this.#lapMax = Math.max(0, i.lapCount);
    this.#startedAt = i.at;
    this.#flagAt = 0;
    this.#result = undefined;
    this.#finalLapPosition = null;
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
      restartedFromLap,
    });
  }

  #track(i: RaceInput, out: RaceSignal[]): void {
    // start position: the slot settles about a second after the countdown appears, once the
    // loading flicker is over; the race is under way when the car moves
    // The slot is read once the car moves AFTER the loading flicker: the packets before it still
    // carry the position of the lobby (measured: P1 for a second, then the real slot P16). Without
    // a flicker the first lap crossing is the fallback.
    const loaded = this.#loadAt >= this.#startedAt - START_LOAD_WINDOW_MS || i.lapCount >= 1;
    if (
      !this.#startPositionSet &&
      loaded &&
      i.onTrack &&
      !i.loading &&
      i.speedMps > MOVING_MPS &&
      i.position > 0
    ) {
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

    if (i.onTrack && !i.loading && i.position > 0) {
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

    if (i.onTrack && !i.loading && i.cars > 0) {
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
