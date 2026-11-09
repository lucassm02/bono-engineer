/**
 * Zero-config startup helpers: port selection / single instance and the automatic web build.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { INSTANCE_HEADER, type InstanceMode } from './identity.ts';

/** Address to reach a server that listens on `host` from this PC. */
export function probeHost(host: string): string {
  return host === '0.0.0.0' || host === '::' || host === '' ? '127.0.0.1' : host;
}

/**
 * Is a GT7 Race Engineer of this `mode` answering on host:port? Any HTTP status counts (a token
 * protected instance answers 401); what matters is the identity header.
 */
export async function isGt7Instance(
  host: string,
  port: number,
  mode: InstanceMode,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const res = await fetch(`http://${probeHost(host)}:${port}/api/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    res.body?.cancel().catch(() => {});
    return res.headers.get(INSTANCE_HEADER) === mode;
  } catch {
    return false;
  }
}

/** Can we listen on host:port right now? */
export function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host }, () => srv.close(() => resolve(true)));
  });
}

export type PortChoice =
  | { kind: 'run'; port: number; skipped: number[] }
  | { kind: 'existing'; port: number }
  | { kind: 'busy'; port: number };

export interface PickPortDeps {
  isInstance?: typeof isGt7Instance;
  isFree?: typeof isPortFree;
}

/**
 * Chooses the HTTP port. Starting at `start`: an instance of ours (same mode) there → `existing`
 * (open the browser on it and exit); a free port → `run`; another program → the next port, up to
 * `tries` ports (`busy` when none or when `explicit`, i.e. the user asked for that exact port).
 */
export async function pickPort(
  start: number,
  host: string,
  mode: InstanceMode,
  explicit: boolean,
  tries = 20,
  deps: PickPortDeps = {},
): Promise<PortChoice> {
  const isInstance = deps.isInstance ?? isGt7Instance;
  const isFree = deps.isFree ?? isPortFree;
  const skipped: number[] = [];
  for (let port = start; port < start + tries && port <= 65535; port++) {
    if (await isInstance(host, port, mode)) return { kind: 'existing', port };
    if (await isFree(port, host)) return { kind: 'run', port, skipped };
    if (explicit) return { kind: 'busy', port };
    skipped.push(port);
  }
  return { kind: 'busy', port: start };
}

// ---------------------------------------------------------------------------------------------
// Web build
// ---------------------------------------------------------------------------------------------

/** Newest mtime (ms) of the files under `dir`, ignoring node_modules/dist; 0 if none. */
export function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (d: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          newest = Math.max(newest, statSync(p).mtimeMs);
        } catch {}
      }
    }
  };
  walk(dir);
  return newest;
}

/**
 * The dashboard must be (re)built when `dist/index.html` is missing or older than any source that
 * goes into it (the web package, the shared types, its config). A cheap directory walk, so the
 * check costs a few ms when everything is built.
 */
export function webNeedsBuild(
  webDist: string,
  sourceDirs: string[],
  sourceFiles: string[],
): boolean {
  const index = join(webDist, 'index.html');
  if (!existsSync(index)) return true;
  const builtAt = statSync(index).mtimeMs;
  let newest = 0;
  for (const d of sourceDirs) newest = Math.max(newest, newestMtime(d));
  for (const f of sourceFiles) {
    try {
      newest = Math.max(newest, statSync(f).mtimeMs);
    } catch {}
  }
  return newest > builtAt + 1000;
}

/** npm's JS entry (no shell needed): npm_execpath under npm scripts, else next to node.exe. */
export function npmCliPath(): string | null {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && /.c?js$/.test(fromEnv) && existsSync(fromEnv)) return fromEnv;
  const bundled = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return existsSync(bundled) ? bundled : null;
}

export function spawnNpm(
  args: string[],
  cwd: string,
  stdio: 'inherit' | 'pipe' = 'inherit',
): ChildProcess {
  const npmCli = npmCliPath();
  return npmCli
    ? spawn(process.execPath, [npmCli, ...args], { cwd, stdio })
    : spawn(`npm ${args.join(' ')}`, { cwd, stdio, shell: true });
}

/** Builds the dashboard (`npm run build -w @gt7/web`), capturing the output for error reports. */
export function buildWeb(repoRoot: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let output = '';
    const child = spawnNpm(['run', 'build', '-w', '@gt7/web'], repoRoot, 'pipe');
    const keep = (b: Buffer) => {
      output = (output + b.toString()).slice(-4000);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    child.on('error', (e) => resolve({ ok: false, output: e.message }));
    child.on('exit', (code) => resolve({ ok: code === 0, output }));
  });
}
