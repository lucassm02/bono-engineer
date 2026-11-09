/**
 * Pure helpers of the desktop shell (no Electron imports, so they are unit-tested with Vitest):
 * folders, the address the window opens and which URLs the window is allowed to navigate to.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export const APP_NAME = 'GT7 Race Engineer';

export interface PathContext {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/**
 * Where Electron/Chromium keeps ITS files (caches, local storage, window state, log). It is NOT
 * the data folder: the history (sessions.db, traces, recordings) stays in the folder `npm start`
 * uses (`defaultDataDir()` of @gt7/core), so both ways of running share it. The two names differ
 * on purpose so no Chromium cache ever lands inside the data folder.
 *
 *   Windows  %LOCALAPPDATA%\GT7 Race Engineer
 *   macOS    ~/Library/Application Support/GT7 Race Engineer Desktop
 *   Linux    $XDG_CONFIG_HOME/gt7-race-engineer-desktop  (default ~/.config)
 */
export function electronUserDataDir(ctx: PathContext = {}): string {
  const platform = ctx.platform ?? process.platform;
  const env = ctx.env ?? process.env;
  const home = ctx.home ?? homedir();
  if (platform === 'win32') {
    return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), APP_NAME);
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', `${APP_NAME} Desktop`);
  }
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'gt7-race-engineer-desktop');
}

/** The dashboard bundled next to the main script (`dist/web`, copied by scripts/build.ts). */
export function bundledWebDist(scriptDir: string): string {
  return join(scriptDir, 'web');
}

const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::', '[::]', 'localhost']);

/** Host to type in the window's address so it reaches a server bound to `bindHost`. */
export function loopbackHost(bindHost: string): string {
  if (WILDCARD_HOSTS.has(bindHost)) return '127.0.0.1';
  return bindHost.includes(':') && !bindHost.startsWith('[') ? `[${bindHost}]` : bindHost;
}

/** Address the window opens (the token, if any, is turned into a cookie by the server). */
export function serverUrl(bindHost: string, port: number, token?: string | null): string {
  const base = `http://${loopbackHost(bindHost)}:${port}/`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Is `url` a page of our own server (the only thing the window may show)? */
export function isInternalUrl(url: string, port: number, bindHost = '127.0.0.1'): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  const own = loopbackHost(bindHost).replace(/^\[|\]$/g, '');
  if (!LOOPBACK.has(host) && host !== own) return false;
  return Number(u.port || 80) === port;
}

/** Links that may be handed to the system browser. Nothing else (file:, javascript:…) ever is. */
export function isOpenableExternally(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

/** Internal actions of the error page (links with this scheme never leave the app). */
export const ACTION_SCHEME = 'gt7-app:';
export type PageAction = 'retry' | 'quit';

export function parsePageAction(url: string): PageAction | null {
  if (!url.startsWith(`${ACTION_SCHEME}//`)) return null;
  const name = url.slice(ACTION_SCHEME.length + 2).replace(/[/?#].*$/, '');
  return name === 'retry' || name === 'quit' ? name : null;
}
