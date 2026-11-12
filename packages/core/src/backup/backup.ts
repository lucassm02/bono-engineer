/**
 * Full backup of the user's data in one `.bono` file (a zip): the database snapshot, lap traces and,
 * optionally, raw recordings. Importing can add to what is already there (merge, ids are random so
 * nothing collides; tracks that are the same circuit are matched by their shape) or replace
 * everything. Secrets (AI key, tokens) never leave the machine.
 *
 *   manifest.json           what is inside (counts, app version, schema version)
 *   data/sessions.db        VACUUM INTO snapshot, cleaned according to the chosen options
 *   data/traces/<id>.bin.gz lap traces of the laps in the snapshot
 *   data/recordings/*       raw recordings (optional)
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate, SCHEMA_VERSION } from '../store/schema.ts';
import type { Gt7Store } from '../store/store.ts';
import { matchTrack } from '../track/fingerprint.ts';
import { extractEntry, readEntryBuffer, readZipEntries, type ZipEntry, ZipWriter } from './zip.ts';

export const BACKUP_FORMAT = 'bono-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_EXTENSION = '.bono';

export interface BackupOptions {
  /** Sessions, laps, tracks, references and coach reports. */
  laps: boolean;
  /** App settings and per-device layouts, without secrets. */
  settings: boolean;
  /** Raw packet recordings (large). */
  recordings: boolean;
}

export interface BackupCounts {
  sessions: number;
  laps: number;
  tracks: number;
  coachReports: number;
  recordings: number;
  settings: number;
  deviceProfiles: number;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: number;
  app: { name: string; version: string };
  schemaVersion: number;
  includes: BackupOptions;
  counts: BackupCounts;
}

export interface BackupInfo {
  manifest: BackupManifest;
  sizeBytes: number;
}

export type ImportMode = 'merge' | 'replace';

export interface ImportOptions {
  mode: ImportMode;
  /** Apply the settings and device layouts that came in the backup. */
  settings: boolean;
}

export interface ImportResult {
  mode: ImportMode;
  sessions: number;
  laps: number;
  tracks: number;
  tracksMatched: number;
  coachReports: number;
  recordings: number;
  settings: number;
  /** Where the safety copy of the previous data went (replace mode only). */
  safetyBackup: string | null;
}

/** Setting keys that are never exported or imported. */
const SECRET_KEY_SQL = `lower(key) LIKE '%apikey%' OR lower(key) LIKE '%token%' OR lower(key) LIKE '%secret%' OR lower(key) LIKE '%password%'`;

const ENTRY_NAME =
  /^data\/(traces\/[A-Za-z0-9_-]+\.bin\.gz|recordings\/[A-Za-z0-9._ -]+|sessions\.db)$/;

function count(db: DatabaseSync, table: string, where = ''): number {
  const row = db.prepare(`SELECT count(*) AS c FROM ${table} ${where}`).get() as { c: number };
  return row.c;
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function countsOf(db: DatabaseSync, recordings: number): BackupCounts {
  return {
    sessions: count(db, 'sessions'),
    laps: count(db, 'laps'),
    tracks: count(db, 'tracks'),
    coachReports: tableExists(db, 'coach_reports') ? count(db, 'coach_reports') : 0,
    recordings,
    settings: count(db, 'settings'),
    deviceProfiles: count(db, 'device_profiles'),
  };
}

/** Removes from a snapshot what the chosen options leave out, plus every secret. */
function clean(db: DatabaseSync, options: BackupOptions): void {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`DELETE FROM settings WHERE ${SECRET_KEY_SQL}`);
  if (!options.settings) {
    db.exec('DELETE FROM settings; DELETE FROM device_profiles;');
  }
  if (!options.laps) {
    db.exec(`
      DELETE FROM engineer_radio_logs; DELETE FROM reference_meta; DELETE FROM coach_reports;
      DELETE FROM laps; DELETE FROM sessions; DELETE FROM track_centerlines; DELETE FROM tracks;
    `);
  }
  db.exec('VACUUM');
}

/** Writes a backup of the live store to `outPath`. */
export async function createBackup(
  store: Gt7Store,
  options: BackupOptions,
  outPath: string,
  meta: { appName: string; appVersion: string },
): Promise<BackupInfo> {
  await store.flush();
  const work = mkdtempSync(join(tmpdir(), 'bono-backup-'));
  const writer = new ZipWriter(outPath);
  try {
    const snapPath = join(work, 'sessions.db');
    store.db.prepare('VACUUM INTO ?').run(snapPath);
    const snap = new DatabaseSync(snapPath);
    let counts: BackupCounts;
    const traceIds: string[] = [];
    const recordingFiles: string[] = [];
    try {
      clean(snap, options);
      if (options.laps) {
        for (const r of snap.prepare('SELECT id FROM laps').all() as { id: string }[]) {
          traceIds.push(r.id);
        }
        if (options.recordings) {
          for (const r of snap
            .prepare('SELECT recording_file AS f FROM sessions WHERE recording_file IS NOT NULL')
            .all() as { f: string }[]) {
            recordingFiles.push(r.f);
          }
        }
      }
      const recordingsFound = recordingFiles.filter((f) => existsSync(join(store.dataDir, f)));
      counts = countsOf(snap, recordingsFound.length);
      recordingFiles.length = 0;
      recordingFiles.push(...recordingsFound);
    } finally {
      snap.close();
    }
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: Date.now(),
      app: { name: meta.appName, version: meta.appVersion },
      schemaVersion: SCHEMA_VERSION,
      includes: options,
      counts,
    };
    writer.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    writer.addFileStored('data/sessions.db', snapPath);
    for (const id of traceIds) {
      const abs = join(store.dataDir, store.traceFileFor(id));
      if (existsSync(abs)) writer.addFileStored(`data/traces/${id}.bin.gz`, abs);
    }
    for (const rel of recordingFiles) {
      writer.addFileStored(`data/recordings/${basename(rel)}`, join(store.dataDir, rel));
    }
    writer.finish();
    return { manifest, sizeBytes: statSync(outPath).size };
  } catch (e) {
    writer.abort();
    rmSync(outPath, { force: true });
    throw e;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function entryMap(entries: ZipEntry[]): Map<string, ZipEntry> {
  const map = new Map<string, ZipEntry>();
  for (const e of entries) {
    if (e.name === 'manifest.json' || ENTRY_NAME.test(e.name)) map.set(e.name, e);
  }
  return map;
}

/** Validates a backup file and returns what is inside. Throws a user-readable error otherwise. */
export async function inspectBackup(path: string): Promise<BackupInfo> {
  const entries = entryMap(readZipEntries(path));
  const m = entries.get('manifest.json');
  if (!m) throw new Error('Este arquivo não é um backup do Bono (sem manifest).');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse((await readEntryBuffer(path, m)).toString('utf8')) as BackupManifest;
  } catch {
    throw new Error('O manifest do backup está ilegível.');
  }
  if (manifest.format !== BACKUP_FORMAT) throw new Error('Este arquivo não é um backup do Bono.');
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new Error('Este backup foi criado por uma versão mais nova do Bono. Atualize o app.');
  }
  if (manifest.schemaVersion > SCHEMA_VERSION) {
    throw new Error('Este backup foi criado por uma versão mais nova do Bono. Atualize o app.');
  }
  if (!entries.has('data/sessions.db')) throw new Error('O backup não traz o banco de dados.');
  return { manifest, sizeBytes: statSync(path).size };
}

const TABLE_COLUMNS = (db: DatabaseSync, schema: string, table: string): string[] =>
  (db.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );

/** Columns present in both databases (a backup from an older schema simply lacks the newer ones). */
function common(db: DatabaseSync, table: string): string {
  const live = new Set(TABLE_COLUMNS(db, 'main', table));
  return TABLE_COLUMNS(db, 'bk', table)
    .filter((c) => live.has(c))
    .map((c) => `"${c}"`)
    .join(', ');
}

/** Imports a backup into the live store. */
export async function importBackup(
  store: Gt7Store,
  path: string,
  options: ImportOptions,
  meta: { appName: string; appVersion: string },
): Promise<ImportResult> {
  await inspectBackup(path);
  const entries = entryMap(readZipEntries(path));
  await store.flush();

  let safetyBackup: string | null = null;
  if (options.mode === 'replace') {
    const dir = join(store.dataDir, 'backups');
    mkdirSync(dir, { recursive: true });
    safetyBackup = join(
      dir,
      `antes-da-importacao-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}${BACKUP_EXTENSION}`,
    );
    await createBackup(
      store,
      { laps: true, settings: true, recordings: false },
      safetyBackup,
      meta,
    );
  }

  const work = mkdtempSync(join(tmpdir(), 'bono-import-'));
  try {
    const bkPath = join(work, 'backup.db');
    await extractEntry(path, entries.get('data/sessions.db')!, bkPath);
    // An older schema is upgraded in the temp copy, so the column lists below line up.
    const prep = new DatabaseSync(bkPath);
    try {
      migrate(prep);
    } finally {
      prep.close();
    }

    const db = store.db;
    db.prepare('ATTACH DATABASE ? AS bk').run(bkPath);
    const result: ImportResult = {
      mode: options.mode,
      sessions: 0,
      laps: 0,
      tracks: 0,
      tracksMatched: 0,
      coachReports: 0,
      recordings: 0,
      settings: 0,
      safetyBackup,
    };
    const lapIds: string[] = [];
    const sessionRecordings: { id: string; f: string }[] = [];
    try {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (options.mode === 'replace') {
          db.exec(`
            DELETE FROM engineer_radio_logs; DELETE FROM reference_meta; DELETE FROM coach_reports;
            DELETE FROM laps; DELETE FROM sessions; DELETE FROM track_centerlines; DELETE FROM tracks;
          `);
          if (options.settings) db.exec('DELETE FROM settings; DELETE FROM device_profiles;');
        }

        // Tracks: same id stays, same circuit (by shape) is matched, anything else is added.
        db.exec('CREATE TEMP TABLE IF NOT EXISTS track_map (old TEXT PRIMARY KEY, new TEXT)');
        db.exec('DELETE FROM temp.track_map');
        const liveTracks = store.listTracks();
        const existingIds = new Set(liveTracks.map((t) => t.id));
        const setMap = db.prepare('INSERT OR REPLACE INTO temp.track_map (old, new) VALUES (?, ?)');
        const bkTracks = db.prepare('SELECT id, fingerprint FROM bk.tracks').all() as {
          id: string;
          fingerprint: string;
        }[];
        const toInsert: string[] = [];
        for (const t of bkTracks) {
          if (existingIds.has(t.id)) {
            setMap.run(t.id, t.id);
            continue;
          }
          let matched: string | null = null;
          try {
            const m = matchTrack(JSON.parse(t.fingerprint), liveTracks);
            matched = m?.track.id ?? null;
          } catch {
            matched = null;
          }
          if (matched) {
            setMap.run(t.id, matched);
            result.tracksMatched++;
          } else {
            setMap.run(t.id, t.id);
            toInsert.push(t.id);
          }
        }
        const insertTrack = db.prepare(
          `INSERT OR IGNORE INTO main.tracks (${common(db, 'tracks')}) SELECT ${common(db, 'tracks')} FROM bk.tracks WHERE id = ?`,
        );
        const insertCenter = db.prepare(
          `INSERT OR IGNORE INTO main.track_centerlines (${common(db, 'track_centerlines')}) SELECT ${common(db, 'track_centerlines')} FROM bk.track_centerlines WHERE track_id = ?`,
        );
        for (const id of toInsert) {
          result.tracks += Number(insertTrack.run(id).changes);
          insertCenter.run(id);
        }

        const mapped = (col: string) =>
          `COALESCE((SELECT new FROM temp.track_map WHERE old = src.${col}), src.${col})`;
        const copyTable = (table: string, trackCols: string[] = []): number => {
          const cols = common(db, table).split(', ');
          const select = cols
            .map((c) =>
              trackCols.includes(c.replaceAll('"', ''))
                ? mapped(c.replaceAll('"', ''))
                : `src.${c}`,
            )
            .join(', ');
          return Number(
            db
              .prepare(
                `INSERT OR IGNORE INTO main.${table} (${cols.join(', ')}) SELECT ${select} FROM bk.${table} AS src`,
              )
              .run().changes,
          );
        };

        result.sessions = copyTable('sessions', ['track_id']);
        result.laps = copyTable('laps', ['track_id']);
        copyTable('reference_meta');
        result.coachReports = copyTable('coach_reports', ['track_id']);
        copyTable('engineer_radio_logs');

        if (options.settings) {
          const settingsCols = common(db, 'settings');
          result.settings += Number(
            db
              .prepare(
                `INSERT OR REPLACE INTO main.settings (${settingsCols}) SELECT ${settingsCols} FROM bk.settings WHERE NOT (${SECRET_KEY_SQL})`,
              )
              .run().changes,
          );
          const profileCols = common(db, 'device_profiles');
          db.prepare(
            `INSERT OR IGNORE INTO main.device_profiles (${profileCols}) SELECT ${profileCols} FROM bk.device_profiles`,
          ).run();
        }

        for (const r of db.prepare('SELECT id FROM bk.laps').all() as { id: string }[]) {
          lapIds.push(r.id);
        }
        for (const r of db
          .prepare(
            'SELECT id, recording_file AS f FROM bk.sessions WHERE recording_file IS NOT NULL',
          )
          .all() as { id: string; f: string }[]) {
          sessionRecordings.push(r);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    } finally {
      db.exec('DETACH DATABASE bk');
    }

    // Files: traces of the imported laps (never overwrite one that already exists) and recordings.
    if (options.mode === 'replace') {
      await rm(store.tracesDir, { recursive: true, force: true });
      mkdirSync(store.tracesDir, { recursive: true });
    }
    for (const id of lapIds) {
      const entry = entries.get(`data/traces/${id}.bin.gz`);
      const dest = join(store.dataDir, store.traceFileFor(id));
      if (entry && !existsSync(dest)) await extractEntry(path, entry, dest);
    }
    if (options.mode === 'replace') await rm(store.recordingsDir, { recursive: true, force: true });
    mkdirSync(store.recordingsDir, { recursive: true });
    const nullRecording = store.db.prepare(
      'UPDATE sessions SET recording_file = NULL WHERE id = ?',
    );
    for (const { id, f } of sessionRecordings) {
      const entry = entries.get(`data/recordings/${basename(f)}`);
      const dest = join(store.recordingsDir, basename(f));
      if (entry && !existsSync(dest)) {
        await extractEntry(path, entry, dest);
        result.recordings++;
      }
      // A backup without recordings leaves sessions that point to a file that is not here.
      if (!existsSync(dest)) nullRecording.run(id);
    }
    return result;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
