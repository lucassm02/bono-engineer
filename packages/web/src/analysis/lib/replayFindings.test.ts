import type {
  Corner,
  CornerComparisonRow,
  CornerMetrics,
  DrivingEvent,
  LapComparison,
} from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  buildFindings,
  cornerSeekM,
  GAIN_MIN_MS,
  MAX_GAINS,
  MAX_LOSSES,
} from './replayFindings.ts';

const LENGTH = 3000;

const corner = (id: string, entryM: number, exitM: number): Corner => ({
  id,
  index: Number(id.slice(1)) - 1,
  name: null,
  entryM,
  apexM: (entryM + exitM) / 2,
  exitM,
  direction: 'left',
});

const corners = [
  corner('T1', 200, 300),
  corner('T2', 600, 700),
  corner('T3', 1000, 1100),
  corner('T4', 1400, 1500),
  corner('T5', 1800, 1900),
  corner('T6', 2200, 2300),
  corner('T7', 2600, 2700),
];

const metrics = (over: Partial<CornerMetrics> = {}) =>
  ({
    brakePointM: 150,
    minSpeedKmh: 100,
    exitSpeedKmh: 140,
    ...over,
  }) as CornerMetrics;

const row = (c: Corner, timeLostMs: number, extra: Partial<CornerComparisonRow> = {}) =>
  ({
    corner: c,
    a: metrics(),
    b: metrics({ minSpeedKmh: 98 }),
    diff: {},
    timeLostMs,
    zone: { fromM: c.entryM - 60, toM: c.exitM + 50 },
    ...extra,
  }) as CornerComparisonRow;

const comparison = (rows: CornerComparisonRow[]) =>
  ({
    trackId: 't',
    lapA: 'a',
    lapB: 'b',
    lapATimeMs: 120000,
    lapBTimeMs: 119000,
    totalDeltaMs: rows.reduce((s, r) => s + r.timeLostMs, 0),
    rows,
    topLosses: [],
    straightsDeltaMs: 0,
    warnings: [],
  }) as unknown as LapComparison;

const event = (over: Partial<DrivingEvent> = {}): DrivingEvent =>
  ({
    id: 'understeer:T2:610',
    kind: 'understeer',
    lapId: 'a',
    cornerId: 'T2',
    phase: 'entry',
    startM: 610,
    endM: 650,
    startS: 30,
    endS: 31,
    durationS: 1,
    confidence: 'high',
    evidence: {} as DrivingEvent['evidence'],
    notes: [],
    message: 'Provável saída de frente na T2.',
    action: 'Solte o freio mais cedo.',
    settledM: 660,
    ...over,
  }) as DrivingEvent;

const base = { lengthM: LENGTH, corners, events: null, comparison: null, issues: null };

describe('buildFindings', () => {
  it('has nothing to say without events, comparison or issues', () => {
    expect(buildFindings(base)).toEqual([]);
  });

  it('turns driving events into "errou" moments a little before they start', () => {
    const [f] = buildFindings({ ...base, events: [event()] });
    expect(f!.tone).toBe('bad');
    expect(f!.cornerId).toBe('T2');
    expect(f!.distanceM).toBe(590);
    expect(f!.detail).toContain('T2');
    expect(f!.range![0]).toBeLessThan(610);
    expect(f!.range![1]).toBeGreaterThan(650);
  });

  it('a low-confidence event is only a hint', () => {
    const [f] = buildFindings({ ...base, events: [event({ confidence: 'low' })] });
    expect(f!.tone).toBe('info');
  });

  it('lists the corners that lose time as "errou" and the ones that gain as "acertou"', () => {
    const rows = [
      row(corners[0]!, 120),
      row(corners[1]!, -90),
      row(corners[2]!, 5),
      row(corners[3]!, 60),
    ];
    const found = buildFindings({ ...base, comparison: comparison(rows) });
    expect(found.filter((f) => f.tone === 'bad').map((f) => f.cornerId)).toEqual(['T1', 'T4']);
    expect(found.filter((f) => f.tone === 'good').map((f) => f.cornerId)).toEqual(['T2']);
    // T3 is inside the noise: not listed
    expect(found.some((f) => f.cornerId === 'T3')).toBe(false);
  });

  it('caps the losses and the gains and keeps the biggest', () => {
    const rows = corners.flatMap((c, i) => [row(c, i % 2 === 0 ? 40 + i * 10 : -(40 + i * 10))]);
    const found = buildFindings({ ...base, comparison: comparison(rows) });
    expect(found.filter((f) => f.tone === 'bad').length).toBeLessThanOrEqual(MAX_LOSSES);
    expect(found.filter((f) => f.tone === 'good').length).toBeLessThanOrEqual(MAX_GAINS);
    const gains = found.filter((f) => f.tone === 'good');
    expect(gains.length).toBeGreaterThan(0);
    for (const g of gains) {
      const r = rows.find((x) => x.corner.id === g.cornerId)!;
      expect(r.timeLostMs).toBeLessThanOrEqual(-GAIN_MIN_MS);
    }
  });

  it('sorts everything in the order it happens along the lap', () => {
    const found = buildFindings({
      ...base,
      events: [event({ startM: 2230, endM: 2260, cornerId: 'T6', id: 'oversteer:T6:2230' })],
      comparison: comparison([row(corners[0]!, 200), row(corners[3]!, -80)]),
    });
    const ds = found.map((f) => f.distanceM);
    expect([...ds].sort((a, b) => a - b)).toEqual(ds);
    expect(found).toHaveLength(3);
  });

  it('uses the validity issues that have a position', () => {
    const found = buildFindings({
      ...base,
      issues: [
        { kind: 'offTrack', atM: 1234, value: 1, message: 'Saiu da pista.' },
        { kind: 'incomplete', atM: null, value: 1, message: 'Dados incompletos.' },
      ],
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.distanceM).toBe(1214);
    expect(found[0]!.detail).toBe('Saiu da pista.');
  });

  it('never points before the start of the lap', () => {
    const [f] = buildFindings({ ...base, events: [event({ startM: 5, endM: 30 })] });
    expect(f!.distanceM).toBe(0);
    expect(f!.range![0]).toBe(0);
  });
});

describe('cornerSeekM', () => {
  it('lands at the start of the braking zone', () => {
    expect(cornerSeekM(corners[1]!, { fromM: 520 }, 560)).toBe(520);
    expect(cornerSeekM(corners[1]!, null, 400)).toBe(380);
    expect(cornerSeekM(corners[0]!, null, null)).toBe(160);
    expect(cornerSeekM({ entryM: 10 }, null, null)).toBe(0);
  });
});
