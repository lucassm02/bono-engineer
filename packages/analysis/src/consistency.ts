/**
 * Consistency across N laps of the same track: per-corner statistics of every numeric metric and
 * highlights of the most inconsistent corner/metric pairs (pt-BR sentences).
 *
 * `timeDeltaS` of each lap is measured against the fastest lap of the set.
 */

import type {
  ConsistencyReport,
  Corner,
  CornerMetricKey,
  CornerMetrics,
  Id,
  MetricStats,
} from '@gt7/shared';
import { CORNER_METRIC_KEYS, cornerZones } from './compare.ts';
import { computeStats, fmt } from './math.ts';
import { computeLapMetrics } from './metrics.ts';
import type { PreparedLap } from './prepare.ts';
import { deltaBetween } from './resample.ts';

/** Spread considered "1 unit of inconsistency" per metric, with pt-BR label and unit. */
const SPREAD_UNITS: Partial<Record<CornerMetricKey, { unit: number; label: string; u: string }>> = {
  brakePointM: { unit: 5, label: 'ponto de frenagem', u: 'm' },
  minSpeedKmh: { unit: 3, label: 'V-mín', u: 'km/h' },
  throttlePickupM: { unit: 8, label: 'retomada do acelerador', u: 'm' },
  exitSpeedKmh: { unit: 3, label: 'velocidade de saída', u: 'km/h' },
  coastingS: { unit: 0.2, label: 'tempo em roda livre', u: 's' },
  timeInCornerS: { unit: 0.08, label: 'tempo na curva', u: 's' },
  timeDeltaS: { unit: 0.08, label: 'tempo na zona da curva', u: 's' },
  minSpeedM: { unit: 12, label: 'local do ápice', u: 'm' },
  peakBrake: { unit: 0.1, label: 'pico de freio', u: '' },
};

export interface ConsistencyOptions {
  sessionId?: Id;
  /** Max highlights (default 5). */
  maxHighlights?: number;
  /** Minimum normalized spread (stdDev / unit) to be highlighted (default 1). */
  minScore?: number;
}

/** Per-corner metric statistics over several laps. Needs at least 2 laps. */
export function computeConsistency(
  laps: readonly PreparedLap[],
  corners: readonly Corner[],
  opts: ConsistencyOptions = {},
): ConsistencyReport & { metrics: CornerMetrics[][] } {
  if (laps.length < 1) throw new Error('computeConsistency: no laps');
  const best = laps.reduce((x, y) => (y.lapTimeS < x.lapTimeS ? y : x));
  const L = best.lengthM;
  const prelim = laps.map((l) => computeLapMetrics(l, corners));
  const zones = cornerZones(
    corners,
    L,
    prelim.map((ms) => ms.map((m) => m.brakePointM)),
  );
  const metrics = prelim.map((ms, li) =>
    ms.map((m, ci) => ({
      ...m,
      timeDeltaS: deltaBetween(laps[li]!, best, zones[ci]!.fromM, zones[ci]!.toM),
    })),
  );

  const cornerStats = corners.map((c, ci) => {
    const out: { [K in CornerMetricKey]?: MetricStats } = {};
    for (const k of CORNER_METRIC_KEYS) {
      const vals = metrics.map((ms) => ms[ci]![k]).filter((v): v is number => v !== null);
      const st = computeStats(vals);
      if (st) out[k] = st;
    }
    return { cornerId: c.id, metrics: out };
  });

  const minScore = opts.minScore ?? 1;
  const highlights: ConsistencyReport['highlights'] = [];
  const scored: { h: ConsistencyReport['highlights'][number]; score: number }[] = [];
  if (laps.length >= 2) {
    for (const cs of cornerStats) {
      for (const [key, spec] of Object.entries(SPREAD_UNITS) as [
        CornerMetricKey,
        { unit: number; label: string; u: string },
      ][]) {
        const st = cs.metrics[key];
        if (!st || st.n < 2) continue;
        const score = st.stdDev / spec.unit;
        if (score < minScore) continue;
        const range = st.max - st.min;
        const digits = spec.u === 's' ? 2 : spec.u === '' ? 2 : 0;
        const value =
          spec.u === ''
            ? `${fmt(range * 100)} pontos percentuais`
            : `${fmt(range, digits)} ${spec.u}`;
        const label = spec.label.charAt(0).toUpperCase() + spec.label.slice(1);
        scored.push({
          h: {
            cornerId: cs.cornerId,
            metric: key,
            stdDev: st.stdDev,
            range,
            message: `${label} na ${cs.cornerId} varia ${value} entre as voltas (desvio-padrão ${fmt(st.stdDev, digits)})`,
          },
          score,
        });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  for (const s of scored.slice(0, opts.maxHighlights ?? 5)) highlights.push(s.h);

  return {
    sessionId: opts.sessionId ?? '',
    lapIds: laps.map((l) => l.lapId),
    lapTime: computeStats(laps.map((l) => l.lapTimeS * 1000))!,
    corners: cornerStats,
    highlights,
    metrics,
  };
}
