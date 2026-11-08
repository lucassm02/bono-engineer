/**
 * Full-screen circular carousel. Only three slots are mounted (previous, current, next) inside a
 * native CSS scroll-snap scroller; when a swipe settles on a neighbour the current view changes and
 * the scroller is re-centred instantly, so the list wraps forever. Only the centre slot renders at
 * full rate (ViewActiveContext); neighbours refresh slowly.
 */

import type { ViewId } from '@gt7/shared';
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { carouselSlots, settledSlot } from '../lib/carousel.ts';
import { ViewActiveContext } from '../live/raf.ts';
import { goToView, stepView } from '../state/actions.ts';
import { useUi } from '../state/uiStore.ts';
import { ViewContent } from '../views/registry.tsx';

let animateStepImpl: ((by: 1 | -1) => void) | null = null;

/** Animated step to the neighbour view (keyboard / arrow buttons). */
export function animateStep(by: 1 | -1): void {
  if (animateStepImpl) animateStepImpl(by);
  else stepView(by, 'keyboard');
}

function slotKeys(views: ViewId[], indices: number[]): string[] {
  const seen = new Map<string, number>();
  return indices.map((i) => {
    const v = views[i] ?? 'corrida';
    const n = seen.get(v) ?? 0;
    seen.set(v, n + 1);
    return n === 0 ? v : `${v}#${n}`;
  });
}

export function Carousel() {
  const views = useUi((s) => s.profile.views);
  const current = useUi((s) => s.currentView);
  const locked = useUi((s) => s.profile.locked);
  const pickerOpen = useUi((s) => s.pickerOpen);
  const idx = Math.max(0, views.indexOf(current));
  const slots = carouselSlots(idx, views.length);
  const curSlot = slots.findIndex((s) => s.role === 'cur');
  const keys = slotKeys(
    views,
    slots.map((s) => s.index),
  );

  const scrollerRef = useRef<HTMLDivElement>(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const viewsRef = useRef(views);
  viewsRef.current = views;

  const recenter = useCallback(() => {
    const el = scrollerRef.current;
    if (el) el.scrollLeft = curSlot * el.clientWidth;
  }, [curSlot]);

  // Re-centre synchronously after every view change (before paint: no flicker).
  // biome-ignore lint/correctness/useExhaustiveDependencies: idx/views changes must re-centre too
  useLayoutEffect(recenter, [recenter, idx, views]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => recenter());
    ro.observe(el);
    return () => ro.disconnect();
  }, [recenter]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let touching = false;
    const hasScrollEnd = 'onscrollend' in window;

    const settle = () => {
      if (touching) return;
      const s = settledSlot(el.scrollLeft, el.clientWidth, slotsRef.current.length);
      const slot = slotsRef.current[s];
      if (!slot || slot.role === 'cur') return;
      const view = viewsRef.current[slot.index];
      if (view) goToView(view, 'swipe');
    };
    const onScroll = () => {
      if (hasScrollEnd) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(settle, 140);
    };
    const onTouchStart = () => {
      touching = true;
    };
    const onTouchEnd = () => {
      touching = false;
      if (!hasScrollEnd) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(settle, 220);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('scrollend', settle);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    animateStepImpl = (by) => {
      const slotsNow = slotsRef.current;
      if (slotsNow.length < 3) return;
      const target = by > 0 ? 2 : 0;
      el.scrollTo({ left: target * el.clientWidth, behavior: 'smooth' });
      // Safety net if no scroll events arrive (reduced motion, hidden tab).
      setTimeout(() => {
        if (settledSlot(el.scrollLeft, el.clientWidth, slotsRef.current.length) !== 1) settle();
        else if (slotsRef.current === slotsNow) stepView(by, 'keyboard');
      }, 700);
    };
    return () => {
      animateStepImpl = null;
      if (timer) clearTimeout(timer);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('scrollend', settle);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  return (
    <div className="carousel" ref={scrollerRef} data-locked={locked ? '1' : '0'}>
      {slots.map((slot, i) => {
        const view = views[slot.index] ?? 'corrida';
        const active = slot.role === 'cur' && !pickerOpen;
        return (
          <section
            key={keys[i]}
            className="slot"
            data-role={slot.role}
            data-view={view}
            aria-hidden={slot.role !== 'cur'}
          >
            <ViewActiveContext.Provider value={active}>
              <ViewContent view={view} />
            </ViewActiveContext.Provider>
          </section>
        );
      })}
    </div>
  );
}
