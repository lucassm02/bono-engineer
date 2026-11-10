/**
 * @gt7/core — live lap engine (laps, sectors, delta, derived channels), track identification,
 * SQLite storage (`node:sqlite`) + gzip trace files, raw session recording, reference capture and
 * the Gt7Runtime facade used by the server and the MCP.
 *
 * Note: importing this package loads `node:sqlite`, which prints "ExperimentalWarning: SQLite is
 * an experimental feature" on Node 24. Suppress it with `--disable-warning=ExperimentalWarning`.
 */

export const CORE_PACKAGE = '@gt7/core';

export {
  AnalysisError,
  type AnalysisErrorCode,
  AnalysisService,
  type AnalysisServiceOptions,
  type ChartRequest,
  CORNER_DETECTION_VERSION,
  CORNER_SIGNATURE_KEY,
  type ConsistencyTarget,
  carryOverNames,
  cornersSignature,
  type EnsureCornersResult,
  findCorner,
  type ResampleRequest,
} from './analysis-service/analysis-service.ts';
export { AnalysisCornerHintProvider } from './analysis-service/corner-hints.ts';
export {
  calibrateDrivingEventModel,
  type DetectDrivingEventsOptions,
  DRIVING_EVENT_THRESHOLDS,
  type DrivingEventsResult,
  type DrivingEventThresholds,
  detectCornerPassEvents,
  detectDrivingEvents,
  radioEventForPass,
} from './analysis-service/driving-events.ts';
export { LruCache } from './analysis-service/lru.ts';
export {
  ReferenceCapture,
  type ReferenceCaptureEvents,
  type ReferenceCaptureMeta,
  type ReferenceCaptureOptions,
  type ReferenceCaptureStore,
  validateReferenceLap,
} from './capture/reference-capture.ts';
export {
  type SeedResult,
  type SeedSessionSpec,
  seedSyntheticData,
} from './dev/seed.ts';
export {
  computeRecords,
  EphemeralContext,
  type IdentifyTrackInput,
  isPersonalLap,
  type LiveEngineContext,
  MemoryEngineContext,
  type TrackRecords,
} from './live/context.ts';
export {
  type CornerHintInput,
  type CornerHintProvider,
  type CornerHintTargets,
  TraceCornerHintProvider,
} from './live/corner-hints.ts';
export { DeltaReference, type StoredLap } from './live/delta-reference.ts';
export { forwardFromRotation, G0, GForceEstimator, headingOf } from './live/gforce.ts';
export {
  type CompletedLap,
  computeSectorTimes,
  type EngineCaptureInfo,
  type LapDiscardedInfo,
  type LapStartedInfo,
  LiveEngine,
  type LiveEngineEvents,
  type LiveEngineOptions,
  NOMINAL_MS_PER_PACKET,
  type SessionEndInfo,
  type SessionEndReason,
} from './live/live-engine.ts';
export {
  CORE_VERSION,
  Gt7Runtime,
  type Gt7RuntimeEvents,
  type Gt7RuntimeOptions,
  type RuntimeNotice,
  SETTINGS_KEYS,
  type SessionSavedInfo,
} from './runtime/runtime.ts';
export { MIGRATIONS, SCHEMA_VERSION } from './store/schema.ts';
export {
  coachPreview,
  DB_FILE,
  EMPTY_COACH_USAGE,
  Gt7Store,
  type ListLapsOptions,
  type ListSessionsOptions,
  RECORDINGS_DIR,
  type StoredCoachReport,
  TRACES_DIR,
} from './store/store.ts';
export { StoreEngineContext } from './store/store-context.ts';
export { LAP_SAMPLE_CHANNELS, TraceBuilder, traceColumn, traceSample } from './trace/channels.ts';
export {
  decodeTrace,
  encodeTrace,
  readTraceFile,
  readTraceFileSync,
  TRACE_EXTENSION,
  TRACE_MAGIC,
  TRACE_VERSION,
  writeTraceFile,
} from './trace/trace-file.ts';
export {
  buildCenterline,
  CENTERLINE_STEP_M,
  centerlinePolyline,
  compareFingerprints,
  computeFingerprint,
  DEFAULT_MATCH_TOLERANCES,
  DEFAULT_SECTOR_COUNT,
  equalSectorGates,
  type FingerprintComparison,
  type IdentifyResult,
  identifyOrCreateTrack,
  lapPolyline,
  type MatchTolerances,
  matchTrack,
  matchTrackByStart,
  nextUnknownTrackName,
  type TrackRepository,
  UNKNOWN_TRACK_PREFIX,
} from './track/fingerprint.ts';
export {
  DATA_DIR_NAME,
  type DataDirContext,
  DEMO_SUBDIR,
  defaultDataDir,
  type MigrationResult,
  migrateLegacyData,
  migratePreviousDataDir,
  previousDataFolderName,
  publishMigratedFolder,
  type ResolveDataDirOptions,
  resolveDataDir,
} from './util/data-dir.ts';
export { newId, sequentialIds } from './util/ids.ts';
export { alignToLine, cumulativeDistance, Polyline, type Projection } from './util/polyline.ts';
