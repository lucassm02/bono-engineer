/**
 * Imagens de compartilhamento 1200x630 (Open Graph e Twitter Card), uma por página.
 * SVG (marca + título + captura do app) renderizado em PNG com o @resvg/resvg-js que o projeto já usa.
 * Fontes: o resvg usa as do sistema. Com Bahnschrift (Windows) o título sai na fonte da marca; em
 * outro sistema cai numa fonte condensada genérica.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_DIR } from './config.mjs';
import { esc, LOGO_SVG, pngSize } from './render.mjs';

export const OG_W = 1200;
export const OG_H = 630;

const FONT =
  "Bahnschrift, 'DIN Alternate', 'Arial Narrow', 'DejaVu Sans Condensed', Arial, sans-serif";

export function ogSvg(page) {
  const shotPath = join(SITE_DIR, 'assets', 'shots', `${page.og.shot}.png`);
  const { w, h } = pngSize(shotPath);
  const data = readFileSync(shotPath).toString('base64');
  // A captura sangra pela direita e por baixo, dentro de um cartão com borda.
  const sw = 560;
  const sh = Math.round((sw * h) / w);
  const sx = 720;
  const sy = 150;
  const lines = page.og.lines;
  const title = lines
    .map(
      (l, i) =>
        `<text x="64" y="${250 + i * 72}" font-family="${FONT}" font-size="64" font-weight="700" fill="#eef3f7">${esc(l)}</text>`,
    )
    .join('');
  const sub =
    page.lang === 'en'
      ? 'Telemetry, radio and lap analysis for GT7'
      : 'Telemetria, rádio e análise de voltas para GT7';
  const logo = LOGO_SVG.replace('<svg ', '<svg x="64" y="56" width="56" height="56" ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}">
<defs>
  <clipPath id="c"><rect x="${sx}" y="${sy}" width="${sw + 80}" height="${OG_H - sy + 40}" rx="18"/></clipPath>
</defs>
<rect width="${OG_W}" height="${OG_H}" fill="#05080c"/>
<rect x="0" y="0" width="10" height="${OG_H}" fill="#66e4f6"/>
${logo}
<text x="136" y="92" font-family="${FONT}" font-size="34" font-weight="700" fill="#eef3f7">Bono</text>
<text x="136" y="110" font-family="${FONT}" font-size="12" font-weight="700" letter-spacing="3.4" fill="#66e4f6">ENGINEER</text>
${title}
<text x="64" y="${250 + (lines.length - 1) * 72 + 60}" font-family="Arial, sans-serif" font-size="26" fill="#a9b7c4">${esc(sub)}</text>
<text x="64" y="590" font-family="Arial, sans-serif" font-size="22" fill="#7b8b9a">lucassm02.github.io/bono-engineer</text>
<g clip-path="url(#c)">
  <rect x="${sx}" y="${sy}" width="${sw + 80}" height="${OG_H}" fill="#0d141c"/>
  <image x="${sx}" y="${sy}" width="${sw}" height="${sh}" href="data:image/png;base64,${data}"/>
</g>
<rect x="${sx}" y="${sy}" width="${sw + 80}" height="${OG_H - sy + 40}" rx="18" fill="none" stroke="#324658" stroke-width="2"/>
</svg>`;
}

export async function renderOg(page) {
  let Resvg;
  try {
    ({ Resvg } = await import('@resvg/resvg-js'));
  } catch {
    throw new Error('@resvg/resvg-js não encontrado: rode "npm ci" na raiz do repositório.');
  }
  const resvg = new Resvg(ogSvg(page), {
    fitTo: { mode: 'width', value: OG_W },
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
  });
  return resvg.render().asPng();
}
