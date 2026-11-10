/** GET /api/mcp/info: MCP connection snippets with this installation's real paths. */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MCP_HTTP_PATH } from '@gt7/mcp';
import type { ApiMcpInfo } from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import { REPO_ROOT } from '../config.ts';
import type { RouteContext } from './context.ts';

export interface McpInfoInput {
  repoRoot: string;
  dataDir: string;
  nodePath: string;
  localUrl: string;
  lanUrls: string[];
  tokenRequired: boolean;
  /**
   * Installed desktop app: absolute path of the bundled `mcp-stdio.cjs` (inside app.asar), run by
   * `nodePath` (the app's .exe) with ELECTRON_RUN_AS_NODE=1. Null/missing = repo + tsx.
   */
  bundledStdio?: string | null;
  /** Default: process.platform (Windows PowerShell 5.1 needs `npm.cmd`, see below). */
  platform?: NodeJS.Platform;
}

/** Quotes one argument for a PowerShell / POSIX command line (only when it needs it). */
export function quoteArg(a: string): string {
  return /[\s"'`$&|;<>()]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a;
}

/** `env` + command line for PowerShell (Windows) or a POSIX shell. */
function shellLine(
  command: string,
  args: string[],
  env: Record<string, string>,
  win: boolean,
): string {
  const cmd = [command, ...args].map(quoteArg).join(' ');
  const vars = Object.entries(env);
  if (!vars.length) return cmd;
  // PowerShell needs `&` to run a quoted path and `$env:` to set a variable.
  if (win) return `${vars.map(([k, v]) => `$env:${k}="${v}"; `).join('')}& ${cmd}`;
  return `${vars.map(([k, v]) => `${k}=${quoteArg(v)} `).join('')}${cmd}`;
}

/** Pure builder (tested): works for paths with spaces and any drive/OS. */
export function buildMcpInfo(i: McpInfoInput): ApiMcpInfo {
  const win = (i.platform ?? process.platform) === 'win32';
  const bundled = i.bundledStdio ?? null;
  const args = bundled
    ? [bundled, '--data', i.dataDir]
    : [
        '--disable-warning=ExperimentalWarning',
        '--import',
        pathToFileURL(join(i.repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href,
        join(i.repoRoot, 'packages', 'mcp', 'src', 'stdio.ts'),
        '--data',
        i.dataDir,
      ];
  // The installed app's .exe is Electron: this variable makes it behave as plain Node.
  const env: Record<string, string> = bundled ? { ELECTRON_RUN_AS_NODE: '1' } : {};
  const commandLine = shellLine(i.nodePath, args, env, win);
  const base = i.localUrl.replace(/\/+$/, '');
  const mcpUrl = (b: string) => `${b.replace(/\/+$/, '')}${MCP_HTTP_PATH}`;
  const httpUrl = mcpUrl(base);
  const header = i.tokenRequired ? ' --header "Authorization: Bearer <seu-token>"' : '';
  const envFlags = Object.entries(env)
    .map(([k, v]) => ` -e ${k}=${quoteArg(v)}`)
    .join('');
  return {
    repoRoot: bundled ? null : i.repoRoot,
    dataDir: i.dataDir,
    nodePath: i.nodePath,
    stdio: {
      command: i.nodePath,
      args,
      env,
      commandLine,
      // PowerShell 5.1 + npm.ps1 swallows the first `--`, so `--data` would go to npm and be
      // ignored; `npm.cmd` passes it through (and works from Git Bash and cmd too).
      npmCommandLine: bundled
        ? null
        : `${win ? 'npm.cmd' : 'npm'} run -s mcp -- --data ${quoteArg(i.dataDir)}`,
    },
    http: {
      path: MCP_HTTP_PATH,
      localUrl: httpUrl,
      lanUrls: i.lanUrls.map(mcpUrl),
      tokenRequired: i.tokenRequired,
    },
    claudeDesktopConfig: {
      mcpServers: { bono: { command: i.nodePath, args, ...(bundled ? { env } : {}) } },
    },
    claudeCode: {
      stdio: `claude mcp add bono${envFlags} -- ${[i.nodePath, ...args].map(quoteArg).join(' ')}`,
      http: `claude mcp add --transport http bono-live ${httpUrl}${header}`,
    },
  };
}

export function mcpInfoRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get(
    '/mcp/info',
    async (): Promise<ApiMcpInfo> =>
      buildMcpInfo({
        repoRoot: REPO_ROOT,
        dataDir: ctx.runtime.store.dataDir,
        nodePath: process.execPath,
        localUrl: ctx.lan.localUrl(),
        lanUrls: ctx.lan.urls(),
        tokenRequired: ctx.tokenRequired,
        bundledStdio: ctx.mcpStdioScript ?? null,
      }),
  );
}
