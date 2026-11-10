/**
 * Where the app keeps its data (sessions.db, traces/, recordings/) when the user does not say:
 * a per-user folder, so nothing is created inside the repository and the data survives
 * reinstalling or moving the project.
 *
 *   Windows  %APPDATA%\Bono Engineer
 *   macOS    ~/Library/Application Support/Bono Engineer
 *   Linux    $XDG_DATA_HOME/bono-engineer  (default ~/.local/share/bono-engineer)
 *
 * Demo mode (`--sim`) uses the `demo` subfolder so synthetic laps never mix with real ones.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PRODUCT_NAME, PRODUCT_SLUG } from '@gt7/shared';

export const DATA_DIR_NAME = PRODUCT_NAME;
export const DATA_DIR_NAME_UNIX = PRODUCT_SLUG;
export const DB_FILE = 'sessions.db';

/** Directory name used by the previous release, for locating existing user data only. */
export function previousDataFolderName(unix: boolean): string {
  const parts = ['GT7', 'Race', 'Engineer'];
  return unix ? parts.join('-').toLowerCase() : parts.join(' ');
}
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

/** Stage beside the destination so two first launches cannot publish a partial copy. */
export function publishMigratedFolder(
  targetDir: string,
  populate: (staging: string) => void,
): boolean {
  if (existsSync(targetDir)) return false;
  mkdirSync(dirname(targetDir), { recursive: true });
  const staging = mkdtempSync(`${targetDir}.migrando-`);
  try {
    populate(staging);
    if (existsSync(targetDir)) return false;
    try {
      renameSync(staging, targetDir);
    } catch (error) {
      if (existsSync(targetDir)) return false;
      throw error;
    }
    return true;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Copy the previous release's default history before SQLite creates an empty store. */
export function migratePreviousDataDir(dataDir: string, ctx: DataDirContext = {}): void {
  const target = resolve(dataDir);
  if (existsSync(target)) return;
  const current = resolve(defaultDataDir(ctx));
  const platform = ctx.platform ?? process.platform;
  const previous = join(
    dirname(current),
    previousDataFolderName(platform !== 'win32' && platform !== 'darwin'),
  );
  const demo = target === join(current, DEMO_SUBDIR);
  if (target !== current && !demo) return;
  const source = demo ? join(previous, DEMO_SUBDIR) : previous;
  const sourceDb = join(source, DB_FILE);
  if (!existsSync(sourceDb)) return;

  publishMigratedFolder(target, (staging) => {
    const db = new DatabaseSync(sourceDb, { readOnly: true, timeout: 5000 });
    try {
      // A snapshot includes committed WAL data without copying the live journal files.
      db.prepare('VACUUM INTO ?').run(join(staging, DB_FILE));
    } finally {
      db.close();
    }
    cpSync(source, staging, {
      recursive: true,
      filter: (path) =>
        path !== join(source, DEMO_SUBDIR) && path !== sourceDb && !path.startsWith(`${sourceDb}-`),
    });
  });
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
  try {
    const migrated = publishMigratedFolder(targetDir, (staging) => {
      cpSync(legacyDir, staging, {
        recursive: true,
        filter: (src) => resolve(src) !== resolve(legacyDir, DEMO_SUBDIR),
      });
    });
    return { ...base, migrated, reason: migrated ? 'copied' : 'target-exists' };
  } catch (e) {
    return { ...base, migrated: false, reason: 'failed', error: (e as Error).message };
  }
}
