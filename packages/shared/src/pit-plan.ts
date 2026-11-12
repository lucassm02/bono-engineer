/**
 * Pit stop planner (spec 16): when the fuel makes a stop necessary and how much to add. A simple
 * estimate from the average consumption, always shown as an estimate. Pure.
 */

/** Safety margin: the stop is planned this many laps of fuel before the tank is dry. */
export const PIT_MARGIN_LAPS = 0.5;

export interface PitPlanInput {
  /** Fuel in the tank now (L). */
  level: number;
  /** Average consumption per lap (L), null while unknown. */
  perLap: number | null;
  /** Laps still to drive, current lap remainder included; null when the race length is unknown. */
  lapsLeft: number | null;
  /** The most fuel a stop can leave in the tank (L): the tank, or what the driver allows. */
  refuelTo: number;
  /** Current lap number, to name the lap to pit in. */
  currentLap: number;
}

export type PitPlan =
  /** Not enough data (no consumption, or no race length). */
  | { kind: 'unknown' }
  /** The fuel reaches the flag. */
  | { kind: 'enough'; surplusL: number }
  | {
      kind: 'stop';
      /** Fuel missing at the flag if no stop is made (L). */
      missingL: number;
      /** Stops needed, refuelling to `refuelTo` each time. */
      stops: number;
      /** Fuel to add at the first stop (L): enough to finish when one stop is enough. */
      addL: number;
      /** Last lap to enter the pits in, keeping the safety margin (>= current lap). */
      pitByLap: number;
      /** Laps of fuel left now. */
      lapsOfFuel: number;
    }
  /** The tank cannot be filled enough to ever finish (refuel limit below one lap of fuel). */
  | { kind: 'impossible' };

export function pitPlan(input: PitPlanInput): PitPlan {
  const { level, perLap, lapsLeft, refuelTo, currentLap } = input;
  if (perLap === null || !(perLap > 0) || lapsLeft === null || !(lapsLeft > 0)) {
    return { kind: 'unknown' };
  }
  const needed = perLap * lapsLeft;
  const missingL = needed - level;
  if (missingL <= 0) return { kind: 'enough', surplusL: -missingL };
  const usableTank = refuelTo - perLap * PIT_MARGIN_LAPS;
  if (!(usableTank > perLap)) return { kind: 'impossible' };
  const lapsOfFuel = level / perLap;
  const stops = Math.max(1, Math.ceil(missingL / usableTank));
  const pitByLap = currentLap + Math.max(0, Math.floor(lapsOfFuel - PIT_MARGIN_LAPS));
  const addL = Math.min(refuelTo - Math.max(0, level - perLap * (pitByLap - currentLap)), missingL);
  return {
    kind: 'stop',
    missingL: Math.round(missingL * 10) / 10,
    stops,
    addL: Math.max(0, Math.round(addL * 10) / 10),
    pitByLap,
    lapsOfFuel: Math.round(lapsOfFuel * 10) / 10,
  };
}
