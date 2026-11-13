/**
 * `npm run site:build`: gera o site estático em `site/dist/` (ignorado pelo git).
 *
 * Sem dependência de runtime além do @resvg/resvg-js (já no repositório) para as imagens de
 * compartilhamento. O conteúdo de cada página vive em `site/pages/*.mjs`; os metadados (title,
 * description, imagem) em `site/config.mjs`.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOT_FOUND, PAGES, pageUrl, ROOT_DIR, SITE, SITE_DIR } from './config.mjs';
import { MOTION_DIR, MOTION_FILES } from './motion.mjs';
import { renderOg } from './og.mjs';
import { checkAssets, htmlDocument, makeCtx } from './render.mjs';

const RENDERERS = {
  home: () => import('./pages/home.mjs'),
  install: () => import('./pages/install.mjs'),
  discord: () => import('./pages/discord.mjs'),
  guide: () => import('./pages/guide.mjs'),
  en: () => import('./pages/en.mjs'),
  404: () => import('./pages/notfound.mjs'),
};

export const DEFAULT_OUT = join(SITE_DIR, 'dist');

export function sitemapXml() {
  const urls = PAGES.map((p) => {
    const alts = p.alternates
      ? Object.entries(p.alternates)
          .map(
            ([lang, id]) =>
              `    <xhtml:link rel="alternate" hreflang="${lang}" href="${pageUrl(PAGES.find((x) => x.id === id))}"/>`,
          )
          .join('\n')
      : '';
    return `  <url>\n    <loc>${pageUrl(p)}</loc>${alts ? `\n${alts}` : ''}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

export function robotsTxt() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE.origin}${SITE.base}/sitemap.xml\n`;
}

export async function build({ out = DEFAULT_OUT, og = true } = {}) {
  if (SITE.version !== SITE.rootVersion) {
    throw new Error(
      `Versões diferentes: package.json ${SITE.rootVersion} e packages/desktop ${SITE.version}.`,
    );
  }
  const missing = checkAssets();
  if (missing.length > 0) {
    throw new Error(
      `Faltam capturas em site/assets/shots (${missing.join(', ')}). Rode npm run site:shots.`,
    );
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const page of [...PAGES, NOT_FOUND]) {
    const { render } = await RENDERERS[page.id]();
    const ctx = makeCtx(page);
    const { body, jsonLd } = render(ctx);
    const file = join(
      out,
      page.path === ''
        ? 'index.html'
        : page.path.endsWith('/')
          ? `${page.path}index.html`
          : page.path,
    );
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, htmlDocument(page, ctx, body, jsonLd));
  }

  // Keep bookmarks working when the published paths change.
  for (const [legacy, current] of Object.entries({
    'como-instalar': 'install',
    'guia-de-pilotagem': 'driving-guide',
  })) {
    const dir = join(out, legacy);
    const href = '../' + current + '/';
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="robots" content="noindex">' +
        '<link rel="canonical" href="' +
        SITE.origin +
        SITE.base +
        '/' +
        current +
        '/">' +
        '<meta http-equiv="refresh" content="0; url=' +
        href +
        '">' +
        '<title>Bono Engineer</title><a href="' +
        href +
        '">Bono Engineer</a></html>',
    );
  }

  // Static files
  cpSync(join(SITE_DIR, 'assets', 'shots'), join(out, 'assets', 'shots'), { recursive: true });
  // Vídeo curto opcional (site/assets/motion/bono-explainer.webm|mp4 + poster): só os arquivos de mídia.
  for (const file of Object.values(MOTION_FILES)) {
    const from = join(MOTION_DIR, file);
    if (existsSync(from)) {
      mkdirSync(join(out, 'assets', 'motion'), { recursive: true });
      cpSync(from, join(out, 'assets', 'motion', file));
    }
  }
  const pub = join(ROOT_DIR, 'packages', 'web', 'public');
  cpSync(join(pub, 'favicon.svg'), join(out, 'favicon.svg'));
  cpSync(join(pub, 'apple-touch-icon.png'), join(out, 'apple-touch-icon.png'));
  writeFileSync(join(out, 'sitemap.xml'), sitemapXml());
  writeFileSync(join(out, 'robots.txt'), robotsTxt());
  writeFileSync(join(out, '.nojekyll'), '');
  if (process.env.SITE_CNAME) writeFileSync(join(out, 'CNAME'), `${process.env.SITE_CNAME}\n`);

  if (og) {
    mkdirSync(join(out, 'assets', 'og'), { recursive: true });
    for (const page of [...PAGES, NOT_FOUND]) {
      writeFileSync(join(out, 'assets', 'og', `${page.id}.png`), await renderOg(page));
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  build()
    .then((out) => {
      console.log(`[site] gerado em ${out} (versão ${SITE.version})`);
      if (!existsSync(join(out, 'index.html'))) process.exit(1);
    })
    .catch((e) => {
      console.error(`[site] ${e.message}`);
      process.exit(1);
    });
}
