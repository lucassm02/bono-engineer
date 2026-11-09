/**
 * Naming help for tracks discovered by geometry: autocomplete over the built-in GT7 list and
 * "looks like X" suggestions by lap length. Suggestions are only candidates: the UI always asks for
 * a click to confirm and nothing is named automatically.
 */

import { GT7_TRACKS, type Gt7Track, trackDisplayName } from '../../data/gt7Tracks.ts';
import { normalizeText } from './history.ts';

/** Relative length tolerance for a suggestion (1.5 %). */
export const LENGTH_TOLERANCE = 0.015;

export interface TrackSuggestion {
  track: Gt7Track;
  /** (measured − catalogue) / catalogue. */
  errorRel: number;
}

/** Catalogue entries whose length is within `tolerance` of the measured one, closest first. */
export function suggestByLength(
  lengthM: number,
  catalog: readonly Gt7Track[] = GT7_TRACKS,
  tolerance = LENGTH_TOLERANCE,
  max = 3,
): TrackSuggestion[] {
  if (!Number.isFinite(lengthM) || lengthM <= 0) return [];
  return catalog
    .filter((t): t is Gt7Track & { lengthM: number } => typeof t.lengthM === 'number')
    .map((t) => ({ track: t, errorRel: (lengthM - t.lengthM) / t.lengthM }))
    .filter((s) => Math.abs(s.errorRel) <= tolerance)
    .sort((a, b) => Math.abs(a.errorRel) - Math.abs(b.errorRel))
    .slice(0, max);
}

/**
 * Autocomplete: every word typed must appear in "name layout" (accent/case-insensitive); entries
 * starting with the text rank first, then shorter lengths difference when `lengthM` is given.
 */
export function searchCatalog(
  query: string,
  lengthM?: number,
  catalog: readonly Gt7Track[] = GT7_TRACKS,
  max = 8,
): Gt7Track[] {
  const words = normalizeText(query).split(' ').filter(Boolean);
  const scored = catalog
    .map((t) => {
      const text = normalizeText(trackDisplayName(t));
      return { t, text };
    })
    .filter(({ text }) => words.every((w) => text.includes(w)))
    .map(({ t, text }) => {
      const starts = words.length > 0 && text.startsWith(words[0]!) ? 0 : 1;
      const dist =
        lengthM && t.lengthM ? Math.abs(lengthM - t.lengthM) / t.lengthM : Number.POSITIVE_INFINITY;
      return { t, starts, dist };
    });
  scored.sort((a, b) => a.starts - b.starts || a.dist - b.dist);
  return scored.slice(0, max).map((s) => s.t);
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
