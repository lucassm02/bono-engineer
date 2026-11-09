/**
 * Track identification from geometry (GT7 sends no track id): start/finish point + heading,
 * closed-loop length, bounding box and a coarse heading signature (shape v1).
 */

import {
  type Id,
  type KnownTrackCandidate,
  matchKnownTrack,
  type SectorGate,
  type Track,
  type TrackCenterline,
  type TrackFingerprint,
  type Vec2,
} from '@gt7/shared';
import { wrapAngle } from '../util/math.ts';
import { Polyline } from '../util/polyline.ts';

/** Number of equidistant heading samples in the shape descriptor. */
export const SHAPE_POINTS = 64;
export const SHAPE_VERSION = 1;
/** Centerline resampling step (m). */
export const CENTERLINE_STEP_M = 2;
/** Default number of equal-length sectors for new tracks. */
export const DEFAULT_SECTOR_COUNT = 3;
export const UNKNOWN_TRACK_PREFIX = 'Pista desconhecida';

export interface MatchTolerances {
  /** Max distance between start points (m). */
  startM: number;
  /** Max start heading difference (rad). */
  headingRad: number;
  /** Max relative length difference. */
  lengthRel: number;
  /** Max RMS difference of the heading signature (rad). */
  shapeRmsRad: number;
}

export const DEFAULT_MATCH_TOLERANCES: MatchTolerances = {
  startM: 30,
  headingRad: 0.5,
  lengthRel: 0.03,
  shapeRmsRad: 0.3,
};

/**
 * Builds the closed reference polyline of a lap from its X/Z samples (the lap's first sample is
 * the start/finish point).
 */
export function lapPolyline(x: ArrayLike<number>, z: ArrayLike<number>): Polyline {
  // drop consecutive duplicates (paused samples) to keep segments non-degenerate
  const xs: number[] = [];
  const zs: number[] = [];
  const n = Math.min(x.length, z.length);
  for (let i = 0; i < n; i++) {
    const px = x[i]!;
    const pz = z[i]!;
    if (!Number.isFinite(px) || !Number.isFinite(pz)) continue;
    const k = xs.length - 1;
    if (k >= 0 && Math.hypot(px - xs[k]!, pz - zs[k]!) < 0.05) continue;
    xs.push(px);
    zs.push(pz);
  }
  return new Polyline(xs, zs, true);
}

/** Heading signature: unwrapped heading change from the start, at SHAPE_POINTS fractions. */
export function headingSignature(line: Polyline, points = SHAPE_POINTS): number[] {
  const h0 = line.pointAt(0.5).heading;
  const out: number[] = [];
  let prev = h0;
  let acc = 0;
  const steps = points * 8;
  for (let k = 0; k <= steps; k++) {
    const s = (k / steps) * line.length;
    const h = line.pointAt(Math.min(line.length - 0.01, s + 0.5)).heading;
    acc += wrapAngle(h - prev);
    prev = h;
    if (k % 8 === 0 && out.length < points) out.push(acc);
  }
  return out;
}

export function computeFingerprint(line: Polyline): TrackFingerprint {
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < line.size; i++) {
    minX = Math.min(minX, line.x[i]!);
    maxX = Math.max(maxX, line.x[i]!);
    minZ = Math.min(minZ, line.z[i]!);
    maxZ = Math.max(maxZ, line.z[i]!);
  }
  return {
    start: { x: line.x[0]!, z: line.z[0]! },
    startHeadingRad: line.pointAt(0.5).heading,
    lengthM: line.length,
    bbox: { min: { x: minX, z: minZ }, max: { x: maxX, z: maxZ } },
    shape: headingSignature(line),
    shapeVersion: SHAPE_VERSION,
  };
}

/** Resampled centerline for storage. `y` is interpolated from the lap samples when given. */
export function buildCenterline(
  trackId: Id,
  sourceLapId: Id | null,
  line: Polyline,
  y?: { s: ArrayLike<number>; y: ArrayLike<number> },
  stepM = CENTERLINE_STEP_M,
): TrackCenterline {
  const r = line.resample(stepM);
  const ys: number[] = [];
  for (let i = 0; i < r.size; i++) {
    if (!y || y.s.length === 0) {
      ys.push(0);
      continue;
    }
    // nearest-by-distance lookup (y varies slowly)
    const target = i * stepM;
    let lo = 0;
    let hi = y.s.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (y.s[mid]! <= target) lo = mid;
      else hi = mid;
    }
    ys.push(Number(y.y[lo]));
  }
  return {
    trackId,
    sourceLapId,
    stepM,
    lengthM: line.length,
    x: Array.from(r.x),
    y: ys,
    z: Array.from(r.z),
  };
}

/** Closed polyline of a stored centerline. */
export function centerlinePolyline(c: TrackCenterline): Polyline {
  return new Polyline(c.x, c.z, true);
}

export interface FingerprintComparison {
  startDistM: number;
  headingDiffRad: number;
  lengthRelDiff: number;
  shapeRmsRad: number;
  /** 0 = identical; ≤ 1 for every component within tolerance (sum of normalized terms / 4). */
  score: number;
  match: boolean;
}

export function compareFingerprints(
  a: TrackFingerprint,
  b: TrackFingerprint,
  tol: MatchTolerances = DEFAULT_MATCH_TOLERANCES,
): FingerprintComparison {
  const startDistM = Math.hypot(a.start.x - b.start.x, a.start.z - b.start.z);
  const headingDiffRad = Math.abs(wrapAngle(a.startHeadingRad - b.startHeadingRad));
  const lengthRelDiff =
    Math.abs(a.lengthM - b.lengthM) / Math.max(1, Math.max(a.lengthM, b.lengthM));
  let shapeRmsRad = Number.POSITIVE_INFINITY;
  if (a.shapeVersion === b.shapeVersion && a.shape.length === b.shape.length && a.shape.length) {
    let acc = 0;
    for (let i = 0; i < a.shape.length; i++) acc += (a.shape[i]! - b.shape[i]!) ** 2;
    shapeRmsRad = Math.sqrt(acc / a.shape.length);
  }
  const terms = [
    startDistM / tol.startM,
    headingDiffRad / tol.headingRad,
    lengthRelDiff / tol.lengthRel,
    shapeRmsRad / tol.shapeRmsRad,
  ];
  const match = terms.every((t) => t <= 1);
  return {
    startDistM,
    headingDiffRad,
    lengthRelDiff,
    shapeRmsRad,
    score: terms.reduce((s, t) => s + t, 0) / terms.length,
    match,
  };
}

/** Best matching track for a fingerprint, or null. */
export function matchTrack(
  fp: TrackFingerprint,
  tracks: readonly Track[],
  tol: MatchTolerances = DEFAULT_MATCH_TOLERANCES,
): { track: Track; comparison: FingerprintComparison } | null {
  let best: { track: Track; comparison: FingerprintComparison } | null = null;
  for (const t of tracks) {
    const c = compareFingerprints(fp, t.fingerprint, tol);
    if (c.match && (!best || c.score < best.comparison.score)) best = { track: t, comparison: c };
  }
  return best;
}

/** Track whose start line matches a point + heading (used for a probable early match). */
export function matchTrackByStart(
  start: Vec2,
  headingRad: number,
  tracks: readonly Track[],
  tol: MatchTolerances = DEFAULT_MATCH_TOLERANCES,
): Track | null {
  let best: Track | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const t of tracks) {
    const d = Math.hypot(start.x - t.fingerprint.start.x, start.z - t.fingerprint.start.z);
    const h = Math.abs(wrapAngle(headingRad - t.fingerprint.startHeadingRad));
    if (d > tol.startM || h > tol.headingRad) continue;
    const score = d / tol.startM + h / tol.headingRad;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/**
 * The catalogue layout whose shipped driving line matches this lap strongly and unambiguously, or
 * null (unknown track, look-alike layouts, partial lines…): only then may a name be applied
 * without asking the user.
 */
export function recognizeKnownLayout(line: Polyline): KnownTrackCandidate | null {
  try {
    return matchKnownTrack({ x: line.x, z: line.z }).auto;
  } catch {
    return null;
  }
}

/** Equal-length sector gates. */
export function equalSectorGates(lengthM: number, count = DEFAULT_SECTOR_COUNT): SectorGate[] {
  return Array.from({ length: count }, (_, i) => ({ index: i, distanceM: (lengthM * i) / count }));
}

/** Next "Pista desconhecida N" name. */
export function nextUnknownTrackName(existing: readonly Pick<Track, 'name'>[]): string {
  let max = 0;
  const re = new RegExp(`^${UNKNOWN_TRACK_PREFIX} (\\d+)$`);
  for (const t of existing) {
    const m = re.exec(t.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${UNKNOWN_TRACK_PREFIX} ${max + 1}`;
}

/** Minimal repository needed by {@link identifyOrCreateTrack}. */
export interface TrackRepository {
  listTracks(): Track[];
  insertTrack(track: Track): void;
  saveCenterline(centerline: TrackCenterline): void;
}

export interface IdentifyResult {
  track: Track;
  created: boolean;
  comparison: FingerprintComparison | null;
  /**
   * Set when a NEW track was named from the shipped catalogue because its driving line matched a
   * known layout strongly and unambiguously (see `matchKnownTrack`); the track then has the
   * official name and layout and `source: 'builtin'`.
   */
  recognized?: KnownTrackCandidate | null;
}

/**
 * Matches a lap against the stored tracks; when nothing matches creates a new track with this lap
 * as the centerline and 3 equal sectors. The new track is named after the official GT7 layout only
 * when the lap's line is a strong, unambiguous match for one of the shipped driving lines;
 * otherwise it is "Pista desconhecida N" (the UI then suggests candidates, one click to confirm).
 */
export function identifyOrCreateTrack(
  repo: TrackRepository,
  input: {
    line: Polyline;
    sourceLapId: Id;
    y?: { s: ArrayLike<number>; y: ArrayLike<number> };
    newId: () => Id;
    now: number;
    tolerances?: MatchTolerances;
  },
): IdentifyResult {
  const fp = computeFingerprint(input.line);
  const tracks = repo.listTracks();
  const m = matchTrack(fp, tracks, input.tolerances);
  if (m) return { track: m.track, created: false, comparison: m.comparison };
  const id = input.newId();
  const known = recognizeKnownLayout(input.line);
  const track: Track = {
    id,
    name: known ? known.layout.venue : nextUnknownTrackName(tracks),
    layout: known ? known.layout.layoutLabel : null,
    fingerprint: fp,
    lengthM: fp.lengthM,
    centerline: { sourceLapId: input.sourceLapId, file: null, stepM: CENTERLINE_STEP_M },
    sectorGates: equalSectorGates(fp.lengthM),
    corners: [],
    source: known ? 'builtin' : 'auto',
    createdAt: input.now,
    updatedAt: input.now,
  };
  repo.insertTrack(track);
  repo.saveCenterline(buildCenterline(id, input.sourceLapId, input.line, input.y));
  return { track, created: true, comparison: null, recognized: known };
}
