/**
 * Single requestAnimationFrame loop for all live widgets.
 *
 * Widgets register a render callback with {@link useLiveRender}. Each tick, a renderer runs only if
 * a new frame arrived since its last run; renderers in off-screen (neighbour) views are throttled to
 * {@link TIMINGS.backgroundRefreshMs} so swiping in never shows stale data yet costs ~nothing.
 */

import type { LiveFrame } from '@gt7/shared';
import { createContext, useContext, useEffect, useRef } from 'react';
import { TIMINGS } from '../config.ts';
import { live } from './liveStore.ts';

export type LiveRenderer = (frame: LiveFrame, now: number) => void;

interface Subscription {
  render: LiveRenderer;
  isActive: () => boolean;
  lastVersion: number;
  lastAt: number;
}

const subs = new Set<Subscription>();
let rafId = 0;

function tick(now: number): void {
  rafId = 0;
  const frame = live.frame;
  if (frame) {
    for (const s of subs) {
      if (s.lastVersion === live.version) continue;
      if (!s.isActive() && now - s.lastAt < TIMINGS.backgroundRefreshMs) continue;
      s.lastVersion = live.version;
      s.lastAt = now;
      try {
        s.render(frame, now);
      } catch (err) {
        console.error('[live] renderer failed', err);
      }
    }
  }
  if (subs.size > 0) rafId = requestAnimationFrame(tick);
}

function ensureLoop(): void {
  if (rafId === 0 && subs.size > 0) rafId = requestAnimationFrame(tick);
}

/** True for the view currently on screen; false for neighbours kept mounted by the carousel. */
export const ViewActiveContext = createContext(true);

/** Registers a live renderer for the lifetime of the component. */
export function useLiveRender(render: LiveRenderer): void {
  const active = useContext(ViewActiveContext);
  const renderRef = useRef(render);
  renderRef.current = render;
  const activeRef = useRef(active);
  activeRef.current = active;
  const subRef = useRef<Subscription | null>(null);

  useEffect(() => {
    const sub: Subscription = {
      render: (f, now) => renderRef.current(f, now),
      isActive: () => activeRef.current,
      lastVersion: -1,
      lastAt: 0,
    };
    subRef.current = sub;
    subs.add(sub);
    ensureLoop();
    return () => {
      subs.delete(sub);
      subRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Becoming visible (or hidden): redraw on the next tick.
    if (active && subRef.current) subRef.current.lastVersion = -1;
  }, [active]);
}
