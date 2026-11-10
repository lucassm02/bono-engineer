/**
 * Builds everything the desktop app needs into packages/desktop/dist:
 *   main.cjs   Electron main + the embedded server + all workspace packages (one esbuild bundle,
 *              no tsx at runtime; only the native @resvg addon stays outside, loaded lazily)
 *   mcp-stdio.cjs   the MCP stdio server for Claude Desktop / Claude Code (same bundling)
 *   web/       the compiled dashboard (packages/web/dist, built here when missing or outdated)
 *   icon.png, tray.png   window / tray icons (also build/icon.ico for the executable)
 *   LICENSE    project license distributed with the Windows app
 *
 *   node --import tsx packages/desktop/scripts/build.ts
 */

import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildWeb, webNeedsBuild } from '../../server/src/startup.ts';
import { MCP_STDIO_BUNDLE } from '../src/paths.ts';
import { generateIcons } from './icons.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const DESKTOP_DIR = join(here, '..');
export const REPO = join(DESKTOP_DIR, '..', '..');

export async function ensureWebBuilt(): Promise<void> {
  const webDir = join(REPO, 'packages', 'web');
  const webDist = join(webDir, 'dist');
  const needs =
    !existsSync(join(webDist, 'index.html')) ||
    webNeedsBuild(
      webDist,
      [join(webDir, 'src'), join(webDir, 'public'), join(REPO, 'packages', 'shared', 'src')],
      [
        join(webDir, 'index.html'),
        join(webDir, 'vite.config.ts'),
        join(webDir, 'package.json'),
        join(REPO, 'package-lock.json'),
      ],
    );
  if (!needs) {
    console.log('[desktop] painel já compilado.');
    return;
  }
  console.log('[desktop] compilando o painel (npm run build -w @gt7/web)…');
  const r = await buildWeb(REPO);
  if (!r.ok) throw new Error(`falha ao compilar o painel:\n${r.output}`);
}

export async function buildDesktop(): Promise<void> {
  await ensureWebBuilt();

  const dist = join(DESKTOP_DIR, 'dist');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  cpSync(join(REPO, 'LICENSE'), join(dist, 'LICENSE'));

  console.log('[desktop] gerando ícones…');
  const buildDir = join(DESKTOP_DIR, 'build');
  generateIcons(buildDir);
  cpSync(join(buildDir, 'icon.png'), join(dist, 'icon.png'));
  cpSync(join(buildDir, 'tray.png'), join(dist, 'tray.png'));

  console.log('[desktop] empacotando o servidor, o app e o MCP stdio (esbuild)…');
  // Two bundles with the same settings: main.cjs (Electron main + embedded server) and
  // mcp-stdio.cjs (the MCP stdio server, run by the app's executable with ELECTRON_RUN_AS_NODE=1;
  // its path inside app.asar is what /api/mcp/info hands to Claude Desktop / Claude Code).
  for (const [entry, out] of [
    [join(DESKTOP_DIR, 'src', 'main.ts'), 'main.cjs'],
    [join(DESKTOP_DIR, 'src', 'preload.ts'), 'preload.cjs'],
    [join(DESKTOP_DIR, 'src', 'mcp-stdio.ts'), MCP_STDIO_BUNDLE],
  ] as const) {
    const result = await build({
      entryPoints: [entry],
      outfile: join(dist, out),
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
      // electron is provided by the runtime; @resvg is a native addon, shipped unpacked and
      // reached only through the lazy stand-in below.
      external: ['electron', 'discord.js', '@discordjs/voice'],
      alias: { '@resvg/resvg-js': join(DESKTOP_DIR, 'src', 'resvg-lazy.ts') },
      ...(out === 'preload.cjs'
        ? {}
        : {
            banner: {
              js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;",
            },
            define: { 'import.meta.url': '__importMetaUrl' },
          }),
      legalComments: 'none',
      logLevel: 'warning',
    });
    const bytes = statSync(join(dist, out)).size;
    console.log(`[desktop] ${out}: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
    if (result.warnings.length)
      console.log(`[desktop] ${result.warnings.length} aviso(s) do esbuild em ${out}`);
  }

  console.log('[desktop] copiando o painel…');
  cpSync(join(REPO, 'packages', 'web', 'dist'), join(dist, 'web'), { recursive: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildDesktop().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
