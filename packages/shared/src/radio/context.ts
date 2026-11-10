/**
 * Step 1 of the decision policy: validate the inputs (phase, sample age, channels, reference)
 * and measure the free window for speech. Pure functions of the frames.
 */

import { BRAKE_ON_THRESHOLD } from '../analysis.ts';
import type { EngineerCue, LiveFrame } from '../live.ts';
import { isBrakeCue } from './cues.ts';
import type { RadioChannel, RadioPhase } from './types.ts';
import { plausibleTyreTemps } from './tyres.ts';

/** A frame older than this (or a gap this long between frames) means the signal was lost. */
export const RADIO_STALE_MS = 450;
/** More than this between two frames is a jump (reacquisition, rewind, teleport). */
export const RADIO_MAX_ADVANCE_M = 55;
/** Consumption below this per lap is not a usable sample (Sport Mode time trial burns nothing). */
export const FUEL_MIN_PER_LAP = 0.05;
/** Lateral load (g) that counts as cornering: no free window. */
export const CORNERING_G = 0.6;
/** Deceleration (m/s²) used to place the braking zone before a corner without a reference. */
export const BRAKING_DECEL = 10;
/** Free window assumed on a steady straight when the track layout is unknown. */
export const UNKNOWN_LAYOUT_WINDOW_MS = 2500;
/** Margin added to an utterance before it is considered to fit in the free window. */
export const WINDOW_MARGIN_MS = 600;

/** Why the engine cannot evaluate this frame at all, or null when it can. */
export function suspensionReason(frame: LiveFrame, sampleAgeMs: number): string | null {
  if (sampleAgeMs > RADIO_STALE_MS) return 'amostra velha';
  switch (frame.state) {
    case 'onTrack':
      break;
    case 'paused':
      return 'pausa';
    case 'replay':
      return 'replay';
    case 'menu':
      return 'fora da pista';
    default:
      return 'sem sinal';
  }
  if (frame.flags?.paused) return 'pausa';
  return null;
}

/** Signed distance advanced since the previous frame (lap wrap handled), null without distance. */
export function distanceAdvance(frame: LiveFrame, previous: LiveFrame): number | null {
  if (frame.distanceM === null || previous.distanceM === null) return null;
  const offset = frame.distanceM - previous.distanceM;
  const length = frame.track?.lengthM;
  return length ? offset - Math.round(offset / length) * length : offset;
}

/**
 * Gap or jump between consecutive frames → pending items are dropped and timing windows reset.
 * Returns the reason, or null when the frames are continuous.
 */
export function discontinuity(frame: LiveFrame, previous: LiveFrame | null): string | null {
  if (!previous) return null;
  const dt = frame.t - previous.t;
  if (dt <= 0 || dt > RADIO_STALE_MS) return 'sinal perdido';
  const advance = distanceAdvance(frame, previous);
  if (advance !== null && (advance < -0.5 || advance > RADIO_MAX_ADVANCE_M))
    return 'salto de posição';
  return null;
}

export function phaseOf(frame: LiveFrame, timedLapSeen: boolean): RadioPhase {
  const lap = frame.lap;
  if (lap.currentLapValid === undefined || !Number.isFinite(lap.lap)) return 'unknown';
  if (lap.lap <= 0) return 'outLap';
  if (lap.currentLapValid) return 'timedLap';
  return timedLapSeen ? 'untimedLap' : 'outLap';
}

export function availableChannels(frame: LiveFrame, previous: LiveFrame | null): Set<RadioChannel> {
  const channels = new Set<RadioChannel>();
  if (plausibleTyreTemps(frame.tyres?.tempC)) channels.add('tyreTemps');
  const fuel = frame.fuel;
  if (
    fuel &&
    Number.isFinite(fuel.level) &&
    fuel.capacity > 0 &&
    fuel.perLapAvg !== null &&
    fuel.perLapAvg >= FUEL_MIN_PER_LAP
  )
    channels.add('fuel');
  if (frame.lap && frame.lap.currentLapValid !== undefined) channels.add('lapTiming');
  const advance = previous ? distanceAdvance(frame, previous) : null;
  if (advance !== null && advance > 0 && advance <= RADIO_MAX_ADVANCE_M) channels.add('progress');
  if (frame.engineer?.status === 'ready') channels.add('cues');
  return channels;
}

/**
 * Time (ms) before the next point that demands attention: braking now or cornering → 0; else
 * the reference brake point, a braking cue or the next corner entry minus a braking allowance,
 * at the current speed. Unknown layout on a steady straight → UNKNOWN_LAYOUT_WINDOW_MS.
 */
export function freeWindowMs(frame: LiveFrame, cues: readonly EngineerCue[]): number {
  const car = frame.car;
  const speed = car.speedKmh / 3.6;
  if ((car.brakeRaw ?? car.brake) >= BRAKE_ON_THRESHOLD) return 0;
  if (Math.abs(frame.g?.lateral ?? 0) >= CORNERING_G) return 0;
  if (speed < 3) return Number.POSITIVE_INFINITY;
  let ahead = Number.POSITIVE_INFINITY;
  const corner = frame.nextCorner;
  if (corner) {
    ahead = corner.distanceToEntryM - (speed * speed) / (2 * BRAKING_DECEL);
    const length = frame.track?.lengthM;
    if (corner.referenceBrakePointM !== null && frame.distanceM !== null && length) {
      const toBrake =
        (((corner.referenceBrakePointM - frame.distanceM) % length) + length) % length;
      if (toBrake <= corner.distanceToEntryM) ahead = Math.min(ahead, toBrake);
    }
  }
  for (const cue of cues)
    if (isBrakeCue(cue.kind) && cue.aheadM >= 0) ahead = Math.min(ahead, cue.aheadM);
  if (!Number.isFinite(ahead)) return UNKNOWN_LAYOUT_WINDOW_MS;
  return Math.max(0, (ahead / speed) * 1000);
}
