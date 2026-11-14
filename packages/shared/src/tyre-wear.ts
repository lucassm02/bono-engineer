/**
 * Tyre wear estimate. The packet has no wear field, so the wear is integrated from what the car
 * reports: distance driven, the temperature of each tyre against the range of the compound, and the
 * load on each wheel (lateral g, braking, slip). The compound is not in the packet either: the driver
 * says it on the pre-race screen.
 *
 * The life of each compound (km until it is used up at a normal pace) is an ESTIMATE, not a measured
 * value: it only sets the scale and is meant to be calibrated against the real console. The shape of
 * the model (hot tyres wear faster, a sliding tyre wears faster, a hard compound lasts longer) is
 * what the numbers are for. Pure and deterministic (isomorphic).
 */

import type { Wheels } from './telemetry.ts';

export const TYRE_COMPOUNDS = [
  'comfortHard',
  'comfortMedium',
  'comfortSoft',
  'sportHard',
  'sportMedium',
  'sportSoft',
  'racingHard',
  'racingMedium',
  'racingSoft',
  'intermediate',
  'heavyWet',
  'dirt',
] as const;

export type TyreCompound = (typeof TYRE_COMPOUNDS)[number];

export type TyreFamily = 'comfort' | 'sport' | 'racing' | 'wet' | 'dirt';

export interface CompoundInfo {
  id: TyreCompound;
  family: TyreFamily;
  /** Kilometres until the tyre is used up at a normal pace and a normal temperature (estimate). */
  lifeKm: number;
  /** Temperature range (°C) in which the compound works as it should (estimate). */
  idealC: readonly [min: number, max: number];
}

const INFO: Record<TyreCompound, CompoundInfo> = {
  comfortHard: { id: 'comfortHard', family: 'comfort', lifeKm: 260, idealC: [60, 85] },
  comfortMedium: { id: 'comfortMedium', family: 'comfort', lifeKm: 200, idealC: [60, 85] },
  comfortSoft: { id: 'comfortSoft', family: 'comfort', lifeKm: 150, idealC: [60, 85] },
  sportHard: { id: 'sportHard', family: 'sport', lifeKm: 180, idealC: [70, 95] },
  sportMedium: { id: 'sportMedium', family: 'sport', lifeKm: 130, idealC: [70, 95] },
  sportSoft: { id: 'sportSoft', family: 'sport', lifeKm: 90, idealC: [70, 95] },
  racingHard: { id: 'racingHard', family: 'racing', lifeKm: 110, idealC: [80, 105] },
  racingMedium: { id: 'racingMedium', family: 'racing', lifeKm: 70, idealC: [80, 105] },
  racingSoft: { id: 'racingSoft', family: 'racing', lifeKm: 45, idealC: [80, 105] },
  intermediate: { id: 'intermediate', family: 'wet', lifeKm: 80, idealC: [50, 80] },
  heavyWet: { id: 'heavyWet', family: 'wet', lifeKm: 90, idealC: [45, 75] },
  dirt: { id: 'dirt', family: 'dirt', lifeKm: 160, idealC: [55, 90] },
};

/** Assumed when the driver did not say which tyres are on. */
export const DEFAULT_COMPOUND: TyreCompound = 'sportMedium';

export function isTyreCompound(v: unknown): v is TyreCompound {
  return typeof v === 'string' && (TYRE_COMPOUNDS as readonly string[]).includes(v);
}

export function compoundInfo(c: TyreCompound | null | undefined): CompoundInfo {
  return INFO[c ?? DEFAULT_COMPOUND];
}

/** Share of the tyre used up at which the model says it is time to change (the rest is the cliff). */
export const WEAR_LIMIT = 0.85;
/** The load factor of a normal pace; the life of a compound is for this load. */
const NOMINAL_LOAD = 1.35;
/** Below this speed the tyre is not worn (m/s). */
const MIN_SPEED_MPS = 1;
/** Distance needed before the rate per km says anything (km). */
const MIN_RATE_KM = 1.5;

/** How much faster a tyre at `tempC` wears than at the right temperature (1 = no extra wear). */
export function tempWearFactor(tempC: number, idealC: readonly [number, number]): number {
  const [lo, hi] = idealC;
  if (!Number.isFinite(tempC)) return 1;
  if (tempC < lo) return 1 + Math.min(0.4, ((lo - tempC) / 30) * 0.4);
  if (tempC <= hi) return 1;
  const over = (tempC - hi) / 20;
  return Math.min(3.5, 1 + 1.2 * over + 0.8 * over * over);
}

export interface WheelLoadInput {
  /** Lateral g (+ = left, the car turns left: the right wheels are the outer ones). */
  gLat: number;
  /** Brake pedal 0…1. */
  brake: number;
  /** Slip ratio of each wheel (+ spin, − lock). */
  slip: Wheels;
}

/** Load on each wheel relative to a straight line at constant speed (1). FL, FR, RL, RR. */
export function wheelLoadFactors(i: WheelLoadInput): Wheels {
  const lat = Math.min(Math.abs(i.gLat), 2.5);
  const rightOuter = i.gLat > 0;
  const brake = Math.max(0, Math.min(1, i.brake));
  const out: Wheels = [1, 1, 1, 1];
  for (let w = 0; w < 4; w++) {
    const right = w === 1 || w === 3;
    const outer = right === rightOuter;
    const front = w < 2;
    const slip = Math.min(Math.abs(i.slip[w] ?? 0), 1);
    out[w] = 1 + (outer ? 0.6 : 0.1) * lat + brake * (front ? 0.6 : 0.25) + 2 * slip;
  }
  return out;
}

export interface TyreWearStep {
  /** Distance covered since the previous step (m). */
  distM: number;
  speedMps: number;
  tempC: Wheels;
  slip: Wheels;
  gLat: number;
  brake: number;
}

/** What the live panel shows. */
export interface LiveTyreWear {
  /** What the driver said is on the car; null = not said (a generic sport medium is assumed). */
  compound: TyreCompound | null;
  /** Estimated wear of each tyre: 0 new … 1 used up. */
  wear: Wheels;
  /** Worst tyre. */
  worst: number;
  /** Km driven on this set. */
  distKm: number;
  /** Wear per lap of the worst tyre at the pace so far; null while there is too little to say. */
  perLap: number | null;
  /** Laps until the worst tyre reaches `WEAR_LIMIT`; null when unknown. */
  lapsLeft: number | null;
}

export class TyreWearTracker {
  #wear: Wheels = [0, 0, 0, 0];
  #distM = 0;

  /** New tyres. */
  reset(): void {
    this.#wear = [0, 0, 0, 0];
    this.#distM = 0;
  }

  get distKm(): number {
    return this.#distM / 1000;
  }

  /** Adds one step of driving. */
  add(compound: TyreCompound | null, s: TyreWearStep): void {
    if (!(s.distM > 0) || s.speedMps < MIN_SPEED_MPS) return;
    const info = compoundInfo(compound);
    const load = wheelLoadFactors({ gLat: s.gLat, brake: s.brake, slip: s.slip });
    const km = s.distM / 1000;
    for (let w = 0; w < 4; w++) {
      const temp = tempWearFactor(s.tempC[w] ?? Number.NaN, info.idealC);
      this.#wear[w] = Math.min(
        1,
        this.#wear[w]! + (km / info.lifeKm) * temp * (load[w]! / NOMINAL_LOAD),
      );
    }
    this.#distM += s.distM;
  }

  /** The state for the frame; `lapLengthM` is the length of the lap when known. */
  snapshot(compound: TyreCompound | null, lapLengthM: number | null): LiveTyreWear {
    const worst = Math.max(...this.#wear);
    const km = this.#distM / 1000;
    let perLap: number | null = null;
    if (km >= MIN_RATE_KM && lapLengthM && lapLengthM > 0 && worst > 0) {
      perLap = (worst / km) * (lapLengthM / 1000);
    }
    const lapsLeft = perLap && perLap > 0 ? Math.max(0, (WEAR_LIMIT - worst) / perLap) : null;
    return {
      compound,
      wear: [...this.#wear] as Wheels,
      worst,
      distKm: km,
      perLap,
      lapsLeft,
    };
  }
}
