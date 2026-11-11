/**
 * Peças compartilhadas do HTML: <head> (SEO), cabeçalho, rodapé, imagens e JSON-LD.
 * Tudo é string: o site é estático e o conteúdo existe no HTML inicial.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOT_FOUND, PAGES, pageUrl, ROOT_DIR, SITE, SITE_DIR } from './config.mjs';

export const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Dimensões de um PNG lidas do cabeçalho (sem dependência de imagem). */
export function pngSize(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const SHOTS_DIR = join(SITE_DIR, 'assets', 'shots');
export const SHOT_W = 1440;

export function shotDims(name) {
  const { w, h } = pngSize(join(SHOTS_DIR, `${name}.png`));
  const width = Math.min(SHOT_W, w);
  return { width, height: Math.round((h * width) / w) };
}

/** Marca (mesmo traçado do favicon do app). */
export const LOGO_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="14" fill="#0b1118"/><g fill="none" stroke="#f7f5ea" stroke-width="3" stroke-linejoin="round"><path d="M16 36.5V14a4 4 0 0 1 4-4h14c6.5 0 9.5 6.5 3.7 10L21 29.5c-3 1.8-5 4-5 7Z"/><path d="M16 36.5C16 31.5 24 29 32.5 29 42 29 50 34 50 42S43 55 34 55H20a4 4 0 0 1-4-4Z"/></g><path fill="#66e4f6" d="m13.2 47.8 5.6-2.9v1.6l-5.6 2.9Z"/></svg>`;

export const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>`;

/** Contexto de uma página: gera URLs relativas (funcionam em /bono-engineer/ e na raiz) e imagens. */
export function makeCtx(page) {
  const absolute = page.id === '404';
  const depth = absolute ? 0 : page.path.split('/').filter(Boolean).length;
  const prefix = absolute ? `${SITE.base}/` : depth === 0 ? './' : '../'.repeat(depth);
  const byId = Object.fromEntries(PAGES.map((p) => [p.id, p]));
  return {
    page,
    site: SITE,
    /** Link para outra página do site. */
    rel(id) {
      const p = byId[id];
      if (!p) throw new Error(`página desconhecida: ${id}`);
      return p.path === '' ? prefix : `${prefix}${p.path}`;
    },
    /** Caminho de um arquivo publicado (assets, favicon...). */
    asset(path) {
      return `${prefix}${path}`;
    },
    /**
     * Captura do app em <picture> (WebP 720/1440 + PNG de reserva) com width/height. `sizes` diz ao
     * navegador quanto da tela a imagem ocupa; `eager` marca a imagem do herói (LCP).
     */
    pic(name, alt, { sizes = '(min-width: 1000px) 700px, 100vw', eager = false } = {}) {
      const { width, height } = shotDims(name);
      const src = (suffix) => this.asset(`assets/shots/${name}${suffix}`);
      const load = eager ? 'fetchpriority="high"' : 'loading="lazy"';
      return `<picture><source type="image/webp" srcset="${src('-720.webp')} 720w, ${src('-1440.webp')} 1440w" sizes="${sizes}"><img src="${src('.png')}" alt="${esc(alt)}" width="${width}" height="${height}" ${load} decoding="async"></picture>`;
    },
  };
}

let cssCache = null;
/** CSS crítico: tokens do app + estilo do site, minificado de forma simples e embutido em cada página. */
export function inlineCss() {
  if (cssCache) return cssCache;
  const tokens = readFileSync(
    join(ROOT_DIR, 'packages', 'web', 'src', 'styles', 'tokens.css'),
    'utf8',
  );
  const site = readFileSync(join(SITE_DIR, 'styles', 'site.css'), 'utf8');
  cssCache = `${tokens}\n${site}`
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/:\s+/g, ':')
    .replace(/;}/g, '}')
    .trim();
  return cssCache;
}

const OG_W = 1200;
const OG_H = 630;

/** <head> completo: title, description, canonical, hreflang, Open Graph, Twitter, ícones, JSON-LD. */
export function head(page, ctx, jsonLd = []) {
  const url = pageUrl(page);
  const ogImage = `${SITE.origin}${SITE.base}/assets/og/${page.id}.png`;
  const locale = page.lang === 'en' ? 'en_US' : 'pt_BR';
  const alternates = page.alternates
    ? Object.entries(page.alternates)
        .map(
          ([lang, id]) =>
            `<link rel="alternate" hreflang="${lang}" href="${pageUrl(PAGES.find((p) => p.id === id))}">`,
        )
        .join('\n    ') +
      `\n    <link rel="alternate" hreflang="x-default" href="${pageUrl(PAGES[0])}">`
    : '';
  const lines = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    page.noindex
      ? '<meta name="robots" content="noindex, follow">'
      : '<meta name="robots" content="index, follow, max-image-preview:large">',
    page.id === '404' ? '' : `<link rel="canonical" href="${url}">`,
    alternates,
    '<meta name="theme-color" content="#080d13">',
    '<meta name="color-scheme" content="dark">',
    `<meta name="author" content="${SITE.author}">`,
    SITE.googleVerification
      ? `<meta name="google-site-verification" content="${esc(SITE.googleVerification)}">`
      : '',
    SITE.bingVerification
      ? `<meta name="msvalidate.01" content="${esc(SITE.bingVerification)}">`
      : '',
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SITE.name}">`,
    `<meta property="og:locale" content="${locale}">`,
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${ogImage}">`,
    `<meta property="og:image:width" content="${OG_W}">`,
    `<meta property="og:image:height" content="${OG_H}">`,
    `<meta property="og:image:alt" content="${esc(page.ogAlt)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(page.title)}">`,
    `<meta name="twitter:description" content="${esc(page.description)}">`,
    `<meta name="twitter:image" content="${ogImage}">`,
    `<meta name="twitter:image:alt" content="${esc(page.ogAlt)}">`,
    `<link rel="icon" type="image/svg+xml" href="${ctx.asset('favicon.svg')}">`,
    `<link rel="apple-touch-icon" href="${ctx.asset('apple-touch-icon.png')}">`,
    `<style>${inlineCss()}</style>`,
    ...jsonLd.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`),
  ];
  return lines.filter(Boolean).join('\n    ');
}

const NAV_IDS = ['instalar', 'discord', 'guia', 'en'];

function header(page, ctx) {
  const home = ctx.rel('home');
  const en = page.lang === 'en';
  const items = NAV_IDS.map((id) => {
    const p = PAGES.find((x) => x.id === id);
    const current = p.id === page.id ? ' aria-current="page"' : '';
    const lang = p.lang === 'en' && !en ? ' lang="en" hreflang="en"' : '';
    return `<li><a href="${ctx.rel(id)}"${current}${lang}>${p.nav}</a></li>`;
  });
  if (en) {
    items.length = 0;
    items.push(`<li><a href="${ctx.rel('home')}" lang="pt-BR" hreflang="pt-BR">Português</a></li>`);
  }
  const cta = en ? 'Download' : 'Baixar';
  return `<a class="skip" href="#conteudo">${en ? 'Skip to content' : 'Ir para o conteúdo'}</a>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="${en ? ctx.rel('en') : home}" aria-label="${SITE.name}">${LOGO_SVG}<span>Bono<small>Engineer</small></span></a>
    <nav class="nav" aria-label="${en ? 'Main' : 'Principal'}"><ul>${items.join('')}</ul></nav>
    <a class="btn btn-sm" href="${SITE.releases}" rel="noopener">${cta}</a>
  </div>
</header>`;
}

function footer(page, ctx) {
  const en = page.lang === 'en';
  if (en) {
    return `<footer class="foot">
  <div class="wrap">
    <div class="foot-grid">
      <div><p><strong>Bono Engineer</strong> is a free race engineer for Gran Turismo 7 on PlayStation. Open source under the MIT license.</p></div>
      <div><h2>Project</h2><ul><li><a href="${SITE.repo}" rel="noopener">Source on GitHub</a></li><li><a href="${SITE.releases}" rel="noopener">Releases</a></li><li><a href="${SITE.repo}/blob/main/CHANGELOG.md" rel="noopener">Changelog</a></li></ul></div>
      <div><h2>Site</h2><ul><li><a href="${ctx.rel('home')}" lang="pt-BR" hreflang="pt-BR">Português (Brasil)</a></li><li><a href="${ctx.rel('guia')}" lang="pt-BR" hreflang="pt-BR">Driving guide (pt-BR)</a></li></ul></div>
    </div>
    <p class="legal">Personal project, not affiliated with Polyphony Digital or Sony. Gran Turismo and PlayStation are trademarks of their owners. This site sets no cookies and has no trackers.</p>
  </div>
</footer>`;
  }
  return `<footer class="foot">
  <div class="wrap">
    <div class="foot-grid">
      <div><p><strong>Bono Engineer</strong> é um engenheiro de pista grátis para Gran Turismo 7 no PlayStation. Código aberto, licença MIT.</p></div>
      <div><h2>No site</h2><ul><li><a href="${ctx.rel('instalar')}">Como instalar</a></li><li><a href="${ctx.rel('discord')}">Rádio no Discord</a></li><li><a href="${ctx.rel('guia')}">Guia de pilotagem</a></li><li><a href="${ctx.rel('en')}" lang="en" hreflang="en">English</a></li></ul></div>
      <div><h2>Projeto</h2><ul><li><a href="${SITE.repo}" rel="noopener">Código no GitHub</a></li><li><a href="${SITE.releases}" rel="noopener">Versões para baixar</a></li><li><a href="${SITE.repo}/blob/main/CHANGELOG.md" rel="noopener">Histórico de versões</a></li></ul></div>
    </div>
    <p class="legal">${SITE.disclaimer} Gran Turismo e PlayStation são marcas de seus donos. Este site não usa cookies nem rastreadores.</p>
  </div>
</footer>`;
}

/** Documento completo. `body` é o conteúdo de <main>. */
export function htmlDocument(page, ctx, body, jsonLd = []) {
  return `<!doctype html>
<html lang="${page.lang}">
  <head>
    ${head(page, ctx, jsonLd)}
  </head>
  <body>
${header(page, ctx)}
<main id="conteudo">
${body}
</main>
${footer(page, ctx)}
</body>
</html>
`;
}

/** JSON-LD */
export function softwareLd(page) {
  const en = page.lang === 'en';
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE.name,
    applicationCategory: 'GameApplication',
    operatingSystem: 'Windows',
    softwareVersion: SITE.version,
    description: page.description,
    url: pageUrl(page),
    downloadUrl: SITE.releases,
    inLanguage: ['pt-BR', 'en', 'es'],
    license: 'https://opensource.org/licenses/MIT',
    image: `${SITE.origin}${SITE.base}/assets/og/${page.id}.png`,
    screenshot: `${SITE.origin}${SITE.base}/assets/shots/ao-vivo.png`,
    author: { '@type': 'Person', name: SITE.author },
    offers: { '@type': 'Offer', price: '0', priceCurrency: en ? 'USD' : 'BRL' },
  };
}

export function faqLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  };
}

export function breadcrumbLd(page) {
  const home = PAGES[0];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: SITE.name, item: pageUrl(home) },
      { '@type': 'ListItem', position: 2, name: page.crumb ?? page.nav, item: pageUrl(page) },
    ],
  };
}

/** Perguntas e respostas em texto puro + link opcional (para o HTML e para o JSON-LD). */
export function faqHtml(items, ctx) {
  return items
    .map((i) => {
      const link = i.link
        ? ` <a href="${i.link.external ?? ctx.rel(i.link.id)}"${i.link.external ? ' rel="noopener"' : ''}>${i.link.label}</a>`
        : '';
      return `<details><summary>${esc(i.q)}</summary><div><p>${esc(i.a)}${link}</p></div></details>`;
    })
    .join('\n');
}

export function checkAssets() {
  const missing = [];
  for (const p of [...PAGES, NOT_FOUND]) {
    const n = p.og.shot;
    for (const f of [`${n}.png`, `${n}-720.webp`, `${n}-1440.webp`]) {
      if (!existsSync(join(SHOTS_DIR, f))) missing.push(f);
    }
  }
  return [...new Set(missing)];
}
