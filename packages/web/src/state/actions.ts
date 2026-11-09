/** User/remote intents: navigation, profile edits, delta reference, overlays, pop-ups. */

import type { LapCompletedEvent, ViewId } from '@gt7/shared';
import { TIMINGS } from '../config.ts';
import { stepIndex } from '../lib/carousel.ts';
import { DELTA_REFERENCE_LABELS, VIEW_LABELS } from '../lib/labels.ts';
import { nextDeltaReference, type ProfileAction, reduceProfile } from '../lib/profile.ts';
import { derived } from '../live/derived.ts';
import { send } from '../net/transport.ts';
import { addNotice, setProfile, useUi } from './uiStore.ts';

let overlayTimer: ReturnType<typeof setTimeout> | null = null;
let popupTimer: ReturnType<typeof setTimeout> | null = null;

function vibrate(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // unsupported (iOS Safari)
  }
}

/** Shows the view/delta header for 3 s. */
export function showOverlay(): void {
  useUi.setState({ overlayVisible: true });
  if (overlayTimer) clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => useUi.setState({ overlayVisible: false }), TIMINGS.overlayMs);
}

export type ViewChangeSource = 'swipe' | 'picker' | 'remote' | 'keyboard';

export function goToView(view: ViewId, source: ViewChangeSource): void {
  const s = useUi.getState();
  if (!s.profile.views.includes(view)) {
    if (source === 'remote') {
      addNotice('warn', `Controle remoto: a tela ${VIEW_LABELS[view]} está desligada aqui.`);
    }
    return;
  }
  if (view === s.currentView) return;
  useUi.setState({ currentView: view });
  vibrate(12);
  send({ type: 'currentView', view });
  if (source === 'remote')
    addNotice('info', `Tela trocada pelo controle remoto: ${VIEW_LABELS[view]}`);
}

export function stepView(by: 1 | -1, source: ViewChangeSource): void {
  const { profile, currentView } = useUi.getState();
  const i = profile.views.indexOf(currentView);
  const next = profile.views[stepIndex(Math.max(0, i), by, profile.views.length)];
  if (next) goToView(next, source);
}

/** Applies a profile edit, persists locally and syncs to the server. */
export function dispatchProfile(action: ProfileAction): void {
  const { profile } = useUi.getState();
  const next = reduceProfile(profile, action, Date.now());
  if (next === profile) return;
  setProfile(next);
  send({ type: 'setDeviceProfile', profile: next });
}

/** Double tap: next delta reference. */
export function cycleDeltaReference(): void {
  const { profile } = useUi.getState();
  // The WS contract does not say whether a captured top lap exists for the track: it is inferred
  // from frames (live/derived.ts). Unknown tracks still offer it once; once the server answered
  // "no reference lap" for this track the cycle skips it.
  const kind = nextDeltaReference(profile.deltaReference, derived.referenceAvailable());
  dispatchProfile({ type: 'setDeltaReference', kind });
  send({ type: 'setDeltaReference', kind });
  vibrate(20);
  showOverlay();
  addNotice('info', `Delta contra: ${DELTA_REFERENCE_LABELS[kind]}`, 1800);
}

// The "top reference" can be selected (double tap) on a track that has none: frames then carry an
// empty delta. Fall back to the personal best once, with a notice (throttled: frames keep arriving
// with the old kind until the server applies the change).
let lastRefFallbackAt = 0;
derived.onReferenceMissing = () => {
  const now = Date.now();
  if (now - lastRefFallbackAt < 4000) return;
  lastRefFallbackAt = now;
  dispatchProfile({ type: 'setDeltaReference', kind: 'personalBest' });
  send({ type: 'setDeltaReference', kind: 'personalBest' });
  addNotice('info', 'Sem referência do top para esta pista: usando sua melhor volta.', 3000);
};

export function setLocked(locked: boolean): void {
  dispatchProfile({ type: 'setLocked', locked });
  vibrate(locked ? 30 : 15);
  addNotice(
    'info',
    locked ? 'Gestos travados. Segure o cadeado para destravar.' : 'Gestos destravados.',
    2500,
  );
}

export function openLayoutEditor(): void {
  if (useUi.getState().profile.locked) return;
  useUi.setState({ layoutEditorOpen: true, pickerOpen: false, overlayVisible: false });
}

export function closeLayoutEditor(): void {
  useUi.setState({ layoutEditorOpen: false });
}

export function openPicker(): void {
  if (useUi.getState().profile.locked) return;
  vibrate(25);
  useUi.setState({ pickerOpen: true, overlayVisible: false });
}

export function closePicker(): void {
  useUi.setState({ pickerOpen: false });
}

/** Menu with shortcuts to the other areas; works even with the gestures locked. */
export function toggleMenu(): void {
  useUi.setState((s) => ({ menuOpen: !s.menuOpen, overlayVisible: false }));
}

export function closeMenu(): void {
  useUi.setState({ menuOpen: false });
}

export function showLapPopup(event: LapCompletedEvent): void {
  if (!useUi.getState().profile.popupsEnabled) return;
  useUi.setState({ lapPopup: event });
  if (popupTimer) clearTimeout(popupTimer);
  popupTimer = setTimeout(() => useUi.setState({ lapPopup: null }), TIMINGS.lapPopupMs);
}

export function dismissLapPopup(): void {
  if (popupTimer) clearTimeout(popupTimer);
  useUi.setState({ lapPopup: null });
}
