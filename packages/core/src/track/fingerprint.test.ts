import type { TrackFingerprint } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { compareFingerprints, SHAPE_POINTS, SHAPE_VERSION } from './fingerprint.ts';

function fp(shape: number[]): TrackFingerprint {
  return {
    start: { x: 144, z: 305 },
    startHeadingRad: 1.47,
    lengthM: 5345,
    bbox: { min: { x: -900, z: -400 }, max: { x: 950, z: 370 } },
    shape,
    shapeVersion: SHAPE_VERSION,
  };
}

/** A smooth running sum of heading changes along a lap. */
const base = Array.from({ length: SHAPE_POINTS }, (_, i) => Math.sin(i / 7) * 2 + i * 0.05);

describe('compareFingerprints: the shape signature', () => {
  it('matches the same circuit when one lap gained a whole turn at a hairpin (+2π from there on)', () => {
    // seen on two real laps of Trial Mountain: the second differed by a constant -6.27 rad after
    // the first hairpin and a second "track" was created
    const turned = base.map((v, i) => (i >= 16 ? v + 2 * Math.PI : v));
    const c = compareFingerprints(fp(base), fp(turned));
    expect(c.shapeRmsRad).toBeLessThan(0.01);
    expect(c.match).toBe(true);
  });

  it('still tells another circuit apart', () => {
    const other = base.map((v, i) => v + Math.cos(i / 3) * 1.2);
    const c = compareFingerprints(fp(base), fp(other));
    expect(c.shapeRmsRad).toBeGreaterThan(0.3);
    expect(c.match).toBe(false);
  });
});
