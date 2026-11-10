/**
 * Fuel projection shared by the "Combustível" view (web fuel.ts adds the pt-BR warnings) and the
 * radio fuel rule.
 */

import type { LiveFuel, LiveLapTiming } from '../live.ts';

export interface FuelProjection {
  level: number;
  capacity: number;
  /** Average consumption per lap, null until known (or when nothing is consumed). */
  perLap: number | null;
  /** Laps the current fuel lasts at the average consumption. */
  lapsOfFuel: number | null;
  /** Laps still to drive in a race (fractional, includes the current one), null if unknown. */
  raceLapsLeft: number | null;
  /** Fuel needed from now to the flag (L), null if unknown. */
  needed: number | null;
  /** Fuel missing to finish (L, > 0) or 0 when it is enough. */
  missing: number | null;
  /** Fuel left at the flag (L), when enough. */
  surplus: number | null;
  /** Saving per lap needed to finish without refuelling (L/lap). */
  savePerLap: number | null;
}

/** Laps still to drive (current lap remainder included); null outside races. */
export function raceLapsLeft(lap: LiveLapTiming, lapFraction: number | null): number | null {
  if (!lap.totalLaps || lap.totalLaps <= 0) return null;
  if (lap.lap <= 0) return lap.totalLaps;
  const frac = lapFraction === null ? 0 : Math.min(Math.max(lapFraction, 0), 1);
  return Math.max(0, lap.totalLaps - lap.lap + 1 - frac);
}

/**
 * `fuel.neededToFinish` (core: laps left × average, i.e. the total needed, not the amount to add)
 * is used when present; otherwise it is computed here.
 */
export function fuelProjection(
  fuel: LiveFuel,
  lap: LiveLapTiming,
  lapFraction: number | null,
): FuelProjection {
  const capacity = fuel.capacity > 0 ? fuel.capacity : 100;
  const level = Math.max(0, fuel.level);
  const perLap = fuel.perLapAvg !== null && fuel.perLapAvg > 0 ? fuel.perLapAvg : null;
  const lapsOfFuel = fuel.lapsRemaining ?? (perLap ? level / perLap : null);
  const left = raceLapsLeft(lap, lapFraction);
  const needed = fuel.neededToFinish ?? (perLap !== null && left !== null ? perLap * left : null);
  const missing = needed === null ? null : Math.max(0, needed - level);
  const surplus = needed === null ? null : Math.max(0, level - needed);
  const savePerLap = missing !== null && missing > 0 && left && left > 0 ? missing / left : null;
  return {
    level,
    capacity,
    perLap,
    lapsOfFuel,
    raceLapsLeft: left,
    needed,
    missing,
    surplus,
    savePerLap,
  };
}
