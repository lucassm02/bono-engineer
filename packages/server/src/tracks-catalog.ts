/**
 * "Tracks overview": everything the home screen needs per track in a single request (thumbnail,
 * counts, best lap, cars, trend), computed from rows the store already has. Pure functions on
 * purpose (no store access here), so they are easy to test.
 *
 * Only the driver's own laps count as "activity": reference laps (top of the ranking) and replay
 * captures are reported separately.
 */

import { describeCar, type Lap, type Session, type Track, type TrackCenterline } from '@gt7/shared';

/** Name given by the engine to tracks it could not identify (see core/track/fingerprint.ts). */
export const UNKNOWN_TRACK_PREFIX = 'Pista desconhecida';

/** Points of the thumbnail polyline. */
export const THUMB_POINTS = 96;

/** Differences below this are reported as "same" in the trend (ms). */
export const TREND_EPSILON_MS = 50;

/** Car name/maker from the catalogue (null when the car is not in it). */
export interface CarNames {
  carName: string | null;
  makerName: string | null;
}

function carNames(carCode: number): CarNames {
  const d = describeCar(carCode);
  return { carName: d.carName, makerName: d.makerName };
}

export interface OverviewBest extends CarNames {
  timeMs: number;
  lapId: string;
  sessionId: string;
  carCode: number;
  /** Epoch ms when the lap started. */
  at: number;
}

export interface OverviewCar extends CarNames {
  carCode: number;
  laps: number;
  sessions: number;
  bestMs: number | null;
  bestLapId: string | null;
  lastAt: number;
}

export type TrendKind = 'improved' | 'worsened' | 'same' | 'none';

export interface OverviewTrend {
  kind: TrendKind;
  /** last session best − previous session best (ms, negative = faster). Null when kind = none. */
  deltaMs: number | null;
  carCode: number | null;
  carName: string | null;
}

export interface TrackOverview {
  id: string;
  name: string;
  layout: string | null;
  lengthM: number;
  source: Track['source'];
  /** Still has the automatic name and nobody confirmed it: the UI asks "which track is this?". */
  needsName: boolean;
  createdAt: number;
  /** Down-sampled closed polyline (world X/Z) for the card thumbnail; null without a centerline. */
  thumb: { x: number[]; z: number[] } | null;
  /** Own live sessions with at least one lap. */
  sessionCount: number;
  /** Own laps (valid or not) in those sessions. */
  lapCount: number;
  validLapCount: number;
  lastActivityAt: number | null;
  best: OverviewBest | null;
  cars: OverviewCar[];
  referenceCount: number;
  bestReferenceMs: number | null;
  trend: OverviewTrend;
}

export interface OverviewInput {
  tracks: readonly Track[];
  sessions: readonly Session[];
  /** All laps of a track (any order). */
  lapsOf: (trackId: string) => readonly Lap[];
  centerlineOf: (trackId: string) => TrackCenterline | null;
}

export function needsName(t: Pick<Track, 'name' | 'source'>): boolean {
  return t.source === 'auto' && t.name.startsWith(UNKNOWN_TRACK_PREFIX);
}

/** Down-samples a closed polyline to ~`n` points (uniform by index). */
export function thumbnail(
  x: readonly number[],
  z: readonly number[],
  n = THUMB_POINTS,
): { x: number[]; z: number[] } | null {
  const len = Math.min(x.length, z.length);
  if (len < 4) return null;
  const out = { x: [] as number[], z: [] as number[] };
  const count = Math.min(n, len);
  const round = (v: number) => Math.round(v * 10) / 10;
  for (let i = 0; i < count; i++) {
    const k = Math.min(len - 1, Math.round((i * len) / count));
    out.x.push(round(x[k]!));
    out.z.push(round(z[k]!));
  }
  return out;
}

function isOwn(l: Lap): boolean {
  return !l.isReference && !l.flags.includes('replay');
}

/**
 * Trend of the most recent own session against the previous one of the same car: compares the
 * best valid lap of each.
 */
export function computeTrend(sessions: readonly Session[]): OverviewTrend {
  const own = sessions
    .filter((s) => s.mode === 'live' && s.bestLapMs !== null)
    .sort((a, b) => b.startedAt - a.startedAt);
  const last = own[0];
  if (!last) return { kind: 'none', deltaMs: null, carCode: null, carName: null };
  const prev = own.slice(1).find((s) => s.carCode === last.carCode);
  if (!prev) {
    return {
      kind: 'none',
      deltaMs: null,
      carCode: last.carCode,
      carName: carNames(last.carCode).carName,
    };
  }
  const deltaMs = last.bestLapMs! - prev.bestLapMs!;
  const kind: TrendKind =
    Math.abs(deltaMs) < TREND_EPSILON_MS ? 'same' : deltaMs < 0 ? 'improved' : 'worsened';
  return { kind, deltaMs, carCode: last.carCode, carName: carNames(last.carCode).carName };
}

export function buildTrackOverview(
  track: Track,
  sessions: readonly Session[],
  laps: readonly Lap[],
  centerline: TrackCenterline | null,
): TrackOverview {
  const liveSessions = sessions.filter((s) => s.mode === 'live' && s.lapCount > 0);
  const own = laps.filter(isOwn);
  const validOwn = own.filter((l) => l.valid);
  const best = validOwn.reduce<Lap | null>((b, l) => (!b || l.timeMs < b.timeMs ? l : b), null);

  const byCar = new Map<number, OverviewCar>();
  const carSessions = new Map<number, Set<string>>();
  for (const l of own) {
    let c = byCar.get(l.carCode);
    if (!c) {
      c = {
        carCode: l.carCode,
        ...carNames(l.carCode),
        laps: 0,
        sessions: 0,
        bestMs: null,
        bestLapId: null,
        lastAt: 0,
      };
      byCar.set(l.carCode, c);
      carSessions.set(l.carCode, new Set());
    }
    c.laps++;
    carSessions.get(l.carCode)!.add(l.sessionId);
    c.lastAt = Math.max(c.lastAt, l.startedAt);
    if (l.valid && (c.bestMs === null || l.timeMs < c.bestMs)) {
      c.bestMs = l.timeMs;
      c.bestLapId = l.id;
    }
  }
  for (const [code, c] of byCar) c.sessions = carSessions.get(code)!.size;

  const refs = laps.filter((l) => l.isReference && l.valid);
  const bestRef = refs.reduce<number | null>(
    (b, l) => (b === null || l.timeMs < b ? l.timeMs : b),
    null,
  );
  const lastLap = own.reduce((m, l) => Math.max(m, l.startedAt), 0);
  const lastSession = liveSessions.reduce((m, s) => Math.max(m, s.endedAt ?? s.startedAt), 0);
  const lastActivityAt = Math.max(lastLap, lastSession) || null;

  return {
    id: track.id,
    name: track.name,
    layout: track.layout ?? null,
    lengthM: track.lengthM,
    source: track.source,
    needsName: needsName(track),
    createdAt: track.createdAt,
    thumb: centerline ? thumbnail(centerline.x, centerline.z) : null,
    sessionCount: liveSessions.length,
    lapCount: own.length,
    validLapCount: validOwn.length,
    lastActivityAt,
    best: best
      ? {
          timeMs: best.timeMs,
          lapId: best.id,
          sessionId: best.sessionId,
          carCode: best.carCode,
          ...carNames(best.carCode),
          at: best.startedAt,
        }
      : null,
    cars: [...byCar.values()].sort((a, b) => b.lastAt - a.lastAt),
    referenceCount: refs.length,
    bestReferenceMs: bestRef,
    trend: computeTrend(sessions),
  };
}

/** Overview of every track, most recent activity first (tracks without activity by creation). */
export function buildTracksOverview(input: OverviewInput): TrackOverview[] {
  const byTrack = new Map<string, Session[]>();
  for (const s of input.sessions) {
    if (!s.trackId) continue;
    const list = byTrack.get(s.trackId);
    if (list) list.push(s);
    else byTrack.set(s.trackId, [s]);
  }
  return input.tracks
    .map((t) =>
      buildTrackOverview(t, byTrack.get(t.id) ?? [], input.lapsOf(t.id), input.centerlineOf(t.id)),
    )
    .sort((a, b) => (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt));
}
