import { getSyntheticTrack } from '@gt7/protocol';
import { describe, expect, it } from 'vitest';
import { buildCenterline, centerlineFromTrace, pointAtDistance } from './centerline.ts';
import { percentile } from './math.ts';
import { prepareLap } from './prepare.ts';
import { projectPath, projectPoint } from './projection.ts';
import { resampleLap } from './resample.ts';
import { syntheticFixture } from './test-utils.ts';

const pro = syntheticFixture('pro', 3, 1);
const track = getSyntheticTrack();
const line = centerlineFromTrace(pro.traces[1]!);

describe('centerline', () => {
  it('has the track length and a uniform ~1 m step', () => {
    expect(Math.abs(line.lengthM - track.lengthM) / track.lengthM).toBeLessThan(0.002);
    expect(line.stepM).toBeGreaterThan(0.95);
    expect(line.stepM).toBeLessThan(1.05);
    expect(line.n).toBeGreaterThan(4000);
  });

  it('has signed curvature (+ = left) matching the synthetic corners', () => {
    for (const c of track.corners) {
      const k = pointAtDistance(line, c.apexM).curvature;
      const expected = (c.direction === 'left' ? 1 : -1) / c.radiusM;
      expect(Math.sign(k)).toBe(Math.sign(expected));
      // radius within 15% (smoothing + pro line offsets)
      expect(Math.abs(1 / Math.abs(k) - c.radiusM) / c.radiusM).toBeLessThan(0.15);
    }
  });
});

describe('projection', () => {
  it('projects the pro lap onto its own line with ≈0 lateral offset and monotonic distance', () => {
    const lap = prepareLap(pro.traces[1]!, line, { lapTimeMs: pro.lapTimesMs[1] });
    const lat = Array.from(lap.lateral, Math.abs);
    expect(percentile(lat, 99)).toBeLessThan(0.3);
    for (let i = 1; i < lap.n; i++)
      expect(lap.sRaw[i]!).toBeGreaterThanOrEqual(lap.sRaw[i - 1]! - 0.01);
    expect(lap.s[0]!).toBeLessThan(2);
    expect(lap.s[lap.n - 1]!).toBeGreaterThan(line.lengthM - 2);
  });

  it('projects the pro lap onto the true track centerline within the pro line offsets', () => {
    const trackLine = buildCenterline(
      { x: track.samples.map((p) => p.x), z: track.samples.map((p) => p.z) },
      { smoothM: 1, curvatureSmoothM: 3 },
    );
    const tr = pro.traces[2]!;
    const p = projectPath(trackLine, tr.channels.x, tr.channels.z);
    expect(percentile(Array.from(p.lateralM, Math.abs), 99)).toBeLessThan(0.8);
    for (let i = 1; i < tr.length; i++) {
      expect(p.distanceM[i]!).toBeGreaterThanOrEqual(p.distanceM[i - 1]! - 0.01);
    }
  });

  it('gives signed lateral offsets (+ = left) and agrees with the global search', () => {
    for (const d of [100, 795, 1117, 2262, 4000]) {
      const pt = pointAtDistance(line, d);
      const nx = Math.cos(pt.heading);
      const nz = -Math.sin(pt.heading);
      const left = projectPoint(line, pt.x + 3 * nx, pt.z + 3 * nz);
      const right = projectPoint(line, pt.x - 3 * nx, pt.z - 3 * nz, { hint: d / line.stepM });
      expect(left.lateralM).toBeCloseTo(3, 1);
      expect(right.lateralM).toBeCloseTo(-3, 1);
      expect(Math.abs(left.distanceM - d)).toBeLessThan(0.5);
      expect(Math.abs(right.distanceM - d)).toBeLessThan(0.5);
    }
  });

  it('unwraps distance across the start/finish line', () => {
    const xs: number[] = [];
    const zs: number[] = [];
    for (let d = line.lengthM - 30; d <= line.lengthM + 30; d += 1.5) {
      const p = pointAtDistance(line, d);
      xs.push(p.x);
      zs.push(p.z);
    }
    const lapStart = projectPath(line, xs, zs);
    expect(lapStart.distanceM[0]!).toBeCloseTo(-30, 0);
    expect(lapStart.distanceM.at(-1)!).toBeCloseTo(30, 0);
    const raw = projectPath(line, xs, zs, { start: 'raw' });
    expect(raw.distanceM[0]!).toBeCloseTo(line.lengthM - 30, 0);
    expect(raw.distanceM.at(-1)!).toBeCloseTo(line.lengthM + 30, 0);
    for (let i = 1; i < xs.length; i++) {
      expect(lapStart.distanceM[i]! - lapStart.distanceM[i - 1]!).toBeCloseTo(1.5, 1);
    }
  });
});

describe('resampling', () => {
  it('resamples every channel on a 2 m grid with monotonic time', () => {
    const lap = prepareLap(pro.traces[1]!, line, { lapTimeMs: pro.lapTimesMs[1] });
    const r = resampleLap(lap);
    expect(r.stepM).toBeCloseTo(2, 1);
    expect(r.distanceM[0]).toBe(0);
    expect(r.distanceM.at(-1)).toBeCloseTo(line.lengthM, 6);
    const t = r.channels.timeS!;
    expect(t[0]).toBeCloseTo(0, 6);
    expect(t.at(-1)!).toBeCloseTo(pro.lapTimesMs[1]! / 1000, 6);
    for (let i = 1; i < t.length; i++) expect(t[i]!).toBeGreaterThan(t[i - 1]!);
    for (const values of Object.values(r.channels)) expect(values.length).toBe(r.distanceM.length);
    const speeds = r.channels.speedKmh!;
    expect(Math.max(...speeds)).toBeGreaterThan(230);
    expect(Math.min(...speeds)).toBeLessThan(70);
  });
});
