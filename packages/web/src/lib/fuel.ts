/** Fuel strategy maths and pt-BR warnings for the "Combustível" view (pure). */

import {
  type FuelProjection,
  fuelProjection,
  type LiveFuel,
  type LiveLapTiming,
} from '@gt7/shared';
import { formatFixed } from './format.ts';
import { t as uiText } from './i18n.ts';

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
      text: uiText('O consumo médio aparece depois da primeira volta completa.'),
    });
  }
  if (missing !== null && missing > 0.05) {
    warnings.push({
      level: 'error',
      text: uiText(
        'Não chega ao fim: faltam {0} L. Reabasteça ou economize {1} L por volta.',
        formatFixed(missing, 1),
        formatFixed(savePerLap ?? 0, 2),
      ),
    });
  } else if (lapsOfFuel !== null && lapsOfFuel < 2 && (left === null || left > lapsOfFuel)) {
    warnings.push({
      level: 'warn',
      text: uiText('Reserva: combustível para {0} volta(s).', formatFixed(lapsOfFuel, 1)),
    });
  } else if (surplus !== null && left !== null && perLap !== null) {
    warnings.push({
      level: 'info',
      text: uiText(
        'Dá para terminar: sobram ~{0} L ({1} volta{2}).',
        formatFixed(surplus, 1),
        formatFixed(surplus / perLap, 1),
        surplus / perLap >= 2 ? 's' : '',
      ),
    });
  }
  if (perLap === null && level / capacity < 0.1) {
    warnings.push({ level: 'warn', text: uiText('Tanque abaixo de 10%.') });
  }
  if (left === null) {
    warnings.push({
      level: 'info',
      text: uiText('Sem número de voltas (treino ou time trial): mostrando só a autonomia.'),
    });
  }
  return { ...projection, fraction: Math.min(1, level / capacity), warnings };
}
