import type { LapCompletedEvent, LiveLapTiming, NextCornerHint } from '@gt7/shared';
import { DEFAULT_CUSTOM_LAYOUT } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  assessPass,
  type CornerFrameInput,
  type CornerPass,
  CornerPassTracker,
  distanceToBrake,
} from './cornerPass.ts';
import { fuelPlan, raceLapsLeft } from './fuel.ts';
import { GStats, gScale } from './gStats.ts';
import {
  bestSectors,
  consistency,
  type LapRow,
  lapRowFromEvent,
  lapTrend,
  mergeLapRows,
  sectorCellStatus,
  sessionBestLap,
  theoreticalBest,
} from './lapStats.ts';
import {
  boundsOf,
  clampView,
  fitScale,
  followPoint,
  initialView,
  isZoomed,
  lapDiff,
  lowerIndex,
  mapX,
  panBy,
  pinchView,
  projection,
  toMap,
  toScreen,
  zoomAt,
} from './mapMath.ts';
import { MicrosectorTracker, microTone } from './microsectors.ts';
import { ReferenceAvailability } from './referenceAvailability.ts';
import { TrackOutlineBuilder } from './trackOutline.ts';
import { packLayout, reduceLayout, sanitizeLayout } from './widgetLayout.ts';

// ---------------------------------------------------------------------------------------------
// Map maths
// ---------------------------------------------------------------------------------------------

describe('map projection and zoom', () => {
  const b = { minX: 0, maxX: 1000, minY: -500, maxY: 0 };
  const vp = { w: 800, h: 400, pad: 0 };

  it('fits the bounds and maps the centre to the viewport centre', () => {
    expect(fitScale(b, vp)).toBeCloseTo(0.8); // min(800/1000, 400/500)
    const p = projection(initialView(b), b, vp);
    const [sx, sy] = toScreen(p, 500, -250);
    expect(sx).toBeCloseTo(400);
    expect(sy).toBeCloseTo(200);
    const [mx, my] = toMap(p, sx, sy);
    expect(mx).toBeCloseTo(500);
    expect(my).toBeCloseTo(-250);
  });

  it('builds bounds in the map plane (y = −z)', () => {
    // map plane = (−x, −z): same view as the MCP PNG, so a left turn (+curvature) looks left
    expect(boundsOf([1, 10], [5, -5])).toEqual({ minX: -10, maxX: -1, minY: -5, maxY: 5 });
    expect(mapX(3)).toBe(-3);
    expect(boundsOf([], [])).toBeNull();
  });

  it('zooms around a screen point keeping it fixed', () => {
    const v0 = initialView(b);
    const p0 = projection(v0, b, vp);
    const anchor = toMap(p0, 600, 100);
    const v1 = zoomAt(v0, b, vp, 3, 600, 100);
    expect(v1.zoom).toBeCloseTo(3);
    const after = toScreen(projection(v1, b, vp), anchor[0], anchor[1]);
    expect(after[0]).toBeCloseTo(600);
    expect(after[1]).toBeCloseTo(100);
    expect(isZoomed(v1)).toBe(true);
  });

  it('clamps zoom and re-centres at zoom 1', () => {
    const v = zoomAt(initialView(b), b, vp, 100, 0, 0);
    expect(v.zoom).toBe(12);
    const back = zoomAt(v, b, vp, 0.001, 0, 0);
    expect(back).toEqual({ ...initialView(b), follow: back.follow });
    expect(clampView({ zoom: 4, cx: 5000, cy: 10, follow: true }, b)).toEqual({
      zoom: 4,
      cx: 1000,
      cy: 0,
      follow: true,
    });
  });

  it('pans only when zoomed and stops following', () => {
    const v0 = initialView(b);
    expect(panBy(v0, b, vp, 50, 0)).toBe(v0);
    const z = zoomAt(v0, b, vp, 2, 400, 200);
    const p = panBy(z, b, vp, 160, 0); // k = 1.6 px/m → 100 m
    expect(p.cx).toBeCloseTo(z.cx - 100);
    expect(p.follow).toBe(false);
  });

  it('pinch zooms by the finger distance ratio', () => {
    const v0 = initialView(b);
    const v = pinchView(
      v0,
      b,
      vp,
      { x: 350, y: 200 },
      { x: 450, y: 200 },
      { x: 300, y: 200 },
      { x: 500, y: 200 },
    );
    expect(v.zoom).toBeCloseTo(2);
    expect(v.cx).toBeCloseTo(500);
  });

  it('follows the car when zoomed', () => {
    const z = { ...zoomAt(initialView(b), b, vp, 4, 400, 200), follow: true };
    const f = followPoint(z, b, 100, -100);
    expect(f.cx).toBe(100);
    expect(f.cy).toBe(-100);
    expect(followPoint(initialView(b), b, 100, -100).cx).toBe(500);
  });

  it('wraps lap distance differences and searches sorted arrays', () => {
    expect(lapDiff(10, 990, 1000)).toBe(20);
    expect(lapDiff(990, 10, 1000)).toBe(-20);
    expect(lapDiff(10, 30, null)).toBe(-20);
    expect(lowerIndex([0, 2, 4, 6], 5)).toBe(2);
    expect(lowerIndex([0, 2, 4, 6], -1)).toBe(0);
    expect(lowerIndex([0, 2, 4, 6], 99)).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------
// Outline, microsectors, G, reference availability
// ---------------------------------------------------------------------------------------------

/** Points on a circle of radius r (m), `n` per lap. */
function circle(r: number, i: number, n: number): [number, number] {
  const a = (i / n) * Math.PI * 2;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

describe('TrackOutlineBuilder', () => {
  it('exposes the partial path, then keeps the closed loop', () => {
    const o = new TrackOutlineBuilder();
    const L = 2 * Math.PI * 200;
    const n = 600;
    for (let i = 0; i < n / 2; i++) {
      const [x, z] = circle(200, i, n);
      o.push(x, z, (i / n) * L, 1, L);
    }
    const partial = o.geometry(null)!;
    expect(partial.closed).toBe(false);
    expect(partial.x.length).toBeGreaterThan(100);
    for (let i = n / 2; i < n; i++) {
      const [x, z] = circle(200, i, n);
      o.push(x, z, (i / n) * L, 1, L);
    }
    const [x0, z0] = circle(200, 0, n);
    o.push(x0, z0, 0, 2, L);
    const g = o.geometry('t1')!;
    expect(g.closed).toBe(true);
    expect(g.trackId).toBe('t1');
    expect(o.hasLoop).toBe(true);
  });

  it('restarts on a teleport and rejects open laps', () => {
    const o = new TrackOutlineBuilder();
    for (let i = 0; i < 300; i++) o.push(i * 3, 0, i * 3, 1, null);
    o.push(5000, 5000, 0, 1, null);
    expect(o.geometry(null)).toBeNull();
    for (let i = 0; i < 300; i++) o.push(i * 3, 0, i * 3, 1, null);
    o.push(0, 0, 0, 2, null); // straight line: does not close
    expect(o.hasLoop).toBe(false);
  });
});

describe('MicrosectorTracker', () => {
  it('stores delta change per microsector and rolls laps', () => {
    const m = new MicrosectorTracker(4);
    const L = 400;
    // Lap 1: lose 50 ms in sector 0, gain 30 ms in sector 1, flat after.
    const deltaAt = (d: number) => (d < 100 ? d / 2 : d < 200 ? 50 - (d - 100) * 0.3 : 20);
    for (let d = 0; d < L; d += 5) m.push(d, L, deltaAt(d), 1, 'pb|a');
    expect(m.value(0).ms).toBeCloseTo(50, 0);
    expect(m.value(1).ms).toBeCloseTo(-30, 0);
    expect(microTone(m.value(0).ms)).toBe('loss');
    expect(microTone(m.value(1).ms)).toBe('gain');
    expect(microTone(m.value(2).ms)).toBe('neutral');
    m.push(0, L, 0, 2, 'pb|a');
    expect(Number.isFinite(m.value(3).ms)).toBe(true); // last one closed on lap change
    expect(m.value(0).stale).toBe(true);
    m.push(10, L, 0, 2, 'sb|b');
    expect(Number.isNaN(m.value(0).ms)).toBe(true); // reference change clears
  });
});

describe('GStats', () => {
  it('tracks lap/session peaks and ignores spikes', () => {
    const g = new GStats(4);
    g.push(1.2, -1.5, 1.1, 1);
    g.push(-0.8, 0.6, null, 1);
    g.push(9, 0, null, 1);
    expect(g.lap.left).toBeCloseTo(1.2);
    expect(g.lap.right).toBeCloseTo(0.8);
    expect(g.lap.brake).toBeCloseTo(1.5);
    expect(g.lap.accel).toBeCloseTo(0.6);
    expect(g.lap.vertical).toBeCloseTo(0.1);
    g.push(0.1, 0.1, null, 2);
    expect(g.lastLap?.left).toBeCloseTo(1.2);
    expect(g.lap.left).toBeCloseTo(0.1);
    expect(g.session.combined).toBeCloseTo(Math.hypot(1.2, 1.5));
    const ages: number[] = [];
    g.forEachTrail((_a, _b, age) => ages.push(age));
    expect(ages.map((a) => a.toFixed(3))).toEqual(['1.000', '0.667', '0.333', '0.000']);
    expect(gScale(1.6)).toBe(2);
    expect(gScale(2.3)).toBe(2.5);
  });
});

describe('ReferenceAvailability', () => {
  it('defaults to available and learns from frames', () => {
    const r = new ReferenceAvailability();
    expect(r.available('t')).toBe(true);
    r.observe('t', 'reference', null, true);
    expect(r.available('t')).toBe(false);
    r.observe('t', 'personalBest', null, true);
    expect(r.available('t')).toBe(false);
    r.observe('t', 'reference', 'lap-1', true);
    expect(r.available('t')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Corner passes
// ---------------------------------------------------------------------------------------------

function hint(id: string, distanceToEntryM: number, extra: Partial<NextCornerHint> = {}) {
  return {
    cornerId: id,
    name: id === 'T1' ? 'Grampo' : null,
    direction: 'right' as const,
    distanceToEntryM,
    referenceBrakePointM: 400,
    referenceMinSpeedKmh: 80,
    referenceGearAtApex: 2,
    lastPassDeltaMs: null,
    referenceThrottleOnM: 540,
    ...extra,
  };
}

/**
 * Drives a synthetic corner: entry at 500 m (T1), next corner T2 at 900 m. Brakes at `brakeAt`,
 * minimum speed `vmin` at 540 m, throttle from `throttleAt`.
 */
function drive(brakeAt: number, vmin: number, throttleAt: number): CornerPass[] {
  const tr = new CornerPassTracker();
  const out: CornerPass[] = [];
  let t = 0;
  for (let d = 0; d <= 1000; d += 2) {
    t += 30;
    const braking = d >= brakeAt && d < 530;
    let speed = 200;
    if (d >= brakeAt && d <= 540) speed = 200 - ((200 - vmin) * (d - brakeAt)) / (540 - brakeAt);
    else if (d > 540) speed = Math.min(200, vmin + (d - 540) * 0.6);
    const f: CornerFrameInput = {
      t,
      onTrack: true,
      distanceM: d,
      lengthM: 2000,
      speedKmh: speed,
      brake: braking ? 0.8 : 0,
      throttle: braking ? 0 : d >= throttleAt || d < brakeAt ? 1 : 0,
      gear: speed < 100 ? 2 : 5,
      hint: d < 500 ? hint('T1', 500 - d) : hint('T2', 900 - d),
    };
    const p = tr.push(f);
    if (p) out.push(p);
  }
  return out;
}

describe('CornerPassTracker', () => {
  it('measures brake point, V-min and throttle pickup of a pass', () => {
    const passes = drive(390, 76, 548);
    const p = passes.find((x) => x.cornerId === 'T1')!;
    expect(p).toBeDefined();
    expect(p.brakeM).toBe(390);
    expect(p.vminKmh).toBeCloseTo(76, 0);
    expect(p.vminM).toBeCloseTo(540, -1);
    expect(p.throttleOnM).toBe(548);
    expect(p.name).toBe('Grampo');
    expect(p.ref.brakeM).toBe(400);
  });

  it('resets on discontinuities', () => {
    const tr = new CornerPassTracker();
    const base = {
      onTrack: true,
      lengthM: 2000,
      speedKmh: 100,
      brake: 0,
      throttle: 1,
      gear: 3,
      hint: hint('T1', 100),
    };
    expect(tr.push({ ...base, t: 0, distanceM: 400 })).toBeNull();
    expect(tr.approaching).toBe('T1');
    tr.push({ ...base, t: 30, distanceM: 1200 });
    tr.push({ ...base, t: 60, distanceM: null });
    expect(tr.approaching).toBeNull();
  });
});

describe('assessPass', () => {
  it('flags early braking and low V-min in pt-BR', () => {
    const p = drive(390, 74, 560).find((x) => x.cornerId === 'T1')!;
    const a = assessPass(p, null);
    expect(a.verdict).toBe('bad');
    const brake = a.items.find((i) => i.key === 'brake')!;
    expect(brake.text).toBe('10 m cedo');
    expect(brake.tone).toBe('bad');
    const vmin = a.items.find((i) => i.key === 'vmin')!;
    expect(vmin.text).toBe('−6 km/h');
    expect(a.items.find((i) => i.key === 'throttle')!.text).toBe('20 m tarde');
    expect(a.phrase).toContain('frenagem 10 metros cedo');
  });

  it('is green when on target and falls back to the previous pass without reference', () => {
    const p = drive(402, 81, 515).find((x) => x.cornerId === 'T1')!;
    const a = assessPass(p, null);
    expect(a.verdict).toBe('good');
    expect(a.headline).toBe('Curva no alvo');
    const noRef: CornerPass = {
      ...p,
      ref: { brakeM: null, vminKmh: null, gear: null, throttleOnM: null },
    };
    const b = assessPass(noRef, { ...p, brakeM: 380 });
    const brake = b.items.find((i) => i.key === 'brake')!;
    expect(brake.basis).toBe('passagem anterior');
    expect(brake.tone).toBe('info');
    expect(b.verdict).toBe('neutral');
  });

  it('computes the distance to the reference brake point', () => {
    const h = hint('T1', 120);
    expect(distanceToBrake(h, 380, 2000)).toEqual({ meters: 20, kind: 'brake' });
    expect(distanceToBrake({ ...h, referenceBrakePointM: null }, 380, 2000)).toEqual({
      meters: 120,
      kind: 'entry',
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Laps
// ---------------------------------------------------------------------------------------------

function ev(n: number, timeMs: number, sectors: number[], valid = true): LapCompletedEvent {
  return {
    sessionId: 's',
    lapId: `l${n}`,
    lapNumber: n,
    timeMs,
    sectorTimesMs: sectors,
    sectorStatus: sectors.map(() => 'slower'),
    valid,
    flags: valid ? [] : ['offTrack'],
    deltaMs: null,
    deltaReference: 'personalBest',
    isPersonalBest: false,
    isSessionBest: false,
    bestSectorIndex: null,
    fuelUsedL: 2.5,
    completedAt: n * 100_000,
  };
}

describe('lap statistics', () => {
  const rows: LapRow[] = [
    ev(1, 92_000, [30_000, 31_000, 31_000]),
    ev(2, 90_500, [30_200, 30_100, 30_200]),
    ev(3, 89_000, [29_800, 30_000, 29_200]),
    ev(4, 120_000, [29_000, 60_000, 31_000], false),
  ].map(lapRowFromEvent);

  it('finds the session best and the theoretical best from valid laps', () => {
    expect(sessionBestLap(rows)?.lapNumber).toBe(3);
    expect(bestSectors(rows)).toEqual([29_800, 30_000, 29_200]);
    expect(theoreticalBest(rows)).toBe(89_000);
    expect(theoreticalBest([])).toBeNull();
  });

  it('computes consistency (stddev within 107 %) and trend', () => {
    const c = consistency(rows)!;
    expect(c.count).toBe(3);
    expect(c.stddevMs).toBeCloseTo(1500, 0);
    const t = lapTrend(rows);
    expect(t.slopeMs).toBeCloseTo(-1500);
    expect(t.label).toBe('melhorando');
    expect(consistency(rows.slice(0, 1))).toBeNull();
  });

  it('merges rows by id and colours sectors', () => {
    const merged = mergeLapRows(rows.slice(0, 2), rows.slice(1));
    expect(merged.map((r) => r.lapNumber)).toEqual([1, 2, 3, 4]);
    const best = bestSectors(rows);
    expect(sectorCellStatus(rows[3]!, 0, best)).toBe('invalid');
    expect(sectorCellStatus(rows[0]!, 0, best)).toBe('slower');
    const restRow = { ...rows[2]!, sectorStatus: null };
    expect(sectorCellStatus(restRow, 0, best)).toBe('sessionBest');
  });
});

// ---------------------------------------------------------------------------------------------
// Fuel
// ---------------------------------------------------------------------------------------------

describe('fuel plan', () => {
  const lap = (l: number, total: number | null) =>
    ({ lap: l, totalLaps: total }) as unknown as LiveLapTiming;
  const fuel = (level: number, perLap: number | null, needed: number | null = null) => ({
    level,
    capacity: 100,
    perLapAvg: perLap,
    lapsRemaining: perLap ? level / perLap : null,
    neededToFinish: needed,
    energyRecovery: null,
  });

  it('computes laps left in a race', () => {
    expect(raceLapsLeft(lap(3, 10), 0.5)).toBeCloseTo(7.5);
    expect(raceLapsLeft(lap(0, 10), null)).toBe(10);
    expect(raceLapsLeft(lap(3, null), 0.5)).toBeNull();
  });

  it('warns when the fuel does not reach the flag', () => {
    const p = fuelPlan(fuel(10, 2.5), lap(3, 10), 0.5);
    expect(p.needed).toBeCloseTo(18.75);
    expect(p.missing).toBeCloseTo(8.75);
    expect(p.savePerLap).toBeCloseTo(8.75 / 7.5);
    expect(p.warnings[0]!.level).toBe('error');
    expect(p.warnings[0]!.text).toContain('faltam 8,8 L');
  });

  it('uses the core total when present and reports surplus', () => {
    const p = fuelPlan(fuel(30, 2.5, 20), lap(3, 10), 0.5);
    expect(p.needed).toBe(20);
    expect(p.surplus).toBe(10);
    expect(p.warnings[0]!.text).toContain('sobram');
  });

  it('has an informative state before the first lap', () => {
    const p = fuelPlan(fuel(30, null), lap(1, null), 0.2);
    expect(p.perLap).toBeNull();
    expect(p.warnings.map((w) => w.level)).toEqual(['info', 'info']);
  });
});

// ---------------------------------------------------------------------------------------------
// Widget layout
// ---------------------------------------------------------------------------------------------

describe('widget layout', () => {
  it('packs items in reading order like CSS grid', () => {
    const { items, rows } = packLayout(
      [
        { key: 'a', widget: 'delta', x: 0, y: 0, w: 2, h: 1 },
        { key: 'b', widget: 'gear', x: 0, y: 0, w: 1, h: 2 },
        { key: 'c', widget: 'speed', x: 0, y: 0, w: 2, h: 1 },
        { key: 'd', widget: 'fuel', x: 0, y: 0, w: 1, h: 1 },
      ],
      3,
    );
    expect(items.map((i) => [i.x, i.y])).toEqual([
      [0, 0],
      [2, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(rows).toBe(3);
  });

  it('reduces edits and keeps the default layout valid', () => {
    let l = sanitizeLayout(DEFAULT_CUSTOM_LAYOUT);
    expect(l.items.map((i) => i.key)).toEqual(DEFAULT_CUSTOM_LAYOUT.items.map((i) => i.key));
    expect(l.rows).toBe(3);
    l = reduceLayout(l, { type: 'add', widget: 'gear' });
    expect(l.items.at(-1)!.key).toBe('gear-2');
    l = reduceLayout(l, { type: 'move', key: 'gear-2', by: -1 });
    expect(l.items.at(-2)!.key).toBe('gear-2');
    const same = reduceLayout(l, { type: 'move', key: 'delta', by: -1 });
    expect(same).toBe(l);
    l = reduceLayout(l, { type: 'resize', key: 'delta', dw: 5, dh: 1 });
    expect(l.items[0]!.w).toBe(4);
    expect(l.items[0]!.h).toBe(2);
    l = reduceLayout(l, { type: 'setColumns', columns: 3 });
    expect(l.columns).toBe(3);
    expect(l.items.every((i) => i.w <= 3 && i.x + i.w <= 3)).toBe(true);
    l = reduceLayout(l, { type: 'remove', key: 'gear-2' });
    expect(l.items.some((i) => i.key === 'gear-2')).toBe(false);
    expect(reduceLayout(l, { type: 'reset' }).columns).toBe(4);
  });

  it('sanitizes untrusted layouts', () => {
    const l = sanitizeLayout({
      columns: 99,
      rows: 1,
      items: [
        { key: 'x', widget: 'nope', x: 0, y: 0, w: 1, h: 1 },
        { key: 'a', widget: 'delta', x: 0, y: 1, w: 20, h: 9 },
        { key: 'a', widget: 'speed', x: 0, y: 0, w: 1, h: 1 },
      ],
    });
    expect(l.columns).toBe(8);
    expect(l.items.map((i) => i.widget)).toEqual(['speed', 'delta']);
    expect(new Set(l.items.map((i) => i.key)).size).toBe(2);
    expect(l.items[1]!.w).toBe(8);
    expect(l.items[1]!.h).toBe(4);
    expect(sanitizeLayout(null).items.length).toBe(DEFAULT_CUSTOM_LAYOUT.items.length);
  });
});
