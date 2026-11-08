/** Session lap table maths for the "Tempos" view (pure). */

import type { Lap, LapCompletedEvent, SectorStatus } from '@gt7/shared';

export interface LapRow {
  lapId: string;
  lapNumber: number;
  timeMs: number;
  sectorTimesMs: (number | null)[];
  /** Status at the time the lap closed (from the live event); null when loaded from REST. */
  sectorStatus: SectorStatus[] | null;
  valid: boolean;
  flags: string[];
  isPersonalBest: boolean;
  fuelUsedL: number | null;
  /** Epoch ms (end of lap for events, start for REST rows): used for ordering only. */
  at: number;
}

export function lapRowFromEvent(e: LapCompletedEvent): LapRow {
  return {
    lapId: e.lapId,
    lapNumber: e.lapNumber,
    timeMs: e.timeMs,
    sectorTimesMs: [...e.sectorTimesMs],
    sectorStatus: [...e.sectorStatus],
    valid: e.valid,
    flags: [...e.flags],
    isPersonalBest: e.isPersonalBest,
    fuelUsedL: e.fuelUsedL,
    at: e.completedAt,
  };
}

export function lapRowFromLap(l: Lap): LapRow {
  return {
    lapId: l.id,
    lapNumber: l.number,
    timeMs: l.timeMs,
    sectorTimesMs: [...l.sectorTimesMs],
    sectorStatus: null,
    valid: l.valid,
    flags: [...l.flags],
    isPersonalBest: false,
    fuelUsedL: l.fuelUsedL,
    at: l.startedAt + l.timeMs,
  };
}

/** Merges rows by lapId (live event data wins over REST data), ordered by time. */
export function mergeLapRows(existing: LapRow[], incoming: LapRow[]): LapRow[] {
  const byId = new Map<string, LapRow>();
  for (const r of existing) byId.set(r.lapId, r);
  for (const r of incoming) {
    const prev = byId.get(r.lapId);
    if (!prev || (prev.sectorStatus === null && r.sectorStatus !== null)) byId.set(r.lapId, r);
  }
  return [...byId.values()].sort((a, b) => a.at - b.at || a.lapNumber - b.lapNumber);
}

function validLaps(rows: LapRow[]): LapRow[] {
  return rows.filter((r) => r.valid && Number.isFinite(r.timeMs) && r.timeMs > 0);
}

export function sessionBestLap(rows: LapRow[]): LapRow | null {
  let best: LapRow | null = null;
  for (const r of validLaps(rows)) if (!best || r.timeMs < best.timeMs) best = r;
  return best;
}

export function sectorCount(rows: LapRow[]): number {
  return rows.reduce((n, r) => Math.max(n, r.sectorTimesMs.length), 0);
}

/** Best time of each sector over valid laps (null when no valid lap has it). */
export function bestSectors(rows: LapRow[], count = sectorCount(rows)): (number | null)[] {
  const best: (number | null)[] = Array.from({ length: count }, () => null);
  for (const r of validLaps(rows)) {
    for (let i = 0; i < count; i++) {
      const t = r.sectorTimesMs[i];
      if (t === null || t === undefined || !(t > 0)) continue;
      const b = best[i];
      if (b === null || b === undefined || t < b) best[i] = t;
    }
  }
  return best;
}

/** Sum of the best sectors (theoretical best lap); null unless every sector has a time. */
export function theoreticalBest(rows: LapRow[]): number | null {
  const best = bestSectors(rows);
  if (best.length === 0 || best.some((b) => b === null)) return null;
  return best.reduce<number>((a, b) => a + (b ?? 0), 0);
}

/**
 * Consistency = sample standard deviation of valid lap times within 107 % of the session best
 * (excludes laps with a big mistake that would dominate the number). Null with < 2 laps.
 */
export function consistency(rows: LapRow[]): { stddevMs: number; count: number } | null {
  const best = sessionBestLap(rows);
  if (!best) return null;
  const xs = validLaps(rows)
    .map((r) => r.timeMs)
    .filter((t) => t <= best.timeMs * 1.07);
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return { stddevMs: Math.sqrt(v), count: xs.length };
}

export type TrendLabel = 'melhorando' | 'piorando' | 'estável';

/**
 * Trend of the last `n` valid laps: least-squares slope in ms/lap; ±100 ms/lap is "stable".
 */
export function lapTrend(
  rows: LapRow[],
  n = 3,
): { laps: LapRow[]; slopeMs: number | null; label: TrendLabel | null } {
  const laps = validLaps(rows).slice(-n);
  if (laps.length < 2) return { laps, slopeMs: null, label: null };
  const k = laps.length;
  const mx = (k - 1) / 2;
  const my = laps.reduce((a, r) => a + r.timeMs, 0) / k;
  let num = 0;
  let den = 0;
  laps.forEach((r, i) => {
    num += (i - mx) * (r.timeMs - my);
    den += (i - mx) ** 2;
  });
  const slope = num / den;
  const label: TrendLabel = slope < -100 ? 'melhorando' : slope > 100 ? 'piorando' : 'estável';
  return { laps, slopeMs: slope, label };
}

/**
 * Colour of a sector cell (`data-status` of the shared `.sector` styles): the live status of the
 * event when known (purple/green/yellow as on the race view); for REST rows, green when it is the
 * session's best sector, else yellow. Invalid laps never get record colours.
 */
export function sectorCellStatus(
  row: LapRow,
  i: number,
  best: (number | null)[],
): SectorStatus | 'invalid' {
  const t = row.sectorTimesMs[i];
  if (t === null || t === undefined) return 'pending';
  if (!row.valid) return 'invalid';
  const st = row.sectorStatus?.[i];
  if (st && st !== 'pending') return st;
  return best[i] !== null && t <= best[i]! ? 'sessionBest' : 'slower';
}

/** Short pt-BR reason of an invalid lap. */
export function invalidReason(flags: string[]): string {
  const map: Record<string, string> = {
    offTrack: 'fora da pista',
    paused: 'pausa',
    incompleteData: 'dados incompletos',
    discontinuity: 'salto',
    outLap: 'volta de saída',
    inLap: 'volta de entrada',
    replay: 'replay',
  };
  const first = flags.find((f) => map[f]);
  return first ? map[first]! : 'inválida';
}
