/**
 * Server entry point. `npm start` needs no argument: it picks a free port (or just opens the
 * browser on the instance that is already running), keeps the data in the user's folder, builds
 * the dashboard when it is missing and finds the PlayStation by itself.
 *
 *   npm start            server (serves packages/web/dist) + opens the browser
 *   npm run demo         same with an in-process fake console (synthetic laps, <data>/demo)
 *   npm run dev          server + Vite dev server (http://localhost:5173, proxies /ws and /api)
 *
 * Run with `node --disable-warning=ExperimentalWarning --import tsx packages/server/src/main.ts`.
 * See config.ts / `--help` for the (optional, advanced) flags and environment variables.
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { defaultDataDir, type Gt7RuntimeOptions, migrateLegacyData } from '@gt7/core';
import type { ConsoleLinkState } from '@gt7/shared';
import { createApp, type Gt7Server, SERVER_VERSION } from './app.ts';
import { renderBanner, renderFirewall } from './banner.ts';
import {
  ConfigError,
  HELP_TEXT,
  LEGACY_DATA_DIR,
  parseConfig,
  REPO_ROOT,
  type ServerConfig,
  webDistExists,
} from './config.ts';
import { DemoConsole } from './sim.ts';
import { buildWeb, npmCliPath, pickPort, webNeedsBuild } from './startup.ts';

const VITE_URL = 'http://localhost:5173/';

function fmtLap(ms: number): string {
  const m = Math.floor(ms / 60000);
  return `${m}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // no browser available: the banner has the URL
  }
}

function withToken(url: string, token: string | null): string {
  return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

function spawnVite(isStopping: () => boolean): ChildProcess {
  const npmCli = npmCliPath();
  const opts = { cwd: REPO_ROOT, stdio: 'inherit' as const };
  const child = npmCli
    ? spawn(process.execPath, [npmCli, 'run', 'dev', '-w', '@gt7/web'], opts)
    : spawn('npm run dev -w @gt7/web', { ...opts, shell: true });
  child.on('error', (e) => console.error(`  [dev] falha ao iniciar o Vite: ${e.message}`));
  child.on('exit', (code) => {
    if (code && !isStopping())
      console.error(`  [dev] o Vite terminou com código ${code} (porta 5173 em uso?)`);
  });
  return child;
}

function killTree(child: ChildProcess | null): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function runtimeOptions(cfg: ServerConfig): Omit<Gt7RuntimeOptions, 'statusExtras'> {
  const opts: Omit<Gt7RuntimeOptions, 'statusExtras'> = { dataDir: cfg.dataDir };
  if (cfg.sim) {
    opts.consoleIp = '127.0.0.1';
    opts.simulator = true;
    opts.persistConsoleIp = false; // the fake console's 127.0.0.1 never becomes a saved setting
    opts.ingestor = {
      bindAddress: '127.0.0.1',
      bindPort: cfg.sim.clientPort,
      consolePort: cfg.sim.consolePort,
      discovery: false,
    };
  } else if (cfg.consoleIp) {
    opts.consoleIp = cfg.consoleIp;
  }
  if (cfg.liveFormat) opts.liveFormat = cfg.liveFormat;
  if (cfg.record === false) opts.record = false;
  return opts;
}

/** The dashboard is built on demand: the first run (or after an update) just takes a bit longer. */
async function ensureWeb(cfg: ServerConfig): Promise<boolean> {
  if (cfg.dev) return webDistExists(cfg.webDist);
  const webDir = join(REPO_ROOT, 'packages', 'web');
  const needs =
    !webDistExists(cfg.webDist) ||
    webNeedsBuild(
      cfg.webDist,
      [join(webDir, 'src'), join(webDir, 'public'), join(REPO_ROOT, 'packages', 'shared', 'src')],
      [
        join(webDir, 'index.html'),
        join(webDir, 'vite.config.ts'),
        join(webDir, 'package.json'),
        join(REPO_ROOT, 'package-lock.json'),
      ],
    );
  if (!needs) return true;
  console.log('  Preparando o painel (só na primeira vez ou depois de uma atualização, ~30 s)…');
  const started = Date.now();
  const r = await buildWeb(REPO_ROOT);
  if (r.ok) {
    console.log(`  Painel pronto (${Math.round((Date.now() - started) / 1000)} s).`);
    return true;
  }
  console.error(`  Aviso: não consegui montar o painel automaticamente.\n${r.output.trimEnd()}`);
  console.error('  Rode "npm install" e depois "npm run build". A API continua funcionando.');
  return webDistExists(cfg.webDist);
}

const LINK_LINES: Record<ConsoleLinkState, (ip: string | null) => string | null> = {
  idle: () => null,
  searching: () => 'Console: procurando o PlayStation na rede…',
  found: (ip) => `Console: ${ip} — aguardando o jogo (abra o Gran Turismo 7 e entre numa pista).`,
  receiving: (ip) => `Console: recebendo telemetria de ${ip}.`,
  lost: () => 'Console: sem dados (jogo fechado ou em pausa). Continuo procurando.',
};

async function main(): Promise<void> {
  let cfg: ServerConfig;
  try {
    cfg = parseConfig();
  } catch (e) {
    console.error(`Erro: ${(e as Error).message}\n\n${HELP_TEXT}`);
    process.exit(e instanceof ConfigError ? 2 : 1);
  }
  if (cfg.help) {
    console.log(HELP_TEXT);
    return;
  }

  // One-time move of the old <repo>/data to the user's folder (the old one is kept).
  let migratedFrom: string | null = null;
  if (!cfg.dataDirExplicit) {
    const m = migrateLegacyData(LEGACY_DATA_DIR, defaultDataDir());
    if (m.migrated) {
      migratedFrom = m.from;
      console.log(`  Seus dados foram copiados para ${m.to} (a pasta antiga foi mantida).`);
    } else if (m.reason === 'failed') {
      console.error(`  Aviso: não consegui copiar os dados antigos de ${m.from}: ${m.error}`);
    }
  }

  // Port: reuse the running instance, or the first free port from the default one.
  let portNote: string | null = null;
  if (!cfg.dev) {
    const choice = await pickPort(cfg.port, cfg.host, cfg.sim ? 'demo' : 'real', cfg.portExplicit);
    if (choice.kind === 'existing') {
      const url = withToken(`http://localhost:${choice.port}/`, cfg.token);
      console.log(`  O GT7 Race Engineer já está aberto em http://localhost:${choice.port}/.`);
      if (cfg.open) {
        console.log('  Abrindo o navegador nele.');
        openBrowser(url);
        await new Promise((r) => setTimeout(r, 400));
      }
      process.exit(0);
    }
    if (choice.kind === 'busy') {
      console.error(
        cfg.portExplicit
          ? `Erro: a porta ${choice.port} já está em uso por outro programa. Use --port com outro número.`
          : `Erro: nenhuma porta livre a partir da ${cfg.port}. Feche algum programa ou use --port.`,
      );
      process.exit(1);
    }
    if (choice.skipped.length) {
      portNote = `a porta ${choice.skipped[0]} estava ocupada por outro programa; usando a ${choice.port}`;
    }
    cfg = { ...cfg, port: choice.port };
  }

  const webBuilt = await ensureWeb(cfg);
  let server: Gt7Server;
  try {
    server = await createApp({
      runtime: runtimeOptions(cfg),
      port: cfg.port,
      host: cfg.host,
      webDist: cfg.webDist,
      token: cfg.token,
      simulator: !!cfg.sim,
      logger: cfg.verbose,
    });
  } catch (e) {
    console.error(`Erro ao abrir os dados em ${cfg.dataDir}: ${(e as Error).message}`);
    process.exit(1);
  }

  try {
    await server.app.listen({ port: cfg.port, host: cfg.host });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    console.error(
      code === 'EADDRINUSE'
        ? `Erro: a porta ${cfg.port} já está em uso (o app já está aberto?). Use --port para outra.`
        : `Erro ao escutar em ${cfg.host}:${cfg.port}: ${(e as Error).message}`,
    );
    await server.close();
    process.exit(1);
  }

  const demo = cfg.sim ? new DemoConsole(cfg.sim) : null;
  let vite: ChildProcess | null = null;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) {
      console.log('  Forçando a saída.');
      process.exit(1);
    }
    stopping = true;
    console.log('\n  Encerrando…');
    setTimeout(() => process.exit(1), 8000).unref();
    killTree(vite);
    try {
      await server.close();
      await demo?.stop();
    } catch (e) {
      console.error(`  Erro ao encerrar: ${(e as Error).message}`);
    }
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    process.on(sig, () => void shutdown());
  }

  if (demo) {
    try {
      await demo.start();
    } catch (e) {
      console.error(`  [sim] falha ao iniciar o console falso: ${(e as Error).message}`);
    }
  }
  try {
    await server.runtime.start();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    console.error(
      code === 'EADDRINUSE'
        ? '  Aviso: a porta UDP 33740 já está em uso (SimHub ou outro app de telemetria aberto?). ' +
            'O painel e o histórico funcionam, mas sem dados ao vivo.'
        : `  Aviso: a telemetria não iniciou: ${(e as Error).message}`,
    );
  }

  await server.firewall.check().catch(() => null);
  if (cfg.dev) vite = spawnVite(() => stopping);

  const { lan, runtime } = server;
  console.log(
    await renderBanner({
      version: SERVER_VERSION,
      localUrl: lan.localUrl(),
      lanUrls: lan.urls(),
      preferredUrl: lan.preferredUrl(),
      devUrl: cfg.dev ? VITE_URL : null,
      consoleIp: runtime.consoleIp,
      consoleSource: runtime.getSettings().consoleIpSource,
      liveFormat: runtime.liveFormat,
      liveFormatAuto: runtime.getSettings().liveFormatAuto,
      simulator: !!cfg.sim,
      dataDir: cfg.dataDir,
      dataMigratedFrom: migratedFrom,
      portNote,
      webBuilt,
      tokenRequired: !!cfg.token,
      host: cfg.host,
    }),
  );
  const fw = renderFirewall(server.firewall.status);
  if (fw) console.log(fw);

  // The terminal is just an optional log: one line whenever the console link changes.
  let lastLink: ConsoleLinkState | null = null;
  runtime.on('status', (st) => {
    const c = st.consoleConnection;
    if (!c || c.state === lastLink) return;
    const first = lastLink === null;
    lastLink = c.state;
    const line = LINK_LINES[c.state](c.consoleIp);
    if (line && !(first && c.state === 'searching')) console.log(`  ${line}`);
  });
  runtime.on('lapCompleted', (e) => {
    const tags = [e.isPersonalBest ? 'melhor pessoal' : '', e.valid ? '' : 'inválida']
      .filter(Boolean)
      .join(', ');
    console.log(`  Volta ${e.lapNumber}: ${fmtLap(e.timeMs)}${tags ? ` (${tags})` : ''}`);
  });
  runtime.on('notice', (n) => {
    if (n.level !== 'info' || n.code === 'consoleDiscovered' || n.code === 'formatAuto')
      console.log(`  [${n.level === 'error' ? 'erro' : 'aviso'}] ${n.message}`);
  });

  if (cfg.open) {
    const target = cfg.dev ? VITE_URL : lan.localUrl();
    setTimeout(() => openBrowser(withToken(target, cfg.token)), cfg.dev ? 2500 : 300).unref();
  }
}

// A stray rejection or exception (a bad UDP packet, a closed socket) must not end a session
// in the middle of a race: report it and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error('  [erro] promessa rejeitada sem tratamento:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('  [erro] exceção não tratada:', err);
});

main().catch((e) => {
  console.error(`Erro fatal: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
