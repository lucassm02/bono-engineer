/**
 * Session summary (spec 12): one answer to "foi uma boa sessão? o que melhorou? o que fazer agora?".
 * Pure and deterministic: it takes the laps of the session plus what the driver did before on the
 * same track and car, and returns numbers and rule-made suggestions (no AI involved).
 *
 * "Clean" laps are valid laps within 107 % of the session's best lap, so a cool-down or an
 * out-lap that happens to be valid does not wreck the pace and consistency numbers.
 */

import type {
  Id,
  SessionSummary,
  SummaryBaseline,
  SummaryComparison,
  SummaryCornerChange,
  SummarySuggestion,
  SummaryTrend,
} from '@gt7/shared';
import { computeStats, percentile } from './math.ts';

/** A lap counts as clean up to this share of the session's best lap. */
export const CLEAN_LAP_RATIO = 1.07;
/** Fewer clean laps than this and the summary is reduced (no spread, trend or tips). */
export const MIN_CLEAN_LAPS = 3;
/** A corner must change by this much (ms) to be listed as a gain or a loss. */
export const CORNER_CHANGE_MIN_MS = 20;
/** Largest loss (ms) worth a suggestion: below it the difference is lap-to-lap noise. */
export const CORNER_TIP_MIN_MS = 80;
/** Average of the best five this far (ms) above the best lap is worth a suggestion. */
export const PACE_GAP_TIP_MS = 500;
const HISTOGRAM_BUCKETS = 6;
const MAX_CORNER_ROWS = 3;
const MAX_SUGGESTIONS = 3;

export interface SummaryLap {
  id: Id;
  number: number;
  timeMs: number;
  valid: boolean;
}

export interface SessionSummaryInput {
  session: {
    id: Id;
    trackId: Id | null;
    carCode: number;
    startedAt: number;
    endedAt: number | null;
    trackTimeMs?: number | null;
  };
  /** The driver's own laps of the session, in driving order (no reference or replay laps). */
  laps: readonly SummaryLap[];
  /** Best valid own lap on the track and car before this session. */
  previousBestMs: number | null;
  lastSession: SummaryBaseline | null;
  bestSession: SummaryBaseline | null;
  goalMs: number | null;
  /** Corner changes against the previous best lap (negative = gained), when it could be made. */
  cornerChanges?: readonly SummaryCornerChange[] | null;
  /** Consistency sentences already written by the analysis (pt-BR), strongest first. */
  consistencyHighlights?: readonly string[];
}

/** Average of the (up to) five smallest values. */
export function topAverage(timesMs: readonly number[], n = 5): number | null {
  if (timesMs.length === 0) return null;
  const top = [...timesMs].sort((a, b) => a - b).slice(0, n);
  return Math.round(top.reduce((a, b) => a + b, 0) / top.length);
}

/** Slope (ms per lap) of the straight line through the lap times, in driving order. */
export function lapSlope(timesMs: readonly number[]): number | null {
  const n = timesMs.length;
  if (n < 2) return null;
  const meanX = (n - 1) / 2;
  const meanY = timesMs.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (timesMs[i]! - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}

/** improving / worsening need the line to move the pace by 0.2 % (and 150 ms) over the session. */
export function paceTrend(
  timesMs: readonly number[],
): { trend: SummaryTrend; slope: number } | null {
  const slope = lapSlope(timesMs);
  if (slope === null || timesMs.length < MIN_CLEAN_LAPS) return null;
  const median = percentile([...timesMs], 50);
  const total = slope * (timesMs.length - 1);
  const threshold = Math.max(150, median * 0.002);
  const trend: SummaryTrend =
    total <= -threshold ? 'improving' : total >= threshold ? 'worsening' : 'steady';
  return { trend, slope };
}

function histogram(timesMs: readonly number[]) {
  const min = Math.min(...timesMs);
  const max = Math.max(...timesMs);
  const width = Math.max(1, (max - min) / HISTOGRAM_BUCKETS);
  const buckets = Array.from({ length: HISTOGRAM_BUCKETS }, (_, i) => ({
    fromMs: Math.round(min + i * width),
    toMs: Math.round(min + (i + 1) * width),
    count: 0,
  }));
  for (const t of timesMs) {
    const i = Math.min(HISTOGRAM_BUCKETS - 1, Math.floor((t - min) / width));
    buckets[i]!.count++;
  }
  return buckets;
}

function compare(
  bestMs: number,
  top5: number | null,
  base: { bestLapMs: number; top5AvgMs: number | null; sessionId: Id; startedAt: number },
): SummaryComparison {
  return {
    baselineMs: base.bestLapMs,
    bestDeltaMs: bestMs - base.bestLapMs,
    paceDeltaMs: top5 !== null && base.top5AvgMs !== null ? top5 - base.top5AvgMs : null,
    sessionId: base.sessionId,
    startedAt: base.startedAt,
  };
}

const seconds = (ms: number) => (Math.abs(ms) / 1000).toFixed(2).replace('.', ',');

export function buildSessionSummary(input: SessionSummaryInput): SessionSummary {
  const { session, laps } = input;
  const valid = laps.filter((l) => l.valid);
  const best = valid.length ? valid.reduce((a, b) => (b.timeMs < a.timeMs ? b : a)) : null;
  const clean = best ? valid.filter((l) => l.timeMs <= best.timeMs * CLEAN_LAP_RATIO) : [];
  const cleanTimes = clean.map((l) => l.timeMs);
  const reduced = clean.length < MIN_CLEAN_LAPS;
  const top5 = topAverage(cleanTimes);

  const span =
    session.trackTimeMs ?? (session.endedAt !== null ? session.endedAt - session.startedAt : null);

  const pace =
    best && cleanTimes.length > 0 && top5 !== null
      ? {
          top5AvgMs: top5,
          medianMs: Math.round(percentile([...cleanTimes], 50)),
          fastestMs: Math.min(...cleanTimes),
          slowestMs: Math.max(...cleanTimes),
          spreadMs: Math.max(...cleanTimes) - Math.min(...cleanTimes),
          histogram: reduced ? [] : histogram(cleanTimes),
        }
      : null;

  const stats = computeStats(cleanTimes);
  const trend = reduced ? null : paceTrend(cleanTimes);
  const consistency =
    stats && !reduced
      ? {
          stdDevMs: Math.round(stats.stdDev),
          trend: trend?.trend ?? null,
          slopeMsPerLap: trend ? Math.round(trend.slope) : null,
        }
      : null;

  const toBase = (b: SummaryBaseline | null) => (b && best ? compare(best.timeMs, top5, b) : null);
  const goal: SummaryComparison | null =
    best && input.goalMs !== null
      ? {
          baselineMs: input.goalMs,
          bestDeltaMs: best.timeMs - input.goalMs,
          paceDeltaMs: null,
          sessionId: null,
          startedAt: null,
        }
      : null;

  const changes = input.cornerChanges ?? null;
  const corners = changes
    ? {
        gains: changes
          .filter((c) => c.deltaMs <= -CORNER_CHANGE_MIN_MS)
          .sort((a, b) => a.deltaMs - b.deltaMs)
          .slice(0, MAX_CORNER_ROWS),
        losses: changes
          .filter((c) => c.deltaMs >= CORNER_CHANGE_MIN_MS)
          .sort((a, b) => b.deltaMs - a.deltaMs)
          .slice(0, MAX_CORNER_ROWS),
      }
    : null;

  // ---- suggestions: only where the data is clearly above the noise ----
  const tips: SummarySuggestion[] = [];
  const invalid = laps.length - valid.length;
  if (laps.length >= 4 && invalid / laps.length >= 0.3) {
    tips.push({
      code: 'invalidLaps',
      text: '{0} de {1} voltas foram inválidas. Priorize voltas limpas antes de buscar tempo.',
      values: [invalid, laps.length],
    });
  }
  const worst = corners?.losses[0];
  if (worst && worst.deltaMs >= CORNER_TIP_MIN_MS) {
    tips.push({
      code: 'cornerLoss',
      text: 'A {0} perdeu {1} s contra a sua melhor volta anterior: comece por ela.',
      values: [worst.name ?? worst.cornerId, seconds(worst.deltaMs)],
    });
  }
  if (!reduced && input.consistencyHighlights?.[0]) {
    tips.push({ code: 'inconsistent', text: '{0}', values: [input.consistencyHighlights[0]] });
  }
  if (!reduced && best && top5 !== null && top5 - best.timeMs >= PACE_GAP_TIP_MS) {
    tips.push({
      code: 'paceGap',
      text: 'A média das suas 5 melhores voltas está {0} s acima da melhor: o ritmo da melhor volta ainda não se repete.',
      values: [seconds(top5 - best.timeMs)],
    });
  }
  if (clean.length >= 5 && trend?.trend === 'worsening') {
    tips.push({
      code: 'worsening',
      text: 'O ritmo piorou ao longo da sessão (cerca de {0} s por volta). Uma pausa curta pode ajudar.',
      values: [seconds(trend.slope)],
    });
  }

  return {
    sessionId: session.id,
    trackId: session.trackId,
    carCode: session.carCode,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs: span,
    laps: { total: laps.length, valid: valid.length, invalid },
    reduced,
    best: best
      ? {
          lapId: best.id,
          lapNumber: best.number,
          timeMs: best.timeMs,
          previousBestMs: input.previousBestMs,
          deltaMs: input.previousBestMs === null ? null : best.timeMs - input.previousBestMs,
          firstTime: input.previousBestMs === null,
        }
      : null,
    pace,
    consistency,
    comparisons: {
      lastSession: toBase(input.lastSession),
      bestSession: toBase(input.bestSession),
      goal,
    },
    corners,
    suggestions: tips.slice(0, MAX_SUGGESTIONS),
  };
}
