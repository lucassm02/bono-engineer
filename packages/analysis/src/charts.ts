/**
 * Chart data helpers (pure): series vs distance for one corner or the full lap, downsampled to a
 * bounded number of points. Rendering (SVG/PNG/uPlot) is up to the consumer (mcp/web).
 */

import { type Corner, EXIT_SPEED_OFFSET_M, type Id, type TraceChannel } from '@gt7/shared';
import { round } from './math.ts';
import type { PreparedLap } from './prepare.ts';
import { channelAtDistances, distanceGrid } from './resample.ts';

export type ChartChannel = Extract<
  TraceChannel,
  | 'speedKmh'
  | 'throttle'
  | 'brake'
  | 'gear'
  | 'steering'
  | 'deltaS'
  | 'rpm'
  | 'latG'
  | 'lonG'
  | 'yawRate'
  | 'lateralOffsetM'
  | 'timeS'
>;

const UNITS: Record<ChartChannel, { unit: string; label: string; digits: number }> = {
  speedKmh: { unit: 'km/h', label: 'Velocidade', digits: 1 },
  throttle: { unit: '%', label: 'Acelerador', digits: 0 },
  brake: { unit: '%', label: 'Freio', digits: 0 },
  gear: { unit: '', label: 'Marcha', digits: 0 },
  steering: { unit: 'rad', label: 'Volante', digits: 3 },
  deltaS: { unit: 's', label: 'Delta', digits: 3 },
  rpm: { unit: 'rpm', label: 'RPM', digits: 0 },
  latG: { unit: 'g', label: 'G lateral', digits: 2 },
  lonG: { unit: 'g', label: 'G longitudinal', digits: 2 },
  yawRate: { unit: 'rad/s', label: 'Guinada', digits: 3 },
  lateralOffsetM: { unit: 'm', label: 'Desvio lateral', digits: 2 },
  timeS: { unit: 's', label: 'Tempo', digits: 3 },
};

export interface ChartSeries {
  lapId: Id;
  channel: ChartChannel;
  unit: string;
  label: string;
  /** Same length as ChartData.distanceM; null where unavailable. Pedals in %. */
  values: (number | null)[];
}

export interface ChartData {
  fromM: number;
  toM: number;
  stepM: number;
  distanceM: number[];
  series: ChartSeries[];
  /** Vertical markers (corner entry/apex/exit, brake points). */
  markers: { label: string; distanceM: number; lapId?: Id }[];
}

export interface ChartOptions {
  channels?: readonly ChartChannel[];
  fromM?: number;
  toM?: number;
  /** Restrict to a corner: [entry − brakeMarginM, exit + EXIT_SPEED_OFFSET_M]. */
  corner?: Corner;
  /** Distance before the corner entry included (m), default 200. */
  brakeMarginM?: number;
  /** Max points per series (default 400). */
  maxPoints?: number;
  /** Minimum step (m), default 1. */
  minStepM?: number;
  /** Index of the reference lap for 'deltaS' (default 0: the first lap). */
  referenceIndex?: number;
  /** Corners whose entry/apex/exit become markers (full-lap charts). */
  corners?: readonly Corner[];
}

/** Builds downsampled chart series for one or more laps (first lap = delta reference). */
export function buildChartData(laps: readonly PreparedLap[], opts: ChartOptions = {}): ChartData {
  if (laps.length === 0) throw new Error('buildChartData: no laps');
  const L = Math.min(...laps.map((l) => l.lengthM));
  const channels = opts.channels ?? ['speedKmh', 'throttle', 'brake', 'gear', 'steering', 'deltaS'];
  let fromM = opts.fromM ?? 0;
  let toM = opts.toM ?? L;
  if (opts.corner) {
    fromM = opts.corner.entryM - (opts.brakeMarginM ?? 200);
    toM = opts.corner.exitM + EXIT_SPEED_OFFSET_M;
  }
  fromM = Math.max(0, fromM);
  toM = Math.min(L, Math.max(fromM + 1, toM));
  const maxPoints = Math.max(10, opts.maxPoints ?? 400);
  const step = Math.max(opts.minStepM ?? 1, (toM - fromM) / (maxPoints - 1));
  const distanceM = distanceGrid(fromM, toM, step);
  const ref = laps[opts.referenceIndex ?? 0]!;

  const series: ChartSeries[] = [];
  for (const lap of laps) {
    for (const ch of channels) {
      if (ch === 'steering' && !lap.hasSteering) continue;
      const spec = UNITS[ch];
      const raw = channelAtDistances(lap, ch, distanceM, ref);
      const scale = ch === 'throttle' || ch === 'brake' ? 100 : 1;
      series.push({
        lapId: lap.lapId,
        channel: ch,
        unit: spec.unit,
        label: spec.label,
        values: raw.map((v) => round(v * scale, spec.digits)),
      });
    }
  }

  const markers: ChartData['markers'] = [];
  const cs = opts.corner ? [opts.corner] : (opts.corners ?? []);
  for (const c of cs) {
    for (const [label, d] of [
      [`${c.id} entrada`, c.entryM],
      [`${c.id} ápice`, c.apexM],
      [`${c.id} saída`, c.exitM],
    ] as const) {
      if (d >= fromM && d <= toM) markers.push({ label, distanceM: round(d, 1)! });
    }
  }
  const realStep = distanceM.length > 1 ? distanceM[1]! - distanceM[0]! : step;
  return {
    fromM,
    toM,
    stepM: round(realStep, 3)!,
    distanceM: distanceM.map((d) => round(d, 1)!),
    series,
    markers,
  };
}
