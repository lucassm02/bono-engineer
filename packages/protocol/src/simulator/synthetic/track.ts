/**
 * "Synthetic Ring": a closed circuit built from straights and constant-radius arcs, closed exactly
 * by solving for the length of two non-parallel straights. World X/Z in meters, Y up (gentle hills).
 *
 * Heading convention: heading θ = 0 points to +Z ("north"); direction = (sin θ, cos θ) in (x, z).
 * Positive curvature increases θ, which is a LEFT turn (counter-clockwise seen from above, Y up).
 */

import type { CornerDirection, CornerKind } from '@gt7/shared';

type SegmentDef =
  | { kind: 'straight'; length: number; adjustable?: boolean }
  | {
      kind: 'arc';
      radius: number;
      /** Signed turn angle in degrees (+ left, − right). */
      angleDeg: number;
      name: string;
      cornerKind: CornerKind;
    };

/** Layout of the Synthetic Ring (start/finish at the beginning of the first straight). */
const LAYOUT: SegmentDef[] = [
  { kind: 'straight', length: 820, adjustable: true }, // main straight
  { kind: 'arc', radius: 18, angleDeg: 175, name: 'Hairpin', cornerKind: 'hairpin' }, // T1
  { kind: 'straight', length: 260 },
  { kind: 'arc', radius: 60, angleDeg: -70, name: 'Curva do Lago', cornerKind: 'medium' }, // T2
  { kind: 'straight', length: 400, adjustable: true },
  { kind: 'arc', radius: 220, angleDeg: 80, name: 'Grande Curva', cornerKind: 'fast' }, // T3
  { kind: 'straight', length: 320 },
  { kind: 'arc', radius: 30, angleDeg: -60, name: 'Chicane 1', cornerKind: 'chicane' }, // T4
  { kind: 'straight', length: 25 },
  { kind: 'arc', radius: 30, angleDeg: 60, name: 'Chicane 2', cornerKind: 'chicane' }, // T5
  { kind: 'straight', length: 350 },
  { kind: 'arc', radius: 70, angleDeg: 95, name: 'Curva da Torre', cornerKind: 'medium' }, // T6
  { kind: 'straight', length: 260 },
  { kind: 'arc', radius: 300, angleDeg: -35, name: 'Kink', cornerKind: 'kink' }, // T7
  { kind: 'straight', length: 260 },
  { kind: 'arc', radius: 35, angleDeg: 110, name: 'Cotovelo', cornerKind: 'slow' }, // T8
  { kind: 'straight', length: 400 },
  { kind: 'arc', radius: 120, angleDeg: 45, name: 'Curva Rápida', cornerKind: 'fast' }, // T9
  { kind: 'straight', length: 150 },
  { kind: 'arc', radius: 50, angleDeg: -40, name: 'Última', cornerKind: 'medium' }, // T10
  { kind: 'straight', length: 120 },
];

export interface TrackSample {
  /** Distance from the start line (m). */
  s: number;
  x: number;
  y: number;
  z: number;
  /** Heading θ (rad), direction (sin θ, cos θ). */
  heading: number;
  /** Geometric signed curvature (1/m, + left). */
  curvature: number;
  /** Smoothed curvature used by the vehicle model (racing line transitions). */
  curvatureSmooth: number;
  /** Elevation gradient dy/ds. */
  slope: number;
}

export interface SyntheticCorner {
  id: string;
  index: number;
  name: string;
  entryM: number;
  apexM: number;
  exitM: number;
  direction: CornerDirection;
  kind: CornerKind;
  radiusM: number;
  angleDeg: number;
}

export interface SyntheticTrack {
  name: string;
  lengthM: number;
  /** Sampling step of `samples` (m). */
  stepM: number;
  /** Samples from s = 0 to s < lengthM. */
  samples: TrackSample[];
  /** Ground-truth corners (useful to validate corner detection). */
  corners: SyntheticCorner[];
}

interface BuiltSegment {
  def: SegmentDef;
  length: number;
  s0: number;
  x0: number;
  z0: number;
  h0: number;
  kappa: number;
}

function segLength(d: SegmentDef): number {
  return d.kind === 'straight' ? d.length : (d.radius * Math.abs(d.angleDeg) * Math.PI) / 180;
}

function displacement(h0: number, length: number, kappa: number): { dx: number; dz: number } {
  if (kappa === 0) return { dx: length * Math.sin(h0), dz: length * Math.cos(h0) };
  const h1 = h0 + kappa * length;
  return { dx: (Math.cos(h0) - Math.cos(h1)) / kappa, dz: (Math.sin(h1) - Math.sin(h0)) / kappa };
}

function kappaOf(d: SegmentDef): number {
  return d.kind === 'straight' ? 0 : Math.sign(d.angleDeg) / d.radius;
}

/** Solves the two adjustable straights so the loop closes exactly. */
function closeLayout(layout: SegmentDef[]): SegmentDef[] {
  const segs = layout.map((d) => ({ ...d }));
  const adj = segs
    .map((d, i) => ({ d, i }))
    .filter((e) => e.d.kind === 'straight' && e.d.adjustable);
  if (adj.length !== 2) throw new Error('layout needs exactly 2 adjustable straights');
  let h = 0;
  let ex = 0;
  let ez = 0;
  const headings: number[] = [];
  for (const d of segs) {
    headings.push(h);
    const k = kappaOf(d);
    const { dx, dz } = displacement(h, segLength(d), k);
    ex += dx;
    ez += dz;
    h += k * segLength(d);
  }
  const [a, b] = adj as [(typeof adj)[0], (typeof adj)[0]];
  const ha = headings[a.i]!;
  const hb = headings[b.i]!;
  // Δa·(sin ha, cos ha) + Δb·(sin hb, cos hb) = −(ex, ez)
  const det = Math.sin(ha) * Math.cos(hb) - Math.sin(hb) * Math.cos(ha);
  if (Math.abs(det) < 1e-6) throw new Error('adjustable straights are parallel');
  const da = (-ex * Math.cos(hb) + ez * Math.sin(hb)) / det;
  const db = (-ez * Math.sin(ha) + ex * Math.cos(ha)) / det;
  const sa = a.d as { kind: 'straight'; length: number };
  const sb = b.d as { kind: 'straight'; length: number };
  sa.length += da;
  sb.length += db;
  if (sa.length < 50 || sb.length < 50) {
    throw new Error(
      `layout closure produced short straight: ${sa.length.toFixed(0)} ${sb.length.toFixed(0)}`,
    );
  }
  return segs;
}

function smoothCircular(values: number[], window: number): number[] {
  const n = values.length;
  const half = Math.max(1, Math.floor(window / 2));
  const out = new Array<number>(n);
  let acc = 0;
  for (let i = -half; i <= half; i++) acc += values[((i % n) + n) % n]!;
  for (let i = 0; i < n; i++) {
    out[i] = acc / (2 * half + 1);
    acc += values[(i + half + 1) % n]! - values[(((i - half) % n) + n) % n]!;
  }
  return out;
}

let cached: SyntheticTrack | null = null;

/** Builds (once) and returns the Synthetic Ring sampled every 1 m. */
export function getSyntheticTrack(): SyntheticTrack {
  if (cached) return cached;
  const segs = closeLayout(LAYOUT);
  const built: BuiltSegment[] = [];
  let s = 0;
  let x = 0;
  let z = 0;
  let h = 0;
  for (const d of segs) {
    const length = segLength(d);
    const kappa = kappaOf(d);
    built.push({ def: d, length, s0: s, x0: x, z0: z, h0: h, kappa });
    const { dx, dz } = displacement(h, length, kappa);
    x += dx;
    z += dz;
    h += kappa * length;
    s += length;
  }
  const lengthM = s;
  const stepM = 1;
  const n = Math.floor(lengthM / stepM);
  const elev = (sv: number) => {
    const u = (2 * Math.PI * sv) / lengthM;
    return 8 * Math.sin(u) + 4 * Math.sin(3 * u + 1) + 1.5 * Math.sin(7 * u + 2);
  };
  const samples: TrackSample[] = [];
  let si = 0;
  for (let i = 0; i < n; i++) {
    const sv = i * stepM;
    while (si < built.length - 1 && sv >= built[si]!.s0 + built[si]!.length) si++;
    const b = built[si]!;
    const ls = sv - b.s0;
    const { dx, dz } = displacement(b.h0, ls, b.kappa);
    const y = elev(sv);
    samples.push({
      s: sv,
      x: b.x0 + dx,
      y,
      z: b.z0 + dz,
      heading: b.h0 + b.kappa * ls,
      curvature: b.kappa,
      curvatureSmooth: 0,
      slope: (elev(sv + 0.5) - elev(sv - 0.5)) / 1,
    });
  }
  const smooth = smoothCircular(
    samples.map((p) => p.curvature),
    31,
  );
  samples.forEach((p, i) => {
    p.curvatureSmooth = smooth[i]!;
  });

  const corners: SyntheticCorner[] = [];
  for (const b of built) {
    if (b.def.kind !== 'arc') continue;
    const idx = corners.length;
    corners.push({
      id: `T${idx + 1}`,
      index: idx,
      name: b.def.name,
      entryM: b.s0,
      apexM: b.s0 + b.length / 2,
      exitM: b.s0 + b.length,
      direction: b.def.angleDeg > 0 ? 'left' : 'right',
      kind: b.def.cornerKind,
      radiusM: b.def.radius,
      angleDeg: b.def.angleDeg,
    });
  }
  cached = { name: 'Synthetic Ring', lengthM, stepM, samples, corners };
  return cached;
}

/** Interpolated track sample at distance s (wraps around the lap). */
export function sampleTrackAt(track: SyntheticTrack, s: number): TrackSample {
  const L = track.lengthM;
  let sv = s % L;
  if (sv < 0) sv += L;
  const n = track.samples.length;
  const f = sv / track.stepM;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const t = f - Math.floor(f);
  const a = track.samples[i0]!;
  const b = track.samples[i1]!;
  // heading may wrap by 2π between samples: interpolate the difference
  let dh = b.heading - a.heading;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  const lerp = (u: number, v: number) => u + (v - u) * t;
  return {
    s: sv,
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    z: lerp(a.z, b.z),
    heading: a.heading + dh * t,
    curvature: t < 0.5 ? a.curvature : b.curvature,
    curvatureSmooth: lerp(a.curvatureSmooth, b.curvatureSmooth),
    slope: lerp(a.slope, b.slope),
  };
}
