/** Public identity is independent of storage paths, app IDs and protocol names. */
export const PRODUCT_NAME = 'Bono Engineer';
export const PRODUCT_DESCRIPTION = 'Telemetria, rádio e análise de voltas para sim racing';
export const BRAND_SURFACE = '#0b1118';
export const BRAND_SIGNAL = '#66e4f6';

/** The two lobes of the B echo radio pulses and stay separate at tray size. */
export function brandIconContents(maskable = false): string {
  const mark = `<path d="M15 12h19l11 8-7 10H26l4-6h7l3-4-6-3H22L13 42H5z" fill="#edf7fa"/>
<path d="M24 34h14l7-6 9 7-4 10-11 7H12l3-7h22l7-4 2-4-5 3H21z" fill="${BRAND_SIGNAL}"/>`;
  return `<rect width="64" height="64" rx="${maskable ? 0 : 14}" fill="${BRAND_SURFACE}"/>
${maskable ? `<g transform="translate(9.6 9.6) scale(.7)">${mark}</g>` : mark}`;
}
