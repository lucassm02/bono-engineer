/**
 * Guided tour (spec 04): which tour is running and at which step, when it may start and how it
 * leaves things. The live tour runs on the in-browser demo (`enterTourDemo`), so it touches neither
 * the PS5 data nor the saved session; leaving restores the source, the screen and the page.
 */

import type { ViewId } from '@gt7/shared';
import { create } from 'zustand';
import { t as uiText } from '../lib/i18n.ts';
import { isSafeToPrompt, SAFE_SPEED_KMH } from '../lib/liveContext.ts';
import { navigate, parseRoute, routes } from '../lib/route.ts';
import {
  loadTourState,
  saveTourState,
  type TourId,
  type TourOutcome,
  withOutcome,
} from '../lib/tour.ts';
import { bumpUsage } from '../lib/usage.ts';
import { enterTourDemo, leaveTourDemo } from '../net/connection.ts';
import { useLiveContext } from './liveContext.ts';
import { addNotice, useUi } from './uiStore.ts';

export interface TourStore {
  active: TourId | null;
  index: number;
  /** The live tour is running on the demo. */
  demo: boolean;
  /** A tour asked for while the car was moving: starts at the next pause. */
  pending: TourId | null;
  /** Page and screen to go back to when the tour ends. */
  returnHash: string | null;
  returnView: ViewId | null;
}

export const useTour = create<TourStore>()(() => ({
  active: null,
  index: 0,
  demo: false,
  pending: null,
  returnHash: null,
  returnView: null,
}));

/** The car is moving on the real console: no tour (the demos never block). */
export function tourBlocked(): boolean {
  const ui = useUi.getState();
  if (ui.source === 'mock') return false;
  if (ui.serverStatus?.consoleConnection?.source === 'simulator') return false;
  const stopped = useLiveContext.getState().stopped;
  return !isSafeToPrompt({ state: ui.liveState, speedKmh: stopped ? 0 : SAFE_SPEED_KMH });
}

function onLiveRoute(): boolean {
  return parseRoute(location.hash).name === 'live';
}

function begin(id: TourId): void {
  const ui = useUi.getState();
  const returnHash = location.hash;
  const returnView = ui.currentView;
  if (id === 'live') {
    enterTourDemo();
    if (!onLiveRoute()) navigate(routes.live());
  } else if (onLiveRoute()) {
    navigate(routes.home());
  }
  bumpUsage('tourStarts');
  useTour.setState({
    active: id,
    index: 0,
    demo: id === 'live',
    pending: null,
    returnHash,
    returnView,
  });
}

/**
 * Starts a tour, unless the car is moving: then it says so and waits for the next pause.
 * Only a button calls this; a tour never opens by itself.
 */
export function requestTour(id: TourId): 'started' | 'deferred' {
  if (useTour.getState().active) return 'started';
  if (tourBlocked()) {
    useTour.setState({ pending: id });
    addNotice('info', uiText('Disponível quando você parar.'), 4000);
    return 'deferred';
  }
  begin(id);
  return 'started';
}

/** Ends the running tour ("Pular", Esc and the last button all land here) and puts things back. */
export function endTour(outcome: TourOutcome): void {
  const t = useTour.getState();
  if (!t.active) return;
  saveTourState(withOutcome(loadTourState(), t.active, outcome));
  bumpUsage(outcome === 'done' ? 'tourFinished' : 'tourSkipped');
  if (t.demo) leaveTourDemo();
  useTour.setState({
    active: null,
    index: 0,
    demo: false,
    pending: null,
    returnHash: null,
    returnView: null,
  });
  const ui = useUi.getState();
  const back = t.returnView;
  if (back && ui.profile.views.includes(back)) useUi.setState({ currentView: back });
  if (t.returnHash !== null && t.returnHash !== location.hash) navigate(t.returnHash || '#/');
}

export function setTourIndex(index: number): void {
  useTour.setState({ index });
}

// A deferred tour starts the moment the car stops.
function startPendingIfSafe(): void {
  const { pending, active } = useTour.getState();
  if (pending && !active && !tourBlocked()) begin(pending);
}
useUi.subscribe(startPendingIfSafe);
useLiveContext.subscribe(startPendingIfSafe);
