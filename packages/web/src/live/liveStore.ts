/**
 * Live telemetry store, outside React. The latest LiveFrame is kept in a mutable holder; widgets
 * read it from the rAF loop (live/raf.ts) and write straight to the DOM/canvas. Only rare changes
 * (connection state, packet format) are mirrored into zustand.
 */

import type { LiveFrame } from '@gt7/shared';
import { TIMINGS } from '../config.ts';
import { useUi } from '../state/uiStore.ts';
import { derived } from './derived.ts';
import { RollingHistory } from './history.ts';

class LiveStore {
  frame: LiveFrame | null = null;
  /** Increments on every new frame (renderers skip work when unchanged). */
  version = 0;
  /** performance.now() of the last frame. */
  receivedAt = 0;
  /** ~20 s at 60 Hz, for the Inputs chart. */
  readonly history = new RollingHistory(60 * Math.max(20, TIMINGS.inputsWindowS * 2));
  private lastHistoryT = 0;

  push(frame: LiveFrame): void {
    const prev = this.frame;
    this.frame = frame;
    this.version++;
    this.receivedAt = performance.now();
    const ts = frame.t / 1000;
    if (frame.state === 'onTrack' || frame.state === 'replay') {
      if (ts < this.lastHistoryT || ts - this.lastHistoryT > 5) this.history.clear();
      this.history.push({
        t: ts,
        throttle: frame.car.throttle * 100,
        brake: frame.car.brake * 100,
        speed: frame.car.speedKmh,
      });
      this.lastHistoryT = ts;
    }
    derived.push(frame);
    // Mirror low-frequency fields only when they change.
    const liveRaceDetected = !!frame.race;
    if (
      !prev ||
      prev.state !== frame.state ||
      prev.format !== frame.format ||
      !!prev.race !== liveRaceDetected
    ) {
      useUi.setState({
        liveState: frame.state,
        liveRaceDetected,
        frameFormat: frame.format,
        ...(frame.state !== 'replay' ? { showReplayTelemetry: false } : {}),
      });
    }
  }

  clear(): void {
    this.frame = null;
    this.version++;
    this.history.clear();
    derived.clear();
    useUi.setState({
      liveState: null,
      liveRaceDetected: false,
      showReplayTelemetry: false,
      frameFormat: null,
    });
  }
}

export const live = new LiveStore();
