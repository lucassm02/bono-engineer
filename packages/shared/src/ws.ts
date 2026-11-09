/**
 * WebSocket protocol between the server and dashboard clients (JSON text frames).
 *
 * Every message is a discriminated union on `type`. Clients must send `hello` first; the server
 * replies with `welcome` (+ `deviceProfile`, `status`, `sessionChanged`) and then streams `frame`.
 * Bump {@link WS_PROTOCOL_VERSION} on breaking changes.
 */

import type { DeltaReferenceKind, Id, Lap, Session } from './domain.ts';
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

/**
 * Where the console conversation stands (zero-config discovery), shown by the UI as the
 * "Conexão com o PlayStation" card.
 * - idle: telemetry not running (UDP port busy or not started yet).
 * - searching: no console IP known yet; scanning the local network(s).
 * - found: console IP known (manual, saved or discovered) but no packet received yet — the game
 *   is closed / in a menu without telemetry ("aguardando o jogo": not an error).
 * - receiving: valid telemetry packets are arriving.
 * - lost: packets were arriving and stopped (game closed/paused, console off, IP changed).
 */
export type ConsoleLinkState = 'idle' | 'searching' | 'found' | 'receiving' | 'lost';

/** How the current console IP was obtained. */
export type ConsoleIpSource = 'manual' | 'discovered' | 'simulator';

/** Console link + discovery status (`ServerStatus.consoleConnection`). */
export interface ConsoleConnection {
  state: ConsoleLinkState;
  consoleIp: string | null;
  /** null while no IP is known. */
  source: ConsoleIpSource | null;
  /** Networks being scanned, CIDR (e.g. "192.168.0.0/24"); empty without a private network. */
  subnets: string[];
  /** Addresses probed with a heartbeat since the current search started. */
  hostsProbed: number;
  /** Epoch ms when the last scan round started, null if none yet. */
  lastScanAt: number | null;
  /** Epoch ms of the last valid telemetry packet, null if none yet. */
  lastPacketAt: number | null;
  /** pt-BR guidance for the user (null when everything is fine). */
  hint: string | null;
}

/** Server/link status snapshot. */
export interface ServerStatus {
  /**
   * High-level driving state (disconnected/menu/onTrack…). NOT the console link: for that see
   * {@link ServerStatus.consoleConnection}.
   */
  connection: ConnectionState;
  ingestor: IngestorStats;
  /** LAN URLs where the dashboard is reachable (for QR code). */
  lanUrls: string[];
  /** Console IP configured/discovered. */
  consoleIp: string | null;
  capture: ReferenceCaptureStatus;
  /** Currently connected dashboard devices. */
  devices: {
    deviceId: string;
    name: string;
    currentView: ViewId | null;
    /** Epoch ms of the last message from this device. (server, additive) */
    lastSeenAt?: number;
  }[];
  serverVersion: string;
  /** Windows Firewall check for LAN access (filled by the server). (server, additive) */
  firewall?: FirewallStatus;
  /** Console link and automatic discovery state. (core, additive) */
  consoleConnection?: ConsoleConnection;
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

// ---------------------------------------------------------------------------------------------
// REST API (/api) payloads — owned by @gt7/server (additive)
// ---------------------------------------------------------------------------------------------

/** Prefix of the JSON REST API. */
export const API_PREFIX = '/api';

/** Error body of every non-2xx JSON response (`message` is pt-BR). */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface FirewallRuleStatus {
  /** Rule display name (netsh "name"). */
  name: string;
  protocol: 'TCP' | 'UDP';
  port: number;
  /** null = unknown (not Windows / check failed). */
  present: boolean | null;
}

/** Windows Firewall inbound rules needed for LAN access (TCP http port, UDP 33740). */
export interface FirewallStatus {
  /** 'ok' = all rules found; 'missing' = some absent; 'unknown' = not Windows or not checkable. */
  state: 'ok' | 'missing' | 'unknown';
  platform: string;
  rules: FirewallRuleStatus[];
  /** Commands for an elevated PowerShell (Run as Administrator) creating the missing rules. */
  powershellCommands: string[];
  /** Same, using netsh (elevated cmd/PowerShell). */
  netshCommands: string[];
  /** pt-BR explanation for the UI. */
  message: string;
  checkedAt: number | null;
}

/** Runtime settings as exposed by GET/PATCH /api/settings. */
export interface ApiSettings {
  /** Current console IP (manual, saved or discovered); null while still searching. */
  consoleIp: string | null;
  /** 'manual' = typed by the user (kept unless dead), 'discovered' = found by the scan. */
  consoleIpSource: ConsoleIpSource | null;
  liveFormat: PacketFormat;
  /**
   * True (default): the app tries '~' then 'B' then 'A' by itself and saves what works.
   * False once the user pinned a format.
   */
  liveFormatAuto: boolean;
  captureFormat: PacketFormat;
  record: boolean;
  deltaReference: { kind: DeltaReferenceKind; lapId: Id | null };
}

/** PATCH /api/settings body (every field optional). */
export interface ApiSettingsPatch {
  /** IPv4 to pin manually; `null` goes back to automatic discovery (same as DELETE /api/settings/consoleIp). */
  consoleIp?: string | null;
  /** Pins this format (turns `liveFormatAuto` off unless `liveFormatAuto: true` is sent too). */
  liveFormat?: PacketFormat;
  /** true = automatic format (~ → B → A); false = keep the current one. */
  liveFormatAuto?: boolean;
  captureFormat?: PacketFormat;
  record?: boolean;
  deltaReference?: { kind: DeltaReferenceKind; lapId?: Id | null };
}

/** POST /api/discovery/scan: restarts the console search. */
export interface ApiDiscoveryScanResult {
  /** The search was (re)started. */
  started: boolean;
  consoleConnection: ConsoleConnection;
}

/** GET /api/status. */
export interface ApiStatus extends ServerStatus {
  /** Always present in the REST status. */
  consoleConnection: ConsoleConnection;
  firewall: FirewallStatus;
  settings: ApiSettings;
  /** UDP ingestor running. */
  running: boolean;
  httpPort: number;
  /** An access token is required for /api and /ws. */
  tokenRequired: boolean;
  /** In-process fake console (demo mode). */
  simulator: boolean;
}

/** GET /api/lan: where the dashboard is reachable from the phone. */
export interface LanInfo {
  port: number;
  /** http://<lan-ip>:<port>/ for every non-internal IPv4 interface, best first. */
  urls: string[];
  /** Best LAN URL (includes ?token= when a token is configured), null without network. */
  preferredUrl: string | null;
  localUrl: string;
  /** QR code of `preferredUrl` as an SVG data URL. */
  qrSvgDataUrl: string | null;
}

/** GET /api/devices entry: stored profile + live connection info. */
export interface DeviceInfo {
  deviceId: string;
  name: string;
  online: boolean;
  /** Open WebSocket connections of this device (tabs). */
  connections: number;
  currentView: ViewId | null;
  lastSeenAt: number | null;
  profile: DeviceProfile | null;
}

/** GET /api/sessions/:id. */
export interface SessionDetail {
  session: Session;
  laps: Lap[];
  /** The session is the one in progress. */
  active: boolean;
}

/** POST /api/capture/start body (same fields as the WS message). */
export type StartCaptureRequest = Omit<StartReferenceCaptureMessage, 'type'> & {
  /** If set, the captured lap must be driven with this car. */
  expectedCarCode?: number;
};
