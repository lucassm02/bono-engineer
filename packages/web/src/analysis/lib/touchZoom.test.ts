import { describe, expect, it } from 'vitest';
import { MIN_ZOOM_SPAN_M, pinchRange } from './touchZoom.ts';

const FULL: [number, number] = [0, 4000];

describe('pinchRange', () => {
  it('zooms in around the fingers: the data point under them stays put', () => {
    // fingers at 25% of a 0-4000 view → anchor 1000 m
    const [min, max] = pinchRange([0, 4000], 0.25, 2, 0.25, FULL);
    expect(max - min).toBeCloseTo(2000);
    expect(min + 0.25 * (max - min)).toBeCloseTo(1000);
  });

  it('pans when the midpoint moves without changing the finger distance', () => {
    const [min, max] = pinchRange([1000, 2000], 0.5, 1, 0.25, FULL);
    expect(max - min).toBeCloseTo(1000);
    expect(min + 0.25 * (max - min)).toBeCloseTo(1500);
  });

  it('never leaves the lap and never zooms out past it', () => {
    const [a, b] = pinchRange([0, 1000], 0, 1, 1, FULL);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(4000);
    expect(pinchRange([1000, 2000], 0.5, 0.1, 0.5, FULL)).toEqual([0, 4000]);
  });

  it('keeps a minimum span and survives bad scales', () => {
    const [min, max] = pinchRange([1000, 2000], 0.5, 1e6, 0.5, FULL);
    expect(max - min).toBeCloseTo(MIN_ZOOM_SPAN_M);
    const nan = pinchRange([1000, 2000], 0.5, Number.NaN, 0.5, FULL);
    expect(nan[1] - nan[0]).toBeCloseTo(1000);
  });
});
