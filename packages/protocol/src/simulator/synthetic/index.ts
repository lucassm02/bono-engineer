/** Synthetic telemetry generator (Synthetic Ring + driver profiles). */

import type { TelemetryPacket } from '@gt7/shared';
import { type CompletedLapInfo, type SyntheticOptions, SyntheticSession } from './session.ts';
import type { SyntheticTrack } from './track.ts';

export { CAR, DRIVER_PROFILES, type DriverProfile, type DriverProfileName } from './model.ts';
export { Rng } from './rng.ts';
export {
  type CompletedLapInfo,
  type SyntheticOptions,
  type SyntheticPhase,
  SyntheticSession,
  stripToFormat,
} from './session.ts';
export {
  getSyntheticTrack,
  type SyntheticCorner,
  type SyntheticTrack,
  sampleTrackAt,
  type TrackSample,
} from './track.ts';

export interface GenerateLapsOptions extends SyntheticOptions {
  /** Number of complete flying laps (default 3). */
  laps?: number;
  /** Include menu/loading packets at the start (default false here). */
  includeMenu?: boolean;
}

export interface GeneratedSession {
  packets: TelemetryPacket[];
  laps: CompletedLapInfo[];
  track: SyntheticTrack;
}

/**
 * Pure function: generates an out lap followed by `laps` complete laps as packets at 60 Hz.
 * The last packet is the first one after the final lap closed (lapCount = laps + 1; with
 * `replay: true` the packets keep lapCount 1, like the real console in a replay).
 */
export function generateLaps(opts: GenerateLapsOptions = {}): GeneratedSession {
  const laps = opts.laps ?? 3;
  const session = new SyntheticSession({ includeMenu: false, ...opts });
  const packets: TelemetryPacket[] = [];
  // safety cap: 10 minutes per lap
  const cap = (laps + 1) * 600 * session.options.rateHz + 10_000;
  while (packets.length < cap) {
    const p = session.next();
    packets.push(p);
    if (session.lapCount > laps) break; // (a replay's packets keep lapCount at 1)
  }
  return { packets, laps: [...session.completedLaps], track: session.track };
}
