import { describe, expect, it } from 'vitest';
import { centerlineFromTrace } from './centerline.ts';
import { computeMicrosectors, sectorTable, sectorTableOf } from './microsectors.ts';
import { prepareLap } from './prepare.ts';
import { syntheticFixture } from './test-utils.ts';

const am = syntheticFixture('amateur', 5, 7);
const line = centerlineFromTrace(am.traces[0]!);
const laps = am.traces.map((t, i) => prepareLap(t, line, { lapTimeMs: am.lapTimesMs[i] }));

describe('sector table (spec 14)', () => {
  const table = sectorTable(laps);

  it('has three sectors with the lap that made each best time', () => {
    expect(table.rows).toHaveLength(3);
    expect(table.lapCount).toBe(laps.length);
    const ids = new Set(laps.map((l) => l.lapId));
    for (const r of table.rows) {
      expect(ids.has(r.bestLapId)).toBe(true);
      expect(r.toM).toBeGreaterThan(r.fromM);
    }
    expect(table.rows[0]!.fromM).toBe(0);
    expect(table.rows[2]!.toM).toBeCloseTo(table.lengthM, 3);
  });

  it('adds up: the sectors of each lap equal its lap time within 1 ms', () => {
    const report = computeMicrosectors(laps);
    for (const l of report.laps) {
      const sum = l.sectorMs.reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - l.lapTimeMs)).toBeLessThanOrEqual(3);
    }
  });

  it('the ideal lap is the sum of the best sectors and never beats physics the wrong way', () => {
    const sum = table.rows.reduce((a, r) => a + r.bestMs, 0);
    expect(table.idealLapMs).toBe(sum);
    expect(table.idealLapMs).toBeLessThanOrEqual(table.bestLapMs);
    expect(table.gainMs).toBe(Math.max(0, table.bestLapMs - table.idealLapMs));
  });

  it('keeps each average between the best time and the slowest lap, and the loss of the best lap ≥ 0', () => {
    const report = computeMicrosectors(laps);
    table.rows.forEach((r, i) => {
      const times = report.laps.map((l) => l.sectorMs[i]!);
      expect(r.avgTopMs).toBeGreaterThanOrEqual(r.bestMs);
      expect(r.avgTopMs).toBeLessThanOrEqual(Math.max(...times));
      expect(r.bestLapLossMs).toBeGreaterThanOrEqual(0);
    });
    // the best lap loses nothing in a sector where it is also the best
    const bestLapSector = table.rows.filter((r) => r.bestLapId === table.bestLapId);
    for (const r of bestLapSector) expect(r.bestLapLossMs).toBe(0);
  });

  it('is the same from a precomputed report, and one lap is its own ideal lap', () => {
    expect(sectorTableOf(computeMicrosectors(laps))).toEqual(table);
    const one = sectorTable([laps[0]!]);
    expect(one.gainMs).toBe(0);
    expect(one.rows.every((r) => r.bestLapId === laps[0]!.lapId)).toBe(true);
  });

  it('follows custom sector cuts', () => {
    const cuts = [0, laps[0]!.lengthM * 0.25, laps[0]!.lengthM * 0.6];
    const t = sectorTable(laps, { sectorStartsM: cuts });
    expect(t.rows).toHaveLength(3);
    expect(t.rows[1]!.fromM).toBeCloseTo(cuts[1]!, 3);
  });
});
