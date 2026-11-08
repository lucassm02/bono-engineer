/**
 * WebSocket protocol between the server and dashboard clients (JSON text frames).
 *
 * Every message is a discriminated union on `type`. Clients must send `hello` first; the server
 * replies with `welcome` (+ `deviceProfile`, `status`, `sessionChanged`) and then streams `frame`.
 * Bump {@link WS_PROTOCOL_VERSION} on breaking changes.
 */

import type { DeltaReferenceKind, Id, Session } from './domain.ts';
import type { ConnectionState, LapCompletedEvent, LiveFrame } from './live.ts';
import type { IngestorStats, PacketFormat } from './telemetry.ts';
import type { DeviceProfile, ViewId } from './ui.ts';

export const WS_PROTOCOL_VERSION = 1;

/** Default HTTP/WebSocket port of the server (0.0.0.0). */
export const DEFAULT_HTTP_PORT = 8770;
/** WebSocket endpoint path. */
export const WS_PATH = '/ws';

/** Reference (replay) capture lifecycle. */
export type CaptureState =
  | 'idle'
  | 'switchingFormat'
  | 'waitingLapStart'
  | 'recording'
  | 'validating';

export interface ReferenceCaptureStatus {
  state: CaptureState;
  driverName: string | null;
  /** Lap id once a lap was captured and saved. */
  lapId: Id | null;
  /** Validation problems (pt-BR strings may be produced by the UI from these codes). */
  issues: string[];
}

/** Server/link status snapshot. */
export interface ServerStatus {
  connection: ConnectionState;
  ingestor: IngestorStats;
  /** LAN URLs where the dashboard is reachable (for QR code). */
  lanUrls: string[];
  /** Console IP configured/discovered. */
  consoleIp: string | null;
  capture: ReferenceCaptureStatus;
  /** Currently connected dashboard devices. */
  devices: { deviceId: string; name: string; currentView: ViewId | null }[];
  serverVersion: string;
}

// ---------------------------------------------------------------------------------------------
// Server → client
// ---------------------------------------------------------------------------------------------

export interface WelcomeMessage {
  type: 'welcome';
  protocolVersion: number;
  serverVersion: string;
  /** Echo of the client deviceId. */
  deviceId: string;
}

export interface FrameMessage {
  type: 'frame';
  frame: LiveFrame;
}

export interface LapCompletedMessage {
  type: 'lapCompleted';
  event: LapCompletedEvent;
}

export interface SessionChangedMessage {
  type: 'sessionChanged';
  /** Null when no session is active. */
  session: Session | null;
}

export interface StatusMessage {
  type: 'status';
  status: ServerStatus;
}

export interface DeviceProfileMessage {
  type: 'deviceProfile';
  profile: DeviceProfile;
}

/** Remote control: the server asks this device to show a view (sent by another device). */
export interface ShowViewMessage {
  type: 'showView';
  view: ViewId;
  /** deviceId of the controller. */
  from: string;
}

export interface NoticeMessage {
  type: 'notice';
  level: 'info' | 'warn' | 'error';
  /** Stable machine code, e.g. 'formatSwitched', 'captureInvalid', 'firewall'. */
  code: string;
  /** Human message (pt-BR). */
  message: string;
  /** Suggested display duration. */
  ttlMs?: number;
}

export interface PongMessage {
  type: 'pong';
  /** Echo of the ping timestamp. */
  t: number;
  serverTime: number;
}

export type ServerMessage =
  | WelcomeMessage
  | FrameMessage
  | LapCompletedMessage
  | SessionChangedMessage
  | StatusMessage
  | DeviceProfileMessage
  | ShowViewMessage
  | NoticeMessage
  | PongMessage;

// ---------------------------------------------------------------------------------------------
// Client → server
// ---------------------------------------------------------------------------------------------

export interface HelloMessage {
  type: 'hello';
  protocolVersion: number;
  deviceId: string;
  /** Suggested name for a new device profile. */
  deviceName?: string;
  userAgent?: string;
}

export interface SetDeviceProfileMessage {
  type: 'setDeviceProfile';
  profile: DeviceProfile;
}

export interface SetDeltaReferenceMessage {
  type: 'setDeltaReference';
  kind: DeltaReferenceKind;
  /** Required when kind = 'reference' and several references exist for the track. */
  lapId?: Id;
}

/** Report which view this device is showing (for the remote control list). */
export interface CurrentViewMessage {
  type: 'currentView';
  view: ViewId;
}

export interface SetTargetViewMessage {
  type: 'setTargetView';
  targetDeviceId: string;
  view: ViewId;
}

export interface StartReferenceCaptureMessage {
  type: 'startReferenceCapture';
  driverName: string;
  carName?: string;
  /** Ranking lap time for validation. */
  rankingTimeMs?: number;
  notes?: string;
  /** Format used for the capture (default 'B': '~' does not work in replays). */
  format?: PacketFormat;
}

export interface StopReferenceCaptureMessage {
  type: 'stopReferenceCapture';
  /** false = discard what was captured. */
  save: boolean;
}

export interface SetPacketFormatMessage {
  type: 'setPacketFormat';
  format: PacketFormat;
}

export interface PingMessage {
  type: 'ping';
  t: number;
}

export type ClientMessage =
  | HelloMessage
  | SetDeviceProfileMessage
  | SetDeltaReferenceMessage
  | CurrentViewMessage
  | SetTargetViewMessage
  | StartReferenceCaptureMessage
  | StopReferenceCaptureMessage
  | SetPacketFormatMessage
  | PingMessage;

export type ServerMessageType = ServerMessage['type'];
export type ClientMessageType = ClientMessage['type'];
