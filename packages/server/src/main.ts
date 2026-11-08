/**
 * Server entry point.
 *
 *   npm start            server (serves packages/web/dist) + opens the browser
 *   npm run demo         same with an in-process fake console (synthetic laps, data/demo)
 *   npm run dev          server + Vite dev server (http://localhost:5173, proxies /ws and /api)
 *
 * Run with `node --disable-warning=ExperimentalWarning --import tsx packages/server/src/main.ts`.
 * See config.ts / `--help` for flags and environment variables.
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Gt7RuntimeOptions } from '@gt7/core';
import { createApp, type Gt7Server, SERVER_VERSION } from './app.ts';
import { renderBanner, renderFirewall } from './banner.ts';
import {
  ConfigError,
  HELP_TEXT,
  parseConfig,
  REPO_ROOT,
  type ServerConfig,
  webDistExists,
} from './config.ts';
import { DemoConsole } from './sim.ts';

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

/** npm's JS entry (no shell needed): npm_execpath under npm scripts, else next to node.exe. */
function npmCliPath(): string | null {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && /.c?js$/.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const bundled = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return existsSync(bundled) ? bundled : null;
}

function spawnVite(): ChildProcess {
  const npmCli = npmCliPath();
  const opts = { cwd: REPO_ROOT, stdio: 'inherit' as const };
  const child = npmCli
    ? spawn(process.execPath, [npmCli, 'run', 'dev', '-w', '@gt7/web'], opts)
    : spawn('npm run dev -w @gt7/web', { ...opts, shell: true });
  child.on('error', (e) => console.error(`  [dev] falha ao iniciar o Vite: ${e.message}`));
  child.on('exit', (code) => {
    if (code) console.error(`  [dev] o Vite terminou com código ${code} (porta 5173 em uso?)`);
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

  const webBuilt = webDistExists(cfg.webDist);
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
        ? `Erro: a porta ${cfg.port} já está em uso (o servidor já está aberto?). Use --port para outra porta.`
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
        ? '  Aviso: a porta UDP de telemetria já está em uso (outro app de telemetria aberto?). ' +
            'O painel e o histórico funcionam, mas sem dados ao vivo.'
        : `  Aviso: falha ao iniciar a telemetria: ${(e as Error).message}`,
    );
  }

  await server.firewall.check().catch(() => null);
  if (cfg.dev) vite = spawnVite();

  const { lan, runtime } = server;
  console.log(
    await renderBanner({
      version: SERVER_VERSION,
      localUrl: lan.localUrl(),
      lanUrls: lan.urls(),
      preferredUrl: lan.preferredUrl(),
      devUrl: cfg.dev ? VITE_URL : null,
      consoleIp: runtime.consoleIp,
      liveFormat: runtime.liveFormat,
      simulator: !!cfg.sim,
      dataDir: cfg.dataDir,
      webBuilt,
      tokenRequired: !!cfg.token,
      host: cfg.host,
    }),
  );
  const fw = renderFirewall(server.firewall.status);
  if (fw) console.log(fw);

  runtime.on('lapCompleted', (e) => {
    const tags = [e.isPersonalBest ? 'melhor pessoal' : '', e.valid ? '' : 'inválida']
      .filter(Boolean)
      .join(', ');
    console.log(`  Volta ${e.lapNumber}: ${fmtLap(e.timeMs)}${tags ? ` (${tags})` : ''}`);
  });
  runtime.on('notice', (n) => {
    if (n.level !== 'info' || n.code === 'consoleDiscovered')
      console.log(`  [${n.level}] ${n.message}`);
  });

  if (cfg.open) {
    const target = cfg.dev ? VITE_URL : lan.localUrl();
    const url = cfg.token ? `${target}?token=${encodeURIComponent(cfg.token)}` : target;
    setTimeout(() => openBrowser(url), cfg.dev ? 2500 : 300).unref();
  }
}

main().catch((e) => {
  console.error(`Erro fatal: ${(e as Error).stack ?? e}`);
  process.exit(1);
});
