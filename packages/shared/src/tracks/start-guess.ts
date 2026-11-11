/**
 * Early guess of the layout from the start line (spec 05 item 5).
 *
 * The packet has no track id; the first moment the app knows anything is when the car crosses the
 * start/finish line for the first time. The catalogue knows where each layout starts (X/Z) and the
 * shipped driving lines tell which way the car points there, so position + heading can name a
 * layout BEFORE a lap is closed. It is only a guess ("provável"): it is never persisted and the
 * lap geometry (./match.ts) has the last word when the lap closes.
 *
 * Pure and dependency-free (isomorphic).
 */

import { listTrackLayouts, type TrackLayout } from './catalog.ts';
import { getKnownLine } from './match.ts';

/** Tolerances of the start-line guess. */
export const START_GUESS_THRESHOLDS = {
  /** Max distance from the car to the layout's start point (m). */
  maxStartM: 40,
  /** Max difference between the car heading and the driving direction at the start (rad). */
  maxHeadingRad: 0.5,
  /** A rival of another venue needs a score this many times worse than the best to be ignored. */
  rivalFactor: 2,
  /** … plus this margin (normalised score units). */
  rivalAdd: 0.15,
} as const;

export interface StartGuessCandidate {
  layout: TrackLayout;
  startDistM: number;
  headingDiffRad: number;
  /** Normalised distance + heading error (0 = on the start point, same direction). */
  score: number;
}

/**
 * - `layout`: one layout fits and nothing else competes.
 * - `venue`: several layouts of the same venue share the line (Full / Short / No chicane): only the
 *   venue can be named.
 * - `none`: no layout starts here, or layouts of different venues compete.
 */
export type StartGuessLevel = 'layout' | 'venue' | 'none';

export interface StartGuess {
  level: StartGuessLevel;
  /** Best candidate (null for `none`). */
  best: StartGuessCandidate | null;
  /** Venue to show ("Trial Mountain Circuit"); null for `none`. */
  venue: string | null;
  /** Layout label to show next to the venue ("Reverse"); only for `layout`. */
  layoutLabel: string | null;
  /** Several layouts of different venues fit: the guess is withheld. */
  ambiguous: boolean;
  candidates: StartGuessCandidate[];
}

function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

const headings = new Map<string, number | null>();

/** Driving direction (atan2(dx, dz)) of the shipped line at the layout's start point. */
export function layoutStartHeading(l: TrackLayout): number | null {
  if (headings.has(l.id)) return headings.get(l.id) ?? null;
  let out: number | null = null;
  const line = l.start ? getKnownLine(l.id) : null;
  if (l.start && line && line.x.length >= 3) {
    const n = line.x.length;
    let best = Number.POSITIVE_INFINITY;
    for (let a = 0; a < n; a++) {
      const b = (a + 1) % n;
      const ax = line.x[a]!;
      const az = line.z[a]!;
      const dx = line.x[b]! - ax;
      const dz = line.z[b]! - az;
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-9) continue;
      const u = Math.max(0, Math.min(1, ((l.start.x - ax) * dx + (l.start.z - az) * dz) / len2));
      const d = Math.hypot(ax + dx * u - l.start.x, az + dz * u - l.start.z);
      if (d < best) {
        best = d;
        out = Math.atan2(dx, dz);
      }
    }
  }
  headings.set(l.id, out);
  return out;
}

const NONE: StartGuess = {
  level: 'none',
  best: null,
  venue: null,
  layoutLabel: null,
  ambiguous: false,
  candidates: [],
};

/**
 * Compares the position and heading of the car at the start line with the start of every layout.
 * `headingRad` is atan2(vx, vz), the same convention as `LiveFrame.headingRad`.
 */
export function guessLayoutByStart(
  start: { x: number; z: number },
  headingRad: number,
  opts: { maxStartM?: number; maxHeadingRad?: number } = {},
): StartGuess {
  const T = START_GUESS_THRESHOLDS;
  const maxStart = opts.maxStartM ?? T.maxStartM;
  const maxHeading = opts.maxHeadingRad ?? T.maxHeadingRad;
  if (!Number.isFinite(start.x) || !Number.isFinite(start.z) || !Number.isFinite(headingRad)) {
    return NONE;
  }
  const candidates: StartGuessCandidate[] = [];
  for (const layout of listTrackLayouts()) {
    if (!layout.start) continue;
    const startDistM = Math.hypot(start.x - layout.start.x, start.z - layout.start.z);
    if (startDistM > maxStart) continue;
    const h = layoutStartHeading(layout);
    if (h === null) continue;
    const headingDiffRad = Math.abs(wrapAngle(headingRad - h));
    if (headingDiffRad > maxHeading) continue;
    candidates.push({
      layout,
      startDistM,
      headingDiffRad,
      score: startDistM / maxStart + headingDiffRad / maxHeading,
    });
  }
  if (candidates.length === 0) return NONE;
  candidates.sort((a, b) => a.score - b.score || a.layout.lengthM - b.layout.lengthM);
  const best = candidates[0]!;
  const close = (c: StartGuessCandidate) => c.score < best.score * T.rivalFactor + T.rivalAdd;
  const rivals = candidates.slice(1).filter((c) => c.layout.venue !== best.layout.venue);
  if (rivals.some(close)) return { ...NONE, ambiguous: true, candidates };
  const siblings = candidates.slice(1).filter((c) => c.layout.venue === best.layout.venue);
  if (siblings.some(close)) {
    return {
      level: 'venue',
      best,
      venue: best.layout.venue,
      layoutLabel: null,
      ambiguous: false,
      candidates,
    };
  }
  return {
    level: 'layout',
    best,
    venue: best.layout.venue,
    layoutLabel: best.layout.layoutLabel,
    ambiguous: false,
    candidates,
  };
}
