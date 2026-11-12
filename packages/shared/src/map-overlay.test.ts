import { describe, expect, it } from 'vitest';
import {
  lateralDifference,
  lateralMarkers,
  lateralSide,
  rampFraction,
  seriesRange,
} from './map-overlay.ts';

describe('lateralDifference', () => {
  it('is zero for the same line and null where an offset is missing', () => {
    const a = [0.5, 1, null, 2];
    expect(lateralDifference(a, a)).toEqual([0, 0, null, 0]);
    expect(lateralDifference([1, 2, 3], [0.5, null, 5])).toEqual([0.5, null, -2]);
  });

  it('uses the shorter length', () => {
    expect(lateralDifference([1, 2, 3], [1])).toEqual([0]);
  });
});

describe('lateralMarkers', () => {
  const d = Array.from({ length: 101 }, (_, i) => i * 10);

  it('finds the peaks of the difference above the floor, strongest first by spacing', () => {
    // two bumps: +4 m around 200 m and −3 m around 700 m, small noise elsewhere
    const diff = d.map(
      (m) =>
        Math.max(0, 4 - Math.abs(m - 200) / 15) - Math.max(0, 3 - Math.abs(m - 700) / 15) + 0.1,
    );
    const marks = lateralMarkers(d, diff);
    expect(marks.map((m) => m.distanceM)).toEqual([200, 700]);
    expect(marks[0]!.diffM).toBeGreaterThan(3.5);
    expect(marks[1]!.diffM).toBeLessThan(-2.5);
  });

  it('ignores small differences and keeps markers apart', () => {
    expect(
      lateralMarkers(
        d,
        d.map(() => 1.5),
      ),
    ).toEqual([]);
    const wide = d.map((m) => (m === 300 || m === 340 ? 5 : 0));
    expect(lateralMarkers(d, wide, { minGapM: 60 })).toHaveLength(1);
    expect(lateralMarkers(d, wide, { minGapM: 20 })).toHaveLength(2);
  });

  it('is limited to the requested number, in track order', () => {
    const diff = d.map((m) => (m % 100 === 0 ? 3 + (m % 7) : 0));
    const marks = lateralMarkers(d, diff, { max: 3 });
    expect(marks).toHaveLength(3);
    expect(marks.map((m) => m.distanceM)).toEqual(
      [...marks.map((m) => m.distanceM)].sort((a, b) => a - b),
    );
  });
});

describe('lateralSide', () => {
  it('names the side and rounds to a tenth of a metre', () => {
    expect(lateralSide(3.24)).toEqual({ meters: 3.2, side: 'left' });
    expect(lateralSide(-1.26)).toEqual({ meters: 1.3, side: 'right' });
  });
});

describe('ramps', () => {
  it('scales a value between lo and hi, clamped', () => {
    expect(rampFraction(50, 0, 100)).toBe(0.5);
    expect(rampFraction(-5, 0, 100)).toBe(0);
    expect(rampFraction(500, 0, 100)).toBe(1);
    expect(rampFraction(null, 0, 100)).toBeNull();
    expect(rampFraction(5, 10, 10)).toBeNull();
  });

  it('takes the 2nd–98th percentile as the range, ignoring gaps', () => {
    const speeds = [null, ...Array.from({ length: 101 }, (_, i) => 100 + i), Number.NaN];
    expect(seriesRange(speeds)).toEqual([102, 198]);
    expect(seriesRange([null, undefined])).toBeNull();
  });
});
