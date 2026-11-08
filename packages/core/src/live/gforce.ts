/**
 * G-force estimation in the car frame (lateral + = left, longitudinal + = accelerating).
 *
 * - B+ formats: uses the packet's sway/surge/heave directly (unit assumed g, unverified on the
 *   real console; the synthetic generator emits g).
 * - Otherwise: derivative of the world velocity rotated into the car frame (forward vector from
 *   the rotation quaternion, falling back to the velocity direction), exponentially smoothed.
 */

import type { LiveGForce, TelemetryPacket, Vec3 } from '@gt7/shared';
import { emaAlpha } from '../util/math.ts';

export const G0 = 9.81;

/** Unit forward vector (x, z) of the car from the rotation quaternion (w = orientation to north). */
export function forwardFromRotation(
  p: Pick<TelemetryPacket, 'rotation' | 'relativeOrientationToNorth'>,
): {
  x: number;
  z: number;
} {
  const { x, y, z } = p.rotation;
  const w = p.relativeOrientationToNorth;
  const fx = 2 * (x * z + w * y);
  const fz = 1 - 2 * (x * x + y * y);
  const n = Math.hypot(fx, fz);
  return n > 1e-6 ? { x: fx / n, z: fz / n } : { x: 0, z: 1 };
}

/** Heading in radians, atan2(dx, dz): from the velocity when moving, else from the rotation. */
export function headingOf(
  p: Pick<TelemetryPacket, 'velocity' | 'rotation' | 'relativeOrientationToNorth'>,
): number {
  const v = p.velocity;
  if (Math.hypot(v.x, v.z) > 1.5) return Math.atan2(v.x, v.z);
  const f = forwardFromRotation(p);
  return Math.atan2(f.x, f.z);
}

export class GForceEstimator {
  #prevV: Vec3 | null = null;
  #lat = 0;
  #lon = 0;
  #vert = 0;
  readonly tauS: number;

  constructor(tauS = 0.08) {
    this.tauS = tauS;
  }

  reset(): void {
    this.#prevV = null;
    this.#lat = 0;
    this.#lon = 0;
    this.#vert = 0;
  }

  /** Updates with a packet; dtS = time since the previous packet (from packetId deltas). */
  update(p: TelemetryPacket, dtS: number): LiveGForce {
    if (p.sway !== undefined && p.surge !== undefined) {
      this.#prevV = p.velocity;
      this.#lat = p.sway;
      this.#lon = p.surge;
      this.#vert = p.heave ?? 0;
      return { lateral: this.#lat, longitudinal: this.#lon, vertical: p.heave ?? null };
    }
    const prev = this.#prevV;
    this.#prevV = p.velocity;
    if (prev && dtS > 0 && dtS < 0.25) {
      const ax = (p.velocity.x - prev.x) / dtS;
      const ay = (p.velocity.y - prev.y) / dtS;
      const az = (p.velocity.z - prev.z) / dtS;
      const speed = Math.hypot(p.velocity.x, p.velocity.z);
      const f =
        speed > 1.5 ? { x: p.velocity.x / speed, z: p.velocity.z / speed } : forwardFromRotation(p);
      // left = (fz, −fx)
      const lat = (ax * f.z - az * f.x) / G0;
      const lon = (ax * f.x + az * f.z) / G0;
      const vert = ay / G0;
      const a = emaAlpha(dtS, this.tauS);
      this.#lat += (lat - this.#lat) * a;
      this.#lon += (lon - this.#lon) * a;
      this.#vert += (vert - this.#vert) * a;
    }
    return { lateral: this.#lat, longitudinal: this.#lon, vertical: this.#vert };
  }
}
