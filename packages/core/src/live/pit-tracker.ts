/**
 * Visits to the pits (spec 09), measured on a real Civic free practice (PS5, Tokyo Expressway).
 *
 * The packet has no pit field, but a visit to the pits has a clear signature:
 *   1. the driver pauses and picks the pits (`paused`, the car frozen);
 *   2. the game loads (`loadingOrProcessing`) and the car reappears **in its box**: more than 30 m
 *      from where it was, stopped (0 km/h), still on the track (`carOnTrack`), with the lap counter
 *      and `totalLaps` untouched (a restart drops the counter, a rolling start moves at 80 km/h,
 *      the grid sets the handbrake);
 *   3. the car stands there a few seconds (13 s in the capture), then drives off.
 * A visit counts when the car leaves; a menu or the garage in between (`carOnTrack` false) cancels it.
 *
 * Pure and deterministic: the engine feeds one input per packet and reacts to the signal.
 */

/** The car must have been teleported at least this far (m) by the loading. */
export const PIT_JUMP_M = 30;
/** Stopped means below this speed (m/s). */
const STOPPED_MPS = 1;
/** The car leaves above this speed (m/s), about 5 km/h. */
const LEAVING_MPS = 1.5;
/** It must stand at least this long (ms): shorter is a reset of the car on the track, not the pits. */
export const PIT_MIN_STOP_MS = 4000;
/** The loading flicker must end within this long (ms) before the stopped car shows. */
const LOAD_WINDOW_MS = 3000;
/** The car counts as running above this speed (m/s). */
const RUNNING_MPS = 3;

export interface PitInput {
  /** Epoch ms of the packet. */
  at: number;
  carOnTrack: boolean;
  loading: boolean;
  paused: boolean;
  handBrake: boolean;
  speedMps: number;
  lapCount: number;
  totalLaps: number;
  x: number;
  z: number;
}

/** A visit to the pits that just ended (the car is leaving). */
export interface PitSignal {
  /** Epoch ms the car arrived in its box (the loading). */
  at: number;
  /** Epoch ms the car left. */
  exitAt: number;
  /** Game lap counter at the time. */
  lap: number;
}

interface Running {
  x: number;
  z: number;
  lapCount: number;
  totalLaps: number;
}

export class PitTracker {
  #running: Running | null = null;
  #loadAt: number | null = null;
  #stopped: { at: number; lap: number; totalLaps: number } | null = null;

  /** Forgets everything (new session). */
  reset(): void {
    this.#running = null;
    this.#loadAt = null;
    this.#stopped = null;
  }

  /** True while the car is stopped in a box that has not been left yet. */
  get inPits(): boolean {
    return this.#stopped !== null;
  }

  update(i: PitInput): PitSignal | null {
    // out of the track (menu, garage, replay): nothing is a visit any more
    if (!i.carOnTrack) {
      this.#running = null;
      this.#loadAt = null;
      this.#stopped = null;
      return null;
    }
    if (i.loading) {
      // the loading flicker: remember when it began; a stop in progress was a reset after all
      if (this.#loadAt === null) this.#loadAt = i.at;
      if (this.#stopped) this.#stopped = null;
      return null;
    }
    const loadAt = this.#loadAt;
    this.#loadAt = null;

    if (this.#stopped) {
      const s = this.#stopped;
      if (i.lapCount < s.lap || i.totalLaps !== s.totalLaps) {
        this.#stopped = null; // a restart, not a visit
      } else if (i.speedMps > LEAVING_MPS && !i.paused) {
        this.#stopped = null;
        if (i.at - s.at >= PIT_MIN_STOP_MS) {
          this.#running = { x: i.x, z: i.z, lapCount: i.lapCount, totalLaps: i.totalLaps };
          return { at: s.at, exitAt: i.at, lap: s.lap };
        }
      }
      return null;
    }

    const run = this.#running;
    if (
      loadAt !== null &&
      run &&
      i.at - loadAt <= LOAD_WINDOW_MS &&
      i.speedMps < STOPPED_MPS &&
      !i.handBrake &&
      i.lapCount >= run.lapCount &&
      i.lapCount <= run.lapCount + 1 &&
      i.totalLaps === run.totalLaps &&
      Math.hypot(i.x - run.x, i.z - run.z) > PIT_JUMP_M
    ) {
      this.#stopped = { at: loadAt, lap: i.lapCount, totalLaps: i.totalLaps };
      this.#running = null;
      return null;
    }

    if (!i.paused && i.speedMps > RUNNING_MPS) {
      this.#running = { x: i.x, z: i.z, lapCount: i.lapCount, totalLaps: i.totalLaps };
    }
    return null;
  }
}
