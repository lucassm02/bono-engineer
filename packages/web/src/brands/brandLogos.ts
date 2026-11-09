/**
 * Maker → logo. Makers found in `simple-icons` get their (single colour) logo; every other maker
 * gets a monogram badge (initials in a circle, colour derived from the name). Pure functions, so
 * "every maker has a logo or a monogram" is testable.
 *
 * Logos are trademarks of their owners and are used only to identify the maker.
 */

import { BRAND_ICONS } from './brandIcons.ts';

export interface IconLogo {
  kind: 'icon';
  title: string;
  /** SVG path data, 24x24 viewBox, fill with currentColor. */
  d: string;
}

export interface MonogramLogo {
  kind: 'monogram';
  /** One to three letters. */
  initials: string;
  /** 0–359. */
  hue: number;
}

export type BrandLogoSpec = IconLogo | MonogramLogo;

/** Words that do not count as initials. */
const SKIP = new Set(['de', 'da', 'do', 'of', 'the', 'and', 'e', '&']);

/** "Alfa Romeo" → "AR", "Mercedes-Benz" → "MB", "Daihatsu" → "DA", "TVR" → "TVR". */
export function monogramInitials(name: string): string {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/['’]/g, '');
  const words = clean
    .split(/[^A-Za-z0-9]+/)
    .filter((w, i) => w !== '' && (i === 0 || !SKIP.has(w.toLowerCase())));
  if (words.length === 0) return '?';
  if (words.length === 1) {
    const w = words[0]!;
    // Short all-caps names are acronyms (TVR, KTM, RUF, DMC): keep them whole.
    if (w.length <= 3 && w === w.toUpperCase()) return w;
    return (w[0]! + (w[1] ?? '')).toUpperCase();
  }
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Stable hue (0–359) from the name. */
export function monogramHue(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

/** Logo for a maker (by catalogue slug and display name). Never null. */
export function logoFor(maker: { slug: string; name: string } | null | undefined): BrandLogoSpec {
  if (!maker) return { kind: 'monogram', initials: '?', hue: 215 };
  const icon = BRAND_ICONS[maker.slug];
  if (icon) return { kind: 'icon', title: icon.title, d: icon.d };
  return { kind: 'monogram', initials: monogramInitials(maker.name), hue: monogramHue(maker.name) };
}

/** Makers (by slug) that have a real logo. */
export function hasRealLogo(slug: string): boolean {
  return slug in BRAND_ICONS;
}

/** Slugs that have a logo (for tests/diagnostics). */
export function logoSlugs(): string[] {
  return Object.keys(BRAND_ICONS);
}
