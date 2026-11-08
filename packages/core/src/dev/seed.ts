/**
 * Development/test helper: fills a runtime's store with synthetic sessions (Synthetic Ring) by
 * pushing generated packets straight into the live engine (no UDP). Optionally captures a replay
 * lap as a reference ("top do ranking"), exactly like the real capture flow.
 */

import type { DriverProfileName } from '@gt7/protocol';
import { generateLaps } from '@gt7/protocol';
import type { Id, PacketFormat } from '@gt7/shared';
import type { Gt7Runtime } from '../runtime/runtime.ts';

export interface SeedSessionSpec {
  profile: DriverProfileName;
  /** Flying laps (ignored for references: one replay lap is captured). */
  laps: number;
  seed: number;
  /** Capture one replay lap of this profile as a reference lap. */
  reference?: { driverName: string; carName?: string };
  /** Epoch ms of the first packet (default: continues after the previous session). */
  startAt?: number;
  /** Packet format (default 'B': has steering). */
  format?: PacketFormat;
  carCode?: number;
}

export interface SeedResult {
  sessions: { sessionId: Id | null; lapIds: Id[]; reference: boolean }[];
  trackId: Id | null;
  referenceLapId: Id | null;
}

const tick = () => new Promise((r) => setImmediate(r));

/** Pushes synthetic sessions through `runtime.engine` and waits for the store/analysis jobs. */
export async function seedSyntheticData(
  runtime: Gt7Runtime,
  specs: readonly SeedSessionSpec[],
): Promise<SeedResult> {
  const result: SeedResult = { sessions: [], trackId: null, referenceLapId: null };
  let clock = specs[0]?.startAt ?? Date.now() - 24 * 3600_000;
  const engine = runtime.engine;
  for (const spec of specs) {
    if (spec.startAt !== undefined) clock = spec.startAt;
    const isRef = !!spec.reference;
    const gen = generateLaps({
      profile: spec.profile,
      seed: spec.seed,
      laps: isRef ? 1 : spec.laps,
      format: spec.format ?? 'B',
      replay: isRef,
      ...(spec.carCode !== undefined ? { carCode: spec.carCode } : {}),
    });
    const lapIds: Id[] = [];
    let sessionId: Id | null = null;
    const onLap = (c: { lap: { id: Id; sessionId: Id; trackId: Id | null } }) => {
      lapIds.push(c.lap.id);
      sessionId = c.lap.sessionId;
      if (c.lap.trackId) result.trackId = c.lap.trackId;
    };
    engine.on('lapCompleted', onLap);
    if (isRef) {
      await runtime.startReferenceCapture({
        driverName: spec.reference!.driverName,
        rankingTimeMs: gen.laps[0]!.timeMs,
        ...(spec.reference!.carName ? { carName: spec.reference!.carName } : {}),
      });
    }
    for (const p of gen.packets) {
      clock += 1000 / 60;
      engine.push(p, clock);
    }
    await tick();
    engine.off('lapCompleted', onLap);
    if (isRef) {
      if (runtime.capture.active) await runtime.stopReferenceCapture(true);
      const captured = runtime.capture.status.lapId;
      if (captured) result.referenceLapId = captured;
    }
    engine.endSession();
    clock += 60_000;
    result.sessions.push({ sessionId, lapIds, reference: isRef });
    await runtime.whenAnalysisIdle();
  }
  await runtime.store.flush();
  return result;
}
