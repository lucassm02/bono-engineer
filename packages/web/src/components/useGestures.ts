/** Pointer Events adapter for the pure gesture recognizer (lib/gestures.ts). */

import { type RefObject, useEffect, useRef } from 'react';
import { TIMINGS } from '../config.ts';
import {
  type GestureConfig,
  type GestureInput,
  type GestureOutput,
  type GestureState,
  INITIAL_GESTURE_STATE,
  nextDeadline,
  stepGesture,
} from '../lib/gestures.ts';

const CFG: GestureConfig = {
  longPressMs: TIMINGS.longPressMs,
  doubleTapMs: TIMINGS.doubleTapMs,
  moveTolerancePx: TIMINGS.moveTolerancePx,
};

export type GestureHandler = (g: GestureOutput) => void;

/**
 * Recognizes tap / double tap / long press on `ref`. Events starting inside an element marked
 * `data-no-gesture` (buttons, sheets) are ignored. Swipes are left to native scrolling.
 */
export function useGestures(ref: RefObject<HTMLElement | null>, onGesture: GestureHandler): void {
  const handlerRef = useRef(onGesture);
  handlerRef.current = onGesture;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let state: GestureState = INITIAL_GESTURE_STATE;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let activePointer: number | null = null;

    const apply = (input: GestureInput) => {
      const r = stepGesture(state, input, CFG);
      state = r.state;
      for (const g of r.emit) handlerRef.current(g);
      if (timer) clearTimeout(timer);
      timer = null;
      const d = nextDeadline(state, CFG);
      if (d !== null) {
        timer = setTimeout(
          () => apply({ type: 'timeout', t: performance.now() }),
          Math.max(0, d - performance.now()),
        );
      }
    };

    const ignored = (e: Event) =>
      e.target instanceof Element && e.target.closest('[data-no-gesture]') !== null;

    const down = (e: PointerEvent) => {
      if (ignored(e)) return;
      if (activePointer !== null) {
        // Second finger: not a gesture we handle (pinch etc.).
        apply({ type: 'cancel', t: performance.now() });
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      activePointer = e.pointerId;
      apply({ type: 'down', t: performance.now(), x: e.clientX, y: e.clientY });
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return;
      apply({ type: 'move', t: performance.now(), x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return;
      activePointer = null;
      apply({ type: 'up', t: performance.now(), x: e.clientX, y: e.clientY });
    };
    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return;
      activePointer = null;
      apply({ type: 'cancel', t: performance.now() });
    };
    const scroll = () => {
      // The carousel started moving: whatever was pressed is a swipe.
      if (state.kind === 'pressing') apply({ type: 'cancel', t: performance.now() });
    };
    const contextMenu = (e: Event) => {
      if (!ignored(e)) e.preventDefault();
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('scroll', scroll, { capture: true, passive: true });
    el.addEventListener('contextmenu', contextMenu);
    return () => {
      if (timer) clearTimeout(timer);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('scroll', scroll, { capture: true });
      el.removeEventListener('contextmenu', contextMenu);
    };
  }, [ref]);
}
