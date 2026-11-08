/**
 * What the live engine needs from the outside world: persistence of sessions/laps, track lookup
 * and records. Synchronous on purpose (node:sqlite is synchronous) so lap closing stays
 * deterministic. {@link MemoryEngineContext} is an in-memory implementation (tests, dry runs);
 * the SQLite-backed one lives in the store module.
 */

import type { Id, Lap, LapTrace, Session, Track, TrackCenterline, Vec2 } from '@gt7/shared';
import {
  type IdentifyResult,
  identifyOrCreateTrack,
  type MatchTolerances,
  matchTrackByStart,
} from '../track/fingerprint.ts';
import { newId } from '../util/ids.ts';
import type { Polyline } from '../util/polyline.ts';
import type { StoredLap } from './delta-reference.ts';

/** Best times on a track+car, used for sector colours. Sector arrays are per sector index. */
export interface TrackRecords {
  /** Best ever, including reference/replay laps. */
  overallBestLapMs: number | null;
  overallBestSectorsMs: (number | null)[];
  /** Best own laps (valid, not reference, not replay). */
  personalBestLapMs: number | null;
  personalBestSectorsMs: (number | null)[];
}

export interface IdentifyTrackInput {
  line: Polyline;
  sourceLapId: Id;
  y?: { s: ArrayLike<number>; y: ArrayLike<number> };
  now: number;
}

export interface LiveEngineContext {
  saveSession(session: Session): void;
  /** Persists a closed lap and its trace (trace file writes may complete asynchronously). */
  saveLap(lap: Lap, trace: LapTrace): void;
  getTrack(trackId: Id): Track | null;
  getCenterline(trackId: Id): TrackCenterline | null;
  /** Probable track from the start line position + heading (before a full lap is known). */
  findTrackByStart(start: Vec2, headingRad: number): Track | null;
  /** Full identification from a complete lap; creates "Pista desconhecida N" when unknown. */
  identifyTrack(input: IdentifyTrackInput): IdentifyResult;
  getTrackRecords(trackId: Id, carCode: number, sectorCount: number): TrackRecords;
  loadLap(lapId: Id): StoredLap | null;
  /** Best valid own lap (not reference/replay) on track+car, with trace. */
  loadPersonalBest(trackId: Id, carCode: number): StoredLap | null;
  /** Best reference lap on the track (same car preferred), with trace. */
  loadBestReference(trackId: Id, carCode: number): StoredLap | null;
}

/** True if the lap counts for personal records (own driving, valid). */
export function isPersonalLap(lap: Lap): boolean {
  return lap.valid && !lap.isReference && !lap.flags.includes('replay');
}

/** Computes records from a list of laps (shared by the memory and SQLite contexts). */
export function computeRecords(laps: readonly Lap[], sectorCount: number): TrackRecords {
  const rec: TrackRecords = {
    overallBestLapMs: null,
    overallBestSectorsMs: Array.from({ length: sectorCount }, () => null),
    personalBestLapMs: null,
    personalBestSectorsMs: Array.from({ length: sectorCount }, () => null),
  };
  const min = (a: number | null, b: number | null) =>
    a === null ? b : b === null ? a : Math.min(a, b);
  for (const lap of laps) {
    if (!lap.valid) continue;
    const personal = isPersonalLap(lap);
    rec.overallBestLapMs = min(rec.overallBestLapMs, lap.timeMs);
    if (personal) rec.personalBestLapMs = min(rec.personalBestLapMs, lap.timeMs);
    if (lap.sectorTimesMs.length !== sectorCount) continue;
    for (let i = 0; i < sectorCount; i++) {
      const s = lap.sectorTimesMs[i] ?? null;
      rec.overallBestSectorsMs[i] = min(rec.overallBestSectorsMs[i] ?? null, s);
      if (personal) rec.personalBestSectorsMs[i] = min(rec.personalBestSectorsMs[i] ?? null, s);
    }
  }
  return rec;
}

/** In-memory context: keeps everything in maps (no IO). */
export class MemoryEngineContext implements LiveEngineContext {
  readonly sessions = new Map<Id, Session>();
  readonly laps = new Map<Id, StoredLap>();
  readonly tracks = new Map<Id, Track>();
  readonly centerlines = new Map<Id, TrackCenterline>();
  readonly #newId: () => Id;
  readonly #tolerances: MatchTolerances | undefined;

  constructor(opts: { idFactory?: () => Id; tolerances?: MatchTolerances } = {}) {
    this.#newId = opts.idFactory ?? (() => newId());
    this.#tolerances = opts.tolerances;
  }

  saveSession(session: Session): void {
    this.sessions.set(session.id, { ...session });
  }

  saveLap(lap: Lap, trace: LapTrace): void {
    this.laps.set(lap.id, { lap: { ...lap }, trace });
  }

  /** Marks a stored lap as reference (what ReferenceCapture does through the store). */
  setReference(lapId: Id, meta: Lap['referenceMeta']): void {
    const s = this.laps.get(lapId);
    if (!s) return;
    s.lap = { ...s.lap, isReference: meta !== null, referenceMeta: meta };
  }

  getTrack(trackId: Id): Track | null {
    return this.tracks.get(trackId) ?? null;
  }

  getCenterline(trackId: Id): TrackCenterline | null {
    return this.centerlines.get(trackId) ?? null;
  }

  findTrackByStart(start: Vec2, headingRad: number): Track | null {
    return matchTrackByStart(start, headingRad, [...this.tracks.values()], this.#tolerances);
  }

  identifyTrack(input: IdentifyTrackInput): IdentifyResult {
    return identifyOrCreateTrack(
      {
        listTracks: () => [...this.tracks.values()],
        insertTrack: (t) => this.tracks.set(t.id, t),
        saveCenterline: (c) => this.centerlines.set(c.trackId, c),
      },
      {
        ...input,
        newId: this.#newId,
        ...(this.#tolerances ? { tolerances: this.#tolerances } : {}),
      },
    );
  }

  #lapsOn(trackId: Id, carCode: number | null): Lap[] {
    return [...this.laps.values()]
      .map((s) => s.lap)
      .filter((l) => l.trackId === trackId && (carCode === null || l.carCode === carCode));
  }

  getTrackRecords(trackId: Id, carCode: number, sectorCount: number): TrackRecords {
    return computeRecords(this.#lapsOn(trackId, carCode), sectorCount);
  }

  loadLap(lapId: Id): StoredLap | null {
    return this.laps.get(lapId) ?? null;
  }

  loadPersonalBest(trackId: Id, carCode: number): StoredLap | null {
    const best = this.#lapsOn(trackId, carCode)
      .filter(isPersonalLap)
      .sort((a, b) => a.timeMs - b.timeMs)[0];
    return best ? (this.laps.get(best.id) ?? null) : null;
  }

  loadBestReference(trackId: Id, carCode: number): StoredLap | null {
    const refs = this.#lapsOn(trackId, null)
      .filter((l) => l.isReference)
      .sort(
        (a, b) =>
          (a.carCode === carCode ? 0 : 1) - (b.carCode === carCode ? 0 : 1) || a.timeMs - b.timeMs,
      );
    return refs[0] ? (this.laps.get(refs[0].id) ?? null) : null;
  }
}
