/**
 * Pure gesture recognizer (tap / double tap / long press) as a state machine.
 *
 * Swipes are left to native scroll-snap: when the pointer travels more than `moveTolerancePx` (or the
 * browser cancels the pointer to scroll) the press is discarded. A single tap is emitted only after
 * the double-tap window expires, so a double tap never also produces a tap.
 *
 * The caller feeds pointer events with timestamps and schedules a `timeout` event at
 * {@link nextDeadline}. No timers or DOM inside: unit-testable.
 */

export interface GestureConfig {
  longPressMs: number;
  doubleTapMs: number;
  moveTolerancePx: number;
}

export type GestureInput =
  | { type: 'down'; t: number; x: number; y: number }
  | { type: 'move'; t: number; x: number; y: number }
  | { type: 'up'; t: number; x: number; y: number }
  | { type: 'cancel'; t: number }
  | { type: 'timeout'; t: number };

export type GestureOutput = 'tap' | 'doubleTap' | 'longPress';

export type GestureState =
  | { kind: 'idle' }
  /** Finger down, may become tap / long press. `second` = this is the 2nd press of a double tap. */
  | { kind: 'pressing'; downT: number; x: number; y: number; second: boolean }
  /** Long press already fired; wait for release. */
  | { kind: 'held' }
  /** Moved too far / cancelled: ignore until release. */
  | { kind: 'ignored' }
  /** One tap done, waiting to see if a second comes. */
  | { kind: 'awaitSecond'; upT: number };

export const INITIAL_GESTURE_STATE: GestureState = { kind: 'idle' };

export interface GestureStep {
  state: GestureState;
  emit: GestureOutput[];
}

export function stepGesture(
  state: GestureState,
  input: GestureInput,
  cfg: GestureConfig,
): GestureStep {
  const none = (s: GestureState): GestureStep => ({ state: s, emit: [] });
  switch (input.type) {
    case 'down': {
      if (state.kind === 'awaitSecond' && input.t - state.upT <= cfg.doubleTapMs) {
        return none({ kind: 'pressing', downT: input.t, x: input.x, y: input.y, second: true });
      }
      // A pending single tap whose window already elapsed is flushed first.
      const emit: GestureOutput[] = state.kind === 'awaitSecond' ? ['tap'] : [];
      return {
        state: { kind: 'pressing', downT: input.t, x: input.x, y: input.y, second: false },
        emit,
      };
    }
    case 'move': {
      if (state.kind !== 'pressing') return none(state);
      const dx = input.x - state.x;
      const dy = input.y - state.y;
      if (dx * dx + dy * dy > cfg.moveTolerancePx * cfg.moveTolerancePx) {
        return none({ kind: 'ignored' });
      }
      return none(state);
    }
    case 'up': {
      if (state.kind === 'pressing') {
        if (input.t - state.downT >= cfg.longPressMs) {
          // The timeout was not delivered in time: still a long press.
          return { state: { kind: 'idle' }, emit: ['longPress'] };
        }
        if (state.second) return { state: { kind: 'idle' }, emit: ['doubleTap'] };
        return none({ kind: 'awaitSecond', upT: input.t });
      }
      if (state.kind === 'held' || state.kind === 'ignored') return none({ kind: 'idle' });
      return none(state);
    }
    case 'cancel': {
      if (state.kind === 'awaitSecond') return none(state);
      return none({ kind: 'idle' });
    }
    case 'timeout': {
      if (state.kind === 'pressing' && input.t - state.downT >= cfg.longPressMs) {
        return { state: { kind: 'held' }, emit: ['longPress'] };
      }
      if (state.kind === 'awaitSecond' && input.t - state.upT > cfg.doubleTapMs) {
        return { state: { kind: 'idle' }, emit: ['tap'] };
      }
      return none(state);
    }
  }
}

/** Absolute time at which the caller should feed a `timeout`, or null if none is needed. */
export function nextDeadline(state: GestureState, cfg: GestureConfig): number | null {
  if (state.kind === 'pressing') return state.downT + cfg.longPressMs;
  if (state.kind === 'awaitSecond') return state.upT + cfg.doubleTapMs + 1;
  return null;
}
