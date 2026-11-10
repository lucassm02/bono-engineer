/** Fuel strategy maths and pt-BR warnings for the "Combustível" view (pure). */

import {
  type FuelProjection,
  fuelProjection,
  type LiveFuel,
  type LiveLapTiming,
} from '@gt7/shared';
import { formatFixed } from './format.ts';

export { raceLapsLeft } from '@gt7/shared';

export interface FuelWarning {
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface FuelPlan extends FuelProjection {
  /** level / capacity, 0–1. */
  fraction: number;
  warnings: FuelWarning[];
}

/** Builds the plan from the shared projection (also used by the radio fuel rule). */
export function fuelPlan(fuel: LiveFuel, lap: LiveLapTiming, lapFraction: number | null): FuelPlan {
  const projection = fuelProjection(fuel, lap, lapFraction);
  const { capacity, level, perLap, lapsOfFuel, missing, surplus, savePerLap } = projection;
  const left = projection.raceLapsLeft;

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
  return { ...projection, fraction: Math.min(1, level / capacity), warnings };
}
