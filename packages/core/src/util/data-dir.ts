/**
 * Where the app keeps its data (sessions.db, traces/, recordings/) when the user does not say:
 * a per-user folder, so nothing is created inside the repository and the data survives
 * reinstalling or moving the project.
 *
 *   Windows  %APPDATA%\GT7 Race Engineer
 *   macOS    ~/Library/Application Support/GT7 Race Engineer
 *   Linux    $XDG_DATA_HOME/gt7-race-engineer  (default ~/.local/share/gt7-race-engineer)
 *
 * Demo mode (`--sim`) uses the `demo` subfolder so synthetic laps never mix with real ones.
 */

import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DB_FILE } from '../store/store.ts';

export const DATA_DIR_NAME = 'GT7 Race Engineer';
export const DATA_DIR_NAME_UNIX = 'gt7-race-engineer';
/** Subfolder of the data folder used by demo mode. */
export const DEMO_SUBDIR = 'demo';

export interface DataDirContext {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/** Base per-user data folder (without the `demo` subfolder). */
export function defaultDataDir(ctx: DataDirContext = {}): string {
  const platform = ctx.platform ?? process.platform;
  const env = ctx.env ?? process.env;
  const home = ctx.home ?? homedir();
  if (platform === 'win32') {
    return join(env.APPDATA || join(home, 'AppData', 'Roaming'), DATA_DIR_NAME);
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', DATA_DIR_NAME);
  }
  return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), DATA_DIR_NAME_UNIX);
}

export interface ResolveDataDirOptions extends DataDirContext {
  /** Explicit folder (`--data`); wins over everything. */
  override?: string | undefined;
  /** Demo mode: use the `demo` subfolder of the default folder. */
  demo?: boolean;
}

/**
 * The data folder to open: an explicit override (`--data`, GT7_DATA, GT7_DATA_DIR — resolved to an
 * absolute path), otherwise the per-user folder (+ `demo` in demo mode).
 */
export function resolveDataDir(opts: ResolveDataDirOptions = {}): string {
  const env = opts.env ?? process.env;
  const override = opts.override || env.GT7_DATA || env.GT7_DATA_DIR || undefined;
  if (override) return resolve(override);
  const base = defaultDataDir(opts);
  return opts.demo ? join(base, DEMO_SUBDIR) : base;
}

export interface MigrationResult {
  /** True when files were copied. */
  migrated: boolean;
  from: string;
  to: string;
  /** Why nothing was copied (or 'copied'). */
  reason: 'copied' | 'no-legacy-data' | 'target-exists' | 'failed';
  error?: string;
}

/**
 * One-time migration of the old in-repository folder (`<repo>/data`) to the per-user folder:
 * done only if the old folder holds the database and the new one does not exist yet. The old folder
 * is copied (never deleted or modified); its `demo` subfolder is left behind. The copy is made in a
 * temporary sibling and renamed, so an interrupted run leaves no half-filled data folder.
 */
export function migrateLegacyData(legacyDir: string, targetDir: string): MigrationResult {
  const base = { from: legacyDir, to: targetDir };
  if (resolve(legacyDir) === resolve(targetDir)) {
    return { ...base, migrated: false, reason: 'target-exists' };
  }
  if (!existsSync(join(legacyDir, DB_FILE))) {
    return { ...base, migrated: false, reason: 'no-legacy-data' };
  }
  if (existsSync(targetDir)) return { ...base, migrated: false, reason: 'target-exists' };
  const tmp = `${targetDir}.migrando`;
  try {
    mkdirSync(dirname(targetDir), { recursive: true });
    rmSync(tmp, { recursive: true, force: true });
    cpSync(legacyDir, tmp, {
      recursive: true,
      filter: (src) => resolve(src) !== resolve(legacyDir, DEMO_SUBDIR),
    });
    renameSync(tmp, targetDir);
    return { ...base, migrated: true, reason: 'copied' };
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    return { ...base, migrated: false, reason: 'failed', error: (e as Error).message };
  }
}
