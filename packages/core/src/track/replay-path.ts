/**
 * Names the track from the car that runs in the background of the pre-race screen.
 *
 * Before a race or a time trial the game plays a lap with the chosen car on the chosen track while
 * the driver is in the menu. Those packets carry real positions (state `replay`, `carOnTrack`
 * false), so the path they draw can be compared with the shipped driving lines
 * (`guessLayoutByPath` in `@gt7/shared`) and the track is known before the driver turns a wheel.
 *
 * The tracker grows the path sample by sample and re-evaluates it as it gets longer. It forgets
 * the path when the car changes or jumps (the game restarted the clip, another track was chosen)
 * and stops once the path closes on itself (one loop: the layout length decided the layout).
 * Nothing is stored: it is only a "probable" label for the live panel.
 */

import { guessLayoutByPath, PATH_GUESS_THRESHOLDS, type PathGuess } from '@gt7/shared';

/** A step this long between two packets means the clip restarted or the scene changed (m). */
export const PATH_JUMP_M = 60;
/** The path is evaluated again every time it grows by this much (m). */
export const PATH_EVAL_EVERY_M = 30;
/** Give up on a path this long without closing (m): it is not a lap of a known track. */
export const PATH_MAX_M = 15_000;

export class ReplayPathTracker {
  #x: number[] = [];
  #z: number[] = [];
  #carCode: number | null = null;
  #pathM = 0;
  #evalAtM = 0;
  #locked = false;
  /** The path got at least `leaveM` away from its first point (so coming back closes a loop). */
  #left = false;
  #guess: PathGuess | null = null;
  /** Guess of the path before the clip restarted (same car): shown until the new path says otherwise. */
  #carry: PathGuess | null = null;

  /** The current guess (circuit, and layout when certain); null while there is none. */
  get guess(): PathGuess | null {
    return this.#guess;
  }

  /** Length of the path collected so far (m). */
  get pathM(): number {
    return this.#pathM;
  }

  /** Forgets the path (the replay ended, or the console went to another screen). */
  reset(): void {
    this.#x = [];
    this.#z = [];
    this.#carCode = null;
    this.#pathM = 0;
    this.#evalAtM = 0;
    this.#locked = false;
    this.#left = false;
    this.#guess = null;
    this.#carry = null;
  }

  /** Feeds one position of the playing replay. Returns true when the guess changed. */
  add(x: number, z: number, carCode: number): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const before = this.#guess;
    const k = this.#x.length - 1;
    if (k >= 0) {
      const step = Math.hypot(x - this.#x[k]!, z - this.#z[k]!);
      if (carCode !== this.#carCode || step > PATH_JUMP_M) {
        // the clip restarted (same car): the track is most likely the same, keep its name meanwhile
        const carry = carCode === this.#carCode ? this.#guess : null;
        this.reset();
        this.#carry = carry;
        this.#guess = carry;
      }
    }
    if (this.#locked) return false;
    this.#carCode = carCode;
    const n = this.#x.length - 1;
    if (n >= 0) {
      const step = Math.hypot(x - this.#x[n]!, z - this.#z[n]!);
      if (step < PATH_GUESS_THRESHOLDS.minStepM) return false;
      this.#pathM += step;
    }
    this.#x.push(x);
    this.#z.push(z);
    if (this.#pathM > PATH_MAX_M) {
      this.#locked = true;
      this.#guess = null;
      return before !== null;
    }
    // one loop done: back near the first point after having been far from it. Checked at every
    // sample so the length used for the layout is the length of the loop, not of the loop + a bit.
    const T = PATH_GUESS_THRESHOLDS;
    const dStart = Math.hypot(x - this.#x[0]!, z - this.#z[0]!);
    if (dStart >= T.leaveM) this.#left = true;
    const closing = this.#left && dStart <= T.closeM && this.#pathM >= T.minLoopM;
    if (
      closing ||
      (this.#pathM >= T.minPathM && this.#pathM - this.#evalAtM >= PATH_EVAL_EVERY_M)
    ) {
      this.#evalAtM = this.#pathM;
      let g = guessLayoutByPath({ x: this.#x, z: this.#z }, { closed: closing });
      const c = this.#carry;
      // same circuit as before the restart: the layout already known stays (the new, shorter path
      // cannot tell the layouts of a circuit apart yet)
      if (g.level === 'venue' && c?.level === 'layout' && c.venue === g.venue) g = c;
      if (g.level !== 'none') this.#guess = g;
      else if (!closing) this.#guess = null;
      if (closing) this.#locked = true;
    }
    return !sameGuess(before, this.#guess);
  }
}

function sameGuess(a: PathGuess | null, b: PathGuess | null): boolean {
  return a?.level === b?.level && a?.venue === b?.venue && a?.layoutId === b?.layoutId;
}
