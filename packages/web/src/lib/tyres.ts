/**
 * Tyre compounds as the driver sees them (pre-race screen, tyre panel): the groups of chips, the
 * names and the wording of the wear estimate. Pure; the estimate itself is `@gt7/shared`'s.
 */

import { type LiveTyreWear, type TyreCompound, WEAR_LIMIT } from '@gt7/shared';
import { formatInt } from './format.ts';
import { t as uiText } from './i18n.ts';

export interface TyreGroup {
  id: string;
  /** The compounds of the group, hard → soft; one for the groups without hardness. */
  compounds: readonly TyreCompound[];
  label(): string;
}

export const TYRE_GROUPS: readonly TyreGroup[] = [
  {
    id: 'comfort',
    compounds: ['comfortHard', 'comfortMedium', 'comfortSoft'],
    label: () => uiText('Conforto'),
  },
  {
    id: 'sport',
    compounds: ['sportHard', 'sportMedium', 'sportSoft'],
    label: () => uiText('Esportivo'),
  },
  {
    id: 'racing',
    compounds: ['racingHard', 'racingMedium', 'racingSoft'],
    label: () => uiText('Competição'),
  },
  { id: 'intermediate', compounds: ['intermediate'], label: () => uiText('Intermediário') },
  { id: 'heavyWet', compounds: ['heavyWet'], label: () => uiText('Chuva forte') },
  { id: 'dirt', compounds: ['dirt'], label: () => uiText('Terra') },
];

export function groupOf(c: TyreCompound | null | undefined): TyreGroup | null {
  if (!c) return null;
  return TYRE_GROUPS.find((g) => g.compounds.includes(c)) ?? null;
}

/** "Duro" / "Médio" / "Macio" for the compounds that have it; null for the others. */
export function hardnessLabel(c: TyreCompound): string | null {
  const g = groupOf(c);
  if (!g || g.compounds.length < 3) return null;
  const i = g.compounds.indexOf(c);
  return [uiText('Duro'), uiText('Médio'), uiText('Macio')][i] ?? null;
}

/** "Esportivo Médio", "Intermediário"; "não informado" without a compound. */
export function compoundLabel(c: TyreCompound | null | undefined): string {
  const g = groupOf(c);
  if (!c || !g) return uiText('não informado');
  const h = hardnessLabel(c);
  return h ? `${g.label()} ${h}` : g.label();
}

/** The compound a tap on a group chip picks: the medium one of the three, the only one otherwise. */
export function defaultOfGroup(g: TyreGroup): TyreCompound {
  return g.compounds[Math.floor(g.compounds.length / 2)] as TyreCompound;
}

export type WearTone = 'ok' | 'warn' | 'loss';

/** Tone of a wear share (0…1): green until half of the limit, amber, red near the limit. */
export function wearTone(wear: number): WearTone {
  if (wear >= WEAR_LIMIT * 0.8) return 'loss';
  if (wear >= WEAR_LIMIT * 0.5) return 'warn';
  return 'ok';
}

/** "~14 voltas até o limite" (or nothing while the estimate has too little to say). */
export function lapsLeftText(w: LiveTyreWear): string | null {
  if (w.lapsLeft === null) return null;
  if (w.worst >= WEAR_LIMIT) return uiText('no limite: hora de trocar');
  const n = Math.floor(w.lapsLeft);
  if (n <= 0) return uiText('menos de 1 volta até o limite');
  return uiText('~{0} voltas até o limite', n);
}

/** "18%". */
export function wearPct(wear: number): string {
  return `${formatInt(Math.round(Math.min(1, Math.max(0, wear)) * 100))}%`;
}
