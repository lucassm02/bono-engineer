/**
 * Gt7Runtime: the facade the server / MCP wire to HTTP, WebSocket and tools.
 *
 * Owns a Gt7Ingestor (UDP), a LiveEngine (laps, delta, sectors) backed by Gt7Store, the raw
 * session recorder and the reference capture. Emits typed events and exposes commands.
 *
 * Console policy (zero-config): the console IP is typed by the user (source 'manual', kept
 * unless it stops answering) or found by the ingestor's subnet sweep (source 'discovered', saved).
 * `getConnection()` summarises the link for the UI (searching / found / receiving / lost).
 *
 * Packet format policy: by default the format is automatic (`liveFormatAuto`): it starts at the
 * saved one ('~' the first time); if no valid packet arrives within `autoFormatTimeoutMs` (5 s)
 * of heartbeating, it tries 'B' and then 'A' (one round; each switch honours the ingestor's
 * cooldown), saves the first format that delivers packets, and after a session ends on a fallback
 * format it goes back to '~'. A format pinned by the user (`setPacketFormat`, option
 * `liveFormat`) is never changed automatically. Reference capture (Onda 9a) does NOT change the
 * packet format any more: the live format already delivers the replay's car data, and the capture
 * times laps by geometry + packet counting (see capture/reference-capture.ts). The old switch to
 * `captureFormat` survives only behind the option `switchFormatOnCapture` (default false).
 *
 * Automatic session capture: sessions open and close by themselves (see LiveEngine). The runtime
 * adds what needs IO: the raw recording per session (size-capped; paused packets throttled), the
 * "Gravar sessões automaticamente" switch (`autoCapture`, default on; off = live view only), a
 * timer that closes a session when the console goes quiet, the clean-up of sessions a crash left
 * open, the removal of sessions that ended with no completed lap, the `sessionSaved` event and
 * `getStatus().sessionCapture` (what the capture is doing, in pt-BR).
 */

import { EventEmitter } from 'node:events';
import { Gt7Ingestor, type Gt7IngestorOptions, RecordingWriter } from '@gt7/protocol';
import {
  type ApiSessionCurrent,
  type ConsoleConnection,
  type ConsoleIpSource,
  type CornerDrill,
  type DeltaReferenceKind,
  decodeFlags,
  type Id,
  isPacketFormat,
  type LapCompletedEvent,
  type LiveDrill,
  type LiveFrame,
  type NoticeMessage,
  type PacketFormat,
  type ReferenceCaptureStatus,
  type ServerStatus,
  type Session,
  type SessionCaptureStatus,
  type SessionSavedMessage,
  type TrackHint,
  type TrackMismatchInfo,
} from '@gt7/shared';
import { AnalysisService } from '../analysis-service/analysis-service.ts';
import { AnalysisCornerHintProvider } from '../analysis-service/corner-hints.ts';
import {
  captureIssueText,
  ReferenceCapture,
  type ReferenceCaptureMeta,
} from '../capture/reference-capture.ts';
import type { CornerHintProvider } from '../live/corner-hints.ts';
import {
  type CompletedLap,
  LiveEngine,
  type LiveEngineOptions,
  type SessionEndInfo,
} from '../live/live-engine.ts';
import { Gt7Store } from '../store/store.ts';
import { StoreEngineContext } from '../store/store-context.ts';
import { TaskService } from '../tasks/task-service.ts';

export const CORE_VERSION = '0.1.0';

/** Keys of the persisted runtime settings (settings table). */
export const SETTINGS_KEYS = {
  engineerAudioDeviceId: 'engineerAudioDeviceId',
  consoleIp: 'consoleIp',
  consoleIpSource: 'consoleIpSource',
  liveFormat: 'liveFormat',
  liveFormatAuto: 'liveFormatAuto',
  captureFormat: 'captureFormat',
  record: 'recordSessions',
  autoCapture: 'autoCapture',
  deltaReference: 'deltaReference',
} as const;

/**
 * Raw packet recording (~20 KB/s): off on a new install, unchanged on an existing one. A saved value
 * always wins; without one, a store that already has sessions keeps the old default (on) and a
 * brand-new store starts off. The resolved value is saved so it never flips on a later start.
 */
export function resolveRecordSetting(store: Gt7Store): boolean {
  const saved = store.getSetting<boolean>(SETTINGS_KEYS.record);
  if (typeof saved === 'boolean') return saved;
  const resolved = store.listSessions({ limit: 1 }).length > 0;
  store.setSetting(SETTINGS_KEYS.record, resolved);
  return resolved;
}

export type RuntimeNotice = Omit<NoticeMessage, 'type'>;

/** A session with laps was closed and saved. */
export type SessionSavedInfo = Omit<SessionSavedMessage, 'type'>;

/** How often the runtime lets the engine check for a silent console / a car out of the track. */
const ENGINE_TICK_MS = 5000;
/** Raw recording stops growing past this many (uncompressed) bytes: ~4 h of 60 Hz packets. */
const DEFAULT_MAX_RECORDING_BYTES = 300 * 1024 * 1024;
/** While the game is paused its packets are identical: keep only a couple per second. */
const PAUSED_RECORD_INTERVAL_MS = 500;

export interface Gt7RuntimeOptions {
  /** Data dir for the store (default 'data'); ignored when `store` is given. */
  dataDir?: string;
  /** Use an existing store (not closed by `close()`). */
  store?: Gt7Store;
  /**
   * Console IP typed by the user (overrides and updates the persisted setting; source 'manual').
   * Null/absent + none saved → automatic discovery.
   */
  consoleIp?: string | null;
  /** In-process demo console: the IP is the fake console (source 'simulator'), no discovery. */
  simulator?: boolean;
  /**
   * Persist the console IP (option, discovery, setConsoleIp) in the settings table (default true).
   * False for the in-process demo console and tests, so 127.0.0.1 never lands in real settings.
   */
  persistConsoleIp?: boolean;
  /** Live packet format (pins it: overrides the persisted setting and turns the automatic mode off). */
  liveFormat?: PacketFormat;
  /** false disables the automatic format round (default: the saved `liveFormatAuto`, true). */
  autoFormat?: boolean;
  /** No valid packet for this long while heartbeating → try the next format (default 5000 ms). */
  autoFormatTimeoutMs?: number;
  /** After the packets stop on a fallback format, go back to '~' after this long (default 10000 ms). */
  autoFormatHealDelayMs?: number;
  /** Capture packet format used only with `switchFormatOnCapture` (default 'B'). */
  captureFormat?: PacketFormat;
  /**
   * Switch the ingestor to `captureFormat` while a reference capture runs and restore the live
   * format afterwards (the pre-Onda 9a behaviour). Default false: the live format is kept.
   */
  switchFormatOnCapture?: boolean;
  /** Reference capture rejects replays not played at 1x by the wall clock (default true; tests off). */
  captureRealtimeCheck?: boolean;
  /** Deprecated: `null` disables the automatic format round (same as `autoFormat: false`). */
  formatFallback?: PacketFormat | null;
  /** Record raw sessions to data/recordings (overrides the persisted setting; default off on a new install, see resolveRecordSetting). */
  record?: boolean;
  /** Save sessions automatically (overrides the persisted `autoCapture` setting; default true). */
  autoCapture?: boolean;
  /** Stop growing a session's raw recording past this many uncompressed bytes (default 300 MB). */
  maxRecordingBytes?: number;
  /** Frame emission rate (default 30 Hz). */
  frameRateHz?: number;
  /** Extra ingestor options (ports, intervals, discovery...). Discovery is on unless `simulator`. */
  ingestor?: Omit<Gt7IngestorOptions, 'consoleIp' | 'format'>;
  serverVersion?: string;
  /** Next-corner hint provider (default: AnalysisCornerHintProvider over `analysis`). */
  cornerHints?: CornerHintProvider;
  /** Shared analysis service (default: one created over the runtime store). */
  analysis?: AnalysisService;
  /** Detect corners of new tracks after each lap (default true). */
  autoDetectCorners?: boolean;
  /** Extra engine options. */
  engine?: Omit<LiveEngineOptions, 'context' | 'frameRateHz' | 'cornerHints'>;
  /** Server-level status fields (LAN URLs, connected devices). */
  statusExtras?: () => Partial<Pick<ServerStatus, 'lanUrls' | 'devices'>>;
}

/** Formats tried by the automatic round, best first. */
const AUTO_FORMAT_ORDER: readonly PacketFormat[] = ['~', 'B', 'A'];

export interface Gt7RuntimeEvents {
  frame: [LiveFrame];
  lapCompleted: [LapCompletedEvent, CompletedLap];
  sessionChanged: [Session | null];
  status: [ServerStatus];
  sessionSaved: [SessionSavedInfo];
  /** Engineer tasks changed; the argument is the number of open proposals. */
  tasksChanged: [number];
  /** The track the driver chose did not match the first lap; the session was moved (spec 06). */
  trackMismatch: [TrackMismatchInfo];
  notice: [RuntimeNotice];
  captureStatus: [ReferenceCaptureStatus];
}

interface RecorderState {
  sessionId: Id;
  startTime: number;
  writer: RecordingWriter | null;
  buffer: { data: Uint8Array; tMs: number }[] | null;
  failed: boolean;
  /** Stopped writing (size cap reached). */
  capped: boolean;
  opening: Promise<void> | null;
}

export class Gt7Runtime extends EventEmitter<Gt7RuntimeEvents> {
  readonly store: Gt7Store;
  readonly engine: LiveEngine;
  readonly capture: ReferenceCapture;
  /** Analysis facade over the runtime store (corners, comparisons, AI summaries). */
  readonly analysis: AnalysisService;
  /** Engineer tasks (spec 20): shared by the REST routes, the MCP tools and the live frame. */
  readonly tasks: TaskService;
  readonly options: Gt7RuntimeOptions;
  readonly #ownsStore: boolean;
  #ingestor: Gt7Ingestor | null = null;
  #consoleIp: string | null;
  #consoleSource: ConsoleIpSource | null;
  #liveFormat: PacketFormat;
  #liveFormatAuto: boolean;
  /** Valid packets since start(); the format round watches it. */
  #packetCount = 0;
  /** Attempts left in the current format round (one per format). */
  #attemptsLeft = AUTO_FORMAT_ORDER.length;
  #attemptTimer: NodeJS.Timeout | null = null;
  #healTimer: NodeJS.Timeout | null = null;
  #startError: string | null = null;
  /** Last live format written to the settings (avoids a SQLite read per packet). */
  #savedLiveFormat: PacketFormat | null = null;
  #captureFormat: PacketFormat;
  #activeCaptureFormat: PacketFormat;
  #record: boolean;
  #autoCapture: boolean;
  #tickTimer: NodeJS.Timeout | null = null;
  #lastPausedWriteAt = 0;
  /** Session clean-ups (recording close, empty session removal) still running. */
  #endJobs = new Set<Promise<void>>();
  #recorder: RecorderState | null = null;
  #recorderCloses = new Set<Promise<void>>();
  #lastWarningAt = 0;
  #analysisJobs = new Set<Promise<void>>();

  constructor(opts: Gt7RuntimeOptions = {}) {
    super();
    this.options = opts;
    this.#ownsStore = !opts.store;
    this.store = opts.store ?? Gt7Store.open(opts.dataDir ?? 'data');
    const s = this.store;
    if (opts.consoleIp) {
      this.#consoleIp = opts.consoleIp;
      this.#consoleSource = opts.simulator ? 'simulator' : 'manual';
      if (opts.persistConsoleIp !== false) {
        s.setSetting(SETTINGS_KEYS.consoleIp, opts.consoleIp);
        s.setSetting(SETTINGS_KEYS.consoleIpSource, 'manual');
      }
    } else {
      this.#consoleIp = s.getSetting<string | null>(SETTINGS_KEYS.consoleIp, null);
      // An IP saved before sources existed was typed by the user: treat it as manual.
      const savedSource = s.getSetting<string>(SETTINGS_KEYS.consoleIpSource);
      this.#consoleSource = this.#consoleIp
        ? savedSource === 'discovered'
          ? 'discovered'
          : 'manual'
        : null;
    }
    const savedLive = s.getSetting<string>(SETTINGS_KEYS.liveFormat);
    this.#liveFormat = opts.liveFormat ?? (isPacketFormat(savedLive) ? savedLive : '~');
    this.#savedLiveFormat = isPacketFormat(savedLive) ? savedLive : null;
    this.#liveFormatAuto =
      opts.liveFormat !== undefined
        ? false
        : s.getSetting<boolean>(SETTINGS_KEYS.liveFormatAuto, true);
    const savedCapture = s.getSetting<string>(SETTINGS_KEYS.captureFormat);
    this.#captureFormat = opts.captureFormat ?? (isPacketFormat(savedCapture) ? savedCapture : 'B');
    this.#activeCaptureFormat = this.#captureFormat;
    this.#record = opts.record ?? resolveRecordSetting(s);
    this.#autoCapture = opts.autoCapture ?? s.getSetting<boolean>(SETTINGS_KEYS.autoCapture, true);
    const savedRef = s.getSetting<{ kind: DeltaReferenceKind; lapId?: Id | null }>(
      SETTINGS_KEYS.deltaReference,
    );

    this.analysis = opts.analysis ?? new AnalysisService({ store: s });
    this.tasks = new TaskService(s, () => {
      this.engine.refreshTasks();
      this.emit('tasksChanged', this.tasks.proposalsCount());
    });
    this.engine = new LiveEngine({
      ...opts.engine,
      context: new StoreEngineContext(s),
      frameRateHz: opts.frameRateHz ?? 30,
      cornerHints: opts.cornerHints ?? new AnalysisCornerHintProvider(this.analysis),
      deltaReference: savedRef?.kind ?? opts.engine?.deltaReference ?? 'personalBest',
      deltaReferenceLapId: savedRef?.lapId ?? null,
    });
    this.capture = new ReferenceCapture({
      engine: this.engine,
      store: s,
      ...(opts.captureRealtimeCheck === false ? { checkRealtime: false } : {}),
      ...(opts.switchFormatOnCapture
        ? { enter: () => this.#enterCapture(), exit: () => this.#exitCapture() }
        : {}),
    });
    this.engine.setPersistence(this.#autoCapture);
    this.#wireEngine();
  }

  // ---------------------------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------------------------

  get ingestor(): Gt7Ingestor | null {
    return this.#ingestor;
  }

  get consoleIp(): string | null {
    return this.#ingestor?.consoleIp ?? this.#consoleIp;
  }

  get liveFormat(): PacketFormat {
    return this.#liveFormat;
  }

  get running(): boolean {
    return this.#ingestor !== null;
  }

  /** Current live frame built on demand (null before the first packet). */
  get liveFrame(): LiveFrame | null {
    return this.engine.snapshot();
  }

  get session(): Session | null {
    return this.engine.session;
  }

  /** Console link + discovery state for the UI (see {@link ConsoleConnection}). */
  getConnection(): ConsoleConnection {
    const ing = this.#ingestor;
    const ip = this.consoleIp;
    const info = ing?.discoveryInfo ?? { subnets: [], hostsProbed: 0, lastScanAt: null };
    const lastPacketAt = ing?.lastPacketAt ?? null;
    const fresh =
      lastPacketAt !== null && Date.now() - lastPacketAt < (ing?.options.timeoutMs ?? 3000);
    let state: ConsoleConnection['state'];
    let hint: string | null;
    if (!ing) {
      state = 'idle';
      hint = this.#startError ?? 'A telemetria está parada.';
    } else if (fresh) {
      state = 'receiving';
      hint = null;
    } else if (ip && lastPacketAt !== null) {
      state = 'lost';
      hint =
        'O PlayStation parou de enviar dados. O jogo pode ter sido fechado ou estar em pausa; ' +
        'se o IP do console mudou, o app procura de novo sozinho.';
    } else if (ip) {
      state = 'found';
      hint =
        ing.stats.decryptFailures > 0 && ing.stats.received === 0
          ? 'O console responde, mas o pacote não pôde ser lido. Confira o formato do pacote em Configurações.'
          : `Console em ${ip}. Abra o Gran Turismo 7 no PS5 e entre numa pista para começar.`;
    } else {
      state = 'searching';
      hint = info.subnets.length
        ? 'Procurando o PlayStation na rede. Abra o Gran Turismo 7 no PS5 e entre numa pista.'
        : 'Nenhuma rede local encontrada. Conecte o PC ao mesmo Wi-Fi ou cabo do PlayStation.';
    }
    return {
      state,
      consoleIp: ip,
      source: ip ? this.#consoleSource : null,
      subnets: info.subnets,
      hostsProbed: info.hostsProbed,
      lastScanAt: info.lastScanAt,
      lastPacketAt,
      hint,
    };
  }

  getStatus(): ServerStatus {
    const extras = this.options.statusExtras?.() ?? {};
    const ing = this.#ingestor;
    return {
      connection: this.engine.state,
      consoleConnection: this.getConnection(),
      ingestor: ing
        ? ing.stats
        : {
            state: 'stopped',
            format: this.#liveFormat,
            receivedFormat: null,
            consoleAddress: this.#consoleIp,
            rateHz: 0,
            received: 0,
            lost: 0,
            lossPct: 0,
            duplicates: 0,
            decryptFailures: 0,
            invalidSize: 0,
            resets: 0,
            lastPacketAt: null,
            heartbeatsSent: 0,
          },
      lanUrls: extras.lanUrls ?? [],
      consoleIp: this.consoleIp,
      capture: this.capture.status,
      sessionCapture: this.getSessionCapture(),
      devices: extras.devices ?? [],
      serverVersion: this.options.serverVersion ?? CORE_VERSION,
    };
  }

  /** Persisted runtime settings. */
  getSettings(): {
    consoleIp: string | null;
    consoleIpSource: ConsoleIpSource | null;
    liveFormat: PacketFormat;
    liveFormatAuto: boolean;
    captureFormat: PacketFormat;
    record: boolean;
    autoCapture: boolean;
  } {
    const ip = this.consoleIp;
    return {
      consoleIp: ip,
      consoleIpSource: ip ? this.#consoleSource : null,
      liveFormat: this.#liveFormat,
      liveFormatAuto: this.#liveFormatAuto,
      captureFormat: this.#captureFormat,
      record: this.#record,
      autoCapture: this.#autoCapture,
    };
  }

  /** What the automatic session capture is doing, with a pt-BR sentence for the UI. */
  getSessionCapture(): SessionCaptureStatus {
    return { ...this.#sessionCaptureBase(), track: this.engine.trackContext };
  }

  /** Open session and what is known of its track (`GET /api/session/current`). */
  getSessionCurrent(): ApiSessionCurrent {
    return {
      session: this.engine.session,
      track: this.engine.trackContext,
      carCode: this.engine.session?.carCode ?? this.engine.lastFrame?.car.carCode ?? null,
    };
  }

  /**
   * "Pista de hoje" (spec 06): the driver's choice of track for this session; `null` = recognise
   * by itself. Throws when the track does not exist. In memory only: it ends with the session.
   */
  setTrackHint(trackId: Id | null, opts: { force?: boolean } = {}): TrackHint | null {
    if (trackId !== null && !this.store.getTrack(trackId)) {
      throw new Error('Pista não encontrada.');
    }
    const hint = this.engine.setTrackHint(trackId, { now: Date.now(), force: opts.force === true });
    this.#emitStatus();
    return hint;
  }

  #sessionCaptureBase(): SessionCaptureStatus {
    const info = this.engine.captureInfo;
    const s = info.session;
    const enabled = this.#autoCapture;
    const link = this.getConnection().state;
    const base: SessionCaptureStatus = {
      state: 'waiting',
      enabled,
      sessionId: null,
      since: null,
      lapsDone: 0,
      carCode: null,
      trackName: null,
      bestLapMs: null,
      trackTimeMs: 0,
      hint: '',
    };
    if (info.replay) {
      return {
        ...base,
        state: 'replay',
        hint: this.capture.active
          ? 'Replay detectado — captura de referência em andamento; não conta como sessão.'
          : 'Replay detectado — não conta como sessão.',
      };
    }
    if (!enabled) {
      return {
        ...base,
        state: 'idle',
        hint: 'Gravação automática desligada — só ao vivo, nada é salvo.',
      };
    }
    if (!s) {
      if (!this.#ingestor) return { ...base, state: 'idle', hint: 'A telemetria está parada.' };
      const hint =
        link === 'receiving'
          ? 'Aguardando você entrar numa pista…'
          : link === 'searching'
            ? 'Procurando o PS5 na rede — a gravação começa sozinha quando você entrar numa pista.'
            : link === 'lost'
              ? 'Sem sinal do PS5 — aguardando o jogo.'
              : 'Aguardando o jogo — abra o Gran Turismo 7 e entre numa pista.';
      return { ...base, hint };
    }
    const open = {
      ...base,
      sessionId: s.id,
      since: s.startedAt,
      lapsDone: s.lapCount,
      carCode: s.carCode,
      trackName: this.engine.trackInfo?.name ?? null,
      bestLapMs: s.bestLapMs,
      trackTimeMs: info.trackTimeMs,
    };
    const silent = this.#ingestor !== null && link !== 'receiving';
    if (silent) {
      return {
        ...open,
        state: 'paused',
        detail: 'noSignal',
        hint: 'Sem sinal do PS5 — a sessão continua aberta por alguns minutos.',
      };
    }
    if (!info.onTrack) {
      return {
        ...open,
        state: 'paused',
        detail: 'offTrack',
        hint: 'Fora da pista — a sessão continua se você voltar em alguns minutos.',
      };
    }
    if (info.paused) return { ...open, state: 'paused', detail: 'paused', hint: 'Pausado' };
    const n = s.lapCount;
    return {
      ...open,
      state: 'recording',
      hint:
        n === 0
          ? 'Gravando sessão — ainda sem volta completa'
          : `Gravando sessão — ${n} ${n === 1 ? 'volta' : 'voltas'} até agora`,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------------------------

  /** Binds the UDP socket and starts heartbeats. */
  async start(): Promise<void> {
    if (this.#ingestor) return;
    await this.#recoverOrphans();
    const ip = this.#consoleIp;
    this.#startError = null;
    this.#packetCount = 0;
    this.#attemptsLeft = AUTO_FORMAT_ORDER.length;
    const ing = new Gt7Ingestor({
      ...this.options.ingestor,
      ...(ip ? { consoleIp: ip } : {}),
      discovery: this.options.ingestor?.discovery ?? !this.options.simulator,
      format: this.#switchesFormat() ? this.#activeCaptureFormat : this.#liveFormat,
    });
    ing.on('packet', (ip2) => {
      this.#onPacketFormat(ing);
      this.engine.push(ip2.packet, ip2.receivedAt);
      this.#recordPacket(ip2.raw, ip2.receivedAt, decodeFlags(ip2.packet.flags).paused);
    });
    ing.on('state', (s, prev) => {
      this.engine.setIngestorState(s);
      if (s === 'timeout' && prev === 'connected') this.#armHeal();
      this.#emitStatus();
    });
    ing.on('scan', () => this.#emitStatus());
    ing.on('stats', (stats) => {
      this.engine.setLinkStats(stats);
      this.#emitStatus();
    });
    ing.on('discovered', (addr, previous) => {
      this.#consoleIp = addr;
      this.#consoleSource = 'discovered';
      this.#persistConsoleIp(addr, 'discovered');
      this.#notice(
        'info',
        'consoleDiscovered',
        previous
          ? `O console mudou de IP: ${previous} → ${addr}. Já reconectei.`
          : `Console encontrado em ${addr}.`,
        8000,
      );
      this.#emitStatus();
    });
    ing.on('warning', (e) => {
      const now = Date.now();
      if (now - this.#lastWarningAt < 10_000) return;
      this.#lastWarningAt = now;
      this.#notice('warn', 'ingestorWarning', e.message);
    });
    this.#ingestor = ing;
    try {
      await ing.start();
    } catch (e) {
      this.#ingestor = null;
      this.#startError =
        (e as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? 'A porta UDP de telemetria (33740) já está em uso por outro programa (SimHub ou outro app de telemetria?). Feche-o e reinicie o app.'
          : `Não foi possível iniciar a telemetria: ${(e as Error).message}`;
      throw e;
    }
    this.engine.setIngestorState(ing.state);
    this.#armAttempt();
    this.#tickTimer = setInterval(() => this.engine.tick(Date.now()), ENGINE_TICK_MS);
    this.#tickTimer.unref?.();
    this.#emitStatus();
  }

  /** Ends the session, closes the recording and the socket. */
  async stop(): Promise<void> {
    this.#clearFormatTimers();
    if (this.#tickTimer) clearInterval(this.#tickTimer);
    this.#tickTimer = null;
    if (this.capture.active) await this.capture.stop(true);
    this.engine.endSession();
    const ing = this.#ingestor;
    this.#ingestor = null;
    if (ing) await ing.stop();
    this.engine.setIngestorState('stopped');
    await this.#closeRecorder();
    while (this.#endJobs.size) await Promise.all([...this.#endJobs]);
    await this.store.flush();
    this.#emitStatus();
  }

  /**
   * Resolves when background jobs are done: corner detection after a lap, and what follows the end
   * of a session (closing its recording, removing it when empty, the `sessionSaved` event).
   */
  async whenAnalysisIdle(): Promise<void> {
    while (this.#analysisJobs.size || this.#endJobs.size) {
      await Promise.all([...this.#analysisJobs, ...this.#endJobs]);
    }
  }

  /** stop() + closes the store if the runtime created it. */
  async close(): Promise<void> {
    await this.stop();
    await this.whenAnalysisIdle();
    if (this.#ownsStore) await this.store.close();
  }

  /**
   * Pins the console IP typed by the user (source 'manual'; replaced only if it stops answering
   * and another host does). `null` forgets it and goes back to automatic discovery.
   */
  setConsoleIp(ip: string | null): void {
    if (ip === null) {
      this.#consoleIp = null;
      this.#consoleSource = null;
      if (this.options.persistConsoleIp !== false) {
        this.store.deleteSetting(SETTINGS_KEYS.consoleIp);
        this.store.deleteSetting(SETTINGS_KEYS.consoleIpSource);
      }
      if (this.#ingestor?.options.discovery) this.#ingestor.setConsoleIp(null);
    } else {
      this.#consoleIp = ip;
      this.#consoleSource = this.options.simulator ? 'simulator' : 'manual';
      this.#persistConsoleIp(ip, 'manual');
      this.#ingestor?.setConsoleIp(ip);
    }
    this.#restartFormatRound();
    this.#emitStatus();
  }

  /**
   * Restarts the search for the console (fast sweep phase again) and the automatic format round.
   * Returns false when telemetry is not running.
   */
  rescan(): boolean {
    const ing = this.#ingestor;
    if (!ing) return false;
    ing.rescan();
    this.#restartFormatRound();
    this.#emitStatus();
    return true;
  }

  /** Pins (and persists) the live packet format, turning the automatic mode off; uses the cooldown. */
  async setPacketFormat(format: PacketFormat): Promise<void> {
    this.#liveFormat = format;
    this.#liveFormatAuto = false;
    this.#clearFormatTimers();
    this.#savedLiveFormat = format;
    this.store.setSetting(SETTINGS_KEYS.liveFormat, format);
    this.store.setSetting(SETTINGS_KEYS.liveFormatAuto, false);
    this.#emitStatus();
    if (this.capture.active) return; // applied when the capture ends
    await this.#switchFormat(format);
  }

  /**
   * Turns the automatic format round on/off (persisted). Turning it on goes back to '~' and tries
   * the others if nothing arrives; turning it off keeps the current format.
   */
  async setLiveFormatAuto(on: boolean): Promise<void> {
    this.#liveFormatAuto = on;
    this.store.setSetting(SETTINGS_KEYS.liveFormatAuto, on);
    if (!on) {
      this.#clearFormatTimers();
      this.#emitStatus();
      return;
    }
    this.#attemptsLeft = AUTO_FORMAT_ORDER.length;
    this.#emitStatus();
    if (this.#switchesFormat()) return;
    this.#liveFormat = '~';
    await this.#switchFormat('~', true);
    this.#armAttempt();
  }

  /**
   * Changes (and persists) the packet format used by reference captures. A capture in progress
   * keeps its format; the new one applies to the next capture.
   */
  setCaptureFormat(format: PacketFormat): void {
    this.#captureFormat = format;
    this.store.setSetting(SETTINGS_KEYS.captureFormat, format);
    if (!this.capture.active) this.#activeCaptureFormat = format;
  }

  /** Enables/disables raw session recording (persisted; applies to the next session). */
  setRecording(on: boolean): void {
    this.#record = on;
    this.store.setSetting(SETTINGS_KEYS.record, on);
  }

  /**
   * "Gravar sessões automaticamente" (persisted, default on). Off = live view only: nothing new is
   * saved. Changing it closes the open session (saved if it was being saved).
   */
  setAutoCapture(on: boolean): void {
    this.#autoCapture = on;
    this.store.setSetting(SETTINGS_KEYS.autoCapture, on);
    this.engine.setPersistence(on);
    this.#emitStatus();
  }

  setDeltaReference(kind: DeltaReferenceKind, lapId?: Id | null): void {
    this.engine.setDeltaReference(kind, lapId);
    this.store.setSetting(SETTINGS_KEYS.deltaReference, {
      kind,
      lapId: kind === 'reference' ? (lapId ?? null) : null,
    });
  }

  /**
   * Arms a reference capture: it waits for a replay, finds the track from the position (or uses
   * `meta.trackId`) and records the next complete lap between two start-line crossings. The packet
   * format is not changed (unless `switchFormatOnCapture`, where `format` overrides
   * `captureFormat` for this capture only).
   */
  async startReferenceCapture(
    meta: ReferenceCaptureMeta & { format?: PacketFormat },
  ): Promise<ReferenceCaptureStatus> {
    this.#activeCaptureFormat = meta.format ?? this.#captureFormat;
    return this.capture.start(meta);
  }

  /** Stops the capture; `save = false` discards a lap captured by this run. */
  async stopReferenceCapture(save = true): Promise<ReferenceCaptureStatus> {
    return this.capture.stop(save);
  }

  /** Re-reads the active track after edits (rename, corners, sector gates). */
  refreshTrack(): void {
    this.engine.refreshTrack();
    const id = this.engine.trackInfo?.id;
    const track = id ? this.store.getTrack(id) : null;
    if (track) this.tasks.reconcileTrack(track);
  }

  /** The goal of a track was set, changed or removed: the live frames read it again. */
  refreshGoal(): void {
    this.engine.refreshGoal();
  }

  /** The corner drill in progress (spec 18), null when none. */
  get drill(): LiveDrill | null {
    return this.engine.drill;
  }

  /** Starts drilling a corner of the current track. Null: no track yet or no such corner. */
  startCornerDrill(cornerId: string, opts: { targetMs?: number | null } = {}): LiveDrill | null {
    const d = this.engine.startCornerDrill(cornerId, opts);
    if (d) this.#emitStatus();
    return d;
  }

  /** Stops the drill; the passes are stored with the session. */
  stopCornerDrill(): CornerDrill | null {
    const d = this.engine.stopCornerDrill();
    this.#emitStatus();
    return d;
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  #persistConsoleIp(ip: string, source: 'manual' | 'discovered'): void {
    if (this.options.persistConsoleIp === false) return;
    this.store.setSetting(SETTINGS_KEYS.consoleIp, ip);
    this.store.setSetting(SETTINGS_KEYS.consoleIpSource, source);
  }

  #notice(level: RuntimeNotice['level'], code: string, message: string, ttlMs?: number): void {
    this.emit('notice', { level, code, message, ...(ttlMs ? { ttlMs } : {}) });
  }

  #emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  async #switchFormat(format: PacketFormat, quiet = false): Promise<void> {
    const ing = this.#ingestor;
    if (!ing || ing.format === format) return;
    if (!quiet) {
      this.#notice(
        'info',
        'formatSwitching',
        `Trocando o formato do pacote para '${format}'…`,
        5000,
      );
    }
    const p = ing.setFormat(format);
    this.#emitStatus();
    await p;
    if (!quiet) this.#notice('info', 'formatSwitched', `Formato do pacote: '${format}'`, 3000);
    this.#emitStatus();
  }

  // --- automatic format round ------------------------------------------------------------------

  #cycleAllowed(): boolean {
    return (
      this.#liveFormatAuto &&
      !this.options.simulator &&
      this.options.autoFormat !== false &&
      this.options.formatFallback !== null &&
      !this.#switchesFormat()
    );
  }

  /** A capture is running and it changed the packet format (legacy option). */
  #switchesFormat(): boolean {
    return this.options.switchFormatOnCapture === true && this.capture.active;
  }

  #clearFormatTimers(): void {
    if (this.#attemptTimer) clearTimeout(this.#attemptTimer);
    if (this.#healTimer) clearTimeout(this.#healTimer);
    this.#attemptTimer = this.#healTimer = null;
  }

  /** Fresh round: every format gets one attempt again. */
  #restartFormatRound(): void {
    this.#attemptsLeft = AUTO_FORMAT_ORDER.length;
    if (this.#healTimer) clearTimeout(this.#healTimer);
    this.#healTimer = null;
    this.#armAttempt();
  }

  /**
   * Watches the current format: if no valid packet shows up within the timeout (longer while the
   * console is still being searched, so a couple of sweep rounds fit), move to the next format.
   */
  #armAttempt(): void {
    if (this.#attemptTimer) clearTimeout(this.#attemptTimer);
    this.#attemptTimer = null;
    const ing = this.#ingestor;
    if (!ing || !this.#cycleAllowed() || this.#attemptsLeft <= 0) return;
    const base = this.#packetCount;
    const wait = this.options.autoFormatTimeoutMs ?? 5000;
    const timeout = ing.consoleIp ? wait : Math.max(wait, wait * 2.4);
    this.#attemptTimer = setTimeout(() => {
      this.#attemptTimer = null;
      const cur = this.#ingestor;
      if (cur !== ing || !this.#cycleAllowed() || this.#packetCount !== base) return;
      if (cur.state === 'switchingFormat') return this.#armAttempt();
      void this.#nextFormat(cur);
    }, timeout);
    this.#attemptTimer.unref?.();
  }

  async #nextFormat(ing: Gt7Ingestor): Promise<void> {
    this.#attemptsLeft--;
    const order = AUTO_FORMAT_ORDER;
    const cur = ing.format;
    // after the last attempt rest on the best format ('~'), otherwise move to the next one
    const next =
      this.#attemptsLeft <= 0 ? order[0]! : order[(order.indexOf(cur) + 1) % order.length]!;
    if (next === cur) return;
    this.#notice(
      'warn',
      'formatFallback',
      this.#attemptsLeft <= 0
        ? `Nenhum pacote em nenhum formato; voltando para '${next}'. O jogo está aberto numa pista?`
        : `Nenhum pacote no formato '${cur}'; tentando '${next}'.`,
      8000,
    );
    this.#liveFormat = next;
    await this.#switchFormat(next, true);
    this.#armAttempt();
  }

  /** A valid packet arrived: the current format works; remember it. */
  #onPacketFormat(ing: Gt7Ingestor): void {
    this.#packetCount++;
    if (this.#healTimer) clearTimeout(this.#healTimer);
    this.#healTimer = null;
    if (this.#attemptTimer) clearTimeout(this.#attemptTimer);
    this.#attemptTimer = null;
    this.#attemptsLeft = AUTO_FORMAT_ORDER.length;
    if (!this.#liveFormatAuto || this.capture.active) return;
    const fmt = ing.format;
    if (this.#liveFormat !== fmt) this.#liveFormat = fmt;
    if (this.#savedLiveFormat !== fmt) {
      this.#savedLiveFormat = fmt;
      this.store.setSetting(SETTINGS_KEYS.liveFormat, fmt);
      if (fmt !== '~') {
        this.#notice(
          'info',
          'formatAuto',
          `Usando o formato '${fmt}' do pacote (o '~' não respondeu).`,
          8000,
        );
      }
    }
  }

  /** Packets stopped on a fallback format: after a while go back to '~' (its data is richer). */
  #armHeal(): void {
    if (!this.#cycleAllowed() || this.#liveFormat === '~') return;
    if (this.#healTimer) clearTimeout(this.#healTimer);
    this.#healTimer = setTimeout(() => {
      this.#healTimer = null;
      if (!this.#cycleAllowed() || !this.#ingestor || this.#liveFormat === '~') return;
      this.#restartFormatRound();
      this.#liveFormat = '~';
      void this.#switchFormat('~', true).then(() => this.#armAttempt());
    }, this.options.autoFormatHealDelayMs ?? 10_000);
    this.#healTimer.unref?.();
  }

  async #enterCapture(): Promise<void> {
    this.engine.setReplayMode(true);
    this.#clearFormatTimers();
    await this.#switchFormat(this.#activeCaptureFormat);
  }

  async #exitCapture(): Promise<void> {
    this.engine.setReplayMode(false);
    await this.#switchFormat(this.#liveFormat);
    this.#restartFormatRound();
  }

  #wireEngine(): void {
    const e = this.engine;
    e.on('frame', (f) => this.emit('frame', f));
    e.on('lapCompleted', (c) => {
      if (e.persisting) this.#analyzeLap(c);
      this.emit('lapCompleted', c.event, c);
      this.#emitStatus();
    });
    e.on('sessionStarted', (s) => {
      if (e.persisting) this.#openRecorder(s);
      this.emit('sessionChanged', this.engine.session ?? s);
      this.#emitStatus();
    });
    e.on('sessionUpdated', (s) => this.emit('sessionChanged', s));
    e.on('sessionEnded', (s, info) => {
      // the recorder must be taken synchronously: a new session may open right after this
      const closing = this.#closeRecorder();
      this.#trackEndJob(this.#afterSessionEnded(s, info, closing));
      this.emit('sessionChanged', null);
      this.#emitStatus();
    });
    e.on('stateChanged', () => this.#emitStatus());
    e.on('trackChanged', () => this.#emitStatus());
    e.on('hintChanged', () => this.#emitStatus());
    e.on('trackMismatch', (info) => {
      // laps moved between tracks: whatever was cached for either track is stale
      this.analysis.invalidateTrack(info.hintedTrackId);
      this.analysis.invalidateTrack(info.detectedTrackId);
      this.emit('trackMismatch', info);
      this.#emitStatus();
    });
    this.capture.on('status', (st) => {
      this.emit('captureStatus', st);
      this.#emitStatus();
    });
    this.capture.on('captured', (c, lap) => {
      this.#analyzeLap(c);
      this.#notice(
        'info',
        'captureSaved',
        `Volta de referência salva (${lap.referenceMeta?.driverName ?? ''}).`,
        6000,
      );
    });
    this.capture.on('invalid', (issues) => {
      this.#notice(
        'warn',
        'captureInvalid',
        `Volta do replay descartada: ${issues.map(captureIssueText).join('; ')}. Aguardando a próxima.`,
        8000,
      );
    });
  }

  /** Background: corners of a new track (first centerline) + cache invalidation. */
  #analyzeLap(c: CompletedLap): void {
    if (this.options.autoDetectCorners === false) return;
    const job = this.analysis
      .onLapCompleted(c)
      .then((changed) => {
        if (c.lap.trackId) this.engine.markCornersSettled(c.lap.trackId);
        if (changed && this.engine.trackInfo?.id === c.lap.trackId) this.engine.refreshTrack();
        else this.#emitStatus();
      })
      .catch((err: unknown) => {
        this.#notice(
          'warn',
          'analysisFailed',
          `Falha ao detectar as curvas da pista: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => this.#analysisJobs.delete(job));
    this.#analysisJobs.add(job);
  }

  #trackEndJob(job: Promise<void>): void {
    const tracked: Promise<void> = job.finally(() => this.#endJobs.delete(tracked));
    this.#endJobs.add(tracked);
  }

  /**
   * After a session closed: one with no completed lap is removed (it would only clutter the
   * history; the raw recording goes with it), one with laps is announced as saved.
   */
  async #afterSessionEnded(
    s: Session,
    info: SessionEndInfo,
    recorderClosed: Promise<void>,
  ): Promise<void> {
    try {
      await recorderClosed;
      if (!info.persisted) return;
      if (s.lapCount === 0) {
        await this.store.deleteSession(s.id);
        return;
      }
      if (s.mode !== 'live') return;
      const track = s.trackId ? this.store.getTrack(s.trackId) : null;
      this.emit('sessionSaved', {
        sessionId: s.id,
        trackId: s.trackId,
        trackName: track?.name ?? null,
        carCode: s.carCode,
        lapCount: s.lapCount,
        bestLapMs: s.bestLapMs,
        startedAt: s.startedAt,
        endedAt: s.endedAt ?? Date.now(),
      });
    } catch (err) {
      this.#notice(
        'warn',
        'sessionCleanupFailed',
        `Não foi possível finalizar a sessão: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Closes sessions a crash or a forced shutdown left open (see Gt7Store.recoverOpenSessions). */
  async #recoverOrphans(): Promise<void> {
    try {
      await this.store.recoverOpenSessions(this.engine.session?.id);
    } catch (err) {
      this.#notice(
        'warn',
        'sessionRecoveryFailed',
        `Não foi possível recuperar sessões abertas: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  #openRecorder(s: Session): void {
    if (!this.#record) return;
    if (this.#recorder) void this.#closeRecorder();
    const { abs, rel } = this.store.recordingPath(s.id);
    const state: RecorderState = {
      sessionId: s.id,
      startTime: s.startedAt,
      writer: null,
      buffer: [],
      failed: false,
      capped: false,
      opening: null,
    };
    this.#recorder = state;
    this.engine.annotateSession({ recordingFile: rel });
    state.opening = RecordingWriter.open(abs, {
      format: s.format,
      startTime: s.startedAt,
      meta: {
        source: 'live',
        sessionId: s.id,
        mode: s.mode,
        carCode: s.carCode,
        consoleIp: this.consoleIp,
      },
    })
      .then((w) => {
        if (this.#recorder !== state) return w.close();
        for (const b of state.buffer ?? []) w.write(b.data, b.tMs);
        state.buffer = null;
        state.writer = w;
      })
      .catch((err: Error) => {
        state.failed = true;
        state.buffer = null;
        this.#notice('error', 'recordingFailed', `Falha ao gravar a sessão: ${err.message}`);
      });
  }

  #recordPacket(raw: Uint8Array, receivedAt: number, paused = false): void {
    const r = this.#recorder;
    if (!r || r.failed || r.capped) return;
    if (paused) {
      if (receivedAt - this.#lastPausedWriteAt < PAUSED_RECORD_INTERVAL_MS) return;
      this.#lastPausedWriteAt = receivedAt;
    }
    const tMs = Math.max(0, receivedAt - r.startTime);
    if (!r.writer) {
      r.buffer?.push({ data: raw.slice(), tMs });
      return;
    }
    if (r.writer.bytes >= (this.options.maxRecordingBytes ?? DEFAULT_MAX_RECORDING_BYTES)) {
      r.capped = true;
      this.#notice(
        'info',
        'recordingCapped',
        'A gravação bruta desta sessão atingiu o limite de tamanho e parou. As voltas continuam sendo salvas.',
        10_000,
      );
      return;
    }
    r.writer.write(raw, tMs);
  }

  async #closeRecorder(): Promise<void> {
    const r = this.#recorder;
    this.#recorder = null;
    if (r?.opening) await r.opening;
    if (r?.writer) {
      const p = r.writer.close();
      this.#recorderCloses.add(p);
      await p.finally(() => this.#recorderCloses.delete(p));
    }
    await Promise.all([...this.#recorderCloses]);
  }
}
