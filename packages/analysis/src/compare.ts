/**
 * Lap comparison: per-corner metric rows with diffs, time lost per corner zone and per sector,
 * findings (pt-BR diagnoses + one action) ranked by estimated time impact.
 *
 * Corner zones partition the lap: zone k spans [min(brake points) − 10 m (or entry − 50 m),
 * exit + EXIT_SPEED_OFFSET_M]; overlapping zones of close corners (chicanes) are cut at the midpoint
 * of the gap between them. Everything outside the zones counts as "straights", so
 * Σ timeLostMs + straightsDeltaMs = totalDeltaMs.
 */

import {
  type Corner,
  type CornerComparisonRow,
  type CornerFinding,
  type CornerMetricKey,
  type CornerMetrics,
  type CornerMetricsDiff,
  EXIT_SPEED_OFFSET_M,
  type Id,
  type LapComparison,
} from '@gt7/shared';
import { type DiagnoseOptions, diagnoseCorner } from './findings.ts';
import { computeLapMetrics } from './metrics.ts';
import type { PreparedLap } from './prepare.ts';
import { deltaBetween } from './resample.ts';

/** Every numeric metric key of CornerMetrics (for diffs and consistency). */
export const CORNER_METRIC_KEYS: readonly CornerMetricKey[] = [
  'brakePointM',
  'peakBrake',
  'timeToPeakBrakeS',
  'brakeReleaseM',
  'brakingDurationS',
  'trailBrakingS',
  'trailBrakingArea',
  'brakeReleaseToApexM',
  'entrySpeedKmh',
  'minSpeedKmh',
  'minSpeedM',
  'apexM',
  'exitSpeedKmh',
  'gearAtApex',
  'throttlePickupM',
  'timeToFullThrottleS',
  'coastingS',
  'rearSlipPeak',
  'tcsActiveS',
  'frontLockPeak',
  'frontLockS',
  'steeringCorrections',
  'timeInCornerS',
  'timeDeltaS',
];

export interface CompareOptions extends DiagnoseOptions {
  /** Number of rows in topLosses (default 3). */
  topN?: number;
  trackId?: Id | null;
  /** Sector start distances (m), first should be 0. Default: 3 equal sectors. */
  sectorStartsM?: number[];
}

/** Subject − reference for every numeric metric (null when either is null). */
export function diffMetrics(a: CornerMetrics, b: CornerMetrics): CornerMetricsDiff {
  const out: CornerMetricsDiff = {};
  for (const k of CORNER_METRIC_KEYS) {
    const va = a[k];
    const vb = b[k];
    out[k] = va === null || vb === null ? null : va - vb;
  }
  return out;
}

export interface CornerZone {
  fromM: number;
  toM: number;
}

/** Non-overlapping time zones of the corners (see module doc). */
export function cornerZones(
  corners: readonly Corner[],
  lengthM: number,
  brakePoints: readonly (number | null)[][],
): CornerZone[] {
  const zones = corners.map((c, i) => {
    const bps = brakePoints.map((l) => l[i]).filter((v): v is number => v != null);
    const from = bps.length > 0 ? Math.min(...bps, c.entryM) - 10 : c.entryM - 50;
    return { fromM: from, toM: c.exitM + EXIT_SPEED_OFFSET_M };
  });
  for (let i = 1; i < zones.length; i++) {
    const prev = zones[i - 1]!;
    const cur = zones[i]!;
    if (cur.fromM < prev.toM) {
      const mid = (corners[i - 1]!.exitM + corners[i]!.entryM) / 2;
      prev.toM = Math.min(prev.toM, Math.max(mid, prev.fromM));
      cur.fromM = Math.max(cur.fromM, prev.toM);
    }
  }
  for (const z of zones) {
    z.fromM = Math.max(0, Math.min(z.fromM, lengthM));
    z.toM = Math.max(z.fromM, Math.min(z.toM, lengthM));
  }
  return zones;
}

/** Default sector starts: `count` equal-length sectors. */
export function equalSectors(lengthM: number, count = 3): number[] {
  return Array.from({ length: count }, (_, i) => (lengthM * i) / count);
}

/**
 * Compares `lap` (subject) with `reference` corner by corner. lapA = subject, lapB = reference;
 * all deltas are subject − reference (+ = subject slower).
 */
export function compareLaps(
  lap: PreparedLap,
  reference: PreparedLap,
  corners: readonly Corner[],
  opts: CompareOptions = {},
): LapComparison {
  const L = Math.min(lap.lengthM, reference.lengthM);
  const warnings: string[] = [];
  if (Math.abs(lap.lengthM - reference.lengthM) > 1) {
    warnings.push('As voltas foram alinhadas em linhas de referência diferentes.');
  }
  for (const w of [...lap.warnings, ...reference.warnings]) warnings.push(w);
  const refReplay = reference.isReplay;
  if (refReplay) {
    warnings.push(
      'Referência capturada de replay: entradas suavizadas, distâncias com precisão de alguns metros; ' +
        'compare tendências (m, km/h), não milissegundos.',
    );
  }
  if (lap.isReplay) warnings.push('A volta analisada também é de replay (entradas suavizadas).');

  const prelimA = computeLapMetrics(lap, corners);
  const prelimB = computeLapMetrics(reference, corners);
  const zones = cornerZones(corners, L, [
    prelimA.map((m) => m.brakePointM),
    prelimB.map((m) => m.brakePointM),
  ]);
  const metricsA = prelimA.map((m, i) => ({
    ...m,
    timeDeltaS: deltaBetween(lap, reference, zones[i]!.fromM, zones[i]!.toM),
  }));
  const metricsB = prelimB.map((m) => ({ ...m, timeDeltaS: 0 }));

  const totalDeltaS = lap.lapTimeS - reference.lapTimeS;
  const rows: CornerComparisonRow[] = corners.map((corner, i) => {
    const z = zones[i]!;
    const a = metricsA[i]!;
    const b = metricsB[i]!;
    const nextFrom = i + 1 < zones.length ? zones[i + 1]!.fromM : L;
    const d = (from: number, to: number) =>
      to > from ? deltaBetween(lap, reference, from, to) : 0;
    const entry = Math.min(Math.max(corner.entryM, z.fromM), z.toM);
    const exit = Math.min(Math.max(corner.exitM, entry), z.toM);
    const phaseLoss = {
      brakingMs: d(z.fromM, entry) * 1000,
      midMs: d(entry, exit) * 1000,
      exitMs: d(exit, z.toM) * 1000,
      followingStraightMs: d(z.toM, nextFrom) * 1000,
    };
    const findings = diagnoseCorner(corner, a, b, phaseLoss, {
      ...opts,
      referenceIsReplay: refReplay || opts.referenceIsReplay,
    });
    return {
      corner,
      a,
      b,
      diff: diffMetrics(a, b),
      timeLostMs: (a.timeDeltaS ?? 0) * 1000,
      findings,
      zone: { fromM: z.fromM, toM: z.toM },
      phaseLoss: {
        brakingMs: Math.round(phaseLoss.brakingMs),
        midMs: Math.round(phaseLoss.midMs),
        exitMs: Math.round(phaseLoss.exitMs),
        followingStraightMs: Math.round(phaseLoss.followingStraightMs),
      },
    };
  });

  const cornersMs = rows.reduce((acc, r) => acc + r.timeLostMs, 0);
  const topN = opts.topN ?? 3;
  const topLosses = [...rows].sort((x, y) => y.timeLostMs - x.timeLostMs).slice(0, topN);
  const allFindings: CornerFinding[] = rows
    .flatMap((r) => r.findings ?? [])
    .sort((x, y) => (y.costMs ?? 0) - (x.costMs ?? 0));
  const keyFindings: CornerFinding[] = rows
    .map((r) => r.findings?.[0])
    .filter((f): f is CornerFinding => f !== undefined)
    .sort((x, y) => (y.costMs ?? 0) - (x.costMs ?? 0));

  const sectorStartsM = (opts.sectorStartsM ?? equalSectors(L)).filter((s) => s >= 0 && s < L);
  if (sectorStartsM[0] !== 0) sectorStartsM.unshift(0);
  const sectorDeltasMs = sectorStartsM.map((from, i) => {
    const to = sectorStartsM[i + 1] ?? L;
    return Math.round(deltaBetween(lap, reference, from, to) * 1000);
  });

  return {
    trackId: opts.trackId ?? null,
    lapA: lap.lapId,
    lapB: reference.lapId,
    lapATimeMs: Math.round(lap.lapTimeS * 1000),
    lapBTimeMs: Math.round(reference.lapTimeS * 1000),
    totalDeltaMs: Math.round(totalDeltaS * 1000),
    rows,
    topLosses,
    straightsDeltaMs: Math.round(totalDeltaS * 1000 - cornersMs),
    warnings,
    findings: allFindings,
    keyFindings,
    sectorDeltasMs,
    sectorStartsM,
    lengthM: L,
    referenceIsReplay: refReplay,
  };
}
