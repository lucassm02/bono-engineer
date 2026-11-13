/**
 * Configuração do site: endereço, versão e metadados de cada página (title, description, imagem
 * de compartilhamento). O `build.mjs` injeta tudo isso no HTML, no sitemap e no JSON-LD.
 *
 * Limites de SEO (verificados em `build.test.mjs`): title até 60 caracteres, description até 155.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SITE_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = join(SITE_DIR, '..');

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT_DIR, rel), 'utf8'));

export const SITE = {
  name: 'Bono Engineer',
  /** Origem e prefixo do GitHub Pages de projeto. Com domínio próprio: SITE_ORIGIN e SITE_BASE='' */
  origin: process.env.SITE_ORIGIN ?? 'https://lucassm02.github.io',
  base: process.env.SITE_BASE ?? '/bono-engineer',
  repo: 'https://github.com/lucassm02/bono-engineer',
  releases: 'https://github.com/lucassm02/bono-engineer/releases/latest',
  /** Versão atual do app: a mesma do instalador (packages/desktop/package.json). */
  version: readJson('packages/desktop/package.json').version,
  rootVersion: readJson('package.json').version,
  author: 'Lucas Santos',
  /** Meta tag de verificação do Google Search Console (cole só o valor de `content`). */
  googleVerification: process.env.SITE_GOOGLE_VERIFICATION ?? '',
  bingVerification: process.env.SITE_BING_VERIFICATION ?? '',
  /** Arquivo (em site/assets) copiado como CNAME na raiz, se houver domínio próprio. */
  disclaimer: 'Projeto pessoal, sem relação com a Polyphony Digital ou a Sony.',
};

/**
 * `path` é o caminho publicado ('' = raiz, 'install/' = pasta com index.html).
 * `og.lines` quebra o título da imagem de compartilhamento; `og.shot` é a captura usada nela.
 */
export const PAGES = [
  {
    id: 'home',
    path: '',
    lang: 'pt-BR',
    nav: 'Início',
    title: 'Bono Engineer · Telemetria e engenheiro de pista para GT7',
    description:
      'Telemetria do Gran Turismo 7 no PC, com engenheiro de pista no rádio e comparação de voltas. Grátis para Windows, sem conta e com dados só no seu PC.',
    og: { lines: ['Seu engenheiro', 'de pista no', 'Gran Turismo 7'], shot: 'live-dashboard' },
    ogAlt: 'Tela ao vivo do Bono Engineer com delta, marcha e velocidade',
    alternates: { 'pt-BR': 'home', en: 'en' },
  },
  {
    id: 'install',
    path: 'install/',
    lang: 'pt-BR',
    nav: 'Como instalar',
    title: 'Como instalar a telemetria do GT7 no PS5 · Bono Engineer',
    description:
      'Instale o Bono Engineer no Windows, libere o firewall e conecte o PS5. Passo a passo, aviso do SmartScreen e o que fazer se nada aparecer.',
    og: { lines: ['Como instalar a', 'telemetria do', 'GT7 no PS5'], shot: 'track-history' },
    ogAlt: 'Tela Início por pista do Bono Engineer',
    crumb: 'Como instalar',
  },
  {
    id: 'discord',
    path: 'radio-discord/',
    lang: 'pt-BR',
    nav: 'Rádio no Discord',
    title: 'Rádio no Discord para GT7 no PS5 · Bono Engineer',
    description:
      'Ouça o engenheiro de pista do Bono no headset do PS5 pelo Discord. Crie o bot, cole o token, convide e escolha o canal de voz. Passo a passo em pt-BR.',
    og: { lines: ['Engenheiro de', 'pista no headset', 'do PS5'], shot: 'engineer-menu' },
    ogAlt: 'Menu do engenheiro do Bono com o rádio e a fala pelo Discord',
    crumb: 'Rádio no Discord',
  },
  {
    id: 'guide',
    path: 'driving-guide/',
    lang: 'pt-BR',
    nav: 'Guia de pilotagem',
    title: 'Como melhorar a volta no GT7 · Guia de pilotagem do Bono',
    description:
      'Frenagem, ápice, saída e consistência: o que cada número do Bono quer dizer na pista e como treinar uma coisa de cada vez para baixar o tempo de volta.',
    og: {
      lines: ['Como melhorar', 'a volta no GT7', 'Guia de pilotagem'],
      shot: 'lap-comparison',
    },
    ogAlt: 'Comparação de duas voltas com velocidade, freio e acelerador sobrepostos',
    crumb: 'Guia de pilotagem',
  },
  {
    id: 'en',
    path: 'en/',
    lang: 'en',
    nav: 'English',
    title: 'Bono Engineer · GT7 telemetry and race engineer for PS5',
    description:
      'Free Windows app for Gran Turismo 7 on PlayStation: live telemetry, a race engineer on the radio, lap comparison and Discord voice. Data stays on your PC.',
    og: { lines: ['Your race', 'engineer for', 'Gran Turismo 7'], shot: 'live-dashboard' },
    ogAlt: 'Bono Engineer Live screen showing delta, gear and speed',
    alternates: { 'pt-BR': 'home', en: 'en' },
  },
];

/** Página de erro: fora do sitemap, com noindex e links absolutos (o Pages a serve em qualquer caminho). */
export const NOT_FOUND = {
  id: '404',
  path: '404.html',
  lang: 'pt-BR',
  title: 'Página não encontrada · Bono Engineer',
  description:
    'Esse endereço não existe no site do Bono Engineer. Volte ao início ou abra um dos guias.',
  og: { lines: ['Página não', 'encontrada'], shot: 'live-dashboard' },
  ogAlt: 'Tela ao vivo do Bono Engineer',
  noindex: true,
};

export const pageUrl = (page) => `${SITE.origin}${SITE.base}/${page.path}`;
