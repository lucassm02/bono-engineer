/**
 * Names an "unknown" track after the laps driven on it, without asking (the driver does not stay
 * long enough on the pre-race screen for the path to name it, and the shipped line of some layouts
 * is only partial, so the strict match at creation does not apply to them).
 *
 * Each valid lap that began at the finish line is compared with the shipped driving lines. A name is
 * applied once {@link NAME_VOTES_NEEDED} laps in a row point to the same single layout (no look-alike
 * candidate, a compatible length, at least a medium match); one lap that does not agree starts the
 * count again. Pure: the engine feeds the matches and applies the name.
 */

import type { Id, KnownTrackCandidate, KnownTrackMatch } from '@gt7/shared';

/** Consecutive laps that must agree before the track is named. */
export const NAME_VOTES_NEEDED = 3;

export class TrackNameVoter {
  #trackId: Id | null = null;
  #layoutId: string | null = null;
  #votes = 0;

  /** Forgets the count (a new session, another track). */
  reset(): void {
    this.#trackId = null;
    this.#layoutId = null;
    this.#votes = 0;
  }

  /**
   * Adds the match of one lap of `trackId`. Returns the layout to name the track with when enough
   * laps agree, null otherwise.
   */
  vote(
    trackId: Id,
    match: Pick<KnownTrackMatch, 'candidates' | 'ambiguous'>,
  ): KnownTrackCandidate['layout'] | null {
    const top = match.candidates[0];
    const usable =
      !!top &&
      !match.ambiguous &&
      match.candidates.length === 1 &&
      top.confidence !== 'low' &&
      top.lengthOk;
    if (!usable) {
      this.reset();
      return null;
    }
    if (this.#trackId === trackId && this.#layoutId === top.layout.id) this.#votes++;
    else {
      this.#trackId = trackId;
      this.#layoutId = top.layout.id;
      this.#votes = 1;
    }
    if (this.#votes < NAME_VOTES_NEEDED) return null;
    this.reset();
    return top.layout;
  }
}
