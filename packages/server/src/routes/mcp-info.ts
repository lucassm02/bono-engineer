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
  /** Default: process.platform (Windows PowerShell 5.1 needs `npm.cmd`, see below). */
  platform?: NodeJS.Platform;
}

/** Quotes one argument for a PowerShell / POSIX command line (only when it needs it). */
export function quoteArg(a: string): string {
  return /[\s"'`$&|;<>()]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a;
}

/** Pure builder (tested): works for paths with spaces and any drive/OS. */
export function buildMcpInfo(i: McpInfoInput): ApiMcpInfo {
  const loader = pathToFileURL(join(i.repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;
  const script = join(i.repoRoot, 'packages', 'mcp', 'src', 'stdio.ts');
  const args = [
    '--disable-warning=ExperimentalWarning',
    '--import',
    loader,
    script,
    '--data',
    i.dataDir,
  ];
  const commandLine = [i.nodePath, ...args].map(quoteArg).join(' ');
  const base = i.localUrl.replace(/\/+$/, '');
  const mcpUrl = (b: string) => `${b.replace(/\/+$/, '')}${MCP_HTTP_PATH}`;
  const httpUrl = mcpUrl(base);
  const header = i.tokenRequired ? ' --header "Authorization: Bearer <seu-token>"' : '';
  return {
    repoRoot: i.repoRoot,
    dataDir: i.dataDir,
    nodePath: i.nodePath,
    stdio: {
      command: i.nodePath,
      args,
      commandLine,
      // PowerShell 5.1 + npm.ps1 swallows the first `--`, so `--data` would go to npm and be
      // ignored; `npm.cmd` passes it through (and works from Git Bash and cmd too).
      npmCommandLine: `${(i.platform ?? process.platform) === 'win32' ? 'npm.cmd' : 'npm'} run -s mcp -- --data ${quoteArg(i.dataDir)}`,
    },
    http: {
      path: MCP_HTTP_PATH,
      localUrl: httpUrl,
      lanUrls: i.lanUrls.map(mcpUrl),
      tokenRequired: i.tokenRequired,
    },
    claudeDesktopConfig: { mcpServers: { gt7: { command: i.nodePath, args } } },
    claudeCode: {
      stdio: `claude mcp add gt7 -- ${commandLine}`,
      http: `claude mcp add --transport http gt7-live ${httpUrl}${header}`,
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
      }),
  );
}
