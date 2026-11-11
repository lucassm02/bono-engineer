/**
 * Testes do build do site (`npm run site:test`, node:test: o site não depende do vitest do monorepo).
 * Geram o site numa pasta temporária e validam SEO, JSON-LD, links internos e imagens.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { build, robotsTxt, sitemapXml } from './build.mjs';
import { NOT_FOUND, PAGES, pageUrl, SITE } from './config.mjs';

let out;
const all = [...PAGES, NOT_FOUND];

const fileOf = (page) =>
  join(
    out,
    page.path === ''
      ? 'index.html'
      : page.path.endsWith('/')
        ? `${page.path}index.html`
        : page.path,
  );
const htmlOf = (page) => readFileSync(fileOf(page), 'utf8');
const meta = (html, attr, name) =>
  html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];
const decode = (s) =>
  s
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

before(
  async () => {
    out = mkdtempSync(join(tmpdir(), 'bono-site-test-'));
    await build({ out });
  },
  { timeout: 120_000 },
);
after(() => rmSync(out, { recursive: true, force: true }));

describe('metadados de SEO', () => {
  for (const page of all) {
    it(`${page.id}: title, description, canonical, Open Graph e Twitter`, () => {
      const html = htmlOf(page);
      const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
      const desc = decode(meta(html, 'name', 'description') ?? '');
      assert.ok(
        title.length > 0 && title.length <= 60,
        `title com ${title.length} caracteres: ${title}`,
      );
      assert.ok(
        desc.length >= 70 && desc.length <= 155,
        `description com ${desc.length} caracteres`,
      );
      assert.match(html, new RegExp(`<html lang="${page.lang}">`));
      if (page.noindex) {
        assert.match(html, /name="robots" content="noindex/);
      } else {
        assert.ok(html.includes(`<link rel="canonical" href="${pageUrl(page)}">`), 'canonical');
      }
      for (const p of [
        'og:title',
        'og:description',
        'og:image',
        'og:url',
        'og:type',
        'og:image:alt',
      ]) {
        assert.ok(meta(html, 'property', p), `falta ${p}`);
      }
      assert.equal(meta(html, 'name', 'twitter:card'), 'summary_large_image');
      assert.ok(meta(html, 'name', 'twitter:image'));
      assert.equal(meta(html, 'property', 'og:image:width'), '1200');
      assert.equal(meta(html, 'property', 'og:image:height'), '630');
    });

    it(`${page.id}: um único h1 e hierarquia sem saltos`, () => {
      const html = htmlOf(page);
      assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1);
      const levels = [...html.matchAll(/<h([1-4])[ >]/g)].map((m) => Number(m[1]));
      for (let i = 1; i < levels.length; i++) {
        assert.ok(levels[i] - levels[i - 1] <= 1, `salto de h${levels[i - 1]} para h${levels[i]}`);
      }
      assert.ok(
        /<main id="conteudo">/.test(html) &&
          /<header class="top">/.test(html) &&
          /<footer/.test(html),
      );
    });
  }

  it('titles e descriptions são únicos', () => {
    const titles = PAGES.map((p) => p.title);
    const descs = PAGES.map((p) => p.description);
    assert.equal(new Set(titles).size, titles.length);
    assert.equal(new Set(descs).size, descs.length);
  });

  it('hreflang pt-BR e en apontam um para o outro', () => {
    const pt = htmlOf(PAGES[0]);
    const en = htmlOf(PAGES.find((p) => p.id === 'en'));
    for (const html of [pt, en]) {
      assert.ok(html.includes(`hreflang="pt-BR" href="${pageUrl(PAGES[0])}"`));
      assert.ok(html.includes(`hreflang="en" href="${pageUrl(PAGES.find((p) => p.id === 'en'))}"`));
      assert.ok(html.includes('hreflang="x-default"'));
    }
  });

  it('o aviso de projeto pessoal está no rodapé e não há rastreadores', () => {
    for (const page of all) {
      const html = htmlOf(page);
      assert.ok(/Polyphony Digital/.test(html), 'aviso legal');
      assert.ok(!/<script[^>]+src=/.test(html), 'script externo');
      assert.ok(!/document\.cookie|google-analytics|gtag\(/.test(html));
      assert.ok(!/<link[^>]+rel="stylesheet"/.test(html), 'CSS deve ser inline');
    }
  });
});

describe('sitemap e robots', () => {
  it('sitemap.xml lista todas as páginas indexáveis e não lista a 404', () => {
    const xml = readFileSync(join(out, 'sitemap.xml'), 'utf8');
    assert.equal(xml, sitemapXml());
    for (const p of PAGES) assert.ok(xml.includes(`<loc>${pageUrl(p)}</loc>`), p.id);
    assert.ok(!xml.includes('404'));
    assert.equal((xml.match(/<loc>/g) ?? []).length, PAGES.length);
  });

  it('robots.txt libera tudo e aponta para o sitemap', () => {
    const txt = readFileSync(join(out, 'robots.txt'), 'utf8');
    assert.equal(txt, robotsTxt());
    assert.match(txt, /Allow: \//);
    assert.ok(txt.includes(`Sitemap: ${SITE.origin}${SITE.base}/sitemap.xml`));
  });
});

describe('JSON-LD', () => {
  const ld = (page) =>
    [...htmlOf(page).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (m) => JSON.parse(m[1]),
    );

  it('home e en têm SoftwareApplication válido e FAQPage coerente com o HTML', () => {
    for (const id of ['home', 'en']) {
      const page = PAGES.find((p) => p.id === id);
      const items = ld(page);
      const app = items.find((i) => i['@type'] === 'SoftwareApplication');
      assert.ok(app, `${id}: SoftwareApplication`);
      assert.equal(app.applicationCategory, 'GameApplication');
      assert.equal(app.operatingSystem, 'Windows');
      assert.equal(app.offers.price, '0');
      assert.equal(app.softwareVersion, SITE.version);
      assert.equal(app.downloadUrl, SITE.releases);
      const faq = items.find((i) => i['@type'] === 'FAQPage');
      assert.ok(faq, `${id}: FAQPage`);
      assert.equal(faq.mainEntity.length, (htmlOf(page).match(/<details>/g) ?? []).length);
      for (const q of faq.mainEntity) {
        assert.ok(q.name && q.acceptedAnswer.text, 'pergunta e resposta preenchidas');
      }
    }
  });

  it('páginas internas têm BreadcrumbList', () => {
    for (const id of ['instalar', 'discord', 'guia']) {
      const items = ld(PAGES.find((p) => p.id === id));
      assert.equal(items[0]['@type'], 'BreadcrumbList');
      assert.equal(items[0].itemListElement.length, 2);
    }
  });
});

describe('links e imagens', () => {
  /** Resolve um link interno para um arquivo em `out` (ou null se for externo). */
  function resolve(page, href) {
    if (/^(https?:|mailto:|data:)/.test(href)) return null;
    const base = page.id === '404' ? `http://t${SITE.base}/` : `http://t/${page.path}`;
    const url = new URL(href, base);
    let path = url.pathname;
    if (path.startsWith(`${SITE.base}/`)) path = path.slice(SITE.base.length);
    let file = join(out, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    return { file, hash: url.hash };
  }

  it('todo link e recurso interno existe, e as âncoras apontam para ids reais', () => {
    for (const page of all) {
      const html = htmlOf(page);
      const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
      for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
        refs.push(...m[1].split(',').map((s) => s.trim().split(/\s+/)[0]));
      }
      for (const href of refs) {
        const r = resolve(page, href);
        if (!r) continue;
        if (href.startsWith('#')) {
          assert.ok(html.includes(`id="${href.slice(1)}"`), `${page.id}: âncora ${href} sem alvo`);
          continue;
        }
        assert.ok(existsSync(r.file), `${page.id}: link quebrado ${href}`);
        if (r.hash && r.file.endsWith('.html')) {
          const target = readFileSync(r.file, 'utf8');
          assert.ok(target.includes(`id="${r.hash.slice(1)}"`), `${page.id}: âncora ${href}`);
        }
      }
    }
  });

  it('toda imagem tem alt, width, height e arquivo; só o herói é prioritário', () => {
    for (const page of all) {
      const html = htmlOf(page);
      const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
      imgs.forEach((tag, i) => {
        assert.match(tag, /alt="[^"]{8,}"/, `${page.id}: alt`);
        assert.match(tag, /width="\d+"/);
        assert.match(tag, /height="\d+"/);
        assert.match(
          tag,
          i === 0 ? /fetchpriority="high"/ : /loading="lazy"/,
          `${page.id}: carregamento da imagem ${i}`,
        );
      });
    }
  });

  it('as imagens de compartilhamento existem e têm 1200x630', () => {
    for (const page of all) {
      const file = join(out, 'assets', 'og', `${page.id}.png`);
      assert.ok(existsSync(file), `og de ${page.id}`);
      const b = readFileSync(file);
      assert.equal(b.readUInt32BE(16), 1200);
      assert.equal(b.readUInt32BE(20), 630);
    }
  });
});

describe('versão', () => {
  it('o site mostra a versão do package.json do app e a página de download aponta para a Release', () => {
    const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(SITE.version, root.version);
    const home = htmlOf(PAGES[0]);
    assert.ok(home.includes(`Baixar o Bono ${root.version}`));
    assert.ok(home.includes('https://github.com/lucassm02/bono-engineer/releases/latest'));
    assert.ok(/SmartScreen/.test(home));
  });
});
