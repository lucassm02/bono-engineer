/**
 * Naming help for tracks discovered by geometry: autocomplete over the official GT7 layouts and
 * "looks like X" suggestions by lap length. Suggestions are only candidates: the UI always asks for
 * a click to confirm (the automatic naming, for a strong and unambiguous geometric match, happens in
 * the server when the track is created, see `@gt7/core` `identifyOrCreateTrack`).
 *
 * Length: the line the car drives is shorter than the official length (median −0.95 %, p10 −2.8 %),
 * so the window is asymmetric: −4 % … +1.5 % of the official length (see `LENGTH_WINDOW`).
 */

import {
  LENGTH_TYPICAL_REL,
  LENGTH_WINDOW,
  lengthCompatible,
  lengthErrorRel,
  searchTrackLayouts,
} from '@gt7/shared';
import { GT7_TRACKS, type Gt7Track, trackDisplayName } from '../../data/gt7Tracks.ts';
import { normalizeText } from './history.ts';

export { LENGTH_WINDOW };

export interface TrackSuggestion {
  track: Gt7Track;
  /** (measured − catalogue) / catalogue. */
  errorRel: number;
}

/**
 * Catalogue entries whose official length is compatible with the measured one (asymmetric window),
 * ordered by how far the error is from the typical −0.95 %, forward layouts before their reverse.
 */
export function suggestByLength(
  lengthM: number,
  catalog: readonly Gt7Track[] = GT7_TRACKS,
  window: { minRel: number; maxRel: number } = LENGTH_WINDOW,
  max = 3,
): TrackSuggestion[] {
  if (!Number.isFinite(lengthM) || lengthM <= 0) return [];
  return catalog
    .filter((t) => lengthCompatible(lengthM, t.lengthM, window))
    .map((t) => ({ track: t, errorRel: lengthErrorRel(lengthM, t.lengthM) }))
    .sort(
      (a, b) =>
        Math.abs(a.errorRel - LENGTH_TYPICAL_REL) - Math.abs(b.errorRel - LENGTH_TYPICAL_REL) ||
        Number(/Reverse/.test(a.track.layout ?? '')) - Number(/Reverse/.test(b.track.layout ?? '')),
    )
    .slice(0, max);
}

/**
 * Autocomplete: every word typed must appear in "name layout official name" (accent/case-
 * insensitive); entries starting with the text rank first, then the closest length when `lengthM`
 * is given.
 */
export function searchCatalog(
  query: string,
  lengthM?: number,
  catalog: readonly Gt7Track[] = GT7_TRACKS,
  max = 8,
): Gt7Track[] {
  const byId = new Map(catalog.map((t) => [t.id, t]));
  return searchTrackLayouts(query, lengthM, 500)
    .map((l) => byId.get(l.id))
    .filter((t): t is Gt7Track => t !== undefined)
    .slice(0, max);
}

/** Splits a typed "Name – Layout" back (when it matches a catalogue entry) for saving. */
export function resolveTyped(
  text: string,
  catalog: readonly Gt7Track[] = GT7_TRACKS,
): { name: string; layout: string | null } {
  const t = text.trim();
  const norm = normalizeText(t);
  const hit = catalog.find((c) => normalizeText(trackDisplayName(c)) === norm);
  if (hit) return { name: hit.name, layout: hit.layout ?? null };
  return { name: t, layout: null };
}
