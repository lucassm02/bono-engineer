/**
 * Reference (replay) capture: after `start(meta)` the next complete lap seen by the live engine
 * (in replay mode, so the lap is flagged 'replay') is validated and stored as a reference lap
 * (isReference + ReferenceMeta). Status follows `ReferenceCaptureStatus` from shared/ws.ts.
 *
 * Validation issue codes: 'paused', 'discontinuity', 'packetGaps', 'lengthMismatch',
 * 'timeMismatch', 'carMismatch'. An invalid lap is kept as a normal replay lap and the capture
 * keeps waiting for the next lap.
 */

import { EventEmitter } from 'node:events';
import type { CaptureState, Id, Lap, ReferenceCaptureStatus, ReferenceMeta } from '@gt7/shared';
import type { CompletedLap, LiveEngine } from '../live/live-engine.ts';
import { lapPolyline } from '../track/fingerprint.ts';

export interface ReferenceCaptureMeta {
  driverName: string;
  carName?: string | null;
  /** Ranking lap time typed by the user (validation). */
  rankingTimeMs?: number | null;
  notes?: string | null;
  /** If set, the captured lap must be driven with this car. */
  expectedCarCode?: number | null;
}

export interface ReferenceCaptureStore {
  setReference(lapId: Id, meta: ReferenceMeta | null): unknown;
  deleteLap?(lapId: Id): Promise<boolean> | boolean;
}

export interface ReferenceCaptureOptions {
  engine: LiveEngine;
  store: ReferenceCaptureStore;
  /** Called on start (e.g. switch the ingestor to format 'B'); state is 'switchingFormat' meanwhile. */
  enter?: () => Promise<void>;
  /** Called when the capture ends (success or stop), e.g. restore the live format. */
  exit?: () => Promise<void>;
  /** Max relative lap length difference vs the known track length (default 0.02). */
  lengthTolerance?: number;
  /** Max |lap time − ranking time| (default 300 ms). */
  timeToleranceMs?: number;
  /** Max single packetId gap (default 6 packets = 100 ms). */
  maxGapPackets?: number;
  /** Max lost packet ratio (default 0.005). */
  maxLossRatio?: number;
}

export interface ReferenceCaptureEvents {
  status: [ReferenceCaptureStatus];
  captured: [CompletedLap, Lap];
  invalid: [string[], CompletedLap];
}

/** Pure validation of a captured lap (exported for tests and the UI). */
export function validateReferenceLap(
  c: CompletedLap,
  meta: ReferenceCaptureMeta,
  opts: {
    lengthTolerance?: number;
    timeToleranceMs?: number;
    maxGapPackets?: number;
    maxLossRatio?: number;
  } = {},
): string[] {
  const issues: string[] = [];
  const flags = c.lap.flags;
  if (flags.includes('paused')) issues.push('paused');
  if (flags.includes('discontinuity')) issues.push('discontinuity');
  const tr = c.trace;
  let maxGap = 0;
  const ids = tr.channels.packetId;
  for (let i = 1; i < tr.length; i++)
    maxGap = Math.max(maxGap, Number(ids[i]) - Number(ids[i - 1]) - 1);
  const lossRatio = c.lap.lostPackets / Math.max(1, tr.length + c.lap.lostPackets);
  if (maxGap > (opts.maxGapPackets ?? 6) || lossRatio > (opts.maxLossRatio ?? 0.005)) {
    issues.push('packetGaps');
  }
  if (c.track && tr.length > 2) {
    const len = lapPolyline(tr.channels.x, tr.channels.z).length;
    if (Math.abs(len - c.track.lengthM) / c.track.lengthM > (opts.lengthTolerance ?? 0.02)) {
      issues.push('lengthMismatch');
    }
  }
  if (
    meta.rankingTimeMs &&
    Math.abs(c.lap.timeMs - meta.rankingTimeMs) > (opts.timeToleranceMs ?? 300)
  ) {
    issues.push('timeMismatch');
  }
  if (
    meta.expectedCarCode !== undefined &&
    meta.expectedCarCode !== null &&
    c.lap.carCode !== meta.expectedCarCode
  ) {
    issues.push('carMismatch');
  }
  return issues;
}

export class ReferenceCapture extends EventEmitter<ReferenceCaptureEvents> {
  readonly options: ReferenceCaptureOptions;
  #state: CaptureState = 'idle';
  #meta: ReferenceCaptureMeta | null = null;
  #lapId: Id | null = null;
  #issues: string[] = [];
  #recordingLap: number | null = null;
  #lastCapture: CompletedLap | null = null;
  #onLapStarted = (info: { lapNumber: number }) => this.#lapStarted(info.lapNumber);
  #onLapCompleted = (c: CompletedLap) => this.#lapCompleted(c);
  #onDiscarded = (info: { lapNumber: number }) => {
    if (this.#state === 'recording' && info.lapNumber === this.#recordingLap) {
      this.#recordingLap = null;
      this.#set('waitingLapStart');
    }
  };

  constructor(opts: ReferenceCaptureOptions) {
    super();
    this.options = opts;
  }

  get status(): ReferenceCaptureStatus {
    return {
      state: this.#state,
      driverName: this.#meta?.driverName ?? null,
      lapId: this.#lapId,
      issues: [...this.#issues],
    };
  }

  get active(): boolean {
    return this.#state !== 'idle';
  }

  /** Starts waiting for the next complete lap (switching format / replay mode via `enter`). */
  async start(meta: ReferenceCaptureMeta): Promise<ReferenceCaptureStatus> {
    if (this.active) await this.stop(true);
    this.#meta = { ...meta };
    this.#lapId = null;
    this.#issues = [];
    this.#recordingLap = null;
    this.#lastCapture = null;
    const e = this.options.engine;
    e.on('lapStarted', this.#onLapStarted);
    e.on('lapCompleted', this.#onLapCompleted);
    e.on('lapDiscarded', this.#onDiscarded);
    this.#set('switchingFormat');
    try {
      if (this.options.enter) await this.options.enter();
      else e.setReplayMode(true);
    } catch (err) {
      this.#issues = ['enterFailed'];
      this.#detach();
      this.#set('idle');
      throw err;
    }
    if (this.#state === 'switchingFormat') this.#set('waitingLapStart');
    return this.status;
  }

  /**
   * Stops capturing. `save = false` discards a lap captured by this run (unmarks and deletes it).
   */
  async stop(save = true): Promise<ReferenceCaptureStatus> {
    if (!this.active && save) return this.status;
    if (!save && this.#lapId) {
      const id = this.#lapId;
      this.options.store.setReference(id, null);
      await this.options.store.deleteLap?.(id);
      this.#lapId = null;
    }
    const wasActive = this.active;
    this.#detach();
    this.#set('idle');
    if (wasActive) await this.#exit();
    return this.status;
  }

  #detach(): void {
    const e = this.options.engine;
    e.off('lapStarted', this.#onLapStarted);
    e.off('lapCompleted', this.#onLapCompleted);
    e.off('lapDiscarded', this.#onDiscarded);
  }

  async #exit(): Promise<void> {
    try {
      if (this.options.exit) await this.options.exit();
      else this.options.engine.setReplayMode(false);
    } catch {
      // exit problems are reported by the owner (runtime notices)
    }
  }

  #set(s: CaptureState): void {
    this.#state = s;
    this.emit('status', this.status);
  }

  #lapStarted(lapNumber: number): void {
    if (this.#state !== 'waitingLapStart') return;
    this.#recordingLap = lapNumber;
    this.#set('recording');
  }

  #lapCompleted(c: CompletedLap): void {
    if (this.#state !== 'recording' || c.lap.number !== this.#recordingLap) return;
    const meta = this.#meta!;
    this.#set('validating');
    const issues = validateReferenceLap(c, meta, this.options);
    this.#lastCapture = c;
    if (issues.length) {
      this.#issues = issues;
      this.#recordingLap = null;
      this.emit('invalid', issues, c);
      // the next lap starts at the same packet that closed this one: keep recording it
      this.#recordingLap = c.lap.number + 1;
      this.#set('recording');
      return;
    }
    const refMeta: ReferenceMeta = {
      driverName: meta.driverName,
      source: 'replayCapture',
      rankingTimeMs: meta.rankingTimeMs ?? null,
      carName: meta.carName ?? null,
      notes: meta.notes ?? null,
      capturedAt: c.event.completedAt,
    };
    const updated = this.options.store.setReference(c.lap.id, refMeta);
    const lap: Lap =
      updated && typeof updated === 'object' && 'id' in updated
        ? (updated as Lap)
        : { ...c.lap, isReference: true, referenceMeta: refMeta };
    this.#lapId = c.lap.id;
    this.#issues = [];
    this.#detach();
    this.#set('idle');
    this.emit('captured', c, lap);
    queueMicrotask(() => void this.#exit());
  }

  /** Last lap seen by this capture run (valid or not). */
  get lastCapture(): CompletedLap | null {
    return this.#lastCapture;
  }
}
