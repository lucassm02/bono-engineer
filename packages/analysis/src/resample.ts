/**
 * Distance alignment: a {@link PreparedLap} resampled on a regular distance grid
 * ({@link ResampledTrace}), plus the time delta by distance between two laps.
 */

import {
  DEFAULT_RESAMPLE_STEP_M,
  type DistanceDelta,
  type LapSampleChannel,
  type ResampledTrace,
  SimulatorFlags,
  type TraceChannel,
} from '@gt7/shared';
import { fractionalIndex, movingAverage, type NumArray, valueAtIndex } from './math.ts';
import { channel, type PreparedLap, timeAtDistance } from './prepare.ts';

/** Trace channel → LapSample channel for plain interpolated channels. */
const DIRECT: Partial<Record<TraceChannel, LapSampleChannel>> = {
  speedKmh: 'speedKmh',
  throttle: 'throttle',
  brake: 'brake',
  clutch: 'clutch',
  rpm: 'rpm',
  steering: 'steeringRad',
  yawRate: 'yawRate',
  latG: 'latG',
  lonG: 'lonG',
  x: 'x',
  y: 'y',
  z: 'z',
  slipFL: 'slipFL',
  slipFR: 'slipFR',
  slipRL: 'slipRL',
  slipRR: 'slipRR',
  tyreTempFL: 'tyreTempFL',
  tyreTempFR: 'tyreTempFR',
  tyreTempRL: 'tyreTempRL',
  tyreTempRR: 'tyreTempRR',
};

/** Default channel set of {@link resampleLap}. */
export const DEFAULT_RESAMPLE_CHANNELS: readonly TraceChannel[] = [
  'timeS',
  'speedKmh',
  'throttle',
  'brake',
  'gear',
  'rpm',
  'steering',
  'yawRate',
  'latG',
  'lonG',
  'lateralOffsetM',
];

export interface ResampleOptions {
  /** Grid step (m), default {@link DEFAULT_RESAMPLE_STEP_M}. */
  stepM?: number;
  fromM?: number;
  toM?: number;
  channels?: readonly TraceChannel[];
  /** Needed for the 'deltaS' channel (subject − reference, s). */
  reference?: PreparedLap;
}

/** Builds the distance grid [fromM, toM] with the given step (last point = toM). */
export function distanceGrid(fromM: number, toM: number, stepM: number): number[] {
  const out: number[] = [];
  const span = Math.max(0, toM - fromM);
  const k = Math.max(1, Math.round(span / stepM));
  const step = span / k;
  for (let i = 0; i <= k; i++) out.push(fromM + i * step);
  return out;
}

function flagChannel(lap: PreparedLap, mask: number, fis: number[]): number[] {
  const flags = channel(lap.trace, 'flags');
  return fis.map((fi) => {
    const v = flags[Math.round(fi)]!;
    return Number.isFinite(v) ? ((v & mask) === mask ? 1 : 0) : Number.NaN;
  });
}

/** Values of one trace channel at the given distances. */
export function channelAtDistances(
  lap: PreparedLap,
  ch: TraceChannel,
  distances: readonly number[],
  reference?: PreparedLap,
): number[] {
  const fis = distances.map((d) => fractionalIndex(lap.s, d));
  switch (ch) {
    case 'timeS':
      return distances.map((d) => timeAtDistance(lap, d));
    case 'deltaS':
      if (!reference) return distances.map(() => Number.NaN);
      return distances.map((d) => timeAtDistance(lap, d) - timeAtDistance(reference, d));
    case 'gear': {
      const g = channel(lap.trace, 'gear');
      return fis.map((fi) => g[Math.floor(fi)]!);
    }
    case 'lateralOffsetM':
      return fis.map((fi) => valueAtIndex(lap.lateral, fi));
    case 'tcs':
      return flagChannel(lap, SimulatorFlags.TcsActive, fis);
    case 'asm':
      return flagChannel(lap, SimulatorFlags.AsmActive, fis);
    default: {
      const name = DIRECT[ch];
      if (!name) return distances.map(() => Number.NaN);
      const arr: NumArray = channel(lap.trace, name);
      return fis.map((fi) => valueAtIndex(arr, fi));
    }
  }
}

/** Resamples a lap on a regular distance grid (default 2 m) for the requested channels. */
export function resampleLap(lap: PreparedLap, opts: ResampleOptions = {}): ResampledTrace {
  const stepM = opts.stepM ?? DEFAULT_RESAMPLE_STEP_M;
  const fromM = Math.max(0, opts.fromM ?? 0);
  const toM = Math.min(lap.lengthM, opts.toM ?? lap.lengthM);
  const distanceM = distanceGrid(fromM, toM, stepM);
  const channels: ResampledTrace['channels'] = {};
  for (const ch of opts.channels ?? DEFAULT_RESAMPLE_CHANNELS) {
    channels[ch] = channelAtDistances(lap, ch, distanceM, opts.reference);
  }
  const realStep = distanceM.length > 1 ? distanceM[1]! - distanceM[0]! : stepM;
  return { lapId: lap.lapId, fromM, toM, stepM: realStep, distanceM, channels };
}

/**
 * Time delta between laps over a distance range: (lap time spent from→to) − (reference time spent
 * from→to). + = the lap is slower there. Distances are clamped to [0, L].
 */
export function deltaBetween(
  lap: PreparedLap,
  reference: PreparedLap,
  fromM: number,
  toM: number,
): number {
  return (
    timeAtDistance(lap, toM) -
    timeAtDistance(lap, fromM) -
    (timeAtDistance(reference, toM) - timeAtDistance(reference, fromM))
  );
}

export interface DistanceDeltaOptions {
  /** Grid step (m), default 2. */
  stepM?: number;
  /** Smoothing window of the derivative (m), default 20. */
  smoothM?: number;
}

/**
 * Cumulative delta by distance of `lap` vs `reference` (+ = lap slower) and its derivative (where
 * time is gained/lost, s per 100 m).
 */
export function computeDistanceDelta(
  lap: PreparedLap,
  reference: PreparedLap,
  opts: DistanceDeltaOptions = {},
): DistanceDelta {
  const stepM = opts.stepM ?? 2;
  const L = Math.min(lap.lengthM, reference.lengthM);
  const distanceM = distanceGrid(0, L, stepM);
  const deltaS = distanceM.map((d) => timeAtDistance(lap, d) - timeAtDistance(reference, d));
  const step = distanceM.length > 1 ? distanceM[1]! - distanceM[0]! : stepM;
  const raw = deltaS.map((_, i) => {
    const a = deltaS[Math.max(0, i - 1)]!;
    const b = deltaS[Math.min(deltaS.length - 1, i + 1)]!;
    const span = (Math.min(deltaS.length - 1, i + 1) - Math.max(0, i - 1)) * step;
    return span > 0 ? ((b - a) / span) * 100 : 0;
  });
  const win = Math.max(1, Math.round((opts.smoothM ?? 20) / step)) | 1;
  const rate = Array.from(movingAverage(raw, win, false));
  return {
    lapId: lap.lapId,
    referenceLapId: reference.lapId,
    stepM: step,
    distanceM,
    deltaS,
    rateSPer100m: rate,
    totalS: deltaS.at(-1) ?? 0,
  };
}
