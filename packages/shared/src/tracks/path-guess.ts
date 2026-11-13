/**
 * Recognition of the track from a PARTIAL path: the car that runs in the background of the
 * pre-race screen (the game plays a lap while you choose the setup) sends real position packets,
 * so the track can be named before the driver drives a single metre.
 *
 * `matchKnownTrack` (./match.ts) needs a whole closed lap. Here the driven path is open and short,
 * so only the distance from the driven samples to each known line counts (plus the driving
 * direction); the layout length is only used once the path closes on itself (one full loop).
 *
 * Verified on a real PS5 (Trial Mountain, Suzuka East Course, Road Atlanta): the right circuit won
 * with 100-150 m of path, the runner-up of another circuit cost 4× to 30× more. Layouts of one
 * circuit share their first metres (Suzuka Full / East), so those answer at `venue` level until the
 * path closes.
 *
 * Pure and dependency-free (isomorphic).
 */

import { lengthCompatible, listTrackLayouts, type TrackLayout } from './catalog.ts';
import { getKnownLine } from './match.ts';

export const PATH_GUESS_THRESHOLDS = {
  /** Shorter paths are never matched (m). */
  minPathM: 100,
  /** Best candidate above this cost (m, mean + 0.5 × p95 of the deviation) is not reported. */
  maxCost: 25,
  /** A rival must cost at least this factor × the best… */
  rivalFactor: 2,
  /** …and this much more (m), or it is "close". */
  rivalAdd: 15,
  /** At most this many samples of the path enter the comparison. */
  maxSamples: 60,
  /** Samples closer than this to the previous one are dropped (m). */
  minStepM: 4,
  /** The path is a closed loop when it comes back to its first point within this distance (m)… */
  closeM: 40,
  /** …after being at least this far from it (m)… */
  leaveM: 150,
  /** …and having run at least this far (m). */
  minLoopM: 400,
} as const;

export interface PathGuessCandidate {
  layout: TrackLayout;
  /** mean + 0.5 × p95 of the distance from the driven samples to the known line (m). */
  cost: number;
  meanDevM: number;
}

/**
 * - `layout`: one layout fits and nothing else competes.
 * - `venue`: several layouts of one circuit fit equally (they share the path so far).
 * - `none`: too little path, no line fits, or several circuits compete.
 */
export type PathGuessLevel = 'layout' | 'venue' | 'none';

export interface PathGuess {
  level: PathGuessLevel;
  /** Circuit to show ("Suzuka Circuit"); null for `none`. */
  venue: string | null;
  /** Layout label ("Reverse"), only for `layout`; null when the circuit has a single layout. */
  layoutLabel: string | null;
  /** Catalogue id, only for `layout`. */
  layoutId: string | null;
  /** Best first (at most 5). */
  candidates: PathGuessCandidate[];
  /** Length of the path used (m). */
  pathM: number;
  /** The path closed on itself (one loop), so the layout length was used. */
  closed: boolean;
  /** Short explanation (pt-BR) for logs. */
  reason: string;
}

export interface PathPoints {
  x: ArrayLike<number>;
  z: ArrayLike<number>;
}

interface Ring {
  x: Float64Array;
  z: Float64Array;
  cum: Float64Array;
  total: number;
}

let RINGS: Map<string, { layout: TrackLayout; ring: Ring }> | null = null;

function rings(): Map<string, { layout: TrackLayout; ring: Ring }> {
  if (RINGS) return RINGS;
  const out = new Map<string, { layout: TrackLayout; ring: Ring }>();
  for (const layout of listTrackLayouts()) {
    const k = getKnownLine(layout.id);
    if (!k || k.x.length < 3) continue;
    const n = k.x.length;
    const cum = new Float64Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) {
      cum[i] = s;
      const j = (i + 1) % n;
      s += Math.hypot(k.x[j]! - k.x[i]!, k.z[j]! - k.z[i]!);
    }
    out.set(layout.id, {
      layout,
      ring: { x: Float64Array.from(k.x), z: Float64Array.from(k.z), cum, total: s },
    });
  }
  RINGS = out;
  return out;
}

/** Distance from a point to a closed ring and the arc length (m) of the closest point. */
function project(ring: Ring, x: number, z: number): { d: number; s: number } {
  const n = ring.x.length;
  let best = Number.POSITIVE_INFINITY;
  let bestS = 0;
  for (let a = 0; a < n; a++) {
    const b = a + 1 === n ? 0 : a + 1;
    const ax = ring.x[a]!;
    const az = ring.z[a]!;
    const dx = ring.x[b]! - ax;
    const dz = ring.z[b]! - az;
    const len2 = dx * dx + dz * dz;
    let u = len2 > 1e-12 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    u = Math.max(0, Math.min(1, u));
    const ex = ax + dx * u - x;
    const ez = az + dz * u - z;
    const e = ex * ex + ez * ez;
    if (e < best) {
      best = e;
      bestS = ring.cum[a]! + u * Math.sqrt(len2);
    }
  }
  return { d: Math.sqrt(best), s: bestS };
}

interface Cleaned {
  x: number[];
  z: number[];
  pathM: number;
}

/** Finite points, no samples closer than `minStepM` to the previous one. */
function clean(line: PathPoints, minStepM: number): Cleaned {
  const x: number[] = [];
  const z: number[] = [];
  let pathM = 0;
  const n = Math.min(line.x.length, line.z.length);
  for (let i = 0; i < n; i++) {
    const px = line.x[i]!;
    const pz = line.z[i]!;
    if (!Number.isFinite(px) || !Number.isFinite(pz)) continue;
    const k = x.length - 1;
    if (k >= 0) {
      const step = Math.hypot(px - x[k]!, pz - z[k]!);
      if (step < minStepM) continue;
      pathM += step;
    }
    x.push(px);
    z.push(pz);
  }
  return { x, z, pathM };
}

/** At most `max` samples spread evenly along the arc length (first and last kept). */
function thin(c: Cleaned, max: number): { x: number[]; z: number[] } {
  if (c.x.length <= max) return { x: c.x, z: c.z };
  const outX: number[] = [];
  const outZ: number[] = [];
  const step = c.pathM / (max - 1);
  let acc = 0;
  let next = 0;
  for (let i = 0; i < c.x.length; i++) {
    if (i > 0) acc += Math.hypot(c.x[i]! - c.x[i - 1]!, c.z[i]! - c.z[i - 1]!);
    if (acc >= next || i === c.x.length - 1) {
      outX.push(c.x[i]!);
      outZ.push(c.z[i]!);
      next = acc + step;
    }
  }
  return { x: outX, z: outZ };
}

/** Did the path leave its first point and come back to it (one full loop)? */
export function pathIsClosed(line: PathPoints): boolean {
  const T = PATH_GUESS_THRESHOLDS;
  const c = clean(line, T.minStepM);
  if (c.x.length < 3 || c.pathM < T.minLoopM) return false;
  let left = false;
  const x0 = c.x[0]!;
  const z0 = c.z[0]!;
  for (let i = 1; i < c.x.length; i++) {
    const d = Math.hypot(c.x[i]! - x0, c.z[i]! - z0);
    if (d >= T.leaveM) left = true;
    else if (left && d <= T.closeM) return true;
  }
  return false;
}

const NONE = (pathM: number, reason: string): PathGuess => ({
  level: 'none',
  venue: null,
  layoutLabel: null,
  layoutId: null,
  candidates: [],
  pathM,
  closed: false,
  reason,
});

/**
 * Names the circuit (and the layout when it is certain) of an open path in driving order.
 * `closed`: the path is exactly one loop (first point ≈ last point), so the layout length counts.
 */
export function guessLayoutByPath(line: PathPoints, opts: { closed?: boolean } = {}): PathGuess {
  const T = PATH_GUESS_THRESHOLDS;
  const c = clean(line, T.minStepM);
  if (c.x.length < 8 || c.pathM < T.minPathM) {
    return NONE(c.pathM, 'Pouco trajeto para reconhecer a pista.');
  }
  const closed = opts.closed === true;
  const s = thin(c, T.maxSamples);
  const n = s.x.length;
  const out: PathGuessCandidate[] = [];

  for (const { layout, ring } of rings().values()) {
    if (closed && !lengthCompatible(c.pathM, layout.lengthM)) continue;
    // cheap reject: the first, middle and last samples must be near the line
    const probe = [0, n >> 1, n - 1];
    if (probe.some((i) => project(ring, s.x[i]!, s.z[i]!).d > 120)) continue;
    const d = new Float64Array(n);
    const arc = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = project(ring, s.x[i]!, s.z[i]!);
      d[i] = p.d;
      arc[i] = p.s;
    }
    // driving direction: net arc length advanced along the line (m); negative = reverse
    let adv = 0;
    for (let i = 1; i < n; i++) {
      let step = arc[i]! - arc[i - 1]!;
      if (step > ring.total / 2) step -= ring.total;
      else if (step < -ring.total / 2) step += ring.total;
      adv += step;
    }
    if (adv < 0.5 * c.pathM) continue;
    const sorted = Float64Array.from(d).sort();
    let mean = 0;
    for (let i = 0; i < n; i++) mean += d[i]!;
    mean /= n;
    const p95 = sorted[Math.min(n - 1, Math.floor(0.95 * n))]!;
    out.push({ layout, cost: mean + 0.5 * p95, meanDevM: mean });
  }

  out.sort((a, b) => a.cost - b.cost);
  const candidates = out.slice(0, 5);
  const best = candidates[0];
  if (!best || best.cost > T.maxCost) {
    return { ...NONE(c.pathM, 'Nenhuma pista conhecida tem esse trajeto.'), closed };
  }
  const close = (cand: PathGuessCandidate) =>
    cand.cost < Math.max(best.cost * T.rivalFactor, best.cost + T.rivalAdd);
  const rivals = candidates.slice(1).filter((x) => x.layout.venue !== best.layout.venue);
  if (rivals.some(close)) {
    return {
      ...NONE(c.pathM, 'Mais de um circuito tem esse trajeto: aguardando mais pista.'),
      candidates,
      closed,
    };
  }
  const siblings = candidates.slice(1).filter((x) => x.layout.venue === best.layout.venue);
  if (siblings.some(close)) {
    return {
      level: 'venue',
      venue: best.layout.venue,
      layoutLabel: null,
      layoutId: null,
      candidates,
      pathM: c.pathM,
      closed,
      reason: `Circuito ${best.layout.venue}; o layout depende de uma volta completa.`,
    };
  }
  return {
    level: 'layout',
    venue: best.layout.venue,
    layoutLabel: best.layout.layoutLabel,
    layoutId: best.layout.id,
    candidates,
    pathM: c.pathM,
    closed,
    reason: `Trajeto de ${best.layout.displayName} (desvio médio ${best.meanDevM.toFixed(1)} m).`,
  };
}
