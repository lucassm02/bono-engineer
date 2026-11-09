/**
 * Low-frequency UI state (zustand): profile, current view, connection, pop-ups, notices.
 * Live 60 Hz telemetry does NOT live here (see live/liveStore.ts).
 */

import {
  type ConnectionState,
  type ConsoleConnection,
  type DeviceProfile,
  type LapCompletedEvent,
  normalizeDeviceProfile,
  type PacketFormat,
  type ServerStatus,
  type Session,
  type ViewId,
} from '@gt7/shared';
import { create } from 'zustand';
import { getDeviceId, guessDeviceName, loadJson, saveJson } from '../lib/storage.ts';

export type DataSource = 'server' | 'mock';
export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed';
export type KeepAwakeMode = 'pending' | 'wakeLock' | 'video' | 'none';

export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  until: number;
}

export interface UiState {
  source: DataSource;
  /** Mock started automatically because no server answered (dev only). */
  mockAuto: boolean;
  wsStatus: WsStatus;
  wsAttempt: number;
  wsRetryAt: number | null;
  wsEverOpened: boolean;
  serverVersion: string | null;
  serverStatus: ServerStatus | null;
  latencyMs: number | null;
  session: Session | null;

  /** State of the latest frame (null = no frame yet / stale). */
  liveState: ConnectionState | null;
  frameFormat: PacketFormat | null;

  profile: DeviceProfile;
  currentView: ViewId;
  overlayVisible: boolean;
  pickerOpen: boolean;
  /** Editor of the "Personalizada" grid. */
  layoutEditorOpen: boolean;
  lapPopup: LapCompletedEvent | null;
  notices: Notice[];
  keepAwake: KeepAwakeMode;
  /** Simulated console link while the in-browser demo runs. */
  mockConnection: ConsoleConnection | null;
  /** Details panel of the console link (opened from the discreet indicator). */
  connectionPanelOpen: boolean;
  /** First-run assistant: 'unknown' = not decided yet, 'active' = showing, 'off' = never/finished. */
  onboarding: 'unknown' | 'active' | 'off';
}

const PROFILE_KEY = 'gt7.profile';

function initialProfile(): DeviceProfile {
  const deviceId = getDeviceId();
  const stored = loadJson<unknown>(PROFILE_KEY);
  const p = normalizeDeviceProfile(stored, deviceId);
  if (!stored)
    p.name = guessDeviceName(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  return { ...p, deviceId };
}

const profile0 = initialProfile();

export const useUi = create<UiState>()(() => ({
  source: 'server',
  mockAuto: false,
  wsStatus: 'idle',
  wsAttempt: 0,
  wsRetryAt: null,
  wsEverOpened: false,
  serverVersion: null,
  serverStatus: null,
  latencyMs: null,
  session: null,
  liveState: null,
  frameFormat: null,
  profile: profile0,
  currentView: profile0.startView,
  overlayVisible: false,
  pickerOpen: false,
  layoutEditorOpen: false,
  lapPopup: null,
  notices: [],
  keepAwake: 'pending',
  mockConnection: null,
  connectionPanelOpen: false,
  onboarding: 'unknown',
}));

/** Stores the profile (keeps the current view when still enabled) and persists it locally. */
export function setProfile(p: DeviceProfile): void {
  const { currentView } = useUi.getState();
  const view = p.views.includes(currentView) ? currentView : p.startView;
  useUi.setState({ profile: p, currentView: view });
  saveJson(PROFILE_KEY, p);
}

export function loadLocalProfile(): DeviceProfile | null {
  const stored = loadJson<unknown>(PROFILE_KEY);
  return stored ? normalizeDeviceProfile(stored, useUi.getState().profile.deviceId) : null;
}

let noticeSeq = 0;
const NOTICE_MAX = 3;

export function addNotice(level: Notice['level'], message: string, ttlMs = 3500): void {
  const now = Date.now();
  const n: Notice = { id: ++noticeSeq, level, message, until: now + ttlMs };
  useUi.setState((s) => ({
    notices: [...s.notices.filter((x) => x.message !== message), n].slice(-NOTICE_MAX),
  }));
  setTimeout(() => {
    useUi.setState((s) => ({ notices: s.notices.filter((x) => x.id !== n.id) }));
  }, ttlMs);
}

export function dismissNotice(id: number): void {
  useUi.setState((s) => ({ notices: s.notices.filter((x) => x.id !== id) }));
}
