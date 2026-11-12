/**
 * Microsectors (N equal-distance slices, default 25), sector times, theoretical best lap (sum of
 * the best microsectors / best sectors) and per-microsector map colors vs a reference.
 */

import {
  DEFAULT_MICROSECTOR_COUNT,
  type Id,
  type MicrosectorColor,
  type MicrosectorReport,
  type SectorTable,
  type SectorTableRow,
} from '@gt7/shared';
import { equalSectors } from './compare.ts';
import { type PreparedLap, timeAtDistance } from './prepare.ts';

export interface MicrosectorOptions {
  /** Number of microsectors (default 25). */
  count?: number;
  /** Sector start distances (m), first 0. Default 3 equal sectors. */
  sectorStartsM?: number[];
}

/** Suggested colors per tone (purple best, green gain, yellow neutral, red loss). */
export const MICROSECTOR_TONE_COLORS: Readonly<Record<MicrosectorColor['tone'], string>> = {
  best: '#a855f7',
  gain: '#22c55e',
  neutral: '#eab308',
  loss: '#ef4444',
};

function spanMs(lap: PreparedLap, from: number, to: number): number {
  return (timeAtDistance(lap, to) - timeAtDistance(lap, from)) * 1000;
}

/** Microsector and sector times of each lap, bests and theoretical best laps. */
export function computeMicrosectors(
  laps: readonly PreparedLap[],
  opts: MicrosectorOptions = {},
): MicrosectorReport {
  if (laps.length === 0) throw new Error('computeMicrosectors: no laps');
  const count = Math.max(1, Math.round(opts.count ?? DEFAULT_MICROSECTOR_COUNT));
  const L = Math.min(...laps.map((l) => l.lengthM));
  const boundariesM = Array.from({ length: count + 1 }, (_, i) => (L * i) / count);
  const sectorStartsM = (opts.sectorStartsM ?? equalSectors(L)).filter((s) => s >= 0 && s < L);
  if (sectorStartsM[0] !== 0) sectorStartsM.unshift(0);

  const lapRows = laps.map((lap) => ({
    lapId: lap.lapId,
    lapTimeMs: lap.lapTimeS * 1000,
    microMs: boundariesM.slice(0, -1).map((from, i) => spanMs(lap, from, boundariesM[i + 1]!)),
    sectorMs: sectorStartsM.map((from, i) => spanMs(lap, from, sectorStartsM[i + 1] ?? L)),
  }));

  const bestOf = (get: (r: (typeof lapRows)[number]) => number[], len: number) => {
    const ms: number[] = [];
    const ids: Id[] = [];
    for (let i = 0; i < len; i++) {
      let bi = 0;
      for (let k = 1; k < lapRows.length; k++) {
        if (get(lapRows[k]!)[i]! < get(lapRows[bi]!)[i]!) bi = k;
      }
      ms.push(get(lapRows[bi]!)[i]!);
      ids.push(lapRows[bi]!.lapId);
    }
    return { ms, ids };
  };
  const bm = bestOf((r) => r.microMs, count);
  const bs = bestOf((r) => r.sectorMs, sectorStartsM.length);
  const bestLap = lapRows.reduce((x, y) => (y.lapTimeMs < x.lapTimeMs ? y : x));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  return {
    count,
    lengthM: L,
    boundariesM,
    sectorStartsM,
    laps: lapRows.map((r) => ({
      ...r,
      lapTimeMs: Math.round(r.lapTimeMs),
      microMs: r.microMs.map((v) => Math.round(v * 10) / 10),
      sectorMs: r.sectorMs.map((v) => Math.round(v)),
    })),
    bestMicroMs: bm.ms.map((v) => Math.round(v * 10) / 10),
    bestMicroLapIds: bm.ids,
    bestSectorMs: bs.ms.map((v) => Math.round(v)),
    bestSectorLapIds: bs.ids,
    bestLapId: bestLap.lapId,
    bestLapMs: Math.round(bestLap.lapTimeMs),
    theoreticalBestMs: Math.round(sum(bm.ms)),
    theoreticalBestSectorsMs: Math.round(sum(bs.ms)),
  };
}

const SECTOR_AVG_LAPS = 5;

/**
 * The sector table of a set of laps (spec 14): per sector the best time, the lap that made it, the
 * average of the best five and what the best lap leaves on the table; plus the ideal lap. The laps
 * must already be the valid ones (the table does no filtering).
 */
export function sectorTable(laps: readonly PreparedLap[], opts: { sectorStartsM?: number[] } = {}) {
  const report = computeMicrosectors(laps, {
    ...(opts.sectorStartsM ? { sectorStartsM: opts.sectorStartsM } : {}),
  });
  return sectorTableOf(report);
}

/** {@link sectorTable} over an existing microsector report. */
export function sectorTableOf(report: MicrosectorReport): SectorTable {
  const best = report.laps.find((l) => l.lapId === report.bestLapId)!;
  const rows: SectorTableRow[] = report.sectorStartsM.map((fromM, i) => {
    const times = report.laps.map((l) => l.sectorMs[i]!).sort((a, b) => a - b);
    const top = times.slice(0, SECTOR_AVG_LAPS);
    const bestMs = report.bestSectorMs[i]!;
    return {
      index: i,
      fromM,
      toM: report.sectorStartsM[i + 1] ?? report.lengthM,
      bestMs,
      bestLapId: report.bestSectorLapIds[i]!,
      avgTopMs: Math.round(top.reduce((a, b) => a + b, 0) / top.length),
      bestLapLossMs: Math.max(0, best.sectorMs[i]! - bestMs),
    };
  });
  const idealLapMs = rows.reduce((a, r) => a + r.bestMs, 0);
  return {
    lengthM: report.lengthM,
    sectorStartsM: report.sectorStartsM,
    rows,
    lapCount: report.laps.length,
    bestLapId: report.bestLapId,
    bestLapMs: report.bestLapMs,
    idealLapMs,
    gainMs: Math.max(0, report.bestLapMs - idealLapMs),
  };
}

export interface ColorOptions {
  /** |delta| below this is 'neutral' (ms), default 10. */
  neutralMs?: number;
  /** Mark microsectors equal to the set's best as 'best' (default true). */
  markBest?: boolean;
}

/**
 * Map colors of `lapId`'s microsectors vs `referenceLapId` (default: the best lap of the report).
 * gain = faster than the reference, loss = slower.
 */
export function microsectorColors(
  report: MicrosectorReport,
  lapId: Id,
  referenceLapId: Id = report.bestLapId,
  opts: ColorOptions = {},
): MicrosectorColor[] {
  const lap = report.laps.find((l) => l.lapId === lapId);
  const ref = report.laps.find((l) => l.lapId === referenceLapId);
  if (!lap || !ref) throw new Error('microsectorColors: lap not in report');
  const neutral = opts.neutralMs ?? 10;
  const deltas = lap.microMs.map((v, i) => v - ref.microMs[i]!);
  const maxAbs = Math.max(1e-9, ...deltas.map((d) => Math.abs(d)));
  return deltas.map((d, i) => {
    const isBest =
      (opts.markBest ?? true) &&
      report.laps.length > 1 &&
      lap.microMs[i]! <= report.bestMicroMs[i]!;
    const tone: MicrosectorColor['tone'] = isBest
      ? 'best'
      : d <= -neutral
        ? 'gain'
        : d >= neutral
          ? 'loss'
          : 'neutral';
    return {
      index: i,
      fromM: report.boundariesM[i]!,
      toM: report.boundariesM[i + 1]!,
      deltaMs: Math.round(d),
      tone,
      intensity: Math.round((Math.abs(d) / maxAbs) * 100) / 100,
      color: MICROSECTOR_TONE_COLORS[tone],
    };
  });
}
