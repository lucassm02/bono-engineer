/**
 * SQLite schema migrations (PRAGMA user_version). Each migration runs once, inside a transaction;
 * running `migrate` again is a no-op.
 */

import type { DatabaseSync } from 'node:sqlite';

export const MIGRATIONS: readonly string[] = [
  // v1 — initial schema
  `
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    layout TEXT,
    fingerprint TEXT NOT NULL,
    length_m REAL NOT NULL,
    centerline TEXT,
    sector_gates TEXT NOT NULL DEFAULT '[]',
    corners TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'auto',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS track_centerlines (
    track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    source_lap_id TEXT,
    step_m REAL NOT NULL,
    length_m REAL NOT NULL,
    points BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    track_id TEXT,
    car_code INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    format TEXT NOT NULL,
    mode TEXT NOT NULL,
    recording_file TEXT,
    notes TEXT
  );
  CREATE INDEX IF NOT EXISTS sessions_track ON sessions(track_id, started_at);
  CREATE TABLE IF NOT EXISTS laps (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    number INTEGER NOT NULL,
    time_ms INTEGER NOT NULL,
    sector_times TEXT NOT NULL DEFAULT '[]',
    valid INTEGER NOT NULL,
    flags TEXT NOT NULL DEFAULT '[]',
    is_reference INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    car_code INTEGER NOT NULL,
    track_id TEXT,
    fuel_used_l REAL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    lost_packets INTEGER NOT NULL DEFAULT 0,
    trace_file TEXT
  );
  CREATE INDEX IF NOT EXISTS laps_session ON laps(session_id, number);
  CREATE INDEX IF NOT EXISTS laps_track ON laps(track_id, car_code, time_ms);
  CREATE TABLE IF NOT EXISTS reference_meta (
    lap_id TEXT PRIMARY KEY REFERENCES laps(id) ON DELETE CASCADE,
    driver_name TEXT NOT NULL,
    source TEXT NOT NULL,
    ranking_time_ms INTEGER,
    car_name TEXT,
    notes TEXT,
    captured_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS device_profiles (
    device_id TEXT PRIMARY KEY,
    profile TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2 — in-app AI coach reports (Debrief com IA): metadata, Markdown, transcript and the raw
  // model conversation (JSON) replayed for follow-up questions.
  `
  CREATE TABLE IF NOT EXISTS coach_reports (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'debrief',
    title TEXT NOT NULL,
    track_id TEXT,
    session_id TEXT,
    lap_id TEXT,
    reference TEXT,
    focus_corner TEXT,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    markdown TEXT NOT NULL DEFAULT '',
    transcript TEXT NOT NULL DEFAULT '[]',
    messages TEXT NOT NULL DEFAULT '[]',
    usage TEXT NOT NULL DEFAULT '{}',
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS coach_reports_track ON coach_reports(track_id, created_at);
  CREATE INDEX IF NOT EXISTS coach_reports_created ON coach_reports(created_at);
  `,
  // v3 — time actually driven in a session (pauses and time out of the track excluded)
  `
  ALTER TABLE sessions ADD COLUMN track_time_ms INTEGER;
  `,
  // v4 — where a reference lap's time comes from (typed ranking time or packet counting) and the
  // time measured from the packets (replay capture by geometry, Onda 9a)
  `
  ALTER TABLE reference_meta ADD COLUMN time_source TEXT;
  ALTER TABLE reference_meta ADD COLUMN measured_time_ms INTEGER;
  `,
  `
  CREATE TABLE engineer_radio_logs (
    lap_id TEXT NOT NULL REFERENCES laps(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    reference_lap_id TEXT NOT NULL,
    calls_json TEXT NOT NULL,
    PRIMARY KEY (lap_id, device_id, reference_lap_id)
  );
  `,
  // v6 — the lap time the driver wants to reach on a track (spec 13)
  `
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL,
    car_code INTEGER,
    target_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    achieved_at INTEGER,
    achieved_lap_id TEXT
  );
  CREATE INDEX IF NOT EXISTS goals_track ON goals(track_id, created_at);
  `,
  // v7 — corner drills: the passes of one corner practised in a session (spec 18)
  `
  CREATE TABLE IF NOT EXISTS corner_drills (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    track_id TEXT NOT NULL,
    corner_id TEXT NOT NULL,
    passes_json TEXT NOT NULL,
    target_ms INTEGER,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS corner_drills_session ON corner_drills(session_id);
  CREATE INDEX IF NOT EXISTS corner_drills_track ON corner_drills(track_id, corner_id);
  `,
  // v8 — engineer tasks (spec 20): what an agent proposed and the driver approved, said on the
  // radio at a point of the lap; and the requests the dictionary could not say
  `
  CREATE TABLE IF NOT EXISTS engineer_tasks (
    id TEXT PRIMARY KEY,
    track_id TEXT NOT NULL,
    car_code INTEGER,
    where_json TEXT NOT NULL,
    say_json TEXT NOT NULL,
    ids_json TEXT NOT NULL,
    dictionary_version INTEGER NOT NULL,
    spoken_json TEXT NOT NULL,
    note TEXT,
    why TEXT,
    source TEXT NOT NULL,
    agent TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    approved_at INTEGER,
    spoken_count INTEGER NOT NULL DEFAULT 0,
    last_spoken_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS engineer_tasks_track ON engineer_tasks(track_id, status);
  CREATE TABLE IF NOT EXISTS engineer_task_misses (
    id TEXT PRIMARY KEY,
    grp TEXT NOT NULL,
    text TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    first_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    UNIQUE (grp, text)
  );
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

/** Applies pending migrations. Returns the number applied. */
export function migrate(db: DatabaseSync): number {
  let v = getSchemaVersion(db);
  if (v > SCHEMA_VERSION) {
    throw new Error(`database schema v${v} is newer than this app (v${SCHEMA_VERSION})`);
  }
  let applied = 0;
  while (v < SCHEMA_VERSION) {
    const sql = MIGRATIONS[v]!;
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    v++;
    applied++;
  }
  return applied;
}
