/**
 * Lap preparation: projects every sample of a {@link LapTrace} onto the reference line (aligned
 * distance + lateral offset) and builds a time-vs-distance table anchored at t(0) = 0 and
 * t(L) = lap time. Every other analysis function consumes a {@link PreparedLap}.
 */

import type { Id, LapSampleChannel, LapTrace } from '@gt7/shared';
import type { Centerline } from './centerline.ts';
import { fractionalIndex, type NumArray, valueAtIndex } from './math.ts';
import { projectPath } from './projection.ts';

export interface PreparedLap {
  lapId: Id;
  trace: LapTrace;
  /** Captured from a replay (smoothed inputs; precision of a few meters). */
  isReplay: boolean;
  /** Reference line length (m). */
  lengthM: number;
  /** Lap time (s): the given lap time, or extrapolated from the samples. */
  lapTimeS: number;
  /** Number of samples. */
  n: number;
  /** Aligned distance per sample (m), unwrapped and made non-decreasing. */
  s: Float64Array;
  /** Raw unwrapped projection distance (may decrease on noise / reversing). */
  sRaw: Float64Array;
  /** Time per sample (s) on the lap clock where t(distance 0) = 0. */
  t: Float64Array;
  /** Lateral offset per sample vs the reference line (m, + = left). */
  lateral: Float64Array;
  /** Distance to the reference line per sample (m). */
  distToLine: Float64Array;
  /** True when the trace has a steering channel (B+ formats). */
  hasSteering: boolean;
  /** Time-at-distance table on a fine regular grid (0..lengthM). */
  timeGrid: { stepM: number; timeS: Float64Array };
  /** Lap time extrapolated from the samples alone (s), for validity checks. */
  sampleLapTimeS: number;
  warnings: string[];
}

export interface PrepareLapOptions {
  /** Official lap time (ms). When given, times are scaled so that t(L) equals it exactly. */
  lapTimeMs?: number | null;
  /** Mark the lap as a replay capture. */
  isReplay?: boolean;
  /** Step of the internal time-vs-distance table (m), default 1. */
  timeGridStepM?: number;
}

/** Reads a channel of a trace as an array (NaN-filled when missing). */
export function channel(trace: LapTrace, name: LapSampleChannel): NumArray {
  const c = trace.channels[name] as NumArray | undefined;
  if (c && c.length === trace.length) return c;
  return new Float64Array(trace.length).fill(Number.NaN);
}

function hasFinite(a: NumArray): boolean {
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]!)) return true;
  return false;
}

/** Projects the lap onto the line and builds its distance/time tables. */
export function prepareLap(
  trace: LapTrace,
  line: Centerline,
  opts: PrepareLapOptions = {},
): PreparedLap {
  const n = trace.length;
  if (n < 10) throw new Error(`prepareLap: lap ${trace.lapId} has too few samples (${n})`);
  const warnings: string[] = [];
  const L = line.lengthM;
  const proj = projectPath(line, channel(trace, 'x'), channel(trace, 'z'));
  const sRaw = proj.distanceM;
  const s = new Float64Array(n);
  let maxS = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const v = sRaw[i]!;
    if (Number.isFinite(v) && v > maxS) maxS = v;
    s[i] = maxS;
  }
  // leading NaNs (no position) → first finite value
  const firstFinite = s.findIndex((v) => Number.isFinite(v));
  if (firstFinite < 0) throw new Error(`prepareLap: lap ${trace.lapId} has no positions`);
  for (let i = 0; i < firstFinite; i++) s[i] = s[firstFinite]!;

  const tMs = channel(trace, 'tMs');
  const speed = channel(trace, 'speedKmh');
  const tRaw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = tMs[i]!;
    tRaw[i] = Number.isFinite(v) ? v / 1000 : i / (trace.sampleRateHz || 60);
  }

  // time at distance d (unshifted clock), extrapolating at the ends with the local speed
  const vAt = (i: number) => Math.max(1, (speed[i]! || 0) / 3.6);
  const timeAt = (d: number): number => {
    if (d <= s[0]!) return tRaw[0]! - (s[0]! - d) / vAt(0);
    if (d >= s[n - 1]!) return tRaw[n - 1]! + (d - s[n - 1]!) / vAt(n - 1);
    return valueAtIndex(tRaw, fractionalIndex(s, d));
  };
  const gridStep = opts.timeGridStepM ?? 1;
  const gn = Math.max(2, Math.round(L / gridStep) + 1);
  const gstep = L / (gn - 1);
  const timeS = new Float64Array(gn);
  for (let k = 0; k < gn; k++) timeS[k] = timeAt(k * gstep);
  const t0 = timeS[0]!;
  for (let k = 0; k < gn; k++) timeS[k] = timeS[k]! - t0;
  const sampleLapTimeS = timeS[gn - 1]!;
  let lapTimeS = sampleLapTimeS;
  let scale = 1;
  if (opts.lapTimeMs != null && opts.lapTimeMs > 0) {
    lapTimeS = opts.lapTimeMs / 1000;
    if (Math.abs(lapTimeS - sampleLapTimeS) > 0.1) {
      warnings.push(
        `lap ${trace.lapId}: official lap time ${lapTimeS.toFixed(3)} s differs from samples ` +
          `${sampleLapTimeS.toFixed(3)} s`,
      );
    }
    scale = sampleLapTimeS > 0 ? lapTimeS / sampleLapTimeS : 1;
    for (let k = 0; k < gn; k++) timeS[k] = timeS[k]! * scale;
  }
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) t[i] = (tRaw[i]! - t0) * scale;

  if (s[0]! > 30)
    warnings.push(`lap ${trace.lapId}: data starts ${s[0]!.toFixed(0)} m after the line`);
  if (s[n - 1]! < L - 30) {
    warnings.push(`lap ${trace.lapId}: data ends ${(L - s[n - 1]!).toFixed(0)} m before the line`);
  }

  return {
    lapId: trace.lapId,
    trace,
    isReplay: opts.isReplay ?? false,
    lengthM: L,
    lapTimeS,
    n,
    s,
    sRaw,
    t,
    lateral: proj.lateralM,
    distToLine: proj.distToLineM,
    hasSteering: hasFinite(channel(trace, 'steeringRad')),
    timeGrid: { stepM: gstep, timeS },
    sampleLapTimeS,
    warnings,
  };
}

/** Lap clock time (s) at aligned distance d (clamped to [0, L]). */
export function timeAtDistance(lap: PreparedLap, d: number): number {
  const g = lap.timeGrid;
  const f = Math.min(Math.max(d, 0), lap.lengthM) / g.stepM;
  return valueAtIndex(g.timeS, f);
}

/** Fractional sample index at aligned distance d. */
export function indexAtDistance(lap: PreparedLap, d: number): number {
  return fractionalIndex(lap.s, d);
}

/** First sample index with s ≥ d (clamped to [0, n−1]). */
export function sampleAtOrAfter(lap: PreparedLap, d: number): number {
  return Math.min(lap.n - 1, Math.ceil(fractionalIndex(lap.s, d)));
}

/** Linear interpolation of a trace channel at aligned distance d. */
export function valueAtDistance(lap: PreparedLap, name: LapSampleChannel, d: number): number {
  return valueAtIndex(channel(lap.trace, name), fractionalIndex(lap.s, d));
}

/** Lateral offset (m) at aligned distance d. */
export function lateralAtDistance(lap: PreparedLap, d: number): number {
  return valueAtIndex(lap.lateral, fractionalIndex(lap.s, d));
}
