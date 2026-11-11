/**
 * Early guess of the track from the start line against the shipped catalogue (spec 05 item 5).
 *
 * Only ever a "probable" label for the live panel: nothing is stored from it. The lap geometry
 * (`identifyOrCreateTrack`) decides when the lap closes. Reuses the catalogue and the driving
 * lines of `@gt7/shared` (`guessLayoutByStart` builds on `match.ts`'s known lines).
 */

import { guessLayoutByStart, type StartGuessLevel, type Vec2 } from '@gt7/shared';

export interface CatalogGuess {
  /** `layout`: one layout; `venue`: only the circuit can be named (layouts share the start). */
  level: Exclude<StartGuessLevel, 'none'>;
  /** Circuit ("Trial Mountain Circuit"). */
  venue: string;
  /** Layout label ("Reverse"), only when `level` is `layout`. */
  layout: string | null;
  /** Catalogue id of the layout, only when `level` is `layout`. */
  layoutId: string | null;
  /** Distance from the car to the layout's start point (m). */
  startDistM: number;
}

/**
 * Names the layout that starts where the car crossed the start line, heading the same way. Returns
 * null for "no layout starts here" and for several circuits competing (ambiguous).
 */
export function catalogGuessAtStart(start: Vec2, headingRad: number): CatalogGuess | null {
  const g = guessLayoutByStart(start, headingRad);
  if (g.level === 'none' || !g.best || !g.venue) return null;
  return {
    level: g.level,
    venue: g.venue,
    layout: g.level === 'layout' ? g.layoutLabel : null,
    layoutId: g.level === 'layout' ? g.best.layout.id : null,
    startDistM: g.best.startDistM,
  };
}
