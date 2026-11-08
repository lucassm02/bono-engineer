/** Fuel strategy maths and pt-BR warnings for the "Combustível" view (pure). */

import type { LiveFuel, LiveLapTiming } from '@gt7/shared';
import { formatFixed } from './format.ts';

export interface FuelWarning {
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface FuelPlan {
  level: number;
  capacity: number;
  /** level / capacity, 0–1. */
  fraction: number;
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
  warnings: FuelWarning[];
}

/** Laps still to drive (current lap remainder included); null outside races. */
export function raceLapsLeft(lap: LiveLapTiming, lapFraction: number | null): number | null {
  if (!lap.totalLaps || lap.totalLaps <= 0) return null;
  if (lap.lap <= 0) return lap.totalLaps;
  const frac = lapFraction === null ? 0 : Math.min(Math.max(lapFraction, 0), 1);
  return Math.max(0, lap.totalLaps - lap.lap + 1 - frac);
}

/**
 * Builds the plan. `fuel.neededToFinish` (core: laps left × average, i.e. the total needed, not
 * the amount to add) is used when present; otherwise it is computed here.
 */
export function fuelPlan(fuel: LiveFuel, lap: LiveLapTiming, lapFraction: number | null): FuelPlan {
  const capacity = fuel.capacity > 0 ? fuel.capacity : 100;
  const level = Math.max(0, fuel.level);
  const perLap = fuel.perLapAvg !== null && fuel.perLapAvg > 0 ? fuel.perLapAvg : null;
  const lapsOfFuel = fuel.lapsRemaining ?? (perLap ? level / perLap : null);
  const left = raceLapsLeft(lap, lapFraction);
  const needed = fuel.neededToFinish ?? (perLap !== null && left !== null ? perLap * left : null);
  const missing = needed === null ? null : Math.max(0, needed - level);
  const surplus = needed === null ? null : Math.max(0, level - needed);
  const savePerLap = missing !== null && missing > 0 && left && left > 0 ? missing / left : null;

  const warnings: FuelWarning[] = [];
  if (perLap === null) {
    warnings.push({
      level: 'info',
      text: 'O consumo médio aparece depois da primeira volta completa.',
    });
  }
  if (missing !== null && missing > 0.05) {
    warnings.push({
      level: 'error',
      text: `Não chega ao fim: faltam ${formatFixed(missing, 1)} L. Reabasteça ou economize ${formatFixed(savePerLap ?? 0, 2)} L por volta.`,
    });
  } else if (lapsOfFuel !== null && lapsOfFuel < 2 && (left === null || left > lapsOfFuel)) {
    warnings.push({
      level: 'warn',
      text: `Reserva: combustível para ${formatFixed(lapsOfFuel, 1)} volta(s).`,
    });
  } else if (surplus !== null && left !== null && perLap !== null) {
    warnings.push({
      level: 'info',
      text: `Dá para terminar: sobram ~${formatFixed(surplus, 1)} L (${formatFixed(surplus / perLap, 1)} volta${surplus / perLap >= 2 ? 's' : ''}).`,
    });
  }
  if (perLap === null && level / capacity < 0.1) {
    warnings.push({ level: 'warn', text: 'Tanque abaixo de 10%.' });
  }
  if (left === null) {
    warnings.push({
      level: 'info',
      text: 'Sem número de voltas (treino ou time trial): mostrando só a autonomia.',
    });
  }
  return {
    level,
    capacity,
    fraction: Math.min(1, level / capacity),
    perLap,
    lapsOfFuel,
    raceLapsLeft: left,
    needed,
    missing,
    surplus,
    savePerLap,
    warnings,
  };
}
