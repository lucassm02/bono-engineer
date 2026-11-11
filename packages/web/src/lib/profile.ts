/** Device profile reducer (pure): enable/disable, reorder, start view, toggles. */

import {
  createDefaultDeviceProfile,
  DELTA_REFERENCE_KINDS,
  type DeltaReferenceKind,
  type DeviceProfile,
  normalizeDeviceProfile,
  VIEW_IDS,
  type ViewId,
  type WidgetGridLayout,
} from '@gt7/shared';

export type ProfileAction =
  | { type: 'toggleView'; view: ViewId }
  | { type: 'moveView'; view: ViewId; by: -1 | 1 }
  | { type: 'setStartView'; view: ViewId }
  | { type: 'setPopups'; enabled: boolean }
  | { type: 'setLocked'; locked: boolean }
  | { type: 'setDeltaReference'; kind: DeltaReferenceKind }
  | { type: 'setAskTrack'; enabled: boolean }
  | { type: 'setCustomLayout'; layout: WidgetGridLayout }
  | { type: 'reset' };

/** Applies an action; returns the same object when nothing changed (cheap equality check). */
export function reduceProfile(p: DeviceProfile, a: ProfileAction, now: number): DeviceProfile {
  let next: DeviceProfile;
  switch (a.type) {
    case 'toggleView': {
      if (p.views.includes(a.view)) {
        if (p.views.length <= 1) return p; // always keep one view
        const views = p.views.filter((v) => v !== a.view);
        next = { ...p, views, startView: p.startView === a.view ? views[0]! : p.startView };
      } else {
        next = { ...p, views: [...p.views, a.view] };
      }
      break;
    }
    case 'moveView': {
      const i = p.views.indexOf(a.view);
      const j = i + a.by;
      if (i < 0 || j < 0 || j >= p.views.length) return p;
      const views = [...p.views];
      views[i] = views[j]!;
      views[j] = a.view;
      next = { ...p, views };
      break;
    }
    case 'setStartView':
      if (!p.views.includes(a.view) || p.startView === a.view) return p;
      next = { ...p, startView: a.view };
      break;
    case 'setPopups':
      if (p.popupsEnabled === a.enabled) return p;
      next = { ...p, popupsEnabled: a.enabled };
      break;
    case 'setLocked':
      if (p.locked === a.locked) return p;
      next = { ...p, locked: a.locked };
      break;
    case 'setDeltaReference':
      if (p.deltaReference === a.kind) return p;
      next = { ...p, deltaReference: a.kind };
      break;
    case 'setAskTrack':
      if (p.askTrackOnStart === a.enabled) return p;
      next = { ...p, askTrackOnStart: a.enabled };
      break;
    case 'setCustomLayout':
      if (p.customLayout === a.layout) return p;
      next = { ...p, customLayout: a.layout };
      break;
    case 'reset':
      next = createDefaultDeviceProfile(p.deviceId, p.name);
      break;
  }
  return { ...normalizeDeviceProfile(next, p.deviceId), updatedAt: now };
}

/** Views not enabled, in catalogue order (listed after the enabled ones in the picker). */
export function disabledViews(p: DeviceProfile): ViewId[] {
  return VIEW_IDS.filter((v) => !p.views.includes(v));
}

/** Next delta reference in the double-tap cycle. `reference` is skipped when unavailable. */
export function nextDeltaReference(
  current: DeltaReferenceKind,
  referenceAvailable: boolean,
): DeltaReferenceKind {
  const kinds = DELTA_REFERENCE_KINDS.filter((k) => k !== 'reference' || referenceAvailable);
  const i = kinds.indexOf(current);
  return kinds[(i + 1) % kinds.length] ?? 'personalBest';
}

/**
 * Reconciles the locally stored profile with the one received from the server: the most recently
 * updated wins. `pushToServer` = the local copy is newer and must be sent back.
 */
export function reconcileProfiles(
  local: DeviceProfile | null,
  remote: DeviceProfile,
): { profile: DeviceProfile; pushToServer: boolean } {
  if (local && local.updatedAt > remote.updatedAt) return { profile: local, pushToServer: true };
  return { profile: remote, pushToServer: false };
}
