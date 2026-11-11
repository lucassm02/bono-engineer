/**
 * Track context of the live panel (specs 05 and 06), low frequency: what the app knows about the
 * track, whether the car is stopped, the "Pista de hoje" sheet, the opening chip, the
 * "Reconhecer sozinho" choice and the mismatch notice. Fed from the live frames by the context bar
 * (see components/LiveContextBar.tsx); frames at 30 Hz only touch the store when something changed.
 */

import type { LiveFrame, LiveTrackContext, TrackMismatchInfo } from '@gt7/shared';
import { create } from 'zustand';
import { api, request } from '../analysis/api.ts';
import type { TrackOverview } from '../analysis/lib/history.ts';
import { t as uiText } from '../lib/i18n.ts';
import {
  demoPromptsAllowed,
  isDemoSource,
  isSafeToPrompt,
  OPEN_CHIP_MS,
  openChipWanted,
  type PromptGate,
  SAFE_SPEED_KMH,
} from '../lib/liveContext.ts';
import { send } from '../net/transport.ts';
import { dispatchProfile } from './actions.ts';
import { addNotice, useUi } from './uiStore.ts';

export type PickerMode = 'choose' | 'name';

type EngineerStatusKey = NonNullable<LiveFrame['engineer']>['status'];

export interface LiveContextState {
  /** Track context of the latest frame (null before the first frame or from an old server). */
  ctx: LiveTrackContext | null;
  carCode: number | null;
  engineerStatus: EngineerStatusKey | undefined;
  sessionId: string | null;
  /** The car is below the "stopped" speed. */
  stopped: boolean;
  /** "Pista de hoje" sheet: closed (null) or open for choosing / naming. */
  picker: PickerMode | null;
  /** The opening chip is shown until this epoch ms. */
  chipUntil: number | null;
  /** "Reconhecer sozinho" was chosen and no session has opened since. */
  skipPending: boolean;
  /** Session for which "Reconhecer sozinho" holds. */
  skippedSessionId: string | null;
  /** The hint failed on the first lap: waiting for the car to stop to tell the driver. */
  mismatch: { info: TrackMismatchInfo; detectedIsNew: boolean } | null;
}

export const useLiveContext = create<LiveContextState>()(() => ({
  ctx: null,
  carCode: null,
  engineerStatus: undefined,
  sessionId: null,
  stopped: true,
  picker: null,
  chipUntil: null,
  skipPending: false,
  skippedSessionId: null,
  mismatch: null,
}));

// ---------------------------------------------------------------------------------------------
// Saved tracks (for the sheet, the menu card and the opening chip)
// ---------------------------------------------------------------------------------------------

export interface SavedTracksState {
  tracks: TrackOverview[] | null;
  at: number;
}

export const useSavedTracks = create<SavedTracksState>()(() => ({ tracks: null, at: 0 }));

const SAVED_TTL_MS = 20_000;
let savedJob: Promise<TrackOverview[]> | null = null;

/** Loads the saved tracks (one request in flight; cached for a few seconds unless `force`). */
export function ensureSavedTracks(force = false): Promise<TrackOverview[]> {
  const { tracks, at } = useSavedTracks.getState();
  if (!force && tracks && Date.now() - at < SAVED_TTL_MS) return Promise.resolve(tracks);
  if (savedJob) return savedJob;
  savedJob = api
    .tracksOverview()
    .then((o) => {
      useSavedTracks.setState({ tracks: o.tracks, at: Date.now() });
      return o.tracks;
    })
    .catch(() => useSavedTracks.getState().tracks ?? [])
    .finally(() => {
      savedJob = null;
    });
  return savedJob;
}

// ---------------------------------------------------------------------------------------------
// Gate: may the app ask anything?
// ---------------------------------------------------------------------------------------------

/** Current conditions for the prompts of spec 06 (`savedTracks` counted by the caller). */
export function currentPromptGate(savedTracks: number): PromptGate {
  const ui = useUi.getState();
  const lc = useLiveContext.getState();
  const link = ui.source === 'mock' ? null : ui.serverStatus?.consoleConnection;
  return {
    demo: isDemoSource(ui.source, link),
    demoAllowed: typeof location !== 'undefined' && demoPromptsAllowed(location.search),
    replay: ui.liveState === 'replay',
    askOnStart: ui.profile.askTrackOnStart,
    savedTracks,
    skipped: lc.skipPending || (!!lc.sessionId && lc.skippedSessionId === lc.sessionId),
    hasHint: !!lc.ctx?.hint,
  };
}

/** Reactive version of {@link currentPromptGate}, for the components that show the prompts. */
export function usePromptGate(): PromptGate {
  const savedTracks = useSavedTracks((s) => s.tracks?.length ?? 0);
  const askOnStart = useUi((s) => s.profile.askTrackOnStart);
  const source = useUi((s) => s.source);
  const link = useUi((s) => s.serverStatus?.consoleConnection ?? null);
  const liveState = useUi((s) => s.liveState);
  const skipPending = useLiveContext((s) => s.skipPending);
  const skippedSessionId = useLiveContext((s) => s.skippedSessionId);
  const sessionId = useLiveContext((s) => s.sessionId);
  const hasHint = useLiveContext((s) => !!s.ctx?.hint);
  return {
    demo: isDemoSource(source, source === 'mock' ? null : link),
    demoAllowed: typeof location !== 'undefined' && demoPromptsAllowed(location.search),
    replay: liveState === 'replay',
    askOnStart,
    savedTracks,
    skipped: skipPending || (!!sessionId && skippedSessionId === sessionId),
    hasHint,
  };
}

export function safeToPromptNow(): boolean {
  const lc = useLiveContext.getState();
  return isSafeToPrompt({
    state: useUi.getState().liveState,
    speedKmh: lc.stopped ? 0 : SAFE_SPEED_KMH,
  });
}

// ---------------------------------------------------------------------------------------------
// Frames → store
// ---------------------------------------------------------------------------------------------

let lastKey = '';

/** Called for every live frame; only changes reach the store. */
export function feedLiveContext(f: LiveFrame): void {
  const ctx = f.trackContext ?? null;
  const stopped = f.car.speedKmh < SAFE_SPEED_KMH;
  const sessionId = f.sessionId ?? null;
  const key = JSON.stringify([ctx, f.car.carCode, f.engineer?.status, stopped, sessionId]);
  if (key === lastKey) return;
  lastKey = key;
  const prev = useLiveContext.getState();
  const patch: Partial<LiveContextState> = {
    ctx,
    carCode: f.car.carCode > 0 ? f.car.carCode : prev.carCode,
    engineerStatus: f.engineer?.status,
    stopped,
    sessionId,
  };
  if (sessionId !== prev.sessionId) {
    if (sessionId && prev.skipPending) {
      patch.skippedSessionId = sessionId;
      patch.skipPending = false;
    }
    patch.chipUntil = null;
  }
  useLiveContext.setState(patch);
  if (sessionId && sessionId !== prev.sessionId) void maybeShowOpenChip(sessionId);
}

/** A session just opened: if nothing was chosen and nothing is known, offer the choice for 8 s. */
async function maybeShowOpenChip(sessionId: string): Promise<void> {
  const tracks = await ensureSavedTracks();
  const lc = useLiveContext.getState();
  if (lc.sessionId !== sessionId) return;
  const wanted = openChipWanted({
    gate: currentPromptGate(tracks.length),
    trackKnown: !!lc.ctx?.name,
    safe: safeToPromptNow(),
  });
  if (wanted) useLiveContext.setState({ chipUntil: Date.now() + OPEN_CHIP_MS });
}

// ---------------------------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------------------------

/** Opens the "Pista de hoje" sheet, only with the car stopped, paused or in a menu. */
export function openTrackPicker(mode: PickerMode): boolean {
  if (!safeToPromptNow()) {
    addNotice('info', uiText('Disponível quando você parar'), 2500);
    return false;
  }
  useUi.setState({ menuOpen: false, overlayVisible: false });
  useLiveContext.setState({ picker: mode, chipUntil: null });
  if (mode === 'choose') void ensureSavedTracks(true);
  return true;
}

export function closeTrackPicker(): void {
  useLiveContext.setState({ picker: null });
}

/**
 * Tells the server which saved track the driver will drive (`null` = recognise by itself). Goes
 * through the WebSocket; falls back to REST when the socket is not connected.
 */
export async function chooseTrack(trackId: string | null, force = false): Promise<boolean> {
  useLiveContext.setState({ chipUntil: null });
  const sent = send({ type: 'setTrackHint', trackId, ...(force ? { force: true } : {}) });
  if (sent) return true;
  try {
    await request('PUT', '/api/session/track-hint', { trackId, ...(force ? { force: true } : {}) });
    return true;
  } catch (e) {
    addNotice('error', (e as Error).message, 5000);
    return false;
  }
}

/** "Reconhecer sozinho": no choice for this session; nothing else is asked until it ends. */
export function skipTrackPrompt(): void {
  const lc = useLiveContext.getState();
  if (lc.sessionId) useLiveContext.setState({ skippedSessionId: lc.sessionId, chipUntil: null });
  else useLiveContext.setState({ skipPending: true, chipUntil: null });
  if (lc.ctx?.hint) void chooseTrack(null);
}

/** "Não perguntar mais": turns the preference off for this device. */
export function neverAskTrack(): void {
  dispatchProfile({ type: 'setAskTrack', enabled: false });
  useLiveContext.setState({ chipUntil: null });
}

/** The server moved the session to another track: tell the driver once the car is stopped. */
export function noteTrackMismatch(info: TrackMismatchInfo): void {
  useLiveContext.setState({
    mismatch: { info, detectedIsNew: /^Pista desconhecida/.test(info.detectedTrackName) },
  });
  void ensureSavedTracks(true);
}

export function dismissMismatch(): void {
  useLiveContext.setState({ mismatch: null });
}

/** Test helper: forget the last frame signature. */
export function resetLiveContextFeed(): void {
  lastKey = '';
  useLiveContext.setState({
    ctx: null,
    carCode: null,
    engineerStatus: undefined,
    sessionId: null,
    stopped: true,
    picker: null,
    chipUntil: null,
    skipPending: false,
    skippedSessionId: null,
    mismatch: null,
  });
}
