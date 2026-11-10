import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultDataDir,
  migrateLegacyData,
  migratePreviousDataDir,
  previousDataFolderName,
  resolveDataDir,
} from './data-dir.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'gt7-datadir-'));
  dirs.push(d);
  return d;
}

describe('defaultDataDir / resolveDataDir', () => {
  it('picks the per-user folder of each platform', () => {
    expect(defaultDataDir({ platform: 'win32', env: { APPDATA: 'C:UsersaAppDataRoaming' } })).toBe(
      join('C:UsersaAppDataRoaming', 'Bono Engineer'),
    );
    expect(defaultDataDir({ platform: 'win32', env: {}, home: 'C:Users\b' })).toBe(
      join('C:Users\b', 'AppData', 'Roaming', 'Bono Engineer'),
    );
    expect(defaultDataDir({ platform: 'darwin', env: {}, home: '/Users/c' })).toBe(
      join('/Users/c', 'Library', 'Application Support', 'Bono Engineer'),
    );
    expect(defaultDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/x/share' } })).toBe(
      join('/x/share', 'bono-engineer'),
    );
    expect(defaultDataDir({ platform: 'linux', env: {}, home: '/home/d' })).toBe(
      join('/home/d', '.local', 'share', 'bono-engineer'),
    );
  });

  it('demo uses the demo subfolder; overrides win (--data, then GT7_DATA, GT7_DATA_DIR)', () => {
    const ctx = { platform: 'linux' as const, home: '/h' };
    expect(resolveDataDir({ ...ctx, env: {}, demo: true })).toBe(
      join('/h', '.local', 'share', 'bono-engineer', 'demo'),
    );
    expect(resolveDataDir({ ...ctx, env: { GT7_DATA: '/e1' }, override: '/o', demo: true })).toBe(
      resolve('/o'),
    );
    expect(resolveDataDir({ ...ctx, env: { GT7_DATA: '/e1', GT7_DATA_DIR: '/e2' } })).toContain(
      'e1',
    );
    expect(resolveDataDir({ ...ctx, env: { GT7_DATA_DIR: '/e2' }, demo: true })).toContain('e2');
  });
});

describe('migrateLegacyData', () => {
  function legacy(root: string): string {
    const dir = join(root, 'repo-data');
    mkdirSync(join(dir, 'traces'), { recursive: true });
    mkdirSync(join(dir, 'demo'), { recursive: true });
    writeFileSync(join(dir, 'sessions.db'), 'db');
    writeFileSync(join(dir, 'sessions.db-wal'), 'wal');
    writeFileSync(join(dir, 'traces', 'a.bin.gz'), 'trace');
    writeFileSync(join(dir, 'demo', 'sessions.db'), 'demo');
    return dir;
  }

  it('copies once, keeps the old folder and leaves demo behind', () => {
    const root = tmp();
    const from = legacy(root);
    const to = join(root, 'nova', 'Bono Engineer');
    const r = migrateLegacyData(from, to);
    expect(r).toMatchObject({ migrated: true, reason: 'copied' });
    expect(readFileSync(join(to, 'sessions.db'), 'utf8')).toBe('db');
    expect(readFileSync(join(to, 'sessions.db-wal'), 'utf8')).toBe('wal');
    expect(readFileSync(join(to, 'traces', 'a.bin.gz'), 'utf8')).toBe('trace');
    expect(existsSync(join(to, 'demo'))).toBe(false);
    expect(existsSync(`${to}.migrando`)).toBe(false);
    expect(existsSync(join(from, 'sessions.db'))).toBe(true); // old folder kept

    writeFileSync(join(to, 'sessions.db'), 'changed');
    expect(migrateLegacyData(from, to)).toMatchObject({ migrated: false, reason: 'target-exists' });
    expect(readFileSync(join(to, 'sessions.db'), 'utf8')).toBe('changed');
  });

  it('does nothing without a legacy database or when the target exists', () => {
    const root = tmp();
    expect(migrateLegacyData(join(root, 'nada'), join(root, 'novo'))).toMatchObject({
      migrated: false,
      reason: 'no-legacy-data',
    });
    const from = legacy(root);
    const to = join(root, 'ja-existe');
    mkdirSync(to);
    expect(migrateLegacyData(from, to)).toMatchObject({ migrated: false, reason: 'target-exists' });
    expect(existsSync(join(to, 'sessions.db'))).toBe(false);
  });
});

it('migrates committed history from the previous default folder with its traces', () => {
  const root = tmp();
  const ctx = { platform: 'win32' as const, env: { APPDATA: root } };
  const from = join(root, previousDataFolderName(false));
  const to = defaultDataDir(ctx);
  mkdirSync(join(from, 'traces'), { recursive: true });
  mkdirSync(join(from, 'demo'));
  writeFileSync(join(from, 'traces', 'lap.bin.gz'), 'trace');
  const source = new DatabaseSync(join(from, 'sessions.db'));
  try {
    source.exec(
      "PRAGMA journal_mode = WAL; CREATE TABLE laps (name TEXT); INSERT INTO laps VALUES ('saved')",
    );
    expect(existsSync(join(from, 'sessions.db-wal'))).toBe(true);
    migratePreviousDataDir(to, ctx);
    source.exec("INSERT INTO laps VALUES ('later')");
    migratePreviousDataDir(to, ctx);

    const migrated = new DatabaseSync(join(to, 'sessions.db'), { readOnly: true });
    try {
      expect(migrated.prepare('SELECT name FROM laps').all()).toEqual([{ name: 'saved' }]);
    } finally {
      migrated.close();
    }
    expect(readFileSync(join(to, 'traces', 'lap.bin.gz'), 'utf8')).toBe('trace');
    expect(existsSync(join(to, 'demo'))).toBe(false);
    expect(source.prepare('SELECT name FROM laps').all()).toHaveLength(2);
  } finally {
    source.close();
  }
});
