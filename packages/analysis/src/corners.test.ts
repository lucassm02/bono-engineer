import { describe, expect, it } from 'vitest';
import { centerlineFromTrace } from './centerline.ts';
import { detectCorners } from './corners.ts';
import { prepareLap } from './prepare.ts';
import { computeDistanceDelta, deltaBetween } from './resample.ts';
import { syntheticFixture } from './test-utils.ts';

const pro = syntheticFixture('pro', 3, 1);
const am = syntheticFixture('amateur', 4, 1);
const gt = pro.session.track.corners;
const line = centerlineFromTrace(pro.traces[1]!);
const ref = prepareLap(pro.traces[1]!, line, { lapTimeMs: pro.lapTimesMs[1] });

function matchQuality(corners: ReturnType<typeof detectCorners>) {
  const apexErr = corners.map((c, i) => Math.abs(c.apexM - gt[i]!.apexM));
  const entryErr = corners.map((c, i) => Math.abs(c.entryM - gt[i]!.entryM));
  const exitErr = corners.map((c, i) => Math.abs(c.exitM - gt[i]!.exitM));
  return {
    maxApex: Math.max(...apexErr),
    meanApex: apexErr.reduce((a, b) => a + b, 0) / apexErr.length,
    maxEntry: Math.max(...entryErr),
    maxExit: Math.max(...exitErr),
  };
}

describe('corner detection', () => {
  it('recovers the 10 synthetic ground-truth corners from the reference lap', () => {
    const corners = detectCorners(line, { reference: ref });
    expect(corners.map((c) => c.id)).toEqual(gt.map((c) => c.id));
    corners.forEach((c, i) => {
      const g = gt[i]!;
      expect(c.direction).toBe(g.direction);
      expect(c.kind).toBe(g.kind);
      expect(c.entryM).toBeLessThan(c.apexM);
      expect(c.apexM).toBeLessThan(c.exitM);
      expect(Math.abs((c.minRadiusM ?? 0) - g.radiusM) / g.radiusM).toBeLessThan(0.15);
    });
    const q = matchQuality(corners);
    console.info(
      `[corners] apex error max ${q.maxApex.toFixed(1)} m, mean ${q.meanApex.toFixed(1)} m; ` +
        `entry max ${q.maxEntry.toFixed(1)} m; exit max ${q.maxExit.toFixed(1)} m`,
    );
    expect(q.maxApex).toBeLessThan(5); // requirement: 30 m
    expect(q.maxEntry).toBeLessThan(20);
    expect(q.maxExit).toBeLessThan(20);
  });

  it('works from geometry only and from an amateur lap line', () => {
    const geo = detectCorners(line);
    expect(geo.length).toBe(10);
    expect(matchQuality(geo).maxApex).toBeLessThan(5);
    const amLine = centerlineFromTrace(am.traces[2]!);
    const amCorners = detectCorners(amLine);
    expect(amCorners.length).toBe(10);
    expect(matchQuality(amCorners).maxApex).toBeLessThan(15);
    expect(amCorners.map((c) => c.direction)).toEqual(gt.map((c) => c.direction));
  });

  it('is robust across seeds and to a replay-smoothed reference', () => {
    for (const [profile, seed, replay] of [
      ['pro', 5, false],
      ['amateur', 9, false],
      ['pro', 3, true],
    ] as const) {
      const fx = syntheticFixture(profile, 2, seed, replay);
      const l = centerlineFromTrace(fx.traces[1]!);
      const r = prepareLap(fx.traces[1]!, l, { lapTimeMs: fx.lapTimesMs[1], isReplay: replay });
      const cs = detectCorners(l, { reference: r });
      expect(cs.length).toBe(10);
      expect(matchQuality(cs).maxApex).toBeLessThan(15);
      expect(cs.map((c) => c.kind)).toEqual(gt.map((c) => c.kind));
    }
  });
});

describe('delta by distance', () => {
  it('amateur vs pro final delta ≈ lap time difference', () => {
    for (let i = 0; i < am.traces.length; i++) {
      const expected = (am.lapTimesMs[i]! - pro.lapTimesMs[1]!) / 1000;
      // with the official lap time and from the samples alone
      const withTime = prepareLap(am.traces[i]!, line, { lapTimeMs: am.lapTimesMs[i] });
      const fromSamples = prepareLap(am.traces[i]!, line);
      expect(Math.abs(computeDistanceDelta(withTime, ref).totalS - expected)).toBeLessThan(0.005);
      expect(Math.abs(computeDistanceDelta(fromSamples, ref).totalS - expected)).toBeLessThan(0.05);
    }
  });

  it('self-comparison is ≈ 0 and another pro lap is ≈ its lap time difference', () => {
    const self = computeDistanceDelta(ref, ref);
    expect(Math.max(...self.deltaS.map(Math.abs))).toBeLessThan(1e-9);
    const other = prepareLap(pro.traces[2]!, line);
    const d = computeDistanceDelta(other, ref);
    expect(Math.abs(d.totalS - (pro.lapTimesMs[2]! - pro.lapTimesMs[1]!) / 1000)).toBeLessThan(
      0.05,
    );
    expect(Math.max(...d.deltaS.map(Math.abs))).toBeLessThan(0.15);
  });

  it('derivative shows where time is lost (amateur loses most in braking zones)', () => {
    const lap = prepareLap(am.traces[1]!, line, { lapTimeMs: am.lapTimesMs[1] });
    const d = computeDistanceDelta(lap, ref);
    expect(d.rateSPer100m.length).toBe(d.distanceM.length);
    // integral of the rate ≈ total delta
    const integral = d.rateSPer100m.reduce((a, r) => a + (r * d.stepM) / 100, 0);
    expect(Math.abs(integral - d.totalS)).toBeLessThan(0.1);
    // the main straight (100–500 m) costs far less than the T1 braking zone + corner (550–850 m)
    expect(Math.abs(deltaBetween(lap, ref, 100, 500))).toBeLessThan(
      deltaBetween(lap, ref, 550, 850),
    );
  });
});
