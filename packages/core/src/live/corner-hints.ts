/**
 * Next-corner hints. The live engine asks a pluggable {@link CornerHintProvider} for reference
 * targets of a corner (brake point, minimum speed, gear at apex); the analysis package can plug a
 * smarter provider later. {@link TraceCornerHintProvider} derives them from the reference trace.
 */

import {
  BRAKE_ON_THRESHOLD,
  type Corner,
  type DrivingEventModel,
  type EngineerCueKind,
  type LapTrace,
  type LiveCornerPass,
  type Track,
  type Vec2,
} from '@gt7/shared';
import type { StoredLap } from './delta-reference.ts';

export interface EngineerMark {
  kind: EngineerCueKind;
  atM: number;
  position: Vec2;
  brakePeak?: number;
  untilM?: number;
  endPosition?: Vec2;
}

export interface CornerHintTargets {
  referenceBrakePointM: number | null;
  referenceMinSpeedKmh: number | null;
  referenceGearAtApex: number | null;
  /** Throttle pickup distance of the reference in this corner (m), when known. */
  referenceThrottleOnM?: number | null;
  engineerMarks?: readonly EngineerMark[];
}

export interface CornerHintInput {
  track: Track;
  corner: Corner;
  /** Current delta reference lap (null if none). */
  reference: StoredLap | null;
}

/** A corner pass just completed in the current lap (live review). */
export interface CornerPassInput {
  track: Track;
  corner: Corner;
  /** Compatible engineer reference (same track and car, valid), null when there is none. */
  reference: StoredLap | null;
  /** Samples of the current lap so far (lap distance from the start line). */
  trace: LapTrace;
  /** Driving-event response model of this car (calibrated on an earlier lap), null = none yet. */
  model: DrivingEventModel | null;
}

/** What the provider measured on the pass; the engine adds id, lap, reference and distance. */
export type CornerPassReview = Omit<
  LiveCornerPass,
  'id' | 'lap' | 'lapStartedAt' | 'referenceLapId' | 'atM'
>;

export interface CornerHintProvider {
  /** Called once per (track, corner, reference lap); results are cached by the engine. */
  targetsFor(input: CornerHintInput): CornerHintTargets | null;
  /**
   * Reviews a corner pass ~80 m after its exit (cause vs the reference, driving event). Optional:
   * without it the live frames carry no corner passes.
   */
  reviewPass?(input: CornerPassInput): CornerPassReview | null;
  /** Calibrates the driving-event model of a car from one of its stored laps. */
  calibrateEvents?(input: { track: Track; lap: StoredLap }): DrivingEventModel | null;
}

/** Look-back distance before the corner entry searched for the brake point (m). */
const BRAKE_SEARCH_M = 300;

export class TraceCornerHintProvider implements CornerHintProvider {
  targetsFor({ track, corner, reference }: CornerHintInput): CornerHintTargets | null {
    if (!reference || reference.trace.length === 0) return null;
    const tr = reference.trace;
    const d = tr.channels.distanceM;
    const brake = tr.channels.brake;
    const speed = tr.channels.speedKmh;
    const gear = tr.channels.gear;
    const L = track.lengthM;
    const inRange = (di: number, from: number, to: number) => {
      if (from < 0) return di >= from + L || di <= to;
      return di >= from && di <= to;
    };
    let minV = Number.POSITIVE_INFINITY;
    let minI = -1;
    for (let i = 0; i < tr.length; i++) {
      const di = Number(d[i]);
      if (di >= corner.entryM && di <= corner.exitM && Number(speed[i]) < minV) {
        minV = Number(speed[i]);
        minI = i;
      }
    }
    // brake point: first sample above threshold in [entry − 300, apex] after a brake-off sample
    let brakePoint: number | null = null;
    let wasOff = false;
    const from = corner.entryM - BRAKE_SEARCH_M;
    for (let i = 0; i < tr.length; i++) {
      const di = Number(d[i]);
      if (!inRange(di, from, corner.apexM)) continue;
      const on = Number(brake[i]) > BRAKE_ON_THRESHOLD;
      if (!on) wasOff = true;
      else if (wasOff && brakePoint === null) {
        brakePoint = di;
        break;
      }
    }
    return {
      referenceBrakePointM: brakePoint,
      referenceMinSpeedKmh: minI >= 0 ? minV : null,
      referenceGearAtApex: minI >= 0 ? Number(gear[minI]) : null,
    };
  }
}
