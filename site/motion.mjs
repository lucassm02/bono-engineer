/**
 * Motion do Bono: um filme curto (15 s, sem som, em loop) que explica o produto em cinco cenas, e o
 * espaço onde um vídeo pode entrar no lugar dele.
 *
 * O filme é SVG + CSS puro (sem JavaScript, sem arquivo binário): fica nítido em qualquer tela,
 * pesa poucos KB e respeita `prefers-reduced-motion`. O CSS está em `styles/motion.css`.
 *
 * Para usar um vídeo de verdade, coloque `bono-explainer.webm` e/ou `bono-explainer.mp4` (e, se
 * quiser, `bono-explainer-poster.webp`) em `site/assets/motion/`. Se existirem, o site usa o vídeo;
 * senão, usa este filme animado.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { brandIconContents } from '../packages/shared/src/brand.ts';
import { SITE_DIR } from './config.mjs';

export const MOTION_DIR = join(SITE_DIR, 'assets', 'motion');
export const MOTION_FILES = {
  webm: 'bono-explainer.webm',
  mp4: 'bono-explainer.mp4',
  poster: 'bono-explainer-poster.webp',
};

const TEXT = {
  'pt-BR': {
    title: 'Como o Bono funciona, em 15 segundos',
    sub: 'Um filme curto e sem som. Dá para pausar.',
    pause: 'Pausar a animação',
    alt: 'Animação de 15 segundos em cinco cenas: o Bono se conecta ao PS5, mostra o delta ao vivo, o engenheiro avisa a freada pelo rádio, a comparação de voltas aponta a curva em que se perdeu tempo e o piloto melhora volta a volta.',
    scenes: [
      ['Conecte o PS5', 'O Bono encontra o console na rede e recebe a telemetria do jogo.'],
      ['Veja o delta ao vivo', 'Delta, marcha, velocidade e setores, no PC ou num tablet.'],
      ['Ouça o engenheiro', 'Chamadas curtas antes da curva, no headset pelo Discord.'],
      ['Descubra onde perdeu', 'Compare voltas e veja a curva que custou cada décimo.'],
      ['Melhore volta a volta', 'Cada volta vira dado, e cada dado vira treino.'],
    ],
    connected: 'Conectado',
    delta: 'DELTA',
    gear: 'MARCHA',
    speed: 'KM/H',
    track: 'Trial Mountain',
    engineer: 'Engenheiro · treino',
    words: ['Freada', 'leve', 'em', '100', 'metros'],
    chain: ['Bono no PC', 'Discord', 'Headset do PS5'],
    ref: 'Referência',
    you: 'Você',
    corner: 'Curva 4',
    lossLabel: 'perdeu 0,024 s',
    best: 'MELHOR VOLTA',
    free: 'Grátis · uso pessoal · Windows',
    km: ['300 m', '200 m', '100 m'],
  },
  en: {
    title: 'How Bono works, in 15 seconds',
    sub: 'A short film with no sound. You can pause it.',
    pause: 'Pause the animation',
    alt: 'A 15-second animation in five scenes: Bono connects to the PS5, shows the live delta, the engineer calls the braking point over the radio, lap comparison points at the corner where time was lost, and the driver improves lap after lap.',
    scenes: [
      [
        'Connect the PS5',
        'Bono finds the console on your network and receives the game telemetry.',
      ],
      ['See the live delta', 'Delta, gear, speed and sectors, on the PC or on a tablet.'],
      ['Hear the engineer', 'Short calls before the corner, on your headset through Discord.'],
      ['Find where you lost it', 'Compare laps and see the corner that cost each tenth.'],
      ['Improve lap by lap', 'Every lap becomes data, and every data point becomes practice.'],
    ],
    connected: 'Connected',
    delta: 'DELTA',
    gear: 'GEAR',
    speed: 'KM/H',
    track: 'Trial Mountain',
    engineer: 'Engineer · practice',
    words: ['Light', 'braking', 'in', '100', 'metres'],
    chain: ['Bono on the PC', 'Discord', 'PS5 headset'],
    ref: 'Reference',
    you: 'You',
    corner: 'Corner 4',
    lossLabel: 'lost 0.024 s',
    best: 'BEST LAP',
    free: 'Free · personal use · for Windows',
    km: ['300 m', '200 m', '100 m'],
  },
};

const TRACK =
  'M40 150 C40 60 140 30 220 50 S330 40 320 120 C312 190 250 200 220 170 S150 150 120 200 C90 240 40 220 40 150Z';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Uma cena: aparece sozinha na sua janela de 3 s do ciclo de 15 s. */
const scene = (i, inner, attrs = '') =>
  `<g class="m-sc" style="--d:${i * 3}s"${attrs}>${inner}</g>`;

const caption = (t, i) =>
  `<text class="m-cap" x="64" y="628">${esc(t.scenes[i][0])}</text><text class="m-sub" x="64" y="670">${esc(t.scenes[i][1])}</text>`;

/** Coluna de números que troca de valor em passos (cada linha tem `h` px de altura). */
function column({ id, x, y, h, w, values, size, cls = '', anchor = 'start' }) {
  const lines = values
    .map(
      (v, k) =>
        `<text class="m-num ${v.cls ?? ''}" x="${anchor === 'middle' ? w / 2 : 0}" y="${h * k + h * 0.78}" font-size="${size}" text-anchor="${anchor}">${esc(v.t ?? v)}</text>`,
    )
    .join('');
  return `<clipPath id="${id}"><rect x="0" y="0" width="${w}" height="${h}"/></clipPath><g transform="translate(${x} ${y})"><g clip-path="url(#${id})"><g class="m-col ${cls}" style="--h:${h}px;--end:${-h * (values.length - 1)}px">${lines}</g></g></g>`;
}

/** Pequeno painel com título. */
const panel = (x, y, w, h, label = '', extra = '') =>
  `<rect class="m-panel" x="${x}" y="${y}" width="${w}" height="${h}" rx="20"/>${label ? `<text class="m-label" x="${x + 24}" y="${y + 38}">${esc(label)}</text>` : ''}${extra}`;

function scene1(t) {
  const packets = Array.from(
    { length: 8 },
    (_, k) =>
      `<circle class="m-pkt" r="7" cx="0" cy="0" style="--o:${(0.35 + k * 0.26).toFixed(2)}s"/>`,
  ).join('');
  const rings = [0, 0.55, 1.1]
    .map((o) => `<circle class="m-ring" cx="262" cy="340" r="60" style="--o:${o}s"/>`)
    .join('');
  return scene(
    0,
    `<g>
  ${rings}
  <rect class="m-shell" x="140" y="210" width="122" height="260" rx="26"/>
  <rect class="m-acc-fill" x="194" y="210" width="14" height="260"/>
  <text class="m-label" x="201" y="510" text-anchor="middle">PS5</text>
  <path class="m-link" d="M290 340 C400 260 540 420 660 340"/>
  ${packets}
  <rect class="m-panel m-strong" x="640" y="190" width="480" height="300" rx="22"/>
  <rect class="m-screen" x="660" y="210" width="440" height="260" rx="12"/>
  <rect class="m-panel" x="830" y="490" width="140" height="22" rx="6"/>
  <rect class="m-panel" x="790" y="508" width="220" height="14" rx="7"/>
  <g transform="translate(804 250) scale(1.9)"><svg viewBox="0 0 64 64" width="64" height="64" x="0" y="0">${brandIconContents()}</svg></g>
  <text class="m-title-s" x="880" y="420" text-anchor="middle">Bono Engineer</text>
  <g class="m-pop" style="--o:2s;transform-origin:880px 450px"><rect class="m-ok" x="810" y="436" width="140" height="30" rx="15"/><text class="m-ok-t" x="880" y="457" text-anchor="middle">${esc(t.connected)}</text></g>
</g>${caption(t, 0)}`,
  );
}

function scene2(t) {
  return scene(
    1,
    `${panel(64, 130, 380, 250, t.delta)}
${column({
  id: 'cd',
  x: 88,
  y: 178,
  h: 112,
  w: 340,
  size: 96,
  values: [
    { t: '+0,412', cls: 'is-loss' },
    { t: '+0,268', cls: 'is-loss' },
    { t: '+0,115', cls: 'is-loss' },
    { t: '−0,033', cls: 'is-gain' },
  ],
})}
<rect class="m-bartrack" x="88" y="326" width="332" height="16" rx="8"/>
<rect class="m-bar-loss" x="254" y="326" width="166" height="16" rx="8"/>
<rect class="m-bar-gain" x="188" y="326" width="66" height="16" rx="8"/>
${panel(464, 130, 120, 250)}<text class="m-label m-label-c" x="524" y="168" text-anchor="middle">${esc(t.gear)}</text>
${column({ id: 'cg', x: 464, y: 172, h: 150, w: 120, size: 130, anchor: 'middle', values: [3, 4, 5, 4] })}
${panel(604, 130, 200, 250)}<text class="m-label m-label-c" x="704" y="168" text-anchor="middle">${esc(t.speed)}</text>
${column({ id: 'cs', x: 604, y: 186, h: 110, w: 200, size: 84, anchor: 'middle', values: [142, 187, 231, 198] })}
<rect class="m-bartrack" x="628" y="326" width="152" height="16" rx="8"/>
<rect class="m-bar-speed" x="628" y="326" width="152" height="16" rx="8"/>
${panel(64, 410, 232, 150)}
<text class="m-label" x="88" y="448">S1</text>
<text class="m-num is-purple m-in" style="--o:.9s" x="88" y="526" font-size="64">31,314</text>
${panel(308, 410, 232, 150)}
<text class="m-label" x="332" y="448">S2</text>
<text class="m-num is-gain m-in" style="--o:1.5s" x="332" y="526" font-size="64">29,870</text>
${panel(552, 410, 252, 150)}
<text class="m-label" x="576" y="448">S3</text>
<text class="m-num is-warn m-in" style="--o:2.1s" x="576" y="526" font-size="64">+0,116</text>
${panel(840, 130, 376, 430, t.track)}
<g transform="translate(850 215)">
  <path class="m-road" d="${TRACK}"/>
  <path class="m-trace" pathLength="1" d="${TRACK}" style="--o:.1s"/>
  <circle class="m-car" r="10" cx="0" cy="0"/>
</g>${caption(t, 1)}`,
  );
}

function scene3(t) {
  const words = t.words
    .map(
      (w, k) =>
        `<tspan class="m-word" style="--o:${(0.9 + k * 0.22).toFixed(2)}s">${esc(w)} </tspan>`,
    )
    .join('');
  const bars = Array.from({ length: 22 }, (_, k) => {
    const h = 20 + ((k * 37) % 56);
    return `<rect class="m-wave" x="${838 + k * 12}" y="${446 - h / 2}" width="6" height="${h}" rx="3" style="animation-delay:${-((k * 0.13) % 0.9).toFixed(2)}s"/>`;
  }).join('');
  const marks = [700, 850, 1000]
    .map(
      (x, k) =>
        `<line class="m-tick" x1="${x}" y1="250" x2="${x}" y2="350"/><text class="m-label" x="${x}" y="238" text-anchor="middle">${esc(t.km[k])}</text>`,
    )
    .join('');
  return scene(
    2,
    `<rect class="m-road2" x="80" y="268" width="1120" height="64" rx="32"/>
${marks}
<rect class="m-brakezone" x="1000" y="268" width="130" height="64" rx="12"/>
<g class="m-drive"><rect class="m-car2" x="96" y="289" width="70" height="22" rx="11"/></g>
<g class="m-in" style="--o:.8s">
  <rect class="m-panel m-strong" x="160" y="382" width="960" height="118" rx="22"/>
  <rect class="m-acc-fill" x="160" y="382" width="8" height="118" rx="4"/>
  <text class="m-label" x="196" y="418">${esc(t.engineer)}</text>
  <text class="m-radio" x="196" y="472">${words}</text>
  ${bars}
</g>
<g class="m-in" style="--o:1.6s">
  <rect class="m-pill" x="170" y="528" width="270" height="40" rx="20"/><text class="m-pill-t" x="305" y="555" text-anchor="middle">${esc(t.chain[0])}</text>
  <path class="m-arrow" d="M452 548h72m-12-9 12 9-12 9"/>
  <rect class="m-pill" x="534" y="528" width="200" height="40" rx="20"/><text class="m-pill-t" x="634" y="555" text-anchor="middle">${esc(t.chain[1])}</text>
  <path class="m-arrow" d="M746 548h72m-12-9 12 9-12 9"/>
  <rect class="m-pill m-pill-acc" x="828" y="528" width="270" height="40" rx="20"/><text class="m-pill-t" x="963" y="555" text-anchor="middle">${esc(t.chain[2])}</text>
</g>${caption(t, 2)}`,
  );
}

function scene4(t) {
  const you =
    'M110 225 C230 225 270 235 340 335 S430 475 480 475 S570 335 650 265 S790 220 900 220';
  const ref =
    'M110 225 C230 225 285 240 355 340 S435 445 480 445 S558 325 635 255 S790 216 900 216';
  return scene(
    3,
    `${panel(64, 130, 860, 430)}
<g class="m-axes"><line x1="110" y1="150" x2="110" y2="520"/><line x1="110" y1="520" x2="900" y2="520"/></g>
<rect class="m-loss-zone m-in" style="--o:1.5s" x="340" y="170" width="310" height="350" rx="12"/>
<path class="m-curve-ref" pathLength="1" d="${ref}" style="--o:.15s"/>
<path class="m-curve-you" pathLength="1" d="${you}" style="--o:.45s"/>
<g class="m-pop" style="--o:1.9s;transform-origin:495px 196px"><rect class="m-badge" x="395" y="176" width="200" height="40" rx="20"/><text class="m-badge-t" x="495" y="203" text-anchor="middle">${esc(t.corner)} · ${esc(t.lossLabel)}</text></g>
<g transform="translate(132 534)"><rect width="14" height="14" rx="3" class="m-key-you"/><text class="m-label" x="24" y="13">${esc(t.you)}</text><rect x="120" width="14" height="14" rx="3" class="m-key-ref"/><text class="m-label" x="144" y="13">${esc(t.ref)}</text></g>
${panel(952, 130, 264, 430)}
<g transform="translate(970 200) scale(.78)">
  <path class="m-road" d="${TRACK}"/>
  <path class="m-loss-seg" pathLength="1" d="${TRACK}" style="--o:1.7s"/>
</g>
<text class="m-label" x="976" y="460">${esc(t.corner)}</text>
<text class="m-num is-loss m-in" style="--o:1.8s" x="976" y="520" font-size="56">+0,024</text>${caption(t, 3)}`,
  );
}

function scene5(t) {
  return scene(
    4,
    `${panel(64, 130, 176, 130)}<text class="m-label" x="88" y="168">S1</text><text class="m-num is-purple m-pop" style="--o:.2s;transform-origin:150px 226px" x="88" y="232" font-size="44">31,114</text>
${panel(256, 130, 176, 130)}<text class="m-label" x="280" y="168">S2</text><text class="m-num is-gain m-pop" style="--o:.4s;transform-origin:342px 226px" x="280" y="232" font-size="44">29,702</text>
${panel(448, 130, 176, 130)}<text class="m-label" x="472" y="168">S3</text><text class="m-num is-gain m-pop" style="--o:.6s;transform-origin:534px 226px" x="472" y="232" font-size="44">33,468</text>
${panel(64, 280, 560, 270, t.best)}
${column({
  id: 'cb',
  x: 88,
  y: 330,
  h: 150,
  w: 520,
  size: 128,
  values: [
    { t: '1:35,161', cls: '' },
    { t: '1:34,870', cls: '' },
    { t: '1:34,512', cls: '' },
    { t: '1:34,284', cls: 'is-purple' },
  ],
})}
<g class="m-pop" style="--o:2.1s;transform-origin:846px 330px">
  <circle class="m-glow" cx="846" cy="330" r="190"/>
  <g transform="translate(702 186) scale(4.5)"><svg viewBox="0 0 64 64" width="64" height="64" x="0" y="0">${brandIconContents()}</svg></g>
</g>
<text class="m-title-s m-in" style="--o:2.3s" x="846" y="560" text-anchor="middle" font-size="22">${esc(t.free)}</text>${caption(t, 4)}`,
    ' data-still="1"',
  );
}

/** O filme: SVG 1280 x 720, 15 s, cinco cenas. */
export function motionSvg(lang = 'pt-BR') {
  const t = TEXT[lang] ?? TEXT['pt-BR'];
  const dots = Array.from(
    { length: 5 },
    (_, i) => `<circle class="m-dot" cx="${1100 + i * 28}" cy="60" r="6" style="--d:${i * 3}s"/>`,
  ).join('');
  return `<svg class="m-stage" viewBox="0 0 1280 720" role="img" aria-labelledby="m-t m-d" xmlns="http://www.w3.org/2000/svg">
<title id="m-t">${esc(t.title)}</title><desc id="m-d">${esc(t.alt)}</desc>
<defs><pattern id="m-grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" class="m-gridline"/></pattern>
<radialGradient id="m-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></radialGradient></defs>
<rect class="m-bg" width="1280" height="720"/>
<rect width="1280" height="720" fill="url(#m-grid)"/>
<ellipse class="m-halo" cx="1040" cy="260" rx="520" ry="320" fill="url(#m-glow)"/>
<g transform="translate(48 30)"><svg viewBox="0 0 64 64" width="52" height="52" x="0" y="0">${brandIconContents()}</svg></g>
<text class="m-brand" x="112" y="66">Bono Engineer</text>
${dots}
${scene1(t)}${scene2(t)}${scene3(t)}${scene4(t)}${scene5(t)}
<rect class="m-prog-track" x="0" y="712" width="1280" height="8"/>
<rect class="m-prog" x="0" y="712" width="1280" height="8"/>
</svg>`;
}

/** Vídeo curto se existir em site/assets/motion; senão, o filme animado. */
export function motionMedia(ctx, lang = 'pt-BR', dir = MOTION_DIR) {
  const has = (f) => existsSync(join(dir, f));
  const sources = [
    has(MOTION_FILES.webm) &&
      `<source src="${ctx.asset(`assets/motion/${MOTION_FILES.webm}`)}" type="video/webm">`,
    has(MOTION_FILES.mp4) &&
      `<source src="${ctx.asset(`assets/motion/${MOTION_FILES.mp4}`)}" type="video/mp4">`,
  ].filter(Boolean);
  const t = TEXT[lang] ?? TEXT['pt-BR'];
  if (sources.length === 0) {
    const caps = t.scenes
      .map(([h, p], i) => `<p style="--d:${i * 3}s"><b>${esc(h)}</b><span>${esc(p)}</span></p>`)
      .join('');
    return `<div class="m-wrap"><input type="checkbox" id="m-pause" class="m-pause-input"><label for="m-pause" class="m-pause-btn"><span class="m-on">${esc(t.pause)}</span></label>${motionSvg(lang)}<div class="m-caps" aria-hidden="true">${caps}</div></div>`;
  }
  const poster = has(MOTION_FILES.poster)
    ? ` poster="${ctx.asset(`assets/motion/${MOTION_FILES.poster}`)}"`
    : '';
  return `<video class="m-video" autoplay muted loop playsinline controls preload="metadata"${poster} aria-label="${esc(t.alt)}">${sources.join('')}${motionSvg(lang)}</video>`;
}

/** Seção da landing page com o filme (ou o vídeo). */
export function motionSection(ctx, lang = 'pt-BR') {
  const t = TEXT[lang] ?? TEXT['pt-BR'];
  return `<section class="sec motion-sec" id="motion" aria-labelledby="h-motion">
  <div class="wrap">
    <h2 id="h-motion">${esc(t.title)}</h2>
    <p class="lead">${esc(t.sub)}</p>
    <figure class="motion">${motionMedia(ctx, lang)}</figure>
  </div>
</section>`;
}

/** Fundo animado do herói: pista que se desenha, cometa de luz e grade. Decorativo. */
export function heroBackdrop() {
  return `<div class="hero-fx" aria-hidden="true">
  <svg viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="hf-g" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0"/><stop offset=".5" stop-color="var(--accent)" stop-opacity=".9"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    <path class="hf-track" pathLength="1" d="M-40 470 C140 470 200 300 360 300 S560 470 700 400 S820 150 980 170 S1160 330 1260 250"/>
    <path class="hf-track hf-track-2" pathLength="1" d="M-40 520 C160 520 220 360 380 360 S580 520 720 450 S840 210 1000 230 S1180 380 1260 300"/>
    <path class="hf-comet" pathLength="1" d="M-40 470 C140 470 200 300 360 300 S560 470 700 400 S820 150 980 170 S1160 330 1260 250" stroke="url(#hf-g)"/>
  </svg>
  <span class="hf-glow"></span>
</div>`;
}

/** Faixa "ao vivo" com o delta trocando de valor, sobre a captura do herói. */
export function liveChip(lang = 'pt-BR') {
  const live = lang === 'en' ? 'LIVE' : 'AO VIVO';
  return `<div class="live-chip" aria-hidden="true"><i></i><b>${live}</b><span class="lc-win"><span class="lc-col"><em class="is-loss">+0,412</em><em class="is-loss">+0,268</em><em class="is-loss">+0,115</em><em class="is-gain">−0,033</em></span></span></div>`;
}

/** Chamadas de rádio que se alternam sobre a captura do herói (a 1ª é a que já existia). */
export function radioCycle(lang = 'pt-BR') {
  const calls =
    lang === 'en'
      ? [
          ['Engineer, practice', 'Light braking in 100 metres'],
          ['Engineer, practice', 'Throttle earlier on exit'],
          ['Engineer, practice', 'Good lap. Best sector 2'],
        ]
      : [
          ['Engenheiro, treino', 'Freada leve em 100 metros'],
          ['Engenheiro, treino', 'Acelere mais cedo na saída'],
          ['Engenheiro, treino', 'Boa volta. Melhor setor 2'],
        ];
  return `<div class="radio-cycle" aria-hidden="true">${calls
    .map(
      ([a, b], i) =>
        `<div class="radio" style="--i:${i}"><b>${esc(a)}</b><span>${esc(b)}</span></div>`,
    )
    .join('')}</div>`;
}

/**
 * Números vivos sobre a captura do herói: a barra de RPM enche e pisca na hora de trocar, a marcha
 * sobe e a velocidade cresce. Cada elemento esconde o trecho original da imagem com uma fatia dela
 * mesma (fundo liso) e desenha o número novo por cima. Posições em pixels da captura (1442 x 863).
 */
export function heroDash(ctx) {
  const plate = ctx.asset('assets/shots/live-dashboard-1440.webp');
  const cover = (x, y, w, h, sx, sw) =>
    `<i class="fx-cover" style="--x:${x};--y:${y};--w:${w};--h:${h};--sx:${sx};--sw:${sw}"></i>`;
  const gears = [2, 3, 4, 5]
    .map((g, k) => `<span style="animation-delay:${k * 1.8}s">${g}</span>`)
    .join('');
  const speeds = [98, 126, 149, 171, 192, 213, 231, 246].map((v) => `<span>${v}</span>`).join('');
  return `<div class="fx" aria-hidden="true" style="--plate:url(${plate})">
  ${cover(0, 36, 1442, 34, 1434, 6)}
  <div class="fx-rpm"><i></i></div>
  ${cover(740, 240, 160, 185, 685, 14)}
  <div class="fx-gear">${gears}</div>
  ${cover(1085, 258, 255, 154, 1005, 14)}
  <div class="fx-speed"><div class="fx-col">${speeds}</div></div>
</div>`;
}
