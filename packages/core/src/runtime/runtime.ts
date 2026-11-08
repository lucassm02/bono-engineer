/**
 * Gt7Runtime: the facade the server / MCP wire to HTTP, WebSocket and tools.
 *
 * Owns a Gt7Ingestor (UDP), a LiveEngine (laps, delta, sectors) backed by Gt7Store, the raw
 * session recorder and the reference capture. Emits typed events and exposes commands.
 *
 * Packet format policy: live mode uses `liveFormat` (default '~', persisted). If no packet at
 * all arrives within `formatFallbackTimeoutMs` after start() while requesting '~', it switches
 * once to `formatFallback` ('B') and emits a notice (the switch is not persisted). Reference
 * capture switches to `captureFormat` ('B': '~' does not work in replays) and restores the live
 * format afterwards.
 */

import { EventEmitter } from 'node:events';
import { Gt7Ingestor, type Gt7IngestorOptions, RecordingWriter } from '@gt7/protocol';
import {
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
  liveFormat: 'liveFormat',
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
  /** Console IP (overrides and updates the persisted setting). Null/absent + none saved → discovery. */
  consoleIp?: string | null;
  /** Live packet format (overrides the persisted setting; default '~'). */
  liveFormat?: PacketFormat;
  /** Capture packet format (default 'B'). */
  captureFormat?: PacketFormat;
  /** Fallback when '~' yields nothing (default 'B'; null disables). */
  formatFallback?: PacketFormat | null;
  /** Default 10000 ms; 0 disables the fallback. */
  formatFallbackTimeoutMs?: number;
  /** Record raw sessions to data/recordings (overrides the persisted setting; default true). */
  record?: boolean;
  /** Frame emission rate (default 30 Hz). */
  frameRateHz?: number;
  /** Extra ingestor options (ports, intervals, discovery...). */
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
  #liveFormat: PacketFormat;
  #captureFormat: PacketFormat;
  #activeCaptureFormat: PacketFormat;
  #record: boolean;
  #recorder: RecorderState | null = null;
  #recorderCloses = new Set<Promise<void>>();
  #fallbackTimer: NodeJS.Timeout | null = null;
  #lastWarningAt = 0;
  #analysisJobs = new Set<Promise<void>>();

  constructor(opts: Gt7RuntimeOptions = {}) {
    super();
    this.options = opts;
    this.#ownsStore = !opts.store;
    this.store = opts.store ?? Gt7Store.open(opts.dataDir ?? 'data');
    const s = this.store;
    if (opts.consoleIp) s.setSetting(SETTINGS_KEYS.consoleIp, opts.consoleIp);
    this.#consoleIp = opts.consoleIp ?? s.getSetting<string | null>(SETTINGS_KEYS.consoleIp, null);
    const savedLive = s.getSetting<string>(SETTINGS_KEYS.liveFormat);
    this.#liveFormat = opts.liveFormat ?? (isPacketFormat(savedLive) ? savedLive : '~');
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

  getStatus(): ServerStatus {
    const extras = this.options.statusExtras?.() ?? {};
    const ing = this.#ingestor;
    return {
      connection: this.engine.state,
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
    liveFormat: PacketFormat;
    captureFormat: PacketFormat;
    record: boolean;
  } {
    return {
      consoleIp: this.consoleIp,
      liveFormat: this.#liveFormat,
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
    const ing = new Gt7Ingestor({
      ...this.options.ingestor,
      ...(ip ? { consoleIp: ip } : {}),
      discovery: this.options.ingestor?.discovery ?? !ip,
      format: this.capture.active ? this.#activeCaptureFormat : this.#liveFormat,
    });
    ing.on('packet', (ip2) => {
      this.engine.push(ip2.packet, ip2.receivedAt);
      this.#recordPacket(ip2.raw, ip2.receivedAt);
    });
    ing.on('state', (s) => {
      this.engine.setIngestorState(s);
      this.#emitStatus();
    });
    ing.on('stats', (stats) => {
      this.engine.setLinkStats(stats);
      this.#emitStatus();
    });
    ing.on('discovered', (addr) => {
      this.#consoleIp = addr;
      this.store.setSetting(SETTINGS_KEYS.consoleIp, addr);
      this.#notice('info', 'consoleDiscovered', `Console encontrado em ${addr}`);
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
      throw e;
    }
    this.engine.setIngestorState(ing.state);
    this.#armFallback();
    this.#emitStatus();
  }

  /** Ends the session, closes the recording and the socket. */
  async stop(): Promise<void> {
    if (this.#fallbackTimer) clearTimeout(this.#fallbackTimer);
    this.#fallbackTimer = null;
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

  setConsoleIp(ip: string): void {
    this.#consoleIp = ip;
    this.store.setSetting(SETTINGS_KEYS.consoleIp, ip);
    this.#ingestor?.setConsoleIp(ip);
    this.#emitStatus();
  }

  /** Changes (and persists) the live packet format; uses the ingestor cooldown. */
  async setPacketFormat(format: PacketFormat): Promise<void> {
    this.#liveFormat = format;
    this.store.setSetting(SETTINGS_KEYS.liveFormat, format);
    if (this.capture.active) return; // applied when the capture ends
    await this.#switchFormat(format);
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

  /** Starts a reference capture (switches to the capture format and replay mode). */
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

  #notice(level: RuntimeNotice['level'], code: string, message: string, ttlMs?: number): void {
    this.emit('notice', { level, code, message, ...(ttlMs ? { ttlMs } : {}) });
  }

  #emitStatus(): void {
    this.emit('status', this.getStatus());
  }

  async #switchFormat(format: PacketFormat): Promise<void> {
    const ing = this.#ingestor;
    if (!ing || ing.format === format) return;
    this.#notice('info', 'formatSwitching', `Trocando o formato do pacote para '${format}'…`, 5000);
    const p = ing.setFormat(format);
    this.#emitStatus();
    await p;
    this.#notice('info', 'formatSwitched', `Formato do pacote: '${format}'`, 3000);
    this.#emitStatus();
  }

  #armFallback(): void {
    const timeout = this.options.formatFallbackTimeoutMs ?? 10_000;
    const fallback = this.options.formatFallback === undefined ? 'B' : this.options.formatFallback;
    if (!fallback || timeout <= 0 || this.#liveFormat !== '~') return;
    this.#fallbackTimer = setTimeout(() => {
      this.#fallbackTimer = null;
      const ing = this.#ingestor;
      if (!ing || ing.stats.received > 0 || ing.format !== '~' || this.capture.active) return;
      this.#notice(
        'warn',
        'formatFallback',
        `Nenhum pacote no formato '~' em ${Math.round(timeout / 1000)} s; tentando '${fallback}'.`,
        8000,
      );
      void this.#switchFormat(fallback);
    }, timeout);
    this.#fallbackTimer.unref?.();
  }

  async #enterCapture(): Promise<void> {
    this.engine.setReplayMode(true);
    await this.#switchFormat(this.#activeCaptureFormat);
  }

  async #exitCapture(): Promise<void> {
    this.engine.setReplayMode(false);
    await this.#switchFormat(this.#liveFormat);
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
