/**
 * @gt7/analysis — pure, isomorphic lap analysis (no Node/DOM APIs): reference line, projection and
 * distance alignment, delta by distance, corner detection, per-corner metrics, lap comparison with
 * pt-BR coaching findings, consistency, microsectors/theoretical best, lap validity, AI summaries
 * and chart data. Contracts live in @gt7/shared analysis.ts.
 *
 * Typical flow:
 *   const line = centerlineFromTrace(referenceTrace);
 *   const ref = prepareLap(referenceTrace, line, { lapTimeMs, isReplay });
 *   const corners = detectCorners(line, { reference: ref });
 *   const lap = prepareLap(myTrace, line, { lapTimeMs });
 *   const cmp = compareLaps(lap, ref, corners);
 *   summarizeComparisonForAI(cmp); formatComparisonMarkdown(cmp);
 */

export const ANALYSIS_PACKAGE = '@gt7/analysis';

export {
  buildCenterline,
  type Centerline,
  type CenterlineOptions,
  type CenterlinePoints,
  type CenterlinePolyline,
  centerlineFromPolyline,
  centerlineFromTrace,
  centerlineToPolyline,
  type LinePoint,
  linePolyline,
  pointAtDistance,
} from './centerline.ts';
export {
  buildChartData,
  type ChartChannel,
  type ChartData,
  type ChartOptions,
  type ChartSeries,
} from './charts.ts';
export {
  CORNER_METRIC_KEYS,
  type CompareOptions,
  type CornerZone,
  compareLaps,
  cornerZones,
  diffMetrics,
  equalSectors,
} from './compare.ts';
export { type ConsistencyOptions, computeConsistency } from './consistency.ts';
export {
  cornerTurnDeg,
  type DetectCornersOptions,
  detectCorners,
  detectionCurvature,
} from './corners.ts';
export { type DiagnoseOptions, diagnoseCorner, findingText } from './findings.ts';
export {
  type CornerWindows,
  computeCornerMetrics,
  computeLapMetrics,
  cornerWindows,
  countReversals,
  type MetricsOptions,
} from './metrics.ts';
export {
  type ColorOptions,
  computeMicrosectors,
  MICROSECTOR_TONE_COLORS,
  type MicrosectorOptions,
  microsectorColors,
  sectorTable,
  sectorTableOf,
} from './microsectors.ts';
export {
  channel,
  indexAtDistance,
  lateralAtDistance,
  type PreparedLap,
  type PrepareLapOptions,
  prepareLap,
  sampleAtOrAfter,
  timeAtDistance,
  valueAtDistance,
} from './prepare.ts';
export {
  type PathProjection,
  type Projection,
  type ProjectOptions,
  type ProjectPathOptions,
  projectPath,
  projectPoint,
} from './projection.ts';
export {
  channelAtDistances,
  computeDistanceDelta,
  DEFAULT_RESAMPLE_CHANNELS,
  type DistanceDeltaOptions,
  deltaBetween,
  distanceGrid,
  type ResampleOptions,
  resampleLap,
} from './resample.ts';
export {
  buildSessionSummary,
  CLEAN_LAP_RATIO,
  lapSlope,
  paceTrend,
  type SessionSummaryInput,
  type SummaryLap,
  topAverage,
} from './session-summary.ts';
export {
  type ComparisonSummaryAI,
  type ComparisonSummaryOptions,
  formatComparisonMarkdown,
  formatDelta,
  formatLapTime,
  type LapSummaryAI,
  type LapSummaryOptions,
  summarizeComparisonForAI,
  summarizeLapForAI,
} from './summary.ts';
export { checkLapValidity, type ValidityOptions } from './validity.ts';
export {
  buildWeeklySummary,
  DAY_MS,
  WEEK_MS,
  type WeeklyInput,
  type WeeklySessionInput,
  weekWindow,
} from './weekly-summary.ts';
