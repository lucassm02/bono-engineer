/**
 * Recognition of a GT7 layout from the line a lap was driven on.
 *
 * The telemetry packet has no track id, but its X/Z are the game's world coordinates and the same
 * ones the community published driving lines in (gt7-datalogger-track-data, gt-telemetry): verified
 * on a real Trial Mountain session (direct overlay, no rotation/mirroring/scale: mean 2.4 m, max
 * 11 m against the 20 m survey line). So a lap can be compared directly with the embedded lines
 * (./geometry.ts, simplified to ~100-300 points per layout).
 *
 * The comparison is the distance between the two closed polylines (mean, p95 and p99 of the
 * distance from every driven sample to the known line and back: tolerant to a lateral offset of a
 * few metres, but a missing chicane shows up in the back-distance), plus the driving direction (so
 * a layout is not confused with its reverse) and the length window of ./catalog.ts.
 *
 * Product rule: a name is applied AUTOMATICALLY only for a strong, unambiguous match
 * (`KnownTrackMatch.auto`); everything else is a suggestion that needs a click.
 *
 * Pure and dependency-free (isomorphic).
 */

import { lengthCompatible, lengthErrorRel, listTrackLayouts, type TrackLayout } from './catalog.ts';
import { TRACK_GEOMETRY_DATA } from './geometry.ts';

export type GeometrySource = 'survey' | 'capture' | 'grid';

export type MatchConfidence = 'high' | 'medium' | 'low';

/** Tolerances of the recognizer (metres unless noted). */
export const MATCH_THRESHOLDS = {
  /** Candidates are only considered when measured/official length is inside this ratio range. */
  prefilterRatio: [0.93, 1.03],
  /** Normalised cost (see {@link KnownTrackCandidate.cost}) for "high" and "medium". */
  highCost: 15,
  mediumCost: 30,
  /** Candidates above this normalised cost are not reported. */
  maxCost: 80,
  /** Mean (symmetric) deviation for "high". */
  highMeanDev: 6.5,
  /** Minimum driving-direction agreement (+1 same way, −1 reversed). */
  minDirection: 0.8,
  /** Runner-up must cost at least this factor × the best, and this much more (metres). */
  marginFactor: 2,
  marginAdd: 8,
  /** Laps shorter than this are never matched (m). */
  minLapM: 400,
} as const;

export interface KnownTrackCandidate {
  layout: TrackLayout;
  confidence: MatchConfidence;
  /**
   * Distance cost in metres, normalised by the quality of the known line (a 16 m-grid line is
   * noisier than a surveyed one): mean + 0.5 × p95 + 0.25 × p99 of the symmetric deviation. 0 =
   * identical lines; a real lap against its surveyed line is typically 5-12.
   */
  cost: number;
  meanDevM: number;
  p95DevM: number;
  p99DevM: number;
  /** `(measured − official) / official` length. */
  lengthErrRel: number;
  /** Measured length is inside the asymmetric window of the catalogue. */
  lengthOk: boolean;
  /** Distance from the first driven point to the layout's start/finish point (null: unknown). */
  startDistM: number | null;
  /** +1: driven in the same direction as the known line; −1: reversed. */
  direction: number;
  geometrySource: GeometrySource;
  /** The known line is a truncated capture (never named automatically). */
  partialGeometry: boolean;
}

export interface KnownTrackMatch {
  /** Length of the driven lap (m). */
  lengthM: number;
  /** Best first. */
  candidates: KnownTrackCandidate[];
  /** Strong and unambiguous: the only case where a name may be applied without a click. */
  auto: KnownTrackCandidate | null;
  /** The two best candidates are too close to call (reverse/look-alike layouts). */
  ambiguous: boolean;
  /** Short explanation (pt-BR) for logs/UI. */
  reason: string;
}

export interface LapLine {
  x: ArrayLike<number>;
  z: ArrayLike<number>;
}

// ---------------------------------------------------------------------------------------------
// Known lines
// ---------------------------------------------------------------------------------------------

interface KnownLine {
  layout: TrackLayout;
  x: Float64Array;
  z: Float64Array;
  /** Cumulative arc length at each vertex (closed ring: length = total). */
  cum: Float64Array;
  total: number;
  source: GeometrySource;
  partial: boolean;
  flagged: boolean;
  /** Dense copy (≤ 12 m spacing) used for the "known line → driven line" distances. */
  denseX: Float64Array;
  denseZ: Float64Array;
}

const SOURCES: GeometrySource[] = ['survey', 'capture', 'grid'];
/** Multiplier of the deviation allowed for a line, by source quality. */
const SOURCE_NOISE: Record<GeometrySource, number> = { survey: 1, capture: 1, grid: 1.8 };

function ringCum(x: ArrayLike<number>, z: ArrayLike<number>): { cum: Float64Array; total: number } {
  const n = x.length;
  const cum = new Float64Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    cum[i] = s;
    const j = (i + 1) % n;
    s += Math.hypot(x[j]! - x[i]!, z[j]! - z[i]!);
  }
  return { cum, total: s };
}

/** Resamples a closed ring every `step` metres (at most `maxN` points). */
function resampleRing(
  x: ArrayLike<number>,
  z: ArrayLike<number>,
  step: number,
  maxN: number,
): { x: Float64Array; z: Float64Array; total: number } {
  const { cum, total } = ringCum(x, z);
  const n = x.length;
  const count = Math.max(8, Math.min(maxN, Math.ceil(total / step)));
  const ox = new Float64Array(count);
  const oz = new Float64Array(count);
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const s = (k / count) * total;
    while (seg < n - 1 && cum[seg + 1]! <= s) seg++;
    const j = (seg + 1) % n;
    const segLen = (seg === n - 1 ? total : cum[seg + 1]!) - cum[seg]!;
    const f = segLen > 1e-9 ? (s - cum[seg]!) / segLen : 0;
    ox[k] = x[seg]! + (x[j]! - x[seg]!) * f;
    oz[k] = z[seg]! + (z[j]! - z[seg]!) * f;
  }
  return { x: ox, z: oz, total };
}

function decodePacked(packed: readonly number[]): { x: number[]; z: number[] } {
  const x: number[] = [];
  const z: number[] = [];
  let px = 0;
  let pz = 0;
  for (let i = 0; i + 1 < packed.length; i += 2) {
    px += packed[i]!;
    pz += packed[i + 1]!;
    x.push(px);
    z.push(pz);
  }
  return { x, z };
}

let LINES: Map<string, KnownLine> | null = null;

function knownLines(): Map<string, KnownLine> {
  if (LINES) return LINES;
  const forward = new Map<
    string,
    { x: number[]; z: number[]; row: (typeof TRACK_GEOMETRY_DATA)[number] }
  >();
  for (const row of TRACK_GEOMETRY_DATA) forward.set(row[0], { ...decodePacked(row[4]), row });
  const out = new Map<string, KnownLine>();
  for (const layout of listTrackLayouts()) {
    const base = forward.get(layout.reverseOf ?? layout.id);
    if (!base) continue;
    let xs = base.x;
    let zs = base.z;
    if (layout.reverse) {
      xs = [...xs].reverse();
      zs = [...zs].reverse();
    }
    const { cum, total } = ringCum(xs, zs);
    const dense = resampleRing(xs, zs, 12, 2500);
    out.set(layout.id, {
      layout,
      x: Float64Array.from(xs),
      z: Float64Array.from(zs),
      cum,
      total,
      source: SOURCES[base.row[1]] ?? 'grid',
      flagged: base.row[2] === 1,
      partial: base.row[3] === 1,
      denseX: dense.x,
      denseZ: dense.z,
    });
  }
  LINES = out;
  return out;
}

/** Does the catalogue have a driving line for this layout? */
export function hasKnownLine(layoutId: string): boolean {
  return knownLines().has(layoutId);
}

/** Number of layouts the recognizer can identify. */
export function knownLineCount(): number {
  return knownLines().size;
}

/** The embedded line of a layout (closed ring, in the direction of the layout), or null. */
export function getKnownLine(
  layoutId: string,
): { x: readonly number[]; z: readonly number[]; source: GeometrySource; partial: boolean } | null {
  const k = knownLines().get(layoutId);
  return k
    ? { x: Array.from(k.x), z: Array.from(k.z), source: k.source, partial: k.partial }
    : null;
}

// ---------------------------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------------------------

/**
 * For each query point: distance to the closed polyline and the arc-length fraction (0..1) of the
 * closest point. `cum`/`total` are those of the polyline.
 */
function project(
  qx: Float64Array,
  qz: Float64Array,
  px: Float64Array,
  pz: Float64Array,
  cum: Float64Array,
  total: number,
  wantT: boolean,
): { d: Float64Array; t: Float64Array | null } {
  const n = px.length;
  const d = new Float64Array(qx.length);
  const t = wantT ? new Float64Array(qx.length) : null;
  for (let i = 0; i < qx.length; i++) {
    const x = qx[i]!;
    const z = qz[i]!;
    let best = Number.POSITIVE_INFINITY;
    let bestT = 0;
    for (let a = 0; a < n; a++) {
      const b = a + 1 === n ? 0 : a + 1;
      const ax = px[a]!;
      const az = pz[a]!;
      const dx = px[b]! - ax;
      const dz = pz[b]! - az;
      const len2 = dx * dx + dz * dz;
      let u = len2 > 1e-12 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
      u = Math.max(0, Math.min(1, u));
      const ex = ax + dx * u - x;
      const ez = az + dz * u - z;
      const e = ex * ex + ez * ez;
      if (e < best) {
        best = e;
        if (t) bestT = cum[a]! + u * Math.sqrt(len2);
      }
    }
    d[i] = Math.sqrt(best);
    if (t) t[i] = total > 0 ? bestT / total : 0;
  }
  return { d, t };
}

function quantile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

function mean(a: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return a.length ? s / a.length : 0;
}

/** Net number of laps the projections advance along the known line (+1: same direction). */
function directionOf(t: Float64Array): number {
  let acc = 0;
  for (let i = 0; i < t.length; i++) {
    let d = t[(i + 1) % t.length]! - t[i]!;
    if (d > 0.5) d -= 1;
    else if (d < -0.5) d += 1;
    acc += d;
  }
  return acc;
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/** Cleans a driven line: finite points, no consecutive duplicates. */
function cleanLine(line: LapLine): { x: number[]; z: number[] } {
  const xs: number[] = [];
  const zs: number[] = [];
  const n = Math.min(line.x.length, line.z.length);
  for (let i = 0; i < n; i++) {
    const x = line.x[i]!;
    const z = line.z[i]!;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const k = xs.length - 1;
    if (k >= 0 && Math.hypot(x - xs[k]!, z - zs[k]!) < 0.5) continue;
    xs.push(x);
    zs.push(z);
  }
  return { x: xs, z: zs };
}

export interface MatchOptions {
  /** Maximum number of candidates returned (default 5). */
  maxCandidates?: number;
}

/**
 * Compares one complete lap (X/Z samples in driving order, the first one at the start/finish line)
 * with the known lines and returns the candidates, best first.
 */
export function matchKnownTrack(line: LapLine, opts: MatchOptions = {}): KnownTrackMatch {
  const T = MATCH_THRESHOLDS;
  const clean = cleanLine(line);
  const none = (lengthM: number, reason: string): KnownTrackMatch => ({
    lengthM,
    candidates: [],
    auto: null,
    ambiguous: false,
    reason,
  });
  if (clean.x.length < 20) return none(0, 'Poucos pontos para reconhecer a pista.');
  const first = { x: clean.x[0]!, z: clean.z[0]! };
  const driven = resampleRing(clean.x, clean.z, 8, 1500);
  const lengthM = driven.total;
  if (!(lengthM >= T.minLapM)) return none(lengthM, 'Volta curta demais para reconhecer a pista.');
  const { cum: drivenCum, total: drivenTotal } = ringCum(driven.x, driven.z);

  const out: KnownTrackCandidate[] = [];
  for (const k of knownLines().values()) {
    const ratio = lengthM / k.layout.lengthM;
    if (ratio < T.prefilterRatio[0] || ratio > T.prefilterRatio[1]) continue;
    const a = project(driven.x, driven.z, k.x, k.z, k.cum, k.total, true);
    const direction = directionOf(a.t!);
    if (direction < T.minDirection) continue;
    const b = project(k.denseX, k.denseZ, driven.x, driven.z, drivenCum, drivenTotal, false);
    const meanDev = (mean(a.d) + mean(b.d)) / 2;
    const sa = Float64Array.from(a.d).sort();
    const sb = Float64Array.from(b.d).sort();
    const p95 = Math.max(quantile(sa, 0.95), quantile(sb, 0.95));
    const p99 = Math.max(quantile(sa, 0.99), quantile(sb, 0.99));
    const noise = SOURCE_NOISE[k.source];
    const cost = (meanDev + 0.5 * p95 + 0.25 * p99) / noise;
    if (cost > T.maxCost) continue;
    const lengthOk = lengthCompatible(lengthM, k.layout.lengthM);
    const startDistM = k.layout.start
      ? Math.hypot(first.x - k.layout.start.x, first.z - k.layout.start.z)
      : null;
    const strong =
      cost <= T.highCost &&
      meanDev / noise <= T.highMeanDev &&
      direction >= T.minDirection &&
      lengthOk &&
      !k.partial &&
      !k.flagged;
    const confidence: MatchConfidence = strong ? 'high' : cost <= T.mediumCost ? 'medium' : 'low';
    out.push({
      layout: k.layout,
      confidence,
      cost,
      meanDevM: meanDev,
      p95DevM: p95,
      p99DevM: p99,
      lengthErrRel: lengthErrorRel(lengthM, k.layout.lengthM),
      lengthOk,
      startDistM,
      direction,
      geometrySource: k.source,
      partialGeometry: k.partial,
    });
  }
  // Best first; costs within 10 % are tied and broken by the distance to the start/finish line.
  out.sort((p, q) => {
    if (Math.abs(p.cost - q.cost) <= 0.1 * Math.min(p.cost, q.cost)) {
      return (p.startDistM ?? 1e9) - (q.startDistM ?? 1e9) || p.cost - q.cost;
    }
    return p.cost - q.cost;
  });
  const candidates = out.slice(0, opts.maxCandidates ?? 5);
  const top = candidates[0];
  if (!top) return none(lengthM, 'Nenhuma pista conhecida tem esse traçado.');
  const second = candidates[1];
  const margin = second
    ? second.cost >= Math.max(top.cost * T.marginFactor, top.cost + T.marginAdd)
    : true;
  const auto = top.confidence === 'high' && margin ? top : null;
  const ambiguous = !!second && !margin;
  const reason = auto
    ? `Traçado idêntico a ${top.layout.displayName} (desvio médio ${top.meanDevM.toFixed(1)} m).`
    : ambiguous
      ? `Traçado parecido com ${top.layout.displayName} e ${second!.layout.displayName}: confirme.`
      : top.confidence === 'high'
        ? 'Traçado conhecido, mas o reconhecimento exige confirmação.'
        : `Traçado semelhante a ${top.layout.displayName}, sem certeza: confirme.`;
  return { lengthM, candidates, auto, ambiguous, reason };
}
