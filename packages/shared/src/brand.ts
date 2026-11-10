/** Public identity is independent of storage paths, app IDs and protocol names. */
export const PRODUCT_NAME = 'Bono Engineer';
export const PRODUCT_SLUG = 'bono-engineer';
export const PRODUCT_DESCRIPTION = 'Telemetria, rádio e análise de voltas para sim racing';
export const BRAND_SURFACE = '#0b1118';
export const BRAND_SIGNAL = '#66e4f6';

/** The B pairs a tight hairpin with a broad sweeper and a cyan start line. */
export function brandIconContents(maskable = false): string {
  const mark = `<g fill="none" stroke="#f7f5ea" stroke-width="3" stroke-linejoin="round">
  <path d="M16 36.5V14a4 4 0 0 1 4-4h14c6.5 0 9.5 6.5 3.7 10L21 29.5c-3 1.8-5 4-5 7Z"/>
  <path d="M16 36.5C16 31.5 24 29 32.5 29 42 29 50 34 50 42S43 55 34 55H20a4 4 0 0 1-4-4Z"/>
</g>
<path fill="${BRAND_SIGNAL}" d="m13.2 47.8 5.6-2.9v1.6l-5.6 2.9Z"/>`;
  return `<rect width="64" height="64" rx="${maskable ? 0 : 14}" fill="${BRAND_SURFACE}"/>
${maskable ? `<g transform="translate(9.6 9.6) scale(.7)">${mark}</g>` : mark}`;
}
