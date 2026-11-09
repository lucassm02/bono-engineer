/**
 * Generates desktop and PWA assets from the same vector mark.
 * The desktop build uses generateIcons. Run npm run brand:icons to refresh both sets.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { brandIconContents, PRODUCT_NAME } from '../../shared/src/brand.ts';

function iconSvg(maskable = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<title>${PRODUCT_NAME}</title>
${brandIconContents(maskable)}
</svg>\n`;
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
  generateIcons(join(desktop, 'build'));
  const web = join(desktop, '..', 'web', 'public');
  const svg = iconSvg();
  writeFileSync(join(web, 'favicon.svg'), svg);
  writeFileSync(join(web, 'icon-192.png'), png(svg, 192));
  writeFileSync(join(web, 'icon-512.png'), png(svg, 512));
  writeFileSync(join(web, 'apple-touch-icon.png'), png(iconSvg(true), 180));
  writeFileSync(join(web, 'icon-maskable-512.png'), png(iconSvg(true), 512));
}
