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
 * `liveFormat`) is never changed automatically. Reference capture switches to `captureFormat`
 * ('B': '~' does not work in replays) and restores the live format afterwards.
 */

import { EventEmitter } from 'node:events';
import { Gt7Ingestor, type Gt7IngestorOptions, RecordingWriter } from '@gt7/protocol';
import {
  type ConsoleConnection,
  type ConsoleIpSource,
  type DeltaReferenceKind,
  type Id,
  isPacketFormat,
  type LapCompletedEvent,
  type LiveFrame,
  type NoticeMessage,
  type PacketFormat,
  type ReferenceCaptureStatus,
  type ServerStatus,
  type Session,
} from '@gt7/shared';
import { AnalysisService } from '../analysis-service/analysis-service.ts';
import { AnalysisCornerHintProvider } from '../analysis-service/corner-hints.ts';
import { ReferenceCapture, type ReferenceCaptureMeta } from '../capture/reference-capture.ts';
import type { CornerHintProvider } from '../live/corner-hints.ts';
import { type CompletedLap, LiveEngine, type LiveEngineOptions } from '../live/live-engine.ts';
import { Gt7Store } from '../store/store.ts';
import { StoreEngineContext } from '../store/store-context.ts';

export const CORE_VERSION = '0.1.0';

/** Keys of the persisted runtime settings (settings table). */
export const SETTINGS_KEYS = {
  consoleIp: 'consoleIp',
  consoleIpSource: 'consoleIpSource',
  liveFormat: 'liveFormat',
  liveFormatAuto: 'liveFormatAuto',
  captureFormat: 'captureFormat',
  record: 'recordSessions',
  deltaReference: 'deltaReference',
} as const;

export type RuntimeNotice = Omit<NoticeMessage, 'type'>;

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
  /** Capture packet format (default 'B'). */
  captureFormat?: PacketFormat;
  /** Deprecated: `null` disables the automatic format round (same as `autoFormat: false`). */
  formatFallback?: PacketFormat | null;
  /** Record raw sessions to data/recordings (overrides the persisted setting; default true). */
  record?: boolean;
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
  notice: [RuntimeNotice];
  captureStatus: [ReferenceCaptureStatus];
}

interface RecorderState {
  sessionId: Id;
  startTime: number;
  writer: RecordingWriter | null;
  buffer: { data: Uint8Array; tMs: number }[] | null;
  failed: boolean;
  opening: Promise<void> | null;
}

export class Gt7Runtime extends EventEmitter<Gt7RuntimeEvents> {
  readonly store: Gt7Store;
  readonly engine: LiveEngine;
  readonly capture: ReferenceCapture;
  /** Analysis facade over the runtime store (corners, comparisons, AI summaries). */
  readonly analysis: AnalysisService;
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
    this.#record = opts.record ?? s.getSetting<boolean>(SETTINGS_KEYS.record, true);
    const savedRef = s.getSetting<{ kind: DeltaReferenceKind; lapId?: Id | null }>(
      SETTINGS_KEYS.deltaReference,
    );

    this.analysis = opts.analysis ?? new AnalysisService({ store: s });
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
      enter: () => this.#enterCapture(),
      exit: () => this.#exitCapture(),
    });
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
  } {
    const ip = this.consoleIp;
    return {
      consoleIp: ip,
      consoleIpSource: ip ? this.#consoleSource : null,
      liveFormat: this.#liveFormat,
      liveFormatAuto: this.#liveFormatAuto,
      captureFormat: this.#captureFormat,
      record: this.#record,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------------------------

  /** Binds the UDP socket and starts heartbeats. */
  async start(): Promise<void> {
    if (this.#ingestor) return;
    const ip = this.#consoleIp;
    this.#startError = null;
    this.#packetCount = 0;
    this.#attemptsLeft = AUTO_FORMAT_ORDER.length;
    const ing = new Gt7Ingestor({
      ...this.options.ingestor,
      ...(ip ? { consoleIp: ip } : {}),
      discovery: this.options.ingestor?.discovery ?? !this.options.simulator,
      format: this.capture.active ? this.#activeCaptureFormat : this.#liveFormat,
    });
    ing.on('packet', (ip2) => {
      this.#onPacketFormat(ing);
      this.engine.push(ip2.packet, ip2.receivedAt);
      this.#recordPacket(ip2.raw, ip2.receivedAt);
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
    this.#emitStatus();
  }

  /** Ends the session, closes the recording and the socket. */
  async stop(): Promise<void> {
    this.#clearFormatTimers();
    if (this.capture.active) await this.capture.stop(true);
    this.engine.endSession();
    const ing = this.#ingestor;
    this.#ingestor = null;
    if (ing) await ing.stop();
    this.engine.setIngestorState('stopped');
    await this.#closeRecorder();
    await this.store.flush();
    this.#emitStatus();
  }

  /** Resolves when background analysis jobs (corner detection after a lap) are done. */
  async whenAnalysisIdle(): Promise<void> {
    while (this.#analysisJobs.size) await Promise.all([...this.#analysisJobs]);
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
    if (this.capture.active) return;
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

  setDeltaReference(kind: DeltaReferenceKind, lapId?: Id | null): void {
    this.engine.setDeltaReference(kind, lapId);
    this.store.setSetting(SETTINGS_KEYS.deltaReference, {
      kind,
      lapId: kind === 'reference' ? (lapId ?? null) : null,
    });
  }

  /**
   * Starts a reference capture (switches to the capture format and replay mode). `format`
   * overrides the configured capture format for this capture only (prefer setCaptureFormat).
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
      !this.capture.active
    );
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
      this.#analyzeLap(c);
      this.emit('lapCompleted', c.event, c);
    });
    e.on('sessionStarted', (s) => {
      this.#openRecorder(s);
      this.emit('sessionChanged', this.engine.session ?? s);
    });
    e.on('sessionUpdated', (s) => this.emit('sessionChanged', s));
    e.on('sessionEnded', () => {
      void this.#closeRecorder();
      this.emit('sessionChanged', null);
    });
    e.on('stateChanged', () => this.#emitStatus());
    this.capture.on('status', (st) => {
      this.emit('captureStatus', st);
      this.#emitStatus();
    });
    this.capture.on('captured', (_c, lap) => {
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
        `Volta capturada inválida: ${issues.join(', ')}. Aguardando a próxima.`,
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
        if (changed && this.engine.trackInfo?.id === c.lap.trackId) this.engine.refreshTrack();
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

  #recordPacket(raw: Uint8Array, receivedAt: number): void {
    const r = this.#recorder;
    if (!r || r.failed) return;
    const tMs = Math.max(0, receivedAt - r.startTime);
    if (r.writer) r.writer.write(raw, tMs);
    else r.buffer?.push({ data: raw.slice(), tMs });
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
