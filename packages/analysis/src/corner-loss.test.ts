import { CORNER_LOSS_MIN_MS, cornerLossRanking } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { centerlineFromTrace } from './centerline.ts';
import { compareLaps } from './compare.ts';
import { detectCorners } from './corners.ts';
import { prepareLap } from './prepare.ts';
import { syntheticFixture } from './test-utils.ts';

const pro = syntheticFixture('pro', 3, 1);
const am = syntheticFixture('amateur', 4, 1);
const line = centerlineFromTrace(pro.traces[1]!);
const ref = prepareLap(pro.traces[1]!, line, { lapTimeMs: pro.lapTimesMs[1] });
const corners = detectCorners(line, { reference: ref });
const lap = prepareLap(am.traces[0]!, line, { lapTimeMs: am.lapTimesMs[0] });
const cmp = compareLaps(lap, ref, corners);

describe('cornerLossRanking (spec 15)', () => {
  const report = cornerLossRanking(cmp, { topN: 5 });

  it('lists the corners that lose the most, biggest first, above the noise floor', () => {
    expect(report.rows.length).toBeGreaterThan(0);
    for (const r of report.rows) expect(r.lossMs).toBeGreaterThanOrEqual(CORNER_LOSS_MIN_MS);
    const losses = report.rows.map((r) => r.lossMs);
    expect([...losses].sort((a, b) => b - a)).toEqual(losses);
    // the biggest listed loss is the biggest loss of the comparison
    const worst = Math.max(...cmp.rows.map((r) => r.timeLostMs));
    expect(report.rows[0]!.lossMs).toBe(Math.round(worst));
  });

  it('closes the lap delta: listed losses + other corners + straights = total (5 ms)', () => {
    const sum =
      report.rows.reduce((a, r) => a + r.lossMs, 0) + report.otherCornersMs + report.straightsMs;
    expect(Math.abs(sum - report.totalDeltaMs)).toBeLessThanOrEqual(5 + report.rows.length);
    expect(report.totalDeltaMs).toBe(cmp.totalDeltaMs);
  });

  it('only gives causes with confidence, each with the number that backs it', () => {
    const withReasons = report.rows.filter((r) => r.reasons.length > 0);
    expect(withReasons.length).toBeGreaterThan(0);
    for (const r of report.rows) {
      expect(r.reasons.length).toBeLessThanOrEqual(2);
      for (const reason of r.reasons) {
        expect(['high', 'medium']).toContain(reason.confidence);
        expect(reason.message).toMatch(/\d/);
      }
    }
  });

  it('keeps the raw numbers of the corner even without a confident cause', () => {
    const row = report.rows[0]!;
    const source = cmp.rows.find((r) => r.corner.id === row.cornerId)!;
    expect(row.brakePointM).toEqual([source.a.brakePointM, source.b.brakePointM]);
    expect(row.minSpeedKmh).toEqual([source.a.minSpeedKmh, source.b.minSpeedKmh]);
  });

  it('lists nothing against itself and honours topN', () => {
    const same = compareLaps(ref, ref, corners);
    const none = cornerLossRanking(same);
    expect(none.rows).toEqual([]);
    expect(none.totalDeltaMs).toBe(0);
    expect(cornerLossRanking(cmp, { topN: 1 }).rows).toHaveLength(1);
  });

  it('drops a loss below a raised floor', () => {
    const strict = cornerLossRanking(cmp, { topN: 20, minLossMs: 1e9 });
    expect(strict.rows).toEqual([]);
  });
});
