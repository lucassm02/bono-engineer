import { describe, expect, it } from 'vitest';
import { centerlineFromTrace, pointAtDistance } from './centerline.ts';
import { buildChartData } from './charts.ts';
import { compareLaps } from './compare.ts';
import { computeConsistency } from './consistency.ts';
import { detectCorners } from './corners.ts';
import { computeMicrosectors, microsectorColors } from './microsectors.ts';
import { prepareLap } from './prepare.ts';
import {
  formatComparisonMarkdown,
  formatLapTime,
  summarizeComparisonForAI,
  summarizeLapForAI,
} from './summary.ts';
import { mutateTrace, syntheticFixture } from './test-utils.ts';
import { checkLapValidity } from './validity.ts';

const pro = syntheticFixture('pro', 3, 1);
const am = syntheticFixture('amateur', 4, 1);
const line = centerlineFromTrace(pro.traces[1]!);
const ref = prepareLap(pro.traces[1]!, line, { lapTimeMs: pro.lapTimesMs[1] });
const corners = detectCorners(line, { reference: ref });
const amLaps = am.traces.map((t, i) => prepareLap(t, line, { lapTimeMs: am.lapTimesMs[i] }));
const proLaps = pro.traces.map((t, i) => prepareLap(t, line, { lapTimeMs: pro.lapTimesMs[i] }));

describe('consistency', () => {
  const rep = computeConsistency(amLaps, corners, { sessionId: 's1' });

  it('has per-corner stats for every lap', () => {
    expect(rep.lapIds.length).toBe(4);
    expect(rep.lapTime.n).toBe(4);
    expect(rep.corners.length).toBe(10);
    const t1 = rep.corners[0]!.metrics;
    expect(t1.brakePointM!.n).toBe(4);
    expect(t1.minSpeedKmh!.min).toBeLessThanOrEqual(t1.minSpeedKmh!.mean);
  });

  it('flags the inconsistent (mistake) corner first, with a pt-BR sentence', () => {
    const mistakeCorners = new Set(am.mistakes.flat());
    expect(rep.highlights.length).toBeGreaterThan(0);
    expect(mistakeCorners.has(rep.highlights[0]!.cornerId)).toBe(true);
    expect(rep.highlights[0]!.message).toMatch(/varia .* entre as voltas/);
  });

  it('pro laps are more consistent than amateur laps', () => {
    const proRep = computeConsistency(proLaps, corners);
    const spread = (r: typeof rep) =>
      r.corners.reduce((a, c) => a + (c.metrics.brakePointM?.stdDev ?? 0), 0);
    expect(spread(proRep)).toBeLessThan(spread(rep));
    expect(proRep.highlights.length).toBe(0);
  });
});

describe('microsectors and theoretical best', () => {
  const rep = computeMicrosectors(amLaps);

  it('splits laps into 25 microsectors whose times add up to the lap time', () => {
    expect(rep.count).toBe(25);
    expect(rep.boundariesM.length).toBe(26);
    for (const l of rep.laps) {
      const sumMicro = l.microMs.reduce((a, b) => a + b, 0);
      expect(Math.abs(sumMicro - l.lapTimeMs)).toBeLessThan(5);
      expect(Math.abs(l.sectorMs.reduce((a, b) => a + b, 0) - l.lapTimeMs)).toBeLessThan(3);
    }
  });

  it('theoretical best ≤ best sectors ≤ best lap', () => {
    expect(rep.bestLapMs).toBe(Math.min(...am.lapTimesMs));
    expect(rep.theoreticalBestMs).toBeLessThanOrEqual(rep.theoreticalBestSectorsMs);
    expect(rep.theoreticalBestSectorsMs).toBeLessThanOrEqual(rep.bestLapMs);
    expect(rep.theoreticalBestMs).toBeLessThan(rep.bestLapMs); // amateur laps vary
  });

  it('colors microsectors vs a reference for the map', () => {
    const withPro = computeMicrosectors([...amLaps, ref]);
    const colors = microsectorColors(withPro, amLaps[1]!.lapId, ref.lapId);
    expect(colors.length).toBe(25);
    const losses = colors.filter((c) => c.tone === 'loss').length;
    expect(losses).toBeGreaterThan(15);
    for (const c of colors) {
      expect(c.intensity).toBeGreaterThanOrEqual(0);
      expect(c.intensity).toBeLessThanOrEqual(1);
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
    }
    const self = microsectorColors(withPro, ref.lapId, ref.lapId);
    expect(self.every((c) => c.tone === 'best' || c.tone === 'neutral')).toBe(true);
  });
});

describe('lap validity', () => {
  it('accepts clean synthetic laps', () => {
    for (const l of [...amLaps, ...proLaps]) {
      const v = checkLapValidity(l);
      expect(v.valid).toBe(true);
      expect(v.issues).toEqual([]);
    }
  });

  it('flags off-track excursions', () => {
    const tr = mutateTrace(am.traces[1]!, (ch) => {
      for (let i = 2000; i < 2120; i++) {
        const p = pointAtDistance(line, ch.distanceM[i]!);
        ch.x[i] = ch.x[i]! + 20 * Math.cos(p.heading);
        ch.z[i] = ch.z[i]! - 20 * Math.sin(p.heading);
      }
    });
    const v = checkLapValidity(prepareLap(tr, line));
    expect(v.valid).toBe(false);
    expect(v.flags).toContain('offTrack');
  });

  it('flags data gaps, rewinds and incomplete laps', () => {
    const gap = mutateTrace(am.traces[1]!, (ch) => {
      for (const k of Object.keys(ch) as (keyof typeof ch)[]) ch[k].splice(3000, 60);
    });
    const vg = checkLapValidity(prepareLap(gap, line));
    expect(vg.flags).toContain('incompleteData');
    expect(vg.issues.some((i) => i.kind === 'timeGap')).toBe(true);

    const rewind = mutateTrace(am.traces[1]!, (ch) => {
      for (let i = 3000; i < 3060; i++) {
        ch.x[i] = ch.x[i - 120]!;
        ch.z[i] = ch.z[i - 120]!;
      }
    });
    const vr = checkLapValidity(prepareLap(rewind, line));
    expect(vr.flags).toContain('discontinuity');

    const partial = mutateTrace(am.traces[1]!, (ch) => {
      for (const k of Object.keys(ch) as (keyof typeof ch)[]) ch[k].splice(0, 400);
    });
    const vp = checkLapValidity(prepareLap(partial, line));
    expect(vp.flags).toContain('incompleteData');

    const mismatch = checkLapValidity(
      prepareLap(am.traces[1]!, line, { lapTimeMs: am.lapTimesMs[1]! + 500 }),
    );
    expect(mismatch.flags).toContain('timeMismatch');
  });
});

describe('AI summaries and charts', () => {
  const cmp = compareLaps(amLaps[1]!, ref, corners);

  it('comparison summary is compact JSON with units in keys', () => {
    const json = JSON.stringify(summarizeComparisonForAI(cmp));
    console.info(`[summary] comparison ${json.length} bytes`);
    expect(json.length).toBeLessThan(4096);
    expect(json).toContain('"brakePoint_m"');
    expect(json).toContain('"vmin_kmh"');
    expect(json).not.toMatch(/\d\.\d{4,}/); // rounded numbers
  });

  it('lap summary is compact', () => {
    const json = JSON.stringify(summarizeLapForAI(amLaps[1]!, corners));
    expect(json.length).toBeLessThan(4096);
    expect(json).toContain('"lapTime_s"');
  });

  it('markdown report is in pt-BR with a corner table and an action plan', () => {
    const md = formatComparisonMarkdown(cmp);
    expect(md).toContain('## Comparação');
    expect(md).toContain('| T1 |');
    expect(md).toContain('Plano: uma ação por curva');
    expect(md).toContain(formatLapTime(cmp.lapATimeMs));
    expect(formatLapTime(95351)).toBe('1:35,351');
  });

  it('builds downsampled chart series for a corner and the full lap', () => {
    const c = corners[0]!;
    const corner = buildChartData([ref, amLaps[1]!], { corner: c });
    expect(corner.fromM).toBeCloseTo(c.entryM - 200, 6);
    expect(corner.distanceM.length).toBeLessThanOrEqual(400);
    expect(corner.series.length).toBe(12);
    const refDelta = corner.series.find((s) => s.lapId === ref.lapId && s.channel === 'deltaS')!;
    expect(refDelta.values.every((v) => v === 0)).toBe(true);
    const brake = corner.series.find((s) => s.lapId === ref.lapId && s.channel === 'brake')!;
    expect(Math.max(...brake.values.map((v) => v ?? 0))).toBeGreaterThan(80); // %
    expect(corner.markers.map((m) => m.label)).toContain('T1 ápice');
    const full = buildChartData([ref], { maxPoints: 300, channels: ['speedKmh'], corners });
    expect(full.distanceM.length).toBeLessThanOrEqual(300);
    expect(full.markers.length).toBe(30);
  });
});
