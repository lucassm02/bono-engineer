/**
 * Generates the app icon from an SVG (speedometer in the dashboard's palette) with @resvg/resvg-js:
 * build/icon.png (512), build/tray.png (32) and build/icon.ico (16…256, PNG-compressed entries).
 * Pure JS output, no native tooling. Run by scripts/build.ts.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const C = 256;
const CY = C + 28;
const R = 150;

function pt(deg: number, r = R): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), CY + r * Math.sin(a)];
}

/** Arc along the gauge from `a0` to `a1` degrees (SVG angles, clockwise from the +x axis). */
function arc(a0: number, a1: number, r = R): string {
  const [x0, y0] = pt(a0, r);
  const [x1, y1] = pt(a1, r);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

export function iconSvg(): string {
  const start = 135;
  const sweep = 270;
  const at = (f: number) => start + sweep * f;
  const seg = (f0: number, f1: number, color: string) =>
    `<path d="${arc(at(f0), at(f1))}" fill="none" stroke="${color}" stroke-width="44" stroke-linecap="butt"/>`;
  const ticks: string[] = [];
  for (let i = 0; i <= 10; i++) {
    const major = i % 5 === 0;
    const [x0, y0] = pt(at(i / 10), R - 38);
    const [x1, y1] = pt(at(i / 10), R - (major ? 76 : 62));
    ticks.push(
      `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="#f1f4f6" stroke-opacity="${major ? 0.95 : 0.55}" stroke-width="${major ? 9 : 6}" stroke-linecap="round"/>`,
    );
  }
  const [nx, ny] = pt(at(0.72), R - 52);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<title>GT7 Race Engineer</title>
<rect width="512" height="512" rx="112" fill="#0b0d10"/>
<circle cx="${C}" cy="${CY}" r="${R + 44}" fill="#14181d"/>
<circle cx="${C}" cy="${CY}" r="${R + 44}" fill="none" stroke="#262d35" stroke-width="10"/>
${seg(0.012, 0.58, '#22e07a')}${seg(0.6, 0.78, '#ffb21e')}${seg(0.8, 0.988, '#ff3d4a')}
${ticks.join('\n')}
<line x1="${C}" y1="${CY}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#f1f4f6" stroke-width="16" stroke-linecap="round"/>
<circle cx="${C}" cy="${CY}" r="26" fill="#f1f4f6"/>
<circle cx="${C}" cy="${CY}" r="10" fill="#0b0d10"/>
<rect x="196" y="${CY + 96}" width="120" height="14" rx="7" fill="#f1f4f6" fill-opacity="0.8"/>
</svg>`;
}

function png(svg: string, size: number): Buffer {
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
}

/** ICO container with PNG-compressed images (supported since Windows Vista). */
export function buildIco(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const o = i * 16;
    const dim = img.size >= 256 ? 0 : img.size;
    dir.writeUInt8(dim, o);
    dir.writeUInt8(dim, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(img.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

export function generateIcons(buildDir: string): void {
  mkdirSync(buildDir, { recursive: true });
  const svg = iconSvg();
  writeFileSync(join(buildDir, 'icon.svg'), svg);
  writeFileSync(join(buildDir, 'icon.png'), png(svg, 512));
  writeFileSync(join(buildDir, 'tray.png'), png(svg, 32));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  writeFileSync(
    join(buildDir, 'icon.ico'),
    buildIco(sizes.map((size) => ({ size, data: png(svg, size) }))),
  );
}
