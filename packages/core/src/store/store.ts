/**
 * Gt7Store: persistence with `node:sqlite` (metadata) + gzip binary trace files.
 *
 * Layout of the data dir (default `data/`):
 *   sessions.db                 SQLite (tracks, sessions, laps, reference meta, profiles, settings)
 *   traces/<lapId>.bin.gz       lap traces (see trace-file.ts)
 *   recordings/<sessionId>.gt7rec  raw session recordings (protocol RecordingWriter)
 *
 * All repository methods are synchronous except trace file IO (writes are queued; `flush()` waits).
 * Note: importing node:sqlite prints an ExperimentalWarning on Node 24 (use
 * `--disable-warning=ExperimentalWarning`).
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { RECORDING_EXTENSION } from '@gt7/protocol';
import type {
  CoachReport,
  CoachReportStatus,
  CoachReportSummary,
  CoachTranscriptEntry,
  CoachUsage,
  Corner,
  CornerDrill,
  DeviceProfile,
  EngineerRadioCall,
  EngineerRadioLog,
  Goal,
  Id,
  Lap,
  LapFlag,
  LapTrace,
  LiveDrillPass,
  ReferenceMeta,
  SectorGate,
  Session,
  Track,
  TrackCenterline,
} from '@gt7/shared';
import { computeRecords, isPersonalLap, type TrackRecords } from '../live/context.ts';
import {
  encodeTraceRaw,
  readTraceFile,
  readTraceFileSync,
  TRACE_EXTENSION,
} from '../trace/trace-file.ts';
import { detectCloudFolder } from '../util/cloud-folder.ts';
import { DB_FILE, migratePreviousDataDir } from '../util/data-dir.ts';
import { newId } from '../util/ids.ts';
import { getSchemaVersion, migrate } from './schema.ts';

const gzipAsync = promisify(gzip);

export { DB_FILE } from '../util/data-dir.ts';
export const TRACES_DIR = 'traces';
export const RECORDINGS_DIR = 'recordings';

type Row = Record<string, unknown>;

function json<T>(v: unknown, def: T): T {
  if (typeof v !== 'string') return def;
  try {
    return JSON.parse(v) as T;
  } catch {
    return def;
  }
}

function num(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : (v as number);
}

function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : num(v);
}

function strOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** A coach report plus the raw model conversation (provider message JSON, opaque to the store). */
export interface StoredCoachReport extends CoachReport {
  messages: unknown[];
}

export const EMPTY_COACH_USAGE: CoachUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  requests: 0,
};

/** Plain-text preview (first ~160 chars) of a Markdown report. */
export function coachPreview(markdown: string): string {
  const t = markdown
    .replace(/[#*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

export interface ListSessionsOptions {
  trackId?: Id;
  carCode?: number;
  mode?: Session['mode'];
  limit?: number;
  offset?: number;
}

export interface ListLapsOptions {
  carCode?: number;
  validOnly?: boolean;
  /** Include reference laps (default true). */
  includeReferences?: boolean;
  /** Only reference laps. */
  referencesOnly?: boolean;
  limit?: number;
  /** Sort by time (default) or by start time. */
  orderBy?: 'time' | 'startedAt';
}

export class Gt7Store {
  readonly dataDir: string;
  readonly dbPath: string;
  readonly tracesDir: string;
  readonly recordingsDir: string;
  readonly db: DatabaseSync;
  #pending = new Map<Id, LapTrace>();
  #writes = new Set<Promise<void>>();
  #closed = false;

  private constructor(dataDir: string) {
    this.dataDir = resolve(dataDir);
    this.dbPath = join(this.dataDir, DB_FILE);
    this.tracesDir = join(this.dataDir, TRACES_DIR);
    this.recordingsDir = join(this.dataDir, RECORDINGS_DIR);
    mkdirSync(this.tracesDir, { recursive: true });
    mkdirSync(this.recordingsDir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    // Cloud-synced folders (OneDrive, Dropbox...) can lock or upload the WAL files mid-write: there the
    // rollback journal with full syncing is the safe choice.
    const synced = detectCloudFolder(this.dataDir) !== null;
    this.db.exec(
      `PRAGMA busy_timeout = 5000; PRAGMA journal_mode = ${synced ? 'DELETE' : 'WAL'}; PRAGMA foreign_keys = ON; PRAGMA synchronous = ${synced ? 'FULL' : 'NORMAL'};`,
    );
    migrate(this.db);
  }

  /** Opens (creating if needed) the store in `dataDir` and applies migrations. */
  static open(dataDir = 'data'): Gt7Store {
    migratePreviousDataDir(dataDir);
    return new Gt7Store(dataDir);
  }

  get schemaVersion(): number {
    return getSchemaVersion(this.db);
  }

  /** Re-runs migrations (idempotent). Returns how many were applied. */
  migrate(): number {
    return migrate(this.db);
  }

  /** Waits for queued trace writes. */
  async flush(): Promise<void> {
    while (this.#writes.size) await Promise.all([...this.#writes]);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    await this.flush();
    this.#closed = true;
    this.db.close();
  }

  // ---------------------------------------------------------------------------------------------
  // Tracks
  // ---------------------------------------------------------------------------------------------

  #track(r: Row): Track {
    return {
      id: String(r.id),
      name: String(r.name),
      layout: strOrNull(r.layout),
      fingerprint: json(r.fingerprint, {} as Track['fingerprint']),
      lengthM: num(r.length_m),
      centerline: json(r.centerline, null),
      sectorGates: json<SectorGate[]>(r.sector_gates, []),
      corners: json<Corner[]>(r.corners, []),
      source: String(r.source) as Track['source'],
      createdAt: num(r.created_at),
      updatedAt: num(r.updated_at),
    };
  }

  listTracks(): Track[] {
    return (this.db.prepare('SELECT * FROM tracks ORDER BY created_at').all() as Row[]).map((r) =>
      this.#track(r),
    );
  }

  getTrack(id: Id): Track | null {
    const r = this.db.prepare('SELECT * FROM tracks WHERE id = ?').get(id) as Row | undefined;
    return r ? this.#track(r) : null;
  }

  insertTrack(t: Track): void {
    this.db
      .prepare(
        `INSERT INTO tracks (id, name, layout, fingerprint, length_m, centerline, sector_gates, corners,
          source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.id,
        t.name,
        t.layout ?? null,
        JSON.stringify(t.fingerprint),
        t.lengthM,
        t.centerline ? JSON.stringify(t.centerline) : null,
        JSON.stringify(t.sectorGates),
        JSON.stringify(t.corners),
        t.source,
        t.createdAt,
        t.updatedAt,
      );
  }

  /** Updates editable fields of a track. Returns the updated track (null if missing). */
  updateTrack(
    id: Id,
    patch: Partial<
      Pick<
        Track,
        | 'name'
        | 'layout'
        | 'sectorGates'
        | 'corners'
        | 'source'
        | 'lengthM'
        | 'centerline'
        | 'fingerprint'
      >
    >,
  ): Track | null {
    const cur = this.getTrack(id);
    if (!cur) return null;
    const t: Track = { ...cur, ...patch, updatedAt: Date.now() };
    this.db
      .prepare(
        `UPDATE tracks SET name = ?, layout = ?, fingerprint = ?, length_m = ?, centerline = ?,
          sector_gates = ?, corners = ?, source = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        t.name,
        t.layout ?? null,
        JSON.stringify(t.fingerprint),
        t.lengthM,
        t.centerline ? JSON.stringify(t.centerline) : null,
        JSON.stringify(t.sectorGates),
        JSON.stringify(t.corners),
        t.source,
        t.updatedAt,
        id,
      );
    return t;
  }

  renameTrack(id: Id, name: string): Track | null {
    return this.updateTrack(id, { name, source: 'user' });
  }

  /** Renames one corner (null clears the name). */
  renameCorner(trackId: Id, cornerId: string, name: string | null): Track | null {
    const t = this.getTrack(trackId);
    if (!t) return null;
    if (!t.corners.some((c) => c.id === cornerId)) return null;
    return this.updateTrack(trackId, {
      corners: t.corners.map((c) => (c.id === cornerId ? { ...c, name } : c)),
    });
  }

  setTrackCorners(trackId: Id, corners: Corner[]): Track | null {
    return this.updateTrack(trackId, { corners: [...corners].sort((a, b) => a.entryM - b.entryM) });
  }

  setSectorGates(trackId: Id, gates: SectorGate[]): Track | null {
    return this.updateTrack(trackId, {
      sectorGates: [...gates].sort((a, b) => a.distanceM - b.distanceM),
    });
  }

  /** Deletes a track (keeps its sessions/laps, which lose the track link). */
  deleteTrack(id: Id): boolean {
    this.db.prepare('UPDATE laps SET track_id = NULL WHERE track_id = ?').run(id);
    this.db.prepare('UPDATE sessions SET track_id = NULL WHERE track_id = ?').run(id);
    this.db.prepare('DELETE FROM goals WHERE track_id = ?').run(id);
    this.db.prepare('DELETE FROM corner_drills WHERE track_id = ?').run(id);
    return Number(this.db.prepare('DELETE FROM tracks WHERE id = ?').run(id).changes) > 0;
  }

  saveCenterline(c: TrackCenterline): void {
    const n = c.x.length;
    const pts = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      pts[i * 3] = c.x[i]!;
      pts[i * 3 + 1] = c.y[i] ?? 0;
      pts[i * 3 + 2] = c.z[i]!;
    }
    this.db
      .prepare(
        `INSERT INTO track_centerlines (track_id, source_lap_id, step_m, length_m, points)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(track_id) DO UPDATE SET source_lap_id = excluded.source_lap_id,
          step_m = excluded.step_m, length_m = excluded.length_m, points = excluded.points`,
      )
      .run(c.trackId, c.sourceLapId, c.stepM, c.lengthM, new Uint8Array(pts.buffer));
  }

  getCenterline(trackId: Id): TrackCenterline | null {
    const r = this.db.prepare('SELECT * FROM track_centerlines WHERE track_id = ?').get(trackId) as
      | Row
      | undefined;
    if (!r) return null;
    const blob = r.points as Uint8Array;
    const copy = new Uint8Array(blob.byteLength);
    copy.set(blob);
    const pts = new Float64Array(copy.buffer);
    const n = Math.floor(pts.length / 3);
    const x: number[] = [];
    const y: number[] = [];
    const z: number[] = [];
    for (let i = 0; i < n; i++) {
      x.push(pts[i * 3]!);
      y.push(pts[i * 3 + 1]!);
      z.push(pts[i * 3 + 2]!);
    }
    return {
      trackId,
      sourceLapId: strOrNull(r.source_lap_id),
      stepM: num(r.step_m),
      lengthM: num(r.length_m),
      x,
      y,
      z,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------------------------

  static readonly #SESSION_SELECT = `SELECT s.*,
      (SELECT COUNT(*) FROM laps l WHERE l.session_id = s.id) AS lap_count,
      (SELECT MIN(l.time_ms) FROM laps l WHERE l.session_id = s.id AND l.valid = 1
        AND l.is_reference = 0 AND l.flags NOT LIKE '%"replay"%') AS best_lap_ms
    FROM sessions s`;

  #session(r: Row): Session {
    return {
      id: String(r.id),
      trackId: strOrNull(r.track_id),
      carCode: num(r.car_code),
      startedAt: num(r.started_at),
      endedAt: numOrNull(r.ended_at),
      format: String(r.format) as Session['format'],
      mode: String(r.mode) as Session['mode'],
      lapCount: num(r.lap_count ?? 0),
      bestLapMs: numOrNull(r.best_lap_ms),
      recordingFile: strOrNull(r.recording_file),
      notes: strOrNull(r.notes),
      trackTimeMs: numOrNull(r.track_time_ms),
    };
  }

  /** Inserts or updates a session (lapCount/bestLapMs are derived from the laps table). */
  saveSession(s: Session): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, track_id, car_code, started_at, ended_at, format, mode, recording_file, notes,
          track_time_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET track_id = excluded.track_id, car_code = excluded.car_code,
          started_at = excluded.started_at, ended_at = excluded.ended_at, format = excluded.format,
          mode = excluded.mode, recording_file = excluded.recording_file, notes = excluded.notes,
          track_time_ms = excluded.track_time_ms`,
      )
      .run(
        s.id,
        s.trackId,
        s.carCode,
        s.startedAt,
        s.endedAt,
        s.format,
        s.mode,
        s.recordingFile,
        s.notes ?? null,
        s.trackTimeMs ?? null,
      );
  }

  getSession(id: Id): Session | null {
    const r = this.db.prepare(`${Gt7Store.#SESSION_SELECT} WHERE s.id = ?`).get(id) as
      | Row
      | undefined;
    return r ? this.#session(r) : null;
  }

  /** Sessions, most recent first. */
  listSessions(opts: ListSessionsOptions = {}): Session[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.trackId) {
      where.push('s.track_id = ?');
      params.push(opts.trackId);
    }
    if (opts.carCode !== undefined) {
      where.push('s.car_code = ?');
      params.push(opts.carCode);
    }
    if (opts.mode) {
      where.push('s.mode = ?');
      params.push(opts.mode);
    }
    const sql = `${Gt7Store.#SESSION_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.started_at DESC LIMIT ? OFFSET ?`;
    params.push(opts.limit ?? 1000, opts.offset ?? 0);
    return (this.db.prepare(sql).all(...params) as Row[]).map((r) => this.#session(r));
  }

  /**
   * Moves a session and its own laps (references stay where they are) to another track in ONE
   * transaction. Idempotent: running it again changes nothing. Returns how many laps changed.
   * No schema change: only the existing `track_id` columns are updated.
   */
  reassignSessionTrack(sessionId: Id, trackId: Id): number {
    const db = this.db;
    const own = !(db as unknown as { isTransaction?: boolean }).isTransaction;
    if (own) db.exec('BEGIN IMMEDIATE');
    try {
      const moved = Number(
        db
          .prepare(
            'UPDATE laps SET track_id = ? WHERE session_id = ? AND is_reference = 0 AND (track_id IS NULL OR track_id <> ?)',
          )
          .run(trackId, sessionId, trackId).changes,
      );
      db.prepare('UPDATE sessions SET track_id = ? WHERE id = ?').run(trackId, sessionId);
      if (own) db.exec('COMMIT');
      return moved;
    } catch (e) {
      if (own) db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Deletes a session, its laps, trace files and recording. */
  async deleteSession(id: Id): Promise<boolean> {
    const s = this.getSession(id);
    if (!s) return false;
    for (const lap of this.listLaps(id)) await this.deleteLap(lap.id);
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    if (s.recordingFile) await rm(join(this.dataDir, s.recordingFile), { force: true });
    return true;
  }

  /**
   * Closes sessions a previous process left open (crash, power loss, killed app): a session that
   * has laps is closed at the end of its last lap; one with no lap at all is deleted (with its
   * recording). `exceptId` is a session being written right now. Returns what was done.
   */
  async recoverOpenSessions(exceptId?: Id): Promise<{ closed: Id[]; removed: Id[] }> {
    const rows = this.db.prepare('SELECT id FROM sessions WHERE ended_at IS NULL').all() as Row[];
    const out = { closed: [] as Id[], removed: [] as Id[] };
    for (const r of rows) {
      const id = String(r.id);
      if (id === exceptId) continue;
      const s = this.getSession(id);
      if (!s) continue;
      const laps = this.listLaps(id);
      if (laps.length === 0) {
        await this.deleteSession(id);
        out.removed.push(id);
        continue;
      }
      const last = laps.reduce((m, l) => Math.max(m, l.startedAt + l.timeMs), s.startedAt);
      this.saveSession({ ...s, endedAt: last });
      out.closed.push(id);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Laps
  // ---------------------------------------------------------------------------------------------

  static readonly #LAP_SELECT =
    `SELECT l.*, m.driver_name, m.source AS ref_source, m.ranking_time_ms,
      m.car_name, m.notes AS ref_notes, m.captured_at, m.time_source, m.measured_time_ms
    FROM laps l LEFT JOIN reference_meta m ON m.lap_id = l.id`;

  #lap(r: Row): Lap {
    const meta: ReferenceMeta | null =
      r.driver_name !== null && r.driver_name !== undefined
        ? {
            driverName: String(r.driver_name),
            source: String(r.ref_source) as ReferenceMeta['source'],
            rankingTimeMs: numOrNull(r.ranking_time_ms),
            carName: strOrNull(r.car_name),
            notes: strOrNull(r.ref_notes),
            capturedAt: num(r.captured_at),
            ...(r.time_source === 'ranking' || r.time_source === 'packets'
              ? { timeSource: r.time_source as 'ranking' | 'packets' }
              : {}),
            ...(r.measured_time_ms !== null && r.measured_time_ms !== undefined
              ? { measuredTimeMs: num(r.measured_time_ms) }
              : {}),
          }
        : null;
    return {
      id: String(r.id),
      sessionId: String(r.session_id),
      number: num(r.number),
      timeMs: num(r.time_ms),
      sectorTimesMs: json<(number | null)[]>(r.sector_times, []),
      valid: num(r.valid) === 1,
      flags: json<LapFlag[]>(r.flags, []),
      isReference: num(r.is_reference) === 1,
      referenceMeta: meta,
      startedAt: num(r.started_at),
      carCode: num(r.car_code),
      trackId: strOrNull(r.track_id),
      fuelUsedL: numOrNull(r.fuel_used_l),
      sampleCount: num(r.sample_count),
      lostPackets: num(r.lost_packets),
      traceFile: strOrNull(r.trace_file),
    };
  }

  /** Relative path of a lap trace file. */
  traceFileFor(lapId: Id): string {
    return `${TRACES_DIR}/${lapId}${TRACE_EXTENSION}`;
  }

  /**
   * Inserts or replaces a lap. With a trace, the trace file write is queued (the trace stays
   * readable from memory until written) and `traceFile` is set.
   */
  saveLap(lap: Lap, trace?: LapTrace): Lap {
    const row: Lap = trace
      ? { ...lap, traceFile: this.traceFileFor(lap.id), sampleCount: trace.length }
      : lap;
    this.db
      .prepare(
        `INSERT INTO laps (id, session_id, number, time_ms, sector_times, valid, flags, is_reference,
          started_at, car_code, track_id, fuel_used_l, sample_count, lost_packets, trace_file)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, number = excluded.number,
          time_ms = excluded.time_ms, sector_times = excluded.sector_times, valid = excluded.valid,
          flags = excluded.flags, is_reference = excluded.is_reference, started_at = excluded.started_at,
          car_code = excluded.car_code, track_id = excluded.track_id, fuel_used_l = excluded.fuel_used_l,
          sample_count = excluded.sample_count, lost_packets = excluded.lost_packets,
          trace_file = excluded.trace_file`,
      )
      .run(
        row.id,
        row.sessionId,
        row.number,
        Math.round(row.timeMs),
        JSON.stringify(row.sectorTimesMs),
        row.valid ? 1 : 0,
        JSON.stringify(row.flags),
        row.isReference ? 1 : 0,
        row.startedAt,
        row.carCode,
        row.trackId,
        row.fuelUsedL,
        row.sampleCount,
        row.lostPackets,
        row.traceFile,
      );
    if (row.isReference && row.referenceMeta) this.#saveMeta(row.id, row.referenceMeta);
    if (trace) this.#queueTrace(row.id, trace);
    return row;
  }

  getLap(id: Id): Lap | null {
    const r = this.db.prepare(`${Gt7Store.#LAP_SELECT} WHERE l.id = ?`).get(id) as Row | undefined;
    return r ? this.#lap(r) : null;
  }

  saveEngineerRadioLog(lapId: Id, log: EngineerRadioLog): void {
    this.db
      .prepare(`INSERT INTO engineer_radio_logs (lap_id, device_id, reference_lap_id, calls_json)
      VALUES (?, ?, ?, ?) ON CONFLICT (lap_id, device_id, reference_lap_id)
      DO UPDATE SET calls_json = excluded.calls_json`)
      .run(lapId, log.deviceId, log.referenceLapId, JSON.stringify(log.calls));
  }

  getEngineerRadioLogs(lapId: Id): EngineerRadioLog[] {
    const rows = this.db
      .prepare(`SELECT device_id, reference_lap_id, calls_json FROM engineer_radio_logs
      WHERE lap_id = ? ORDER BY device_id, reference_lap_id`)
      .all(lapId) as {
      device_id: string;
      reference_lap_id: string;
      calls_json: string;
    }[];
    return rows.map((row) => ({
      deviceId: row.device_id,
      referenceLapId: row.reference_lap_id,
      calls: JSON.parse(row.calls_json) as EngineerRadioCall[],
    }));
  }

  // ---------------------------------------------------------------------------------------------
  // Corner drills (spec 18)
  // ---------------------------------------------------------------------------------------------

  #drill(r: Row): CornerDrill {
    return {
      id: String(r.id),
      sessionId: strOrNull(r.session_id),
      trackId: String(r.track_id),
      cornerId: String(r.corner_id),
      passes: json<LiveDrillPass[]>(r.passes_json, []),
      startedAt: num(r.started_at),
      endedAt: num(r.ended_at),
      targetMs: numOrNull(r.target_ms),
    };
  }

  saveDrill(d: CornerDrill): void {
    this.db
      .prepare(
        `INSERT INTO corner_drills (id, session_id, track_id, corner_id, passes_json, target_ms, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET passes_json = excluded.passes_json,
           target_ms = excluded.target_ms, ended_at = excluded.ended_at`,
      )
      .run(
        d.id,
        d.sessionId,
        d.trackId,
        d.cornerId,
        JSON.stringify(d.passes),
        d.targetMs,
        d.startedAt,
        d.endedAt,
      );
  }

  /** Drills of a session, oldest first. */
  listDrills(sessionId: Id): CornerDrill[] {
    return (
      this.db
        .prepare('SELECT * FROM corner_drills WHERE session_id = ? ORDER BY started_at')
        .all(sessionId) as Row[]
    ).map((r) => this.#drill(r));
  }

  /** Drills of a corner across sessions, newest first. */
  listDrillsForCorner(trackId: Id, cornerId: string, limit = 20): CornerDrill[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM corner_drills WHERE track_id = ? AND corner_id = ? ORDER BY started_at DESC LIMIT ?',
        )
        .all(trackId, cornerId, limit) as Row[]
    ).map((r) => this.#drill(r));
  }

  // ---------------------------------------------------------------------------------------------
  // Goals (spec 13)
  // ---------------------------------------------------------------------------------------------

  #goal(r: Row): Goal {
    return {
      id: String(r.id),
      trackId: String(r.track_id),
      carCode: numOrNull(r.car_code),
      targetMs: num(r.target_ms),
      createdAt: num(r.created_at),
      achievedAt: numOrNull(r.achieved_at),
      achievedLapId: strOrNull(r.achieved_lap_id),
    };
  }

  /**
   * The goal being chased on a track: the one for this car when there is one, else the one for any
   * car. Reached goals are history, not active.
   */
  getActiveGoal(trackId: Id, carCode: number | null): Goal | null {
    const rows = (
      this.db
        .prepare(
          `SELECT * FROM goals WHERE track_id = ? AND achieved_at IS NULL
           ORDER BY created_at DESC`,
        )
        .all(trackId) as Row[]
    ).map((r) => this.#goal(r));
    return (
      (carCode !== null ? rows.find((g) => g.carCode === carCode) : undefined) ??
      rows.find((g) => g.carCode === null) ??
      null
    );
  }

  /** Reached goals of a track, newest first. */
  listGoalHistory(trackId: Id): Goal[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM goals WHERE track_id = ? AND achieved_at IS NOT NULL
           ORDER BY achieved_at DESC`,
        )
        .all(trackId) as Row[]
    ).map((r) => this.#goal(r));
  }

  /**
   * Sets the goal of a track and car (`carCode` null = any car), replacing the active one of the
   * same scope. Returns the stored goal.
   */
  setGoal(trackId: Id, carCode: number | null, targetMs: number, now = Date.now()): Goal {
    const goal: Goal = {
      id: newId(),
      trackId,
      carCode,
      targetMs: Math.round(targetMs),
      createdAt: now,
      achievedAt: null,
      achievedLapId: null,
    };
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `DELETE FROM goals WHERE track_id = ? AND achieved_at IS NULL
           AND ((? IS NULL AND car_code IS NULL) OR car_code = ?)`,
        )
        .run(trackId, carCode, carCode);
      this.db
        .prepare(
          `INSERT INTO goals (id, track_id, car_code, target_ms, created_at, achieved_at, achieved_lap_id)
           VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
        )
        .run(goal.id, goal.trackId, goal.carCode, goal.targetMs, goal.createdAt);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return goal;
  }

  /** Removes the active goal of the scope. Returns whether there was one. */
  clearGoal(trackId: Id, carCode: number | null): boolean {
    return (
      Number(
        this.db
          .prepare(
            `DELETE FROM goals WHERE track_id = ? AND achieved_at IS NULL
             AND ((? IS NULL AND car_code IS NULL) OR car_code = ?)`,
          )
          .run(trackId, carCode, carCode).changes,
      ) > 0
    );
  }

  /** Marks a goal as reached, once: a goal that was already reached stays as it was. */
  markGoalAchieved(goalId: Id, lapId: Id, at: number): boolean {
    return (
      Number(
        this.db
          .prepare(
            `UPDATE goals SET achieved_at = ?, achieved_lap_id = ?
             WHERE id = ? AND achieved_at IS NULL`,
          )
          .run(at, lapId, goalId).changes,
      ) > 0
    );
  }

  /** Laps of a session in lap order. */
  listLaps(sessionId: Id): Lap[] {
    return (
      this.db
        .prepare(`${Gt7Store.#LAP_SELECT} WHERE l.session_id = ? ORDER BY l.started_at, l.number`)
        .all(sessionId) as Row[]
    ).map((r) => this.#lap(r));
  }

  /** Laps on a track (fastest first by default). */
  listLapsForTrack(trackId: Id, opts: ListLapsOptions = {}): Lap[] {
    const where = ['l.track_id = ?'];
    const params: (string | number)[] = [trackId];
    if (opts.carCode !== undefined) {
      where.push('l.car_code = ?');
      params.push(opts.carCode);
    }
    if (opts.validOnly) where.push('l.valid = 1');
    if (opts.referencesOnly) where.push('l.is_reference = 1');
    else if (opts.includeReferences === false) where.push('l.is_reference = 0');
    const order = opts.orderBy === 'startedAt' ? 'l.started_at' : 'l.time_ms';
    params.push(opts.limit ?? 100000);
    return (
      this.db
        .prepare(`${Gt7Store.#LAP_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
        .all(...params) as Row[]
    ).map((r) => this.#lap(r));
  }

  /** Fastest valid laps on a track (+car), references included unless disabled. */
  getBestLaps(
    trackId: Id,
    opts: { carCode?: number; includeReferences?: boolean; limit?: number } = {},
  ): Lap[] {
    return this.listLapsForTrack(trackId, { ...opts, validOnly: true, limit: opts.limit ?? 10 });
  }

  /** Best own lap (valid, not reference, not replay) on track+car. */
  getPersonalBestLap(trackId: Id, carCode: number): Lap | null {
    return (
      this.listLapsForTrack(trackId, { carCode, validOnly: true, includeReferences: false }).find(
        isPersonalLap,
      ) ?? null
    );
  }

  /** Best lap / sector times on track+car (overall incl. references, and personal). */
  getTrackRecords(trackId: Id, carCode: number, sectorCount: number): TrackRecords {
    return computeRecords(
      this.listLapsForTrack(trackId, { carCode, validOnly: true }),
      sectorCount,
    );
  }

  /** Reference laps, optionally for one track, fastest first. */
  listReferenceLaps(trackId?: Id): Lap[] {
    if (trackId) return this.listLapsForTrack(trackId, { referencesOnly: true });
    return (
      this.db
        .prepare(`${Gt7Store.#LAP_SELECT} WHERE l.is_reference = 1 ORDER BY l.track_id, l.time_ms`)
        .all() as Row[]
    ).map((r) => this.#lap(r));
  }

  #saveMeta(lapId: Id, m: ReferenceMeta): void {
    this.db
      .prepare(
        `INSERT INTO reference_meta (lap_id, driver_name, source, ranking_time_ms, car_name, notes, captured_at,
          time_source, measured_time_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(lap_id) DO UPDATE SET driver_name = excluded.driver_name, source = excluded.source,
          ranking_time_ms = excluded.ranking_time_ms, car_name = excluded.car_name,
          notes = excluded.notes, captured_at = excluded.captured_at,
          time_source = excluded.time_source, measured_time_ms = excluded.measured_time_ms`,
      )
      .run(
        lapId,
        m.driverName,
        m.source,
        m.rankingTimeMs,
        m.carName ?? null,
        m.notes ?? null,
        m.capturedAt,
        m.timeSource ?? null,
        m.measuredTimeMs ?? null,
      );
  }

  /** Marks a lap as reference with metadata, or unmarks it (meta = null). */
  setReference(lapId: Id, meta: ReferenceMeta | null): Lap | null {
    if (!this.getLap(lapId)) return null;
    if (meta) {
      this.db.prepare('UPDATE laps SET is_reference = 1 WHERE id = ?').run(lapId);
      this.#saveMeta(lapId, meta);
    } else {
      this.db.prepare('UPDATE laps SET is_reference = 0 WHERE id = ?').run(lapId);
      this.db.prepare('DELETE FROM reference_meta WHERE lap_id = ?').run(lapId);
    }
    return this.getLap(lapId);
  }

  /** Deletes a lap row, its reference meta and trace file. */
  async deleteLap(id: Id): Promise<boolean> {
    const lap = this.getLap(id);
    if (!lap) return false;
    this.db.prepare('DELETE FROM reference_meta WHERE lap_id = ?').run(id);
    this.db.prepare('DELETE FROM laps WHERE id = ?').run(id);
    this.#pending.delete(id);
    await this.flush();
    if (lap.traceFile) await rm(join(this.dataDir, lap.traceFile), { force: true });
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // Traces
  // ---------------------------------------------------------------------------------------------

  #queueTrace(lapId: Id, trace: LapTrace): void {
    this.#pending.set(lapId, trace);
    const abs = join(this.dataDir, this.traceFileFor(lapId));
    const p = (async () => {
      const gz = await gzipAsync(encodeTraceRaw(trace), { level: 6 });
      if (this.#pending.get(lapId) !== trace) return; // deleted or replaced meanwhile
      await writeFile(abs, gz);
    })()
      .catch((e) => {
        console.error(`[gt7-store] failed to write trace ${abs}: ${(e as Error).message}`);
      })
      .finally(() => {
        if (this.#pending.get(lapId) === trace) this.#pending.delete(lapId);
        this.#writes.delete(p);
      });
    this.#writes.add(p);
  }

  /** Saves a trace file now (awaits the write). */
  async saveTrace(trace: LapTrace): Promise<string> {
    this.#queueTrace(trace.lapId, trace);
    await this.flush();
    return this.traceFileFor(trace.lapId);
  }

  async loadTrace(lapId: Id): Promise<LapTrace | null> {
    const mem = this.#pending.get(lapId);
    if (mem) return mem;
    const abs = join(this.dataDir, this.traceFileFor(lapId));
    if (!existsSync(abs)) return null;
    return readTraceFile(abs);
  }

  loadTraceSync(lapId: Id): LapTrace | null {
    const mem = this.#pending.get(lapId);
    if (mem) return mem;
    const abs = join(this.dataDir, this.traceFileFor(lapId));
    if (!existsSync(abs)) return null;
    try {
      return readTraceFileSync(abs);
    } catch {
      return null;
    }
  }

  /** Lap row + trace (null if either is missing). */
  async getLapWithTrace(lapId: Id): Promise<{ lap: Lap; trace: LapTrace } | null> {
    const lap = this.getLap(lapId);
    if (!lap) return null;
    const trace = await this.loadTrace(lapId);
    return trace ? { lap, trace } : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Device profiles
  // ---------------------------------------------------------------------------------------------

  getDeviceProfile(deviceId: string): DeviceProfile | null {
    const r = this.db
      .prepare('SELECT profile FROM device_profiles WHERE device_id = ?')
      .get(deviceId) as Row | undefined;
    return r ? json<DeviceProfile | null>(r.profile, null) : null;
  }

  saveDeviceProfile(p: DeviceProfile): DeviceProfile {
    const saved = { ...p, updatedAt: p.updatedAt || Date.now() };
    this.db
      .prepare(
        `INSERT INTO device_profiles (device_id, profile, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET profile = excluded.profile, updated_at = excluded.updated_at`,
      )
      .run(saved.deviceId, JSON.stringify(saved), saved.updatedAt);
    return saved;
  }

  listDeviceProfiles(): DeviceProfile[] {
    return (
      this.db.prepare('SELECT profile FROM device_profiles ORDER BY updated_at DESC').all() as Row[]
    )
      .map((r) => json<DeviceProfile | null>(r.profile, null))
      .filter((p): p is DeviceProfile => p !== null);
  }

  deleteDeviceProfile(deviceId: string): boolean {
    return (
      Number(
        this.db.prepare('DELETE FROM device_profiles WHERE device_id = ?').run(deviceId).changes,
      ) > 0
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Settings (key → JSON value)
  // ---------------------------------------------------------------------------------------------

  getSetting<T>(key: string): T | undefined;
  getSetting<T>(key: string, def: T): T;
  getSetting<T>(key: string, def?: T): T | undefined {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | Row
      | undefined;
    return r ? json<T | undefined>(r.value, def) : def;
  }

  setSetting(key: string, value: unknown): void {
    if (value === undefined) {
      this.deleteSetting(key);
      return;
    }
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, JSON.stringify(value));
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  getSettings(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of this.db.prepare('SELECT key, value FROM settings').all() as Row[]) {
      out[String(r.key)] = json<unknown>(r.value, null);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Coach reports (in-app AI debrief)
  // ---------------------------------------------------------------------------------------------

  #coachReport(r: Row): CoachReport {
    const markdown = String(r.markdown ?? '');
    return {
      id: String(r.id),
      createdAt: num(r.created_at),
      updatedAt: num(r.updated_at),
      kind: r.kind === 'corner' || r.kind === 'chat' ? r.kind : 'debrief',
      title: String(r.title),
      trackId: strOrNull(r.track_id),
      sessionId: strOrNull(r.session_id),
      lapId: strOrNull(r.lap_id),
      reference: strOrNull(r.reference),
      focusCorner: strOrNull(r.focus_corner),
      model: String(r.model),
      status: (['running', 'done', 'error'] as const).includes(r.status as CoachReportStatus)
        ? (r.status as CoachReportStatus)
        : 'error',
      preview: coachPreview(markdown),
      usage: { ...EMPTY_COACH_USAGE, ...json<Partial<CoachUsage>>(r.usage, {}) },
      markdown,
      transcript: json<CoachTranscriptEntry[]>(r.transcript, []),
      error: strOrNull(r.error),
    };
  }

  /** Inserts or replaces a coach report (with its raw model conversation). */
  saveCoachReport(report: StoredCoachReport): void {
    this.db
      .prepare(
        `INSERT INTO coach_reports (id, created_at, updated_at, kind, title, track_id, session_id,
          lap_id, reference, focus_corner, model, status, markdown, transcript, messages, usage, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, kind = excluded.kind,
          title = excluded.title, track_id = excluded.track_id, session_id = excluded.session_id,
          lap_id = excluded.lap_id, reference = excluded.reference,
          focus_corner = excluded.focus_corner, model = excluded.model, status = excluded.status,
          markdown = excluded.markdown, transcript = excluded.transcript,
          messages = excluded.messages, usage = excluded.usage, error = excluded.error`,
      )
      .run(
        report.id,
        report.createdAt,
        report.updatedAt,
        report.kind,
        report.title,
        report.trackId,
        report.sessionId,
        report.lapId,
        report.reference,
        report.focusCorner,
        report.model,
        report.status,
        report.markdown,
        JSON.stringify(report.transcript),
        JSON.stringify(report.messages),
        JSON.stringify(report.usage),
        report.error,
      );
  }

  /** A coach report with its raw conversation, or null. */
  getCoachReport(id: Id): StoredCoachReport | null {
    const r = this.db.prepare('SELECT * FROM coach_reports WHERE id = ?').get(id) as
      | Row
      | undefined;
    return r ? { ...this.#coachReport(r), messages: json<unknown[]>(r.messages, []) } : null;
  }

  /** Reports, newest first (no conversation). */
  listCoachReports(opts: { trackId?: Id; limit?: number } = {}): CoachReportSummary[] {
    const cols =
      'id, created_at, updated_at, kind, title, track_id, session_id, lap_id, reference, ' +
      'focus_corner, model, status, substr(markdown, 1, 400) AS markdown, usage';
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
    const rows = (
      opts.trackId
        ? this.db
            .prepare(
              `SELECT ${cols} FROM coach_reports WHERE track_id = ? ORDER BY created_at DESC LIMIT ?`,
            )
            .all(opts.trackId, limit)
        : this.db
            .prepare(`SELECT ${cols} FROM coach_reports ORDER BY created_at DESC LIMIT ?`)
            .all(limit)
    ) as Row[];
    return rows.map((r) => {
      const { markdown: _m, transcript: _t, error: _e, ...summary } = this.#coachReport(r);
      return summary;
    });
  }

  deleteCoachReport(id: Id): boolean {
    return Number(this.db.prepare('DELETE FROM coach_reports WHERE id = ?').run(id).changes) > 0;
  }

  /** Keeps the newest `keep` finished reports (running ones are never pruned); returns removed. */
  pruneCoachReports(keep: number): number {
    const n = Math.max(0, Math.floor(keep));
    return Number(
      this.db
        .prepare(
          `DELETE FROM coach_reports WHERE status <> 'running' AND id NOT IN (
             SELECT id FROM coach_reports WHERE status <> 'running'
             ORDER BY created_at DESC, id DESC LIMIT ?)`,
        )
        .run(n).changes,
    );
  }

  /** Marks reports left 'running' by a previous process as failed (they can never finish). */
  failStaleCoachReports(message: string): number {
    return Number(
      this.db
        .prepare(
          `UPDATE coach_reports SET status = 'error', error = ?, updated_at = ? WHERE status = 'running'`,
        )
        .run(message, Date.now()).changes,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Recordings
  // ---------------------------------------------------------------------------------------------

  /** Paths for a session recording: absolute and relative to the data dir. */
  recordingPath(sessionId: Id): { abs: string; rel: string } {
    const rel = `${RECORDINGS_DIR}/${sessionId}${RECORDING_EXTENSION}`;
    return { abs: join(this.dataDir, rel), rel };
  }

  /** Deletes everything in the data dir (tests/tools only). */
  static destroy(dataDir: string): void {
    rmSync(resolve(dataDir), { recursive: true, force: true });
  }
}
