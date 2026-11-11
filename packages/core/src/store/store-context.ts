/** LiveEngineContext backed by Gt7Store (SQLite + trace files). */

import type { Id, Lap, LapTrace, Session, Track, TrackCenterline, Vec2 } from '@gt7/shared';
import type { IdentifyTrackInput, LiveEngineContext, TrackRecords } from '../live/context.ts';
import type { StoredLap } from '../live/delta-reference.ts';
import {
  type IdentifyResult,
  identifyOrCreateTrack,
  type MatchTolerances,
  matchTrackByStart,
} from '../track/fingerprint.ts';
import { newId } from '../util/ids.ts';
import type { Gt7Store } from './store.ts';

export class StoreEngineContext implements LiveEngineContext {
  readonly store: Gt7Store;
  readonly #newId: () => Id;
  readonly #tolerances: MatchTolerances | undefined;

  constructor(store: Gt7Store, opts: { idFactory?: () => Id; tolerances?: MatchTolerances } = {}) {
    this.store = store;
    this.#newId = opts.idFactory ?? (() => newId());
    this.#tolerances = opts.tolerances;
  }

  saveSession(session: Session): void {
    this.store.saveSession(session);
  }

  saveLap(lap: Lap, trace: LapTrace): void {
    this.store.saveLap(lap, trace);
  }

  reassignSessionTrack(sessionId: Id, trackId: Id): number {
    return this.store.reassignSessionTrack(sessionId, trackId);
  }

  getTrack(trackId: Id): Track | null {
    return this.store.getTrack(trackId);
  }

  listTracks(): Track[] {
    return this.store.listTracks();
  }

  getCenterline(trackId: Id): TrackCenterline | null {
    return this.store.getCenterline(trackId);
  }

  findTrackByStart(start: Vec2, headingRad: number): Track | null {
    return matchTrackByStart(start, headingRad, this.store.listTracks(), this.#tolerances);
  }

  identifyTrack(input: IdentifyTrackInput): IdentifyResult {
    return identifyOrCreateTrack(this.store, {
      ...input,
      newId: this.#newId,
      ...(this.#tolerances ? { tolerances: this.#tolerances } : {}),
    });
  }

  getTrackRecords(trackId: Id, carCode: number, sectorCount: number): TrackRecords {
    return this.store.getTrackRecords(trackId, carCode, sectorCount);
  }

  #withTrace(lap: Lap | null): StoredLap | null {
    if (!lap) return null;
    const trace = this.store.loadTraceSync(lap.id);
    return trace ? { lap, trace } : null;
  }

  loadLap(lapId: Id): StoredLap | null {
    return this.#withTrace(this.store.getLap(lapId));
  }

  loadPersonalBest(trackId: Id, carCode: number): StoredLap | null {
    return this.#withTrace(this.store.getPersonalBestLap(trackId, carCode));
  }

  loadBestReference(trackId: Id, carCode: number): StoredLap | null {
    const refs = this.store.listReferenceLaps(trackId);
    const best = refs.find((l) => l.carCode === carCode) ?? refs[0] ?? null;
    return this.#withTrace(best);
  }
}
