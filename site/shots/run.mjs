/**
 * `npm run site:shots`: captura as telas do app em modo demonstração para o site.
 *
 *   npm run site:shots                                      sobe um servidor de demonstração próprio (porta 5191)
 *   npm run site:shots -- --server http://localhost:8770    usa um servidor de demonstração já aberto
 *
 *   --lang en        captura com o app em inglês (nome da pista em inglês)
 *   --only live-dashboard    captura só uma tela (por nome)
 *   --out docs/x      pasta de saída (relativa à raiz), em vez de site/assets/shots
 *
 * O Electron do projeto (já instalado) abre cada tela numa janela invisível; as imagens vão para
 * `site/assets/shots/` em PNG e WebP. Passo manual, se preferir: abra o app com `npm run demo`, tire
 * as capturas em 1440x860 e salve com os mesmos nomes nessa pasta.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const arg = (name) =>
  process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const OUT = arg('--out') ? join(ROOT, arg('--out')) : join(ROOT, 'site', 'assets', 'shots');
const LANG = arg('--lang');
const ONLY = arg('--only');
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const serverArg = argv.includes('--server') ? argv[argv.indexOf('--server') + 1] : null;
const PORT = 5191;
const MIN_LAPS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url) => (await fetch(url, { signal: AbortSignal.timeout(3000) })).json();

function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else child.kill('SIGTERM');
}

function startDemo() {
  const data = mkdtempSync(join(tmpdir(), 'bono-site-'));
  const child = spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--import',
      'tsx',
      'packages/server/src/main.ts',
      '--sim',
      '--no-open',
      '--no-record',
      '--port',
      String(PORT),
      '--data',
      data,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
  return { child, data, base: `http://localhost:${PORT}` };
}

async function waitFor(fn, label, timeoutMs) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // servidor ainda subindo
    }
    if (Date.now() > end) throw new Error(`tempo esgotado: ${label}`);
    await sleep(2000);
  }
}

function pickLaps(base) {
  return waitFor(
    async () => {
      const sessions = await getJson(`${base}/api/sessions`);
      for (const s of sessions) {
        const laps = (await getJson(`${base}/api/sessions/${s.id}/laps`)).filter(
          (l) => l.valid && l.timeMs > 0,
        );
        if (laps.length >= MIN_LAPS) {
          laps.sort((a, b) => a.timeMs - b.timeMs);
          return { session: s, best: laps[0], other: laps[laps.length - 1] };
        }
      }
      return null;
    },
    `${MIN_LAPS} voltas válidas no servidor de demonstração (pode levar alguns minutos)`,
    10 * 60_000,
  );
}

/** Dá um nome à pista da demonstração (sem nome, o app pergunta "qual é?" e a faixa mostra "Dar nome"). */
async function nameDemoTrack(base, trackId) {
  if (!trackId) return;
  try {
    await fetch(`${base}/api/tracks/${trackId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: LANG === 'en' ? 'Demo Circuit' : 'Circuito de Demonstração' }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // sem nome a captura sai igual, só menos bonita
  }
}

/** Antes de fotografar o ao vivo: engenheiro ligado e sem os rótulos da primeira semana nos botões. */
const PREPARE_LIVE = `${LANG ? `localStorage.setItem('bono.language', '${LANG}'); ` : ''}localStorage.setItem('gt7.engineer.enabled', 'true'); localStorage.setItem('bono.usage.v1', JSON.stringify({ since: Date.now() - 30 * 864e5, counters: {} })); location.reload()`;

/** O convite "Novidades no Bono" aparece para quem nunca respondeu (perfil novo do Electron): some antes da foto. */
const DISMISS_INVITE =
  "[...document.querySelectorAll('.su-invite button')].find((b) => /agora não/i.test(b.textContent))?.click()";

/** Rola a página da análise até os gráficos (a rolagem é a da janela; `instant` ignora o scroll suave do app). */
const SCROLL_MAIN = "window.scrollTo({ top: 600, behavior: 'instant' })";

const demo = serverArg
  ? { child: null, data: null, base: serverArg.replace(/\/$/, '') }
  : startDemo();
let code = 0;
try {
  await waitFor(() => getJson(`${demo.base}/api/status`), 'servidor de demonstração', 180_000);
  // A tela ao vivo não depende de voltas salvas: com `--only live-dashboard` não espera o simulador.
  const needLaps = ONLY !== 'live-dashboard';
  const { session, best, other } = needLaps
    ? await pickLaps(demo.base)
    : { session: {}, best: {}, other: {} };
  // Só renomeia a pista no servidor que este script iniciou; um servidor já aberto não é alterado.
  if (!serverArg) await nameDemoTrack(demo.base, session.trackId);
  // ao vivo com o servidor de demonstração (sem o selo "Demonstração" do modo mock): mostra a faixa de contexto
  const live = `${demo.base}/#/live`;
  const shots = [
    {
      name: 'live-dashboard',
      url: live,
      width: 1440,
      height: 860,
      waitMs: 6000,
      steps: [
        { js: PREPARE_LIVE, waitMs: 9000 },
        // a janela invisível não tem voz: o cartão diria "áudio indisponível", então ele fica recolhido
        {
          js: "document.querySelector('.engineer-hud-btn[aria-pressed=true]')?.click()",
          waitMs: 700,
        },
      ],
    },
    {
      name: 'lap-comparison',
      url: `${demo.base}/?s=compare#/analysis/compare?lap=${best.id}&ref=${other.id}`,
      width: 1440,
      height: 860,
      waitMs: 4500,
      steps: [
        { js: DISMISS_INVITE, waitMs: 600 },
        { js: SCROLL_MAIN, waitMs: 800 },
      ],
    },
    {
      name: 'track-history',
      url: `${demo.base}/?s=home#/home`,
      width: 1440,
      height: 860,
      waitMs: 4500,
      steps: [{ js: DISMISS_INVITE, waitMs: 800 }],
    },
    {
      name: 'engineer-menu',
      url: `${demo.base}/?s=menu#/live`,
      width: 1440,
      height: 860,
      waitMs: 4000,
      steps: [
        { js: PREPARE_LIVE, waitMs: 6000 },
        { js: "document.querySelector('button[aria-label^=Menu]')?.click()", waitMs: 900 },
        {
          js: "[...document.querySelectorAll('[role=tab]')].find((t) => /engenheiro/i.test(t.textContent))?.click()",
          waitMs: 900,
        },
      ],
    },
  ];
  mkdirSync(OUT, { recursive: true });
  const specPath = join(tmpdir(), `bono-shots-${process.pid}.json`);
  const selected = ONLY ? shots.filter((shot) => shot.name === ONLY) : shots;
  if (!selected.length) throw new Error(`nenhuma captura chamada "${ONLY}"`);
  writeFileSync(specPath, JSON.stringify({ outDir: OUT, shots: selected }));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(require('electron'), [join(HERE, 'capture.cjs'), specPath], {
    stdio: 'inherit',
    env,
  });
  code = r.status ?? 1;
  rmSync(specPath, { force: true });
} catch (e) {
  console.error(`[site:shots] ${e.message}`);
  code = 1;
} finally {
  killTree(demo.child);
  if (demo.data) rmSync(demo.data, { recursive: true, force: true });
}
process.exit(code);
