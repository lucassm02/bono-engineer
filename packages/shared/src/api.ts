/**
 * REST payloads of the analysis endpoints (`/api/analysis/*`, lap trace/CSV export, corner
 * re-detection) — owned by @gt7/server (additive). Most bodies reuse the Wave 3 result types of
 * `analysis.ts` (AnalysisService output) as-is.
 */

import type {
  ComparisonReferenceKind,
  ConsistencyReport,
  Corner,
  DistanceDelta,
  EvolutionReport,
  LapAnalysis,
  LapComparisonResult,
  LapDrivingEvents,
  MapCorner,
  MicrosectorAnalysis,
  SectorTable,
  TraceChannel,
  TrackAnalysis,
  TrackSectorRange,
} from './analysis.ts';
import type { Goal, Id, LapSampleChannel, Track } from './domain.ts';
import type { DrillSummary } from './drill.ts';
import type { CornerDrill, LiveDrill } from './live.ts';

/** Prefix of the analysis REST endpoints. */
export const API_ANALYSIS_PREFIX = '/api/analysis';

/**
 * `ref` query value of compare/delta/microsectors/chart: a lap id or a symbolic reference
 * (`personalBest | sessionBest | bestReference | auto`; default `auto`).
 */
export type ApiReference = Id | ComparisonReferenceKind;

/** GET /api/analysis/tracks/:trackId (404 `noCenterline` while the track has no line yet). */
export interface ApiTrackAnalysis {
  track: Track;
  /** Reference line downsampled for maps (world X/Z), point i at distance i * stepM, closed. */
  polyline: { x: number[]; z: number[]; stepM: number; lengthM: number };
  /** Corners with the apex position on the map. */
  corners: MapCorner[];
  /** Sector start distances (first = 0). */
  sectorStartsM: number[];
  sectors: TrackSectorRange[];
  records: TrackAnalysis['records'];
  /** Same as `records.references` (captured top laps of the track). */
  references: TrackAnalysis['records']['references'];
  sessionCount: number;
  lapCount: number;
}

/** GET /api/analysis/laps/:lapId: per-corner metrics, validity report and AI summary. */
export type ApiLapAnalysis = LapAnalysis;

/**
 * GET /api/analysis/laps/:lapId/events: driving events of the lap (understeer, oversteer, front
 * lock, exit traction loss) with corner, distance range, evidence, confidence and pt-BR action.
 */
export type ApiLapDrivingEvents = LapDrivingEvents;

/**
 * GET /api/analysis/compare?lap=&ref=: corner-by-corner table (`comparison.rows`), findings,
 * `comparison.keyFindings`, `comparison.sectorDeltasMs`, pt-BR `markdown`, `comparison.warnings`.
 */
export type ApiComparison = LapComparisonResult;

/** GET /api/analysis/delta?lap=&ref=&stepM=: cumulative delta by distance. */
export type ApiDistanceDelta = DistanceDelta;

/** Short channel names accepted by /api/analysis/traces (mapped to {@link TraceChannel}). */
export const API_TRACE_CHANNEL_ALIASES = {
  speed: 'speedKmh',
  throttle: 'throttle',
  brake: 'brake',
  gear: 'gear',
  steering: 'steering',
  rpm: 'rpm',
  clutch: 'clutch',
  time: 'timeS',
  delta: 'deltaS',
  latG: 'latG',
  lonG: 'lonG',
  yawRate: 'yawRate',
  offset: 'lateralOffsetM',
  x: 'x',
  z: 'z',
} as const satisfies Record<string, TraceChannel>;

export type ApiTraceChannelAlias = keyof typeof API_TRACE_CHANNEL_ALIASES;

/**
 * GET /api/analysis/traces?laps=a,b&channels=speed,throttle,brake,gear,steering&stepM=2&from=&to=
 * &maxPoints=&ref=: every lap resampled on the SAME distance grid (overlays). Channel keys are the
 * names requested (aliases or TraceChannel names); unavailable values are null.
 */
export interface ApiTraces {
  fromM: number;
  toM: number;
  stepM: number;
  distanceM: number[];
  /** Requested channel keys, in order. */
  channels: string[];
  laps: { lapId: Id; channels: Record<string, (number | null)[]> }[];
}

/**
 * GET /api/analysis/tracks/:trackId/sectors?carCode=: best time per sector, the lap that made it
 * and the ideal lap, over the fastest valid own laps of the track (400 `invalidArgument` while
 * there is none).
 */
export interface ApiTrackSectors {
  trackId: Id;
  carCode: number | null;
  table: SectorTable;
  /** The laps behind the table, to name the lap of each best sector. */
  laps: { lapId: Id; number: number; startedAt: number; timeMs: number }[];
}

/** GET /api/analysis/microsectors?laps=a,b,c&ref=: microsectors, colors, theoretical best. */
export type ApiMicrosectors = MicrosectorAnalysis;

/** GET /api/analysis/consistency?sessionId= | ?laps=a,b. */
export type ApiConsistency = ConsistencyReport;

/** GET /api/analysis/evolution?trackId=&carCode=. */
export type ApiEvolution = EvolutionReport;

/**
 * GET /api/laps/:id/trace: the raw stored lap trace (columnar, 60 Hz, one array per channel;
 * NaN/unavailable → null). Add `?download=1` for an attachment.
 */
export interface ApiLapTrace {
  lapId: Id;
  sampleRateHz: number;
  length: number;
  channels: Partial<Record<LapSampleChannel, (number | null)[]>>;
}

/** Columns of GET /api/laps/:id/export.csv (distance-aligned, `;`-free, dot decimals). */
export const API_LAP_CSV_COLUMNS = [
  'distance_m',
  'time_s',
  'speed_kmh',
  'throttle_pct',
  'brake_pct',
  'gear',
  'rpm',
  'steering_rad',
  'lat_g',
  'lon_g',
  'x',
  'y',
  'z',
] as const;

/** GET /api/drill: the corner drill in progress (null when none). */
export interface ApiDrillState {
  drill: LiveDrill | null;
}

/** POST /api/drill. */
export interface ApiDrillStart {
  cornerId: string;
  /** Target for the stretch time (ms), optional. */
  targetMs?: number | null;
}

/** DELETE /api/drill: the drill that ended (null without passes) and its summary. */
export interface ApiDrillStop {
  drill: CornerDrill | null;
  summary: DrillSummary | null;
}

/**
 * GET /api/tracks/:id/goal?carCode=: the active goal of the track (for the car, else for any car),
 * the history of reached goals and a suggested target (null without enough laps).
 */
export interface ApiTrackGoal {
  trackId: Id;
  active: Goal | null;
  history: Goal[];
  suggestion: ApiGoalSuggestion | null;
  /** Best valid own lap on the track (and car, when given), the reference of the progress. */
  bestLapMs: number | null;
  /** Best valid own lap from before the active goal was set: where the progress starts. */
  baselineMs: number | null;
}

/** A realistic target: the ideal lap or 0.5 % under the best lap, whichever is slower (spec 13). */
export interface ApiGoalSuggestion {
  targetMs: number;
  basis: 'idealLap' | 'bestLap';
  /** Ideal lap (sum of the best sectors), when it could be computed. */
  idealLapMs: number | null;
}

/** PUT /api/tracks/:id/goal. */
export interface ApiGoalPut {
  targetMs: number;
  /** Null or absent = any car. */
  carCode?: number | null;
  /** Accept a target slower than the best lap (the server refuses it otherwise). */
  allowSlower?: boolean;
}

/** POST /api/tracks/:id/redetect-corners. */
export interface ApiRedetectCornersResult {
  track: Track;
  corners: Corner[];
  /** True when corners were detected and saved (names carried over by apex proximity). */
  detected: boolean;
}

/**
 * GET /api/mcp/info: ready-to-copy MCP connection data with the real paths of this installation
 * (so the settings page needs no placeholder).
 */
export interface ApiMcpInfo {
  /** Absolute path of the repository (where `npm run mcp` works); null in the installed app. */
  repoRoot: string | null;
  /** Absolute data directory of the running app (`sessions.db` + `traces/`). */
  dataDir: string;
  /** Absolute path of the Node executable running the server (the app's .exe when installed). */
  nodePath: string;
  stdio: {
    command: string;
    args: string[];
    /** Extra environment (ELECTRON_RUN_AS_NODE=1 makes the installed app's .exe act as Node). */
    env: Record<string, string>;
    /** `env` + `command` + `args`, quoted for the current shell (PowerShell on Windows). */
    commandLine: string;
    /** Alternative from the repo folder: `npm run -s mcp -- --data "<dir>"`; null when installed. */
    npmCommandLine: string | null;
  };
  http: {
    path: string;
    localUrl: string;
    lanUrls: string[];
    tokenRequired: boolean;
  };
  /** Content for `%APPDATA%\Claude\claude_desktop_config.json` (stdio). */
  claudeDesktopConfig: {
    mcpServers: { bono: { command: string; args: string[]; env?: Record<string, string> } };
  };
  claudeCode: { stdio: string; http: string };
}

// ---------------------------------------------------------------------------------------------
// Data: folder summary, .bono backup export and import (`/api/data/*`)
// ---------------------------------------------------------------------------------------------

export interface ApiDataSummary {
  dataDir: string;
  /** Cloud service syncing the folder (OneDrive, Dropbox...), when detected. */
  cloudProvider: string | null;
  sizes: { databaseBytes: number; tracesBytes: number; recordingsBytes: number };
  counts: { sessions: number; laps: number; tracks: number; recordings: number };
  simulator: boolean;
}

/** What is inside a `.bono` backup (its manifest). */
export interface ApiBackupManifest {
  format: 'bono-backup';
  formatVersion: number;
  createdAt: number;
  app: { name: string; version: string };
  schemaVersion: number;
  includes: { laps: boolean; settings: boolean; recordings: boolean };
  counts: {
    sessions: number;
    laps: number;
    tracks: number;
    coachReports: number;
    recordings: number;
    settings: number;
    deviceProfiles: number;
  };
}

export interface ApiBackupUpload {
  uploadId: string;
  manifest: ApiBackupManifest;
  sizeBytes: number;
}

export type ApiImportMode = 'merge' | 'replace';

export interface ApiImportResult {
  mode: ApiImportMode;
  sessions: number;
  laps: number;
  /** Circuits added that this install did not know. */
  tracks: number;
  /** Circuits recognised as ones this install already had. */
  tracksMatched: number;
  coachReports: number;
  recordings: number;
  settings: number;
  /** Where the safety copy of the previous data went (replace mode only). */
  safetyBackup: string | null;
}
