/**
 * One-time hints of the guided tour (spec 04): the first time the engineer speaks, the first lap
 * without a reference and the first saved session. Each shows once per device (`gt7.tour.v1`,
 * `hints`), never in the demo, and goes away by itself. Triggers call `offerHint` from where the
 * event already happens.
 */

import { create } from 'zustand';
import { type HintId, loadTourState, saveTourState, withHint } from '../lib/tour.ts';
import { useUi } from './uiStore.ts';

export const useHint = create<{ hint: HintId | null }>()(() => ({ hint: null }));

export function offerHint(id: HintId): void {
  if (useUi.getState().source === 'mock') return;
  const state = loadTourState();
  if (state.hints[id]) return;
  saveTourState(withHint(state, id));
  useHint.setState({ hint: id });
}

export function dismissHint(): void {
  useHint.setState({ hint: null });
}
