/**
 * GitHub social preview (1280x640): `npm run site:social` writes docs/social-preview.png.
 * The dashboard capture is the hero; the radio call on top of it is the product in one line.
 * Upload the file manually in the repository: Settings > General > Social preview.
 * Fonts: resvg uses the system fonts; Bahnschrift (Windows) gives the brand look.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_DIR } from './config.mjs';
import { LOGO_SVG, pngSize } from './render.mjs';

const W = 1280;
const H = 640;
const FONT =
  "Bahnschrift, 'DIN Alternate', 'Arial Narrow', 'DejaVu Sans Condensed', Arial, sans-serif";

export function socialSvg() {
  // English capture (npm run site:shots -- --lang en --only live-dashboard --out docs/social); falls back to the site's.
  const english = join(SITE_DIR, '..', 'docs', 'social', 'live-dashboard.png');
  const shot = existsSync(english) ? english : join(SITE_DIR, 'assets', 'shots', 'live-dashboard.png');
  const { w, h } = pngSize(shot);
  const data = readFileSync(shot).toString('base64');
  // Dashboard bleeds off the right and bottom edges, inside a card with a border.
  const sw = 770;
  const sh = Math.round((sw * h) / w);
  const sx = 500;
  const sy = 128;
  const logo = LOGO_SVG.replace('<svg ', '<svg x="64" y="64" width="72" height="72" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <radialGradient id="glow" cx="0.78" cy="0.55" r="0.75">
    <stop offset="0" stop-color="#66e4f6" stop-opacity="0.16"/>
    <stop offset="1" stop-color="#66e4f6" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="card"><rect x="${sx}" y="${sy}" width="${W - sx + 40}" height="${H - sy + 40}" rx="22"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="#05080c"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
${logo}
<text x="156" y="104" font-family="${FONT}" font-size="40" font-weight="700" fill="#eef3f7">Bono Engineer</text>
<text x="157" y="130" font-family="${FONT}" font-size="15" font-weight="700" letter-spacing="3.6" fill="#66e4f6">GRAN TURISMO 7</text>
<text x="64" y="300" font-family="${FONT}" font-size="60" font-weight="700" fill="#eef3f7">Your race</text>
<text x="64" y="366" font-family="${FONT}" font-size="60" font-weight="700" fill="#eef3f7">engineer on</text>
<text x="64" y="432" font-family="${FONT}" font-size="60" font-weight="700" fill="#66e4f6">the radio.</text>
<text x="64" y="500" font-family="Arial, sans-serif" font-size="24" fill="#a9b7c4">Live telemetry, race radio and</text>
<text x="64" y="532" font-family="Arial, sans-serif" font-size="24" fill="#a9b7c4">lap analysis. Free, local, for Windows.</text>
<g clip-path="url(#card)">
  <rect x="${sx}" y="${sy}" width="${W - sx + 40}" height="${H}" fill="#0d141c"/>
  <image x="${sx}" y="${sy}" width="${sw}" height="${sh}" href="data:image/png;base64,${data}"/>
</g>
<rect x="${sx}" y="${sy}" width="${W - sx + 40}" height="${H - sy + 40}" rx="22" fill="none" stroke="#324658" stroke-width="2"/>
<g>
  <rect x="${sx - 56}" y="${sy - 22}" width="352" height="64" rx="32" fill="#0d141c" stroke="#66e4f6" stroke-opacity="0.6" stroke-width="2"/>
  <circle cx="${sx - 22}" cy="${sy + 10}" r="20" fill="#66e4f6"/>
  <g transform="translate(${sx - 22 - 14.4} ${sy + 10 - 14.4}) scale(1.2)" fill="none" stroke="#04141a" stroke-width="1.9" stroke-linecap="round">
    <path d="M6 9a8 8 0 0 0 0 6M18 9a8 8 0 0 1 0 6M9 7a5 5 0 0 0 0 10M15 7a5 5 0 0 1 0 10"/>
    <circle cx="12" cy="12" r="1.2" fill="#04141a"/>
  </g>
  <text x="${sx + 14}" y="${sy + 19}" font-family="${FONT}" font-size="26" font-weight="700" fill="#eef3f7">Brake at T4. Release early.</text>
</g>
</svg>`;
}

export async function renderSocial() {
  const { Resvg } = await import('@resvg/resvg-js');
  const resvg = new Resvg(socialSvg(), {
    fitTo: { mode: 'width', value: W },
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
  });
  return resvg.render().asPng();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'social-preview.png');
  mkdirSync(dirname(out), { recursive: true });
  const png = await renderSocial();
  writeFileSync(out, png);
  console.log(`Social preview written to docs/social-preview.png (${png.length} bytes).`);
}
