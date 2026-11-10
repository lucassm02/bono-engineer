/**
 * CornerHintProvider backed by @gt7/analysis: projects the delta reference lap on the track line
 * and takes brake point / minimum speed / gear at apex / throttle pickup from the per-corner metrics (same
 * definitions as the analysis page and the AI coach). Falls back to the simple trace scan of
 * {@link TraceCornerHintProvider} when the track has no line yet or the analysis fails.
 *
 * Synchronous (the live engine calls it inside the packet loop): the reference trace comes with
 * the input and the line is built from the stored centerline (cached by the AnalysisService).
 */

import {
  computeCornerMetrics,
  computeLapMetrics,
  cornerWindows,
  type PreparedLap,
  prepareLap,
} from '@gt7/analysis';
import type { DrivingEventModel, Track } from '@gt7/shared';
import {
  type CornerHintInput,
  type CornerHintProvider,
  type CornerHintTargets,
  type CornerPassInput,
  type CornerPassReview,
  TraceCornerHintProvider,
} from '../live/corner-hints.ts';
import type { StoredLap } from '../live/delta-reference.ts';
import type { AnalysisService, LineEntry } from './analysis-service.ts';
import { cornersSignature } from './analysis-service.ts';
import { reviewCornerPass } from './corner-pass-review.ts';
import { calibrateDrivingEventModel } from './driving-events.ts';
import { engineerMarks, wrapEngineerLap } from './engineer-marks.ts';
import { LruCache } from './lru.ts';

export class AnalysisCornerHintProvider implements CornerHintProvider {
  readonly #analysis: AnalysisService;
  readonly #fallback = new TraceCornerHintProvider();
  readonly #cache = new LruCache<string, Map<string, CornerHintTargets>>(16);
  readonly #prepared = new LruCache<string, PreparedLap>(4);

  constructor(analysis: AnalysisService) {
    this.#analysis = analysis;
  }

  targetsFor(input: CornerHintInput): CornerHintTargets | null {
    const { track, corner, reference } = input;
    if (!reference || reference.trace.length < 10) return null;
    try {
      const line = this.#analysis.getLine(track.id);
      if (!line) return this.#fallback.targetsFor(input);
      const corners = [...track.corners].sort((a, b) => a.entryM - b.entryM);
      const key = `${reference.lap.id}|${line.key}|${cornersSignature(corners)}`;
      let byCorner = this.#cache.get(key);
      if (!byCorner) {
        const lap = prepareLap(reference.trace, line.line, {
          lapTimeMs: reference.lap.timeMs,
          isReplay: reference.lap.flags.includes('replay'),
        });
        const windows = cornerWindows(corners, lap.lengthM);
        const radioLap = wrapEngineerLap(lap);
        byCorner = new Map(
          computeLapMetrics(lap, corners).map((m, i) => [
            m.cornerId,
            {
              referenceBrakePointM: m.brakePointM,
              referenceMinSpeedKmh: Number.isFinite(m.minSpeedKmh) ? m.minSpeedKmh : null,
              referenceGearAtApex: Number.isFinite(m.gearAtApex) ? m.gearAtApex : null,
              referenceThrottleOnM:
                m.throttlePickupM !== null && Number.isFinite(m.throttlePickupM)
                  ? m.throttlePickupM
                  : null,
              engineerMarks: engineerMarks(
                radioLap,
                radioLap !== lap &&
                  (windows[i]!.brakeFromM < 0 || corners[i]!.exitM + 150 > lap.lengthM)
                  ? computeCornerMetrics(radioLap, windows[i]!)
                  : m,
                corners[i]!.exitM,
              ),
            },
          ]),
        );
        this.#cache.set(key, byCorner);
      }
      return byCorner.get(corner.id) ?? this.#fallback.targetsFor(input);
    } catch {
      return this.#fallback.targetsFor(input);
    }
  }

  /** Stored lap prepared on the track line (cached per lap and line). */
  #preparedStored(stored: StoredLap, line: LineEntry): PreparedLap {
    const key = `${stored.lap.id}|${line.key}`;
    let lap = this.#prepared.get(key);
    if (!lap) {
      lap = prepareLap(stored.trace, line.line, {
        lapTimeMs: stored.lap.timeMs,
        isReplay: stored.lap.flags.includes('replay'),
      });
      this.#prepared.set(key, lap);
    }
    return lap;
  }

  reviewPass(input: CornerPassInput): CornerPassReview | null {
    const { track, corner, reference, trace, model } = input;
    if (trace.length < 30) return null;
    try {
      const line = this.#analysis.getLine(track.id);
      if (!line) return null;
      const pass = prepareLap(trace, line.line);
      const ref =
        reference && reference.trace.length >= 10 ? this.#preparedStored(reference, line) : null;
      return reviewCornerPass(pass, ref, track.corners, corner.id, { model });
    } catch {
      return null;
    }
  }

  calibrateEvents({ track, lap }: { track: Track; lap: StoredLap }): DrivingEventModel | null {
    if (lap.trace.length < 10) return null;
    try {
      const line = this.#analysis.getLine(track.id);
      return line ? calibrateDrivingEventModel(this.#preparedStored(lap, line)) : null;
    } catch {
      return null;
    }
  }
}
