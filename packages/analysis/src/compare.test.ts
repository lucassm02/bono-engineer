import type { CornerMetrics } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { centerlineFromTrace } from './centerline.ts';
import { compareLaps } from './compare.ts';
import { detectCorners } from './corners.ts';
import { computeLapMetrics, countReversals } from './metrics.ts';
import { prepareLap } from './prepare.ts';
import { syntheticFixture } from './test-utils.ts';

const pro = syntheticFixture('pro', 3, 1);
const am = syntheticFixture('amateur', 4, 1);
const proReplay = syntheticFixture('pro', 3, 1, true);
const line = centerlineFromTrace(pro.traces[1]!);
const ref = prepareLap(pro.traces[1]!, line, { lapTimeMs: pro.lapTimesMs[1] });
const corners = detectCorners(line, { reference: ref });
const cleanIdx = am.mistakes.findIndex((m, i) => i > 0 && m.length === 0);
const mistakeIdx = am.mistakes.findIndex((m) => m.length > 0);
const sub = prepareLap(am.traces[cleanIdx]!, line, { lapTimeMs: am.lapTimesMs[cleanIdx] });
const mSub = computeLapMetrics(sub, corners);
const mRef = computeLapMetrics(ref, corners);

const pairs = (key: keyof CornerMetrics) =>
  corners
    .map((_, i) => [mSub[i]![key], mRef[i]![key]] as [number | null, number | null])
    .filter((p): p is [number, number] => typeof p[0] === 'number' && typeof p[1] === 'number');
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('corner metrics: amateur vs pro (generator ground truth)', () => {
  it('amateur brakes earlier (brakeG 1.3 vs 1.52 g, plus coasting)', () => {
    const p = pairs('brakePointM');
    expect(p.length).toBeGreaterThanOrEqual(8); // T7 kink is flat out
    const earlier = p.filter(([a, b]) => b - a >= 5).length;
    expect(earlier / p.length).toBeGreaterThanOrEqual(0.8);
  });

  it('amateur has a lower minimum speed (95% grip)', () => {
    const p = pairs('minSpeedKmh');
    const lower = p.filter(([a, b]) => a < b).length;
    expect(lower / p.length).toBeGreaterThanOrEqual(0.8);
    expect(sum(p.map(([a, b]) => a - b)) / p.length).toBeLessThan(-1);
  });

  it('amateur picks up the throttle later where the delay matters (short corners T4, T5, T10)', () => {
    const late = ['T4', 'T5', 'T10'].map((id) => {
      const i = corners.findIndex((c) => c.id === id);
      return mSub[i]!.throttlePickupM! - mRef[i]!.throttlePickupM!;
    });
    expect(sum(late) / late.length).toBeGreaterThan(5);
    expect(sum(pairs('throttlePickupM').map(([a, b]) => a - b))).toBeGreaterThan(0);
  });

  it('amateur coasts more, does not trail-brake and corrects the steering more', () => {
    expect(sum(mSub.map((m) => m.coastingS))).toBeGreaterThan(
      sum(mRef.map((m) => m.coastingS)) + 3,
    );
    for (const [a, b] of pairs('trailBrakingS')) expect(b).toBeGreaterThan(a);
    const steerA = sum(mSub.map((m) => m.steeringCorrections ?? 0));
    const steerB = sum(mRef.map((m) => m.steeringCorrections ?? 0));
    expect(steerA).toBeGreaterThan(2 * steerB);
    // softer brake pressure (1.3 g target vs 1.52 g)
    for (const [a, b] of pairs('peakBrake')) expect(a).toBeLessThan(b + 0.02);
  });

  it('a mistake corner shows front lock and a much lower vmin', () => {
    expect(mistakeIdx).toBeGreaterThanOrEqual(0);
    const id = am.mistakes[mistakeIdx]![0]!;
    const lap = prepareLap(am.traces[mistakeIdx]!, line, { lapTimeMs: am.lapTimesMs[mistakeIdx] });
    const cmp = compareLaps(lap, ref, corners);
    const row = cmp.rows.find((r) => r.corner.id === id)!;
    expect(row.a.frontLockS).toBeGreaterThan(0.1);
    expect(row.diff.minSpeedKmh!).toBeLessThan(-4);
    const kinds = row.findings!.map((f) => f.kind);
    expect(kinds).toContain('frontLock');
    expect(kinds).toContain('lowerMinSpeed');
  });

  it('counts steering reversals with hysteresis', () => {
    expect(countReversals([0, 0.5, 1, 0.5, 0], 0.15)).toBe(0); // clean corner
    expect(countReversals([0, 1, 0.7, 1, 0.7, 1, 0], 0.15)).toBe(4);
    expect(countReversals([0, 1, 0.95, 1, 0], 0.15)).toBe(0); // below hysteresis
  });
});

describe('compareLaps', () => {
  const cmp = compareLaps(sub, ref, corners);

  it('totals add up and the delta equals the lap time difference', () => {
    expect(cmp.totalDeltaMs).toBe(am.lapTimesMs[cleanIdx]! - pro.lapTimesMs[1]!);
    const cornersMs = sum(cmp.rows.map((r) => r.timeLostMs));
    expect(Math.abs(cornersMs + cmp.straightsDeltaMs - cmp.totalDeltaMs)).toBeLessThanOrEqual(1);
    expect(Math.abs(sum(cmp.sectorDeltasMs!) - cmp.totalDeltaMs)).toBeLessThanOrEqual(3);
    expect(cmp.topLosses.length).toBe(3);
    expect(cmp.topLosses[0]!.timeLostMs).toBeGreaterThanOrEqual(cmp.topLosses[1]!.timeLostMs);
    // zones do not overlap
    for (let i = 1; i < cmp.rows.length; i++) {
      expect(cmp.rows[i]!.zone!.fromM).toBeGreaterThanOrEqual(cmp.rows[i - 1]!.zone!.toM - 1e-9);
    }
    // every row diff is subject − reference
    const r = cmp.rows[0]!;
    expect(r.diff.minSpeedKmh).toBeCloseTo(r.a.minSpeedKmh - r.b.minSpeedKmh, 9);
    expect(r.b.timeDeltaS).toBe(0);
  });

  it('produces the expected diagnosis types with numbers and one action per corner (pt-BR)', () => {
    const kinds = new Set(cmp.findings!.map((f) => f.kind));
    for (const k of [
      'brakeEarlier',
      'coasting',
      'noTrailBraking',
      'lowerMinSpeed',
      'steeringCorrections',
      'softBraking',
      'lateThrottle',
    ] as const) {
      expect(kinds).toContain(k);
    }
    const brake = cmp.findings!.find((f) => f.kind === 'brakeEarlier')!;
    expect(brake.message).toMatch(/^Você freia \d+ m antes da referência na T\d+/);
    expect(brake.action).toMatch(/marco de \d+ m/);
    expect(cmp.findings!.find((f) => f.kind === 'coasting')!.message).toMatch(
      /\d,\d s em roda livre/,
    );
    // ranked by cost
    const costs = cmp.findings!.map((f) => f.costMs ?? 0);
    for (let i = 1; i < costs.length; i++) expect(costs[i]!).toBeLessThanOrEqual(costs[i - 1]!);
    // key findings: one per corner, each with message + action + confidence
    const ids = cmp.keyFindings!.map((f) => f.cornerId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    for (const f of cmp.keyFindings!) {
      expect(f.message!.length).toBeGreaterThan(10);
      expect(f.action!.length).toBeGreaterThan(10);
      expect(['high', 'medium', 'low']).toContain(f.confidence);
    }
    // the costliest corners carry most of the findings' cost
    const top = cmp.keyFindings![0]!;
    expect(top.costMs!).toBeGreaterThan(100);
    expect(cmp.referenceIsReplay).toBe(false);
  });

  it('still yields sensible findings against a replay-smoothed reference', () => {
    const repLine = centerlineFromTrace(proReplay.traces[1]!);
    const repRef = prepareLap(proReplay.traces[1]!, repLine, {
      lapTimeMs: proReplay.lapTimesMs[1],
      isReplay: true,
    });
    const repCorners = detectCorners(repLine, { reference: repRef });
    expect(repCorners.length).toBe(10);
    const subOnRep = prepareLap(am.traces[cleanIdx]!, repLine, {
      lapTimeMs: am.lapTimesMs[cleanIdx],
    });
    const rc = compareLaps(subOnRep, repRef, repCorners);
    expect(rc.referenceIsReplay).toBe(true);
    expect(rc.warnings.some((w) => w.includes('replay'))).toBe(true);
    const kinds = new Set(rc.findings!.map((f) => f.kind));
    for (const k of ['brakeEarlier', 'coasting', 'noTrailBraking', 'lowerMinSpeed'] as const) {
      expect(kinds).toContain(k);
    }
    // replay brake points within a few meters of the live reference
    const repM = computeLapMetrics(repRef, repCorners);
    const deltas = mRef
      .map((m, i) => [m.brakePointM, repM[i]!.brakePointM])
      .filter((p): p is [number, number] => p[0] !== null && p[1] !== null)
      .map(([a, b]) => Math.abs(a - b));
    expect(Math.max(...deltas)).toBeLessThan(6);
    // input-shape findings are never 'high' confidence against a replay
    for (const f of rc.findings!) {
      if (['coasting', 'noTrailBraking', 'steeringCorrections', 'softBraking'].includes(f.kind)) {
        expect(f.confidence).not.toBe('high');
      }
    }
  });
});
