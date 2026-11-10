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
  MapCorner,
  MicrosectorAnalysis,
  TraceChannel,
  TrackAnalysis,
  TrackSectorRange,
} from './analysis.ts';
import type { Id, LapSampleChannel, Track } from './domain.ts';

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
