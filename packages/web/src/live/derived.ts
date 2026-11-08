/**
 * Live state derived from every frame (independent of which view is on screen): G trail/peaks,
 * microsector gain/loss, the progressive track outline, the car trail, corner passes for the
 * Treino de curva view and reference availability for the double-tap cycle.
 *
 * Fed by `live.push` (O(1) per frame, no allocations on the hot path except finished passes).
 */

import { DEFAULT_MICROSECTOR_COUNT, type LiveFrame } from '@gt7/shared';
import {
  assessPass,
  type CornerHintExt,
  type CornerPass,
  CornerPassTracker,
  type PassAssessment,
} from '../lib/cornerPass.ts';
import { GStats } from '../lib/gStats.ts';
import { MicrosectorTracker } from '../lib/microsectors.ts';
import { ReferenceAvailability } from '../lib/referenceAvailability.ts';
import { type TrackGeometry, TrackOutlineBuilder } from '../lib/trackOutline.ts';
import { announceCornerPass } from '../state/cornerTraining.ts';
import { notePersonalBest } from '../state/sessionStore.ts';
import { useUi } from '../state/uiStore.ts';
import { trackGeometry } from './trackGeometry.ts';

/** Car trail on the map: positions of the last ~10 s. */
export class PositionTrail {
  readonly capacity: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  private head = 0;
  private count = 0;

  constructor(capacity = 600) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
  }

  push(x: number, z: number): void {
    if (this.count > 0) {
      const last = (this.head - 1 + this.capacity) % this.capacity;
      if (Math.hypot(x - this.x[last]!, z - this.z[last]!) > 60) this.clear();
    }
    this.x[this.head] = x;
    this.z[this.head] = z;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  clear(): void {
    this.head = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  /** Index of the j-th oldest point. */
  at(j: number): number {
    return (this.head - this.count + j + this.capacity) % this.capacity;
  }
}

export interface PassRecord {
  pass: CornerPass;
  assessment: PassAssessment;
}

class Derived {
  readonly g = new GStats(90);
  readonly micro = new MicrosectorTracker(DEFAULT_MICROSECTOR_COUNT);
  readonly outline = new TrackOutlineBuilder();
  readonly trail = new PositionTrail();
  readonly corners = new CornerPassTracker();
  readonly refAvail = new ReferenceAvailability();
  /** Latest completed pass (any corner) and the last pass per corner. */
  lastPass: PassRecord | null = null;
  readonly passes = new Map<string, PassRecord>();
  /** Lap distance of each corner entry seen in hints (for the pinned corner countdown). */
  readonly cornerEntries = new Map<string, { entryM: number; name: string | null }>();
  passVersion = 0;
  trackKey: string | null = null;
  private lastPbMs: number | null = null;

  push(f: LiveFrame): void {
    const trackId = f.track?.id ?? null;
    if (trackId !== this.trackKey) {
      // A different identified track: everything positional starts over.
      if (this.trackKey !== null && trackId !== null) this.resetTrack();
      this.trackKey = trackId;
      if (useUi.getState().source === 'server') trackGeometry.request(trackId);
    }
    const driving = f.state === 'onTrack' || f.state === 'replay';
    const d = f.lap.delta;
    this.refAvail.observe(trackId ?? '?', d.reference, d.referenceLapId, f.state === 'onTrack');
    if (d.reference === 'personalBest' && f.lap.referenceLapMs != null) {
      if (f.lap.referenceLapMs !== this.lastPbMs) {
        this.lastPbMs = f.lap.referenceLapMs;
        notePersonalBest(f.lap.referenceLapMs);
      }
    }
    if (!driving) {
      this.corners.reset();
      return;
    }
    const lengthM = f.track?.lengthM ?? null;
    this.g.push(f.g.lateral, f.g.longitudinal, f.g.vertical, f.lap.lap);
    this.micro.push(f.distanceM, lengthM, d.ms, f.lap.lap, `${d.reference}|${d.referenceLapId}`);
    this.outline.push(f.position.x, f.position.z, f.distanceM, f.lap.lap, lengthM);
    this.trail.push(f.position.x, f.position.z);
    const hint = f.nextCorner as CornerHintExt | null;
    if (hint && f.distanceM !== null) {
      const entryM = lengthM
        ? (f.distanceM + hint.distanceToEntryM) % lengthM
        : f.distanceM + hint.distanceToEntryM;
      this.cornerEntries.set(hint.cornerId, { entryM, name: hint.name });
    }
    const pass = this.corners.push({
      t: f.t,
      onTrack: f.state === 'onTrack',
      distanceM: f.distanceM,
      lengthM,
      speedKmh: f.car.speedKmh,
      brake: f.car.brake,
      throttle: f.car.throttle,
      gear: f.car.gear,
      hint,
    });
    if (pass) {
      const prev = this.passes.get(pass.cornerId)?.pass ?? null;
      const rec = { pass, assessment: assessPass(pass, prev) };
      this.passes.set(pass.cornerId, rec);
      this.lastPass = rec;
      this.passVersion++;
      announceCornerPass(pass, rec.assessment);
    }
  }

  private resetTrack(): void {
    this.micro.reset();
    this.outline.reset();
    this.trail.clear();
    this.corners.reset();
    this.passes.clear();
    this.cornerEntries.clear();
    this.lastPass = null;
    this.passVersion++;
  }

  clear(): void {
    this.resetTrack();
    this.g.reset();
    this.trackKey = null;
    this.lastPbMs = null;
  }

  /** Geometry for the map: server/mock polyline of this track, else the live outline. */
  geometry(): TrackGeometry | null {
    const g = trackGeometry.geometry;
    if (g && (g.trackId === this.trackKey || g.source === 'mock')) return g;
    return this.outline.geometry(this.trackKey);
  }

  /** Version that changes whenever {@link geometry} may return something different. */
  get geometryVersion(): number {
    return trackGeometry.version * 1_000_003 + this.outline.version;
  }

  /** Is a captured "top" reference known/assumed for the current track? */
  referenceAvailable(): boolean {
    return this.refAvail.available(this.trackKey ?? '?');
  }
}

export const derived = new Derived();
