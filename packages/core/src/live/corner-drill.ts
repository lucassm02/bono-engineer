/**
 * Corner drill tracker (spec 18): measures every pass through ONE corner of the track by position,
 * from the entry line to the exit line of the corner, whatever lap the car is on. It keeps its own
 * clock (the lap clock restarts at the line, and a corner next to the line must still be measured)
 * and never depends on a valid or complete lap.
 *
 * Pure and deterministic: the engine feeds it one sample per packet.
 */

import {
  BRAKE_ON_THRESHOLD,
  bestPass,
  DRILL_APPROACH_M,
  DRILL_HISTORY,
  isCleanDrillPass,
  type LiveDrill,
  type LiveDrillPass,
} from '@gt7/shared';

/** Forward progress per sample beyond this (m) is a jump (teleport, restart), not driving. */
const MAX_STEP_M = 80;
/** Brake lighter than this counts as released. */
const BRAKE_RELEASED = 0.02;
/** A brake released this close to the entry is the end of the braking, not a new onset. */
const BRAKE_END_ZONE_M = 40;
/** After the entry the exit must come within this extra distance (m), else the pass is dropped. */
const EXIT_SLACK_M = 250;

export interface DrillCornerInput {
  id: string;
  name: string | null;
  entryM: number;
  exitM: number;
}

export interface DrillSample {
  /** Lap distance (m); any lap, it is wrapped on the track length. */
  distanceM: number;
  /** Milliseconds since the previous sample (packet count × packet period). */
  dtMs: number;
  speedKmh: number;
  /** Brake pedal 0–1. */
  brake: number;
  /** Epoch ms of the sample. */
  at: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export class CornerDrillTracker {
  readonly corner: DrillCornerInput;
  readonly lengthM: number;
  readonly startedAt: number;
  readonly targetMs: number | null;
  readonly referenceBrakeM: number | null;
  /** Every clean pass so far, oldest first. */
  readonly passes: LiveDrillPass[] = [];

  #clockMs = 0;
  #prevW: number | null = null;
  #state: 'idle' | 'in' = 'idle';
  #brakeStartM: number | null = null;
  #entryClock = 0;
  #entrySpeed = 0;
  #minSpeed = 0;
  #travelled = 0;
  #lastDistanceToEntry: number | null = null;

  constructor(opts: {
    corner: DrillCornerInput;
    lengthM: number;
    startedAt: number;
    targetMs?: number | null;
    referenceBrakeM?: number | null;
  }) {
    this.corner = opts.corner;
    this.lengthM = opts.lengthM;
    this.startedAt = opts.startedAt;
    this.targetMs = opts.targetMs ?? null;
    this.referenceBrakeM = opts.referenceBrakeM ?? null;
  }

  /** Forgets a half-measured pass (teleport, new session). Finished passes are kept. */
  reset(): void {
    this.#prevW = null;
    this.#state = 'idle';
    this.#brakeStartM = null;
  }

  /** Feeds one sample; returns the pass finished by it, if any. */
  step(s: DrillSample): LiveDrillPass | null {
    const L = this.lengthM;
    if (!(L > 0)) return null;
    this.#clockMs += Math.max(0, s.dtMs);
    const w = mod(s.distanceM, L);
    const prev = this.#prevW;
    this.#prevW = w;
    const toEntry = mod(this.corner.entryM - w, L);
    this.#lastDistanceToEntry = toEntry;
    if (prev === null) return null;
    const d = mod(w - prev, L);
    if (d > MAX_STEP_M) {
      this.#state = 'idle';
      this.#brakeStartM = null;
      return null;
    }
    // crossing of a line `x` during this step, as the fraction of the step (null = not crossed)
    const crossing = (x: number): number | null => {
      if (d === 0) return null;
      const ahead = mod(x - prev, L);
      return ahead > 0 && ahead <= d ? ahead / d : null;
    };
    const prevClock = this.#clockMs - Math.max(0, s.dtMs);

    if (this.#state === 'idle') {
      const u = crossing(this.corner.entryM);
      if (u !== null) {
        // the braking noted so far belongs to this pass
        this.#state = 'in';
        this.#entryClock = prevClock + (this.#clockMs - prevClock) * u;
        this.#entrySpeed = s.speedKmh;
        this.#minSpeed = s.speedKmh;
        this.#travelled = d * (1 - u);
        return null;
      }
      if (toEntry <= DRILL_APPROACH_M) {
        if (s.brake >= BRAKE_ON_THRESHOLD) {
          if (this.#brakeStartM === null) this.#brakeStartM = toEntry;
        } else if (
          this.#brakeStartM !== null &&
          s.brake < BRAKE_RELEASED &&
          toEntry > BRAKE_END_ZONE_M
        ) {
          this.#brakeStartM = null;
        }
      } else {
        this.#brakeStartM = null;
      }
      return null;
    }

    // inside the corner
    this.#minSpeed = Math.min(this.#minSpeed, s.speedKmh);
    const u = crossing(this.corner.exitM);
    this.#travelled += d;
    if (u !== null) {
      const exitClock = prevClock + (this.#clockMs - prevClock) * u;
      const timeMs = Math.round(exitClock - this.#entryClock);
      const brakePointM = this.#brakeStartM;
      const minSpeed = this.#minSpeed;
      const entrySpeed = this.#entrySpeed;
      this.#state = 'idle';
      this.#brakeStartM = null;
      if (!isCleanDrillPass(minSpeed, timeMs)) return null;
      const pass: LiveDrillPass = {
        n: this.passes.length + 1,
        timeMs,
        entrySpeedKmh: Math.round(entrySpeed * 10) / 10,
        minSpeedKmh: Math.round(minSpeed * 10) / 10,
        exitSpeedKmh: Math.round(s.speedKmh * 10) / 10,
        brakePointM: brakePointM === null ? null : Math.round(brakePointM),
        at: s.at,
      };
      this.passes.push(pass);
      return pass;
    }
    const span = mod(this.corner.exitM - this.corner.entryM, L);
    if (this.#travelled > span + EXIT_SLACK_M) {
      this.#state = 'idle';
      this.#brakeStartM = null;
    }
    return null;
  }

  /** The drill as the frame carries it. */
  frame(): LiveDrill {
    const toEntry = this.#lastDistanceToEntry;
    const phase: LiveDrill['phase'] =
      this.#state === 'in'
        ? 'in'
        : toEntry !== null && toEntry > 0 && toEntry <= DRILL_APPROACH_M
          ? 'approach'
          : 'away';
    return {
      cornerId: this.corner.id,
      cornerName: this.corner.name,
      startedAt: this.startedAt,
      phase,
      distanceToEntryM: toEntry === null ? null : Math.round(toEntry),
      passes: this.passes.slice(-DRILL_HISTORY),
      count: this.passes.length,
      best: bestPass(this.passes),
      targetMs: this.targetMs,
      referenceBrakeM: this.referenceBrakeM,
    };
  }
}
