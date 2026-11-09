/**
 * CornerHintProvider backed by @gt7/analysis: projects the delta reference lap on the track line
 * and takes brake point / minimum speed / gear at apex / throttle pickup from the per-corner metrics (same
 * definitions as the analysis page and the AI coach). Falls back to the simple trace scan of
 * {@link TraceCornerHintProvider} when the track has no line yet or the analysis fails.
 *
 * Synchronous (the live engine calls it inside the packet loop): the reference trace comes with
 * the input and the line is built from the stored centerline (cached by the AnalysisService).
 */

import { computeCornerMetrics, computeLapMetrics, cornerWindows, prepareLap } from '@gt7/analysis';
import {
  type CornerHintInput,
  type CornerHintProvider,
  type CornerHintTargets,
  TraceCornerHintProvider,
} from '../live/corner-hints.ts';
import type { AnalysisService } from './analysis-service.ts';
import { cornersSignature } from './analysis-service.ts';
import { engineerMarks, wrapEngineerLap } from './engineer-marks.ts';
import { LruCache } from './lru.ts';

export class AnalysisCornerHintProvider implements CornerHintProvider {
  readonly #analysis: AnalysisService;
  readonly #fallback = new TraceCornerHintProvider();
  readonly #cache = new LruCache<string, Map<string, CornerHintTargets>>(16);

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
}
