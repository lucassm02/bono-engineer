import { describe, expect, it } from 'vitest';
import realLap from './fixtures/trial-mountain-real-lap.json';
import {
  getKnownLine,
  getTrackLayout,
  hasKnownLine,
  knownLineCount,
  listTrackLayouts,
  matchKnownTrack,
  recognizeTrack,
} from './index.ts';

const real = { x: realLap.x, z: realLap.z };

/** Densifies a closed line to ~3 m spacing (what a 60 Hz lap looks like) with a lateral wobble. */
function drive(
  x: readonly number[],
  z: readonly number[],
  opts: { amp?: number; reverse?: boolean; shift?: number } = {},
): { x: number[]; z: number[] } {
  const px = [...x];
  const pz = [...z];
  if (opts.reverse) {
    px.reverse();
    pz.reverse();
  }
  const n = px.length;
  const ox: number[] = [];
  const oz: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const L = Math.hypot(px[j]! - px[i]!, pz[j]! - pz[i]!);
    const k = Math.max(1, Math.round(L / 3));
    const tx = (px[j]! - px[i]!) / (L || 1);
    const tz = (pz[j]! - pz[i]!) / (L || 1);
    for (let s = 0; s < k; s++) {
      const f = s / k;
      acc += L / k;
      const off = (opts.amp ?? 0) * Math.sin(acc / 180);
      ox.push(px[i]! + (px[j]! - px[i]!) * f - tz * off);
      oz.push(pz[i]! + (pz[j]! - pz[i]!) * f + tx * off);
    }
  }
  const s = opts.shift ?? 0;
  return { x: ox.slice(s).concat(ox.slice(0, s)), z: oz.slice(s).concat(oz.slice(0, s)) };
}

function distanceToLine(
  line: { x: readonly number[]; z: readonly number[] },
  px: number,
  pz: number,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < line.x.length; i++) {
    const j = (i + 1) % line.x.length;
    const ax = line.x[i]!;
    const az = line.z[i]!;
    const dx = line.x[j]! - ax;
    const dz = line.z[j]! - az;
    const u = Math.max(
      0,
      Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)),
    );
    best = Math.min(best, Math.hypot(ax + dx * u - px, az + dz * u - pz));
  }
  return best;
}

describe('coordinate system (real Trial Mountain session)', () => {
  it('the app’s X/Z overlay the published line directly: mean < 4 m, max < 15 m, no transform', () => {
    const line = getKnownLine('802508')!;
    const d = real.x.map((x, i) => distanceToLine(line, x, real.z[i]!));
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    expect(mean).toBeLessThan(4);
    expect(Math.max(...d)).toBeLessThan(15);
    // mirroring does NOT fit (so the match above is not an accident)
    const m = real.x.map((x, i) => distanceToLine(line, -x, real.z[i]!));
    expect(m.reduce((a, b) => a + b, 0) / m.length).toBeGreaterThan(30);
  });

  it('the lap starts at the layout’s start/finish point', () => {
    const t = getTrackLayout('802508')!;
    expect(Math.hypot(real.x[0]! - t.start!.x, real.z[0]! - t.start!.z)).toBeLessThan(40);
  });
});

describe('matchKnownTrack', () => {
  it('knows a driving line for 121 of the 122 layouts', () => {
    expect(knownLineCount()).toBe(121);
    expect(hasKnownLine('802508')).toBe(true);
    expect(hasKnownLine('26514b')).toBe(true); // reverse reuses the forward line
    expect(
      listTrackLayouts()
        .filter((l) => !hasKnownLine(l.id))
        .map((l) => l.officialName),
    ).toEqual(['Nürburgring Endurance II']);
  });

  it('names the real Trial Mountain lap automatically', () => {
    const m = matchKnownTrack(real);
    expect(m.auto?.layout.officialName).toBe('Trial Mountain Circuit');
    expect(m.auto?.confidence).toBe('high');
    expect(m.auto?.direction).toBeGreaterThan(0.95);
    expect(m.auto?.meanDevM).toBeLessThan(4);
    expect(m.auto?.lengthOk).toBe(true);
    expect(m.auto!.lengthErrRel).toBeGreaterThan(-0.03);
    expect(m.auto!.lengthErrRel).toBeLessThan(0);
    expect(m.ambiguous).toBe(false);
    // the reverse layout (same length) is not a candidate: the lap was driven the other way round
    expect(m.candidates.map((c) => c.layout.officialName)).not.toContain(
      'Trial Mountain Circuit (Reverse)',
    );
  });

  it('survives a lateral offset of a few metres and a different start point', () => {
    const m = matchKnownTrack(drive(real.x, real.z, { amp: 5, shift: 700 }));
    expect(m.auto?.layout.officialName).toBe('Trial Mountain Circuit');
  });

  it('tells the reverse layout apart by the driving direction', () => {
    const m = matchKnownTrack(drive(real.x, real.z, { reverse: true }));
    expect(m.candidates[0]?.layout.officialName).toBe('Trial Mountain Circuit (Reverse)');
    expect(m.candidates.every((c) => c.layout.officialName !== 'Trial Mountain Circuit')).toBe(
      true,
    );
  });

  it('recognises each layout from its own wobbled line and never names a wrong one', () => {
    let top1 = 0;
    let auto = 0;
    let tried = 0;
    for (const l of listTrackLayouts()) {
      const k = getKnownLine(l.id);
      if (!k || k.partial) continue;
      const d = drive(k.x, k.z, { amp: 4 });
      const m = matchKnownTrack(d);
      // lines whose own length disagrees with the official one (flagged by the source) are
      // outside the length pre-filter by design
      if (Math.abs(m.lengthM / l.lengthM - 1) > 0.05) continue;
      tried++;
      if (m.candidates[0]?.layout.id === l.id) top1++;
      if (m.auto) {
        auto++;
        expect(m.auto.layout.id, `${l.displayName} named as ${m.auto.layout.displayName}`).toBe(
          l.id,
        );
      }
    }
    expect(tried).toBeGreaterThan(100);
    expect(top1 / tried).toBeGreaterThan(0.95);
    expect(auto / tried).toBeGreaterThan(0.75);
  }, 60_000);

  it('does not name look-alike layouts by itself: Monza with and without the chicane', () => {
    const monza = getKnownLine('e6817f')!;
    const m = matchKnownTrack(drive(monza.x, monza.z, { amp: 8 }));
    const names = m.candidates.slice(0, 2).map((c) => c.layout.officialName);
    expect(names).toContain('Autodromo Nazionale Monza');
    expect(names).toContain('Autodromo Nazionale Monza No Chicane');
    expect(m.auto).toBeNull();
    expect(m.ambiguous).toBe(true);
  });

  it('does not recognise a track it does not know', () => {
    const n = 200;
    const R = 500;
    const ring = {
      x: Array.from({ length: n }, (_, i) => R * Math.cos((2 * Math.PI * i) / n)),
      z: Array.from({ length: n }, (_, i) => R * Math.sin((2 * Math.PI * i) / n)),
    };
    expect(matchKnownTrack(drive(ring.x, ring.z)).auto).toBeNull();
    // a known line moved 300 m away is not recognised either
    const moved = drive(
      real.x.map((x) => x + 300),
      real.z.map((z) => z - 300),
    );
    expect(matchKnownTrack(moved).auto).toBeNull();
  });

  it('refuses garbage: too few points, a tiny loop, NaN', () => {
    expect(matchKnownTrack({ x: [], z: [] }).candidates).toEqual([]);
    expect(matchKnownTrack({ x: [0, 1, 2], z: [0, 1, 2] }).auto).toBeNull();
    const tiny = {
      x: Array.from({ length: 100 }, (_, i) => Math.cos(i / 16)),
      z: Array.from({ length: 100 }, (_, i) => Math.sin(i / 16)),
    };
    expect(matchKnownTrack(tiny).auto).toBeNull();
    expect(matchKnownTrack({ x: real.x.map(() => Number.NaN), z: real.z }).auto).toBeNull();
  });
});

describe('recognizeTrack (what the naming prompt shows)', () => {
  it('uses the geometry when there is a line', () => {
    const r = recognizeTrack(5361, real);
    expect(r.usedGeometry).toBe(true);
    expect(r.strong).toBe(true);
    expect(r.candidates[0]).toMatchObject({
      name: 'Trial Mountain Circuit',
      layout: null,
      basis: 'geometry',
      confidence: 'high',
      officialLengthM: 5434,
      turns: 15,
    });
    expect(r.candidates[0]!.lookAlikes).toContain('Trial Mountain Circuit – Reverse');
  });

  it('falls back to the length window (candidates, never strong) without a line', () => {
    const r = recognizeTrack(5361, null);
    expect(r.usedGeometry).toBe(false);
    expect(r.strong).toBe(false);
    expect(r.candidates.map((c) => c.displayName)).toContain('Trial Mountain Circuit');
    expect(r.candidates.every((c) => c.basis === 'length' && c.confidence === 'low')).toBe(true);
    expect(recognizeTrack(100, null).candidates).toEqual([]);
  });
});
