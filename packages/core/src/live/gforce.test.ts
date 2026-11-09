import type { TelemetryPacket } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { G0, GForceEstimator } from './gforce.ts';

/** Minimal packet: only the fields the estimator reads. */
function pkt(extra: Partial<TelemetryPacket>): TelemetryPacket {
  return {
    velocity: { x: 0, y: 0, z: 30 },
    rotation: { x: 0, y: 0, z: 0 },
    relativeOrientationToNorth: 1,
    ...extra,
  } as TelemetryPacket;
}

describe('GForceEstimator — B+ formats (real console units)', () => {
  it('converts sway/surge/heave from m/s² to g', () => {
    const est = new GForceEstimator();
    const g = est.update(pkt({ sway: 0, surge: G0, heave: -G0 }), 1 / 60);
    expect(g.longitudinal).toBeCloseTo(1, 6);
    expect(g.vertical).toBeCloseTo(-1, 6);
    expect(g.lateral).toBeCloseTo(0, 6);
  });

  it('negates sway: the packet is + = right, the app is + = left', () => {
    const est = new GForceEstimator();
    // Real sample from a PS5 session: steering left-positive, sway −8.44 m/s² at 111 km/h.
    const left = est.update(pkt({ sway: -8.44, surge: 3.5, heave: 2.9 }), 1 / 60);
    expect(left.lateral).toBeCloseTo(8.44 / G0, 6);
    expect(left.lateral).toBeLessThan(1.2); // a real car cannot do 8 g
    const right = est.update(pkt({ sway: 8.44, surge: 0, heave: 0 }), 1 / 60);
    expect(right.lateral).toBeCloseTo(-8.44 / G0, 6);
  });

  it('keeps vertical null when the packet has no heave', () => {
    const est = new GForceEstimator();
    const g = est.update(pkt({ sway: 1, surge: 1 }), 1 / 60);
    expect(g.vertical).toBeNull();
  });
});
