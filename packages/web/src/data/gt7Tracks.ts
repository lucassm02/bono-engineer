/**
 * Circuits and layouts of Gran Turismo 7 used to name the tracks the app discovers by geometry.
 *
 * Derived from the shared official catalogue (`@gt7/shared` tracks: 122 layouts generated from
 * gt7info, gt7-datalogger-track-data and gt-telemetry by `scripts/gen-tracks.mjs`), so the list,
 * the lengths and the names are the game's own. It stays a convenience, not an authority: the user
 * can always type any other name.
 */

import { listTrackLayouts } from '@gt7/shared';

export interface Gt7Track {
  /** Official layout id (hex). */
  id: string;
  /** Circuit / location. */
  name: string;
  /** Layout label, when the circuit has more than one ("No Chicane", "Reverse"). */
  layout?: string;
  /** Official lap length in metres. */
  lengthM: number;
}

export const GT7_TRACKS: readonly Gt7Track[] = listTrackLayouts().map((l) => ({
  id: l.id,
  name: l.venue,
  ...(l.layoutLabel ? { layout: l.layoutLabel } : {}),
  lengthM: l.lengthM,
}));

/** "Name – Layout" as shown to the user. */
export function trackDisplayName(t: Pick<Gt7Track, 'name' | 'layout'>): string {
  return t.layout ? `${t.name} – ${t.layout}` : t.name;
}
