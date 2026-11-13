/**
 * WebSocket hub: one entry per dashboard connection, fan-out of runtime events and handling of
 * every ClientMessage of @gt7/shared ws.ts.
 *
 * Back-pressure: live frames are serialized once and skipped for a client whose socket buffer is
 * above `frameBufferLimit` (a slow phone just sees fewer frames; nothing is queued in the hub).
 * Other messages are always sent, but a client whose buffer exceeds `maxBufferedBytes` is
 * considered stuck and terminated, so memory per client is bounded.
 */

import {
  type Gt7Runtime,
  type RuntimeNotice,
  SETTINGS_KEYS,
  type SessionSavedInfo,
} from '@gt7/core';
import {
  type ClientMessage,
  createDefaultDeviceProfile,
  DELTA_REFERENCE_KINDS,
  type DeltaReferenceKind,
  type DeviceInfo,
  type DeviceProfile,
  type FirewallStatus,
  isPacketFormat,
  isViewId,
  normalizeDeviceProfile,
  normalizeDriverName,
  type ServerMessage,
  type ServerStatus,
  type TrackMismatchInfo,
  type ViewId,
  WS_PROTOCOL_VERSION,
} from '@gt7/shared';

/** Minimal surface of a `ws` WebSocket used by the hub (also implemented by test fakes). */
export interface HubSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  ping?(): void;
  on(event: 'message', listener: (data: unknown, isBinary?: boolean) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'pong', listener: () => void): unknown;
}

const OPEN = 1;

export interface HubOptions {
  serverVersion: string;
  /** Skip frames for a client above this many buffered bytes (default 32 KiB). */
  frameBufferLimit?: number;
  /** Terminate a client above this many buffered bytes (default 2 MiB). */
  maxBufferedBytes?: number;
  /** Protocol-level ping interval; a client that misses one pong is dropped (default 30 s). */
  keepAliveMs?: number;
  /** Firewall status added to every `status` message. */
  firewall?: () => FirewallStatus;
}

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

interface Client {
  seq: number;
  socket: HubSocket;
  info: ClientInfo;
  deviceId: string | null;
  currentView: ViewId | null;
  connectedAt: number;
  alive: boolean;
  framesSent: number;
  framesDropped: number;
}

interface DeviceEntry {
  deviceId: string;
  name: string;
  lastSeenAt: number;
  currentView: ViewId | null;
}

export interface HubStats {
  clients: number;
  framesSent: number;
  framesDropped: number;
  terminated: number;
}

const DEVICE_ID_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
/** Offline entries kept in the in-memory device registry (any client may invent deviceIds). */
const MAX_OFFLINE_DEVICES = 100;

export class WsHub {
  readonly runtime: Gt7Runtime;
  readonly options: Required<Omit<HubOptions, 'firewall'>> & Pick<HubOptions, 'firewall'>;
  readonly #clients = new Set<Client>();
  readonly #devices = new Map<string, DeviceEntry>();
  #seq = 0;
  #stats = { framesSent: 0, framesDropped: 0, terminated: 0 };
  #statusTimer: NodeJS.Timeout | null = null;
  #lastStatusAt = 0;
  #keepAlive: NodeJS.Timeout | null = null;
  #closed = false;
  readonly #unsubscribe: (() => void)[] = [];

  constructor(runtime: Gt7Runtime, opts: HubOptions) {
    this.runtime = runtime;
    this.options = {
      serverVersion: opts.serverVersion,
      frameBufferLimit: opts.frameBufferLimit ?? 32 * 1024,
      maxBufferedBytes: opts.maxBufferedBytes ?? 2 * 1024 * 1024,
      keepAliveMs: opts.keepAliveMs ?? 30_000,
      ...(opts.firewall ? { firewall: opts.firewall } : {}),
    };
    this.#subscribe();
    if (this.options.keepAliveMs > 0) {
      this.#keepAlive = setInterval(() => this.#pingAll(), this.options.keepAliveMs);
      this.#keepAlive.unref?.();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------------------------

  get stats(): HubStats {
    return { clients: this.#clients.size, ...this.#stats };
  }

  /** Connected devices (one entry per deviceId), for `ServerStatus.devices`. */
  devices(): ServerStatus['devices'] {
    const out: ServerStatus['devices'] = [];
    for (const d of this.#devices.values()) {
      if (this.#connectionsOf(d.deviceId) === 0) continue;
      out.push({
        deviceId: d.deviceId,
        name: d.name,
        currentView: d.currentView,
        lastSeenAt: d.lastSeenAt,
      });
    }
    return out;
  }

  /** Stored profiles merged with live connection info (GET /api/devices). */
  deviceInfos(profiles: DeviceProfile[]): DeviceInfo[] {
    const seen = new Set<string>();
    const out: DeviceInfo[] = [];
    for (const p of profiles) {
      seen.add(p.deviceId);
      out.push(this.deviceInfo(p.deviceId, p));
    }
    for (const d of this.#devices.values()) {
      if (!seen.has(d.deviceId)) out.push(this.deviceInfo(d.deviceId, null));
    }
    return out;
  }

  deviceInfo(deviceId: string, profile: DeviceProfile | null): DeviceInfo {
    const d = this.#devices.get(deviceId);
    const connections = this.#connectionsOf(deviceId);
    return {
      deviceId,
      name: profile?.name ?? d?.name ?? deviceId,
      online: connections > 0,
      connections,
      currentView: d?.currentView ?? null,
      lastSeenAt: d?.lastSeenAt ?? null,
      profile,
    };
  }

  /** Sends a message to every connection of a device; returns how many received it. */
  sendToDevice(deviceId: string, msg: ServerMessage): number {
    const data = JSON.stringify(msg);
    let n = 0;
    for (const c of this.#clients) {
      if (c.deviceId === deviceId && this.#sendRaw(c, data)) n++;
    }
    return n;
  }

  /** Remote control: asks `deviceId` to show `view`. Returns delivered connections. */
  showView(deviceId: string, view: ViewId, from: string): number {
    return this.sendToDevice(deviceId, { type: 'showView', view, from });
  }

  /** A profile was changed outside of the device (REST): push it to its connections. */
  profileUpdated(profile: DeviceProfile, exceptSeq?: number): void {
    const entry = this.#devices.get(profile.deviceId);
    if (entry && entry.name !== profile.name) {
      entry.name = profile.name;
      this.scheduleStatus();
    }
    const data = JSON.stringify({ type: 'deviceProfile', profile } satisfies ServerMessage);
    for (const c of this.#clients) {
      if (c.deviceId === profile.deviceId && c.seq !== exceptSeq) this.#sendRaw(c, data);
    }
  }

  /** Decorated server status (adds firewall). */
  status(): ServerStatus {
    const s = this.runtime.getStatus();
    s.engineerAudioDeviceId = this.runtime.store.getSetting<string | null>(
      SETTINGS_KEYS.engineerAudioDeviceId,
      null,
    );
    const fw = this.options.firewall?.();
    return fw ? { ...s, firewall: fw } : s;
  }

  /** Broadcasts `status` soon (coalesces bursts to at most one every 100 ms). */
  scheduleStatus(): void {
    if (this.#closed || this.#statusTimer) return;
    const wait = Math.max(0, 100 - (Date.now() - this.#lastStatusAt));
    this.#statusTimer = setTimeout(() => {
      this.#statusTimer = null;
      this.#lastStatusAt = Date.now();
      this.#broadcast({ type: 'status', status: this.status() });
    }, wait);
    this.#statusTimer.unref?.();
  }

  /** Broadcasts a notice to every connected dashboard. */
  notice(n: RuntimeNotice): void {
    this.#broadcast({ type: 'notice', ...n });
  }

  /** Registers a new WebSocket connection. */
  attach(socket: HubSocket, info: ClientInfo = {}): void {
    if (this.#closed) {
      socket.close(1001, 'Servidor encerrando');
      return;
    }
    const client: Client = {
      seq: ++this.#seq,
      socket,
      info,
      deviceId: null,
      currentView: null,
      connectedAt: Date.now(),
      alive: true,
      framesSent: 0,
      framesDropped: 0,
    };
    this.#clients.add(client);
    socket.on('message', (data, isBinary) => this.#onRaw(client, data, isBinary));
    socket.on('pong', () => {
      client.alive = true;
    });
    socket.on('close', () => this.#detach(client));
    socket.on('error', () => this.#detach(client));
  }

  /** Closes every connection and stops listening to the runtime. */
  closeAll(code = 1001, reason = 'Servidor encerrando'): void {
    this.#closed = true;
    for (const u of this.#unsubscribe.splice(0)) u();
    if (this.#statusTimer) clearTimeout(this.#statusTimer);
    if (this.#keepAlive) clearInterval(this.#keepAlive);
    this.#statusTimer = null;
    this.#keepAlive = null;
    for (const c of [...this.#clients]) {
      try {
        c.socket.close(code, reason);
      } catch {
        c.socket.terminate?.();
      }
    }
    this.#clients.clear();
  }

  // ---------------------------------------------------------------------------------------------
  // Runtime → clients
  // ---------------------------------------------------------------------------------------------

  #subscribe(): void {
    const r = this.runtime;
    const on = <K extends Parameters<Gt7Runtime['on']>[0]>(
      event: K,
      // biome-ignore lint/suspicious/noExplicitAny: listener types come from Gt7RuntimeEvents
      fn: (...args: any[]) => void,
    ) => {
      r.on(event as 'frame', fn);
      this.#unsubscribe.push(() => r.off(event as 'frame', fn));
    };
    on('frame', (frame) => this.#broadcastFrame(JSON.stringify({ type: 'frame', frame })));
    on('lapCompleted', (event) => this.#broadcast({ type: 'lapCompleted', event }));
    on('sessionChanged', (session) => this.#broadcast({ type: 'sessionChanged', session }));
    on('sessionSaved', (saved: SessionSavedInfo) =>
      this.#broadcast({ type: 'sessionSaved', ...saved }),
    );
    on('tasksChanged', (proposals: number) => this.#broadcast({ type: 'tasksChanged', proposals }));
    on('trackMismatch', (info: TrackMismatchInfo) => {
      this.#broadcast({ type: 'trackMismatch', info });
      this.scheduleStatus();
    });
    on('status', () => this.scheduleStatus());
    on('notice', (n: RuntimeNotice) => this.notice(n));
    // Capture state travels inside ServerStatus.capture: push it right away.
    on('captureStatus', () => {
      this.#lastStatusAt = Date.now();
      this.#broadcast({ type: 'status', status: this.status() });
    });
  }

  #broadcastFrame(data: string): void {
    const limit = this.options.frameBufferLimit;
    for (const c of this.#clients) {
      if (!c.deviceId || c.socket.readyState !== OPEN) continue;
      if (c.socket.bufferedAmount > limit) {
        c.framesDropped++;
        this.#stats.framesDropped++;
        continue;
      }
      if (this.#sendRaw(c, data)) {
        c.framesSent++;
        this.#stats.framesSent++;
      }
    }
  }

  #broadcast(msg: ServerMessage): void {
    let data: string | null = null;
    for (const c of this.#clients) {
      if (!c.deviceId) continue;
      data ??= JSON.stringify(msg);
      this.#sendRaw(c, data);
    }
  }

  #send(c: Client, msg: ServerMessage): boolean {
    return this.#sendRaw(c, JSON.stringify(msg));
  }

  #sendRaw(c: Client, data: string): boolean {
    const s = c.socket;
    if (s.readyState !== OPEN) return false;
    if (s.bufferedAmount > this.options.maxBufferedBytes) {
      this.#stats.terminated++;
      this.#drop(c);
      return false;
    }
    try {
      s.send(data);
      return true;
    } catch {
      this.#drop(c);
      return false;
    }
  }

  #drop(c: Client): void {
    try {
      if (c.socket.terminate) c.socket.terminate();
      else c.socket.close(1013, 'Cliente lento');
    } catch {
      // already gone
    }
    this.#detach(c);
  }

  #detach(c: Client): void {
    if (!this.#clients.delete(c)) return;
    if (c.deviceId) {
      const d = this.#devices.get(c.deviceId);
      if (d) d.lastSeenAt = Date.now();
      this.scheduleStatus();
    }
  }

  #pingAll(): void {
    for (const c of [...this.#clients]) {
      if (!c.alive) {
        this.#stats.terminated++;
        this.#drop(c);
        continue;
      }
      c.alive = false;
      try {
        if (c.socket.ping) c.socket.ping();
        else c.alive = true;
      } catch {
        this.#drop(c);
      }
    }
  }

  /** Drops the oldest offline entries beyond MAX_OFFLINE_DEVICES (memory stays bounded). */
  #pruneDevices(): void {
    if (this.#devices.size <= MAX_OFFLINE_DEVICES) return;
    const offline = [...this.#devices.values()]
      .filter((d) => this.#connectionsOf(d.deviceId) === 0)
      .sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    for (const d of offline) {
      if (this.#devices.size <= MAX_OFFLINE_DEVICES) break;
      this.#devices.delete(d.deviceId);
    }
  }

  #connectionsOf(deviceId: string): number {
    let n = 0;
    for (const c of this.#clients) if (c.deviceId === deviceId) n++;
    return n;
  }

  // ---------------------------------------------------------------------------------------------
  // Clients → server
  // ---------------------------------------------------------------------------------------------

  #onRaw(c: Client, data: unknown, isBinary?: boolean) {
    c.alive = true;
    let text: string;
    if (typeof data === 'string') text = data;
    else if (isBinary) return this.#error(c, 'badMessage', 'Mensagens binárias não são aceitas.');
    else if (Buffer.isBuffer(data)) text = data.toString('utf8');
    else if (Array.isArray(data)) text = Buffer.concat(data as Buffer[]).toString('utf8');
    else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString('utf8');
    else return this.#error(c, 'badMessage', 'Mensagem inválida.');
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return this.#error(c, 'badMessage', 'Mensagem inválida (JSON malformado).');
    }
    if (
      typeof msg !== 'object' ||
      msg === null ||
      typeof (msg as { type?: unknown }).type !== 'string'
    ) {
      return this.#error(c, 'badMessage', 'Mensagem sem "type".');
    }
    if (c.deviceId) {
      const d = this.#devices.get(c.deviceId);
      if (d) d.lastSeenAt = Date.now();
    }
    try {
      this.#handle(c, msg as ClientMessage);
    } catch (e) {
      this.#error(c, 'serverError', `Erro ao processar a mensagem: ${(e as Error).message}`);
    }
  }

  #error(c: Client, code: string, message: string): void {
    this.#send(c, { type: 'notice', level: 'error', code, message, ttlMs: 6000 });
  }

  #handle(c: Client, msg: ClientMessage) {
    if (msg.type === 'ping') {
      const t = typeof msg.t === 'number' && Number.isFinite(msg.t) ? msg.t : 0;
      this.#send(c, { type: 'pong', t, serverTime: Date.now() });
      return;
    }
    if (msg.type === 'hello') return this.#hello(c, msg);
    const deviceId = c.deviceId;
    if (!deviceId) {
      return this.#error(c, 'helloRequired', 'Envie "hello" antes de outras mensagens.');
    }
    switch (msg.type) {
      case 'setDeviceProfile': {
        if (typeof msg.profile !== 'object' || msg.profile === null) {
          return this.#error(c, 'badMessage', 'Perfil do dispositivo inválido.');
        }
        const p = normalizeDeviceProfile(msg.profile, deviceId);
        const saved = this.runtime.store.saveDeviceProfile({
          ...p,
          deviceId,
          updatedAt: p.updatedAt > 0 ? p.updatedAt : Date.now(),
        });
        this.profileUpdated(saved, c.seq);
        return;
      }
      case 'setDeltaReference': {
        if (!(DELTA_REFERENCE_KINDS as readonly unknown[]).includes(msg.kind)) {
          return this.#error(c, 'badMessage', 'Referência de delta inválida.');
        }
        const lapId = typeof msg.lapId === 'string' && msg.lapId ? msg.lapId : null;
        this.runtime.setDeltaReference(msg.kind as DeltaReferenceKind, lapId);
        this.scheduleStatus();
        return;
      }
      case 'currentView': {
        if (!isViewId(msg.view)) return this.#error(c, 'badMessage', 'Tela desconhecida.');
        c.currentView = msg.view;
        const d = this.#devices.get(deviceId);
        if (d) d.currentView = msg.view;
        this.scheduleStatus();
        return;
      }
      case 'setTargetView': {
        if (!isViewId(msg.view)) return this.#error(c, 'badMessage', 'Tela desconhecida.');
        if (typeof msg.targetDeviceId !== 'string' || !msg.targetDeviceId) {
          return this.#error(c, 'badMessage', 'Dispositivo de destino inválido.');
        }
        const n = this.showView(msg.targetDeviceId, msg.view, deviceId);
        if (n === 0) {
          this.#send(c, {
            type: 'notice',
            level: 'warn',
            code: 'targetOffline',
            message: 'O dispositivo de destino não está conectado.',
            ttlMs: 4000,
          });
        }
        return;
      }
      case 'startReferenceCapture': {
        if (msg.format !== undefined && !isPacketFormat(msg.format)) {
          return this.#error(c, 'badMessage', 'Formato de pacote inválido.');
        }
        const ranking =
          typeof msg.rankingTimeMs === 'number' &&
          Number.isFinite(msg.rankingTimeMs) &&
          msg.rankingTimeMs > 0
            ? msg.rankingTimeMs
            : null;
        const fmt = msg.format ?? this.#savedCaptureFormat();
        this.runtime
          .startReferenceCapture({
            driverName: normalizeDriverName(msg.driverName),
            carName: typeof msg.carName === 'string' ? msg.carName.slice(0, 80) : null,
            rankingTimeMs: ranking,
            notes: typeof msg.notes === 'string' ? msg.notes.slice(0, 500) : null,
            trackId:
              typeof msg.trackId === 'string' && this.runtime.store.getTrack(msg.trackId)
                ? msg.trackId
                : null,
            ...(fmt ? { format: fmt } : {}),
          })
          .catch((e: Error) =>
            this.#error(c, 'captureFailed', `Falha ao iniciar a captura: ${e.message}`),
          );
        return;
      }
      case 'stopReferenceCapture': {
        this.runtime
          .stopReferenceCapture(msg.save !== false)
          .catch((e: Error) =>
            this.#error(c, 'captureFailed', `Falha ao parar a captura: ${e.message}`),
          );
        return;
      }
      case 'setTrackHint': {
        const id = msg.trackId;
        if (id !== null && (typeof id !== 'string' || !id || id.length > 100)) {
          return this.#error(c, 'badMessage', 'Pista inválida.');
        }
        if (id !== null && !this.runtime.store.getTrack(id)) {
          return this.#error(c, 'trackNotFound', 'Essa pista não existe mais.');
        }
        this.runtime.setTrackHint(id, { force: msg.force === true });
        this.scheduleStatus();
        return;
      }
      case 'setPacketFormat': {
        if (!isPacketFormat(msg.format)) {
          return this.#error(c, 'badMessage', 'Formato de pacote inválido.');
        }
        this.runtime
          .setPacketFormat(msg.format)
          .catch((e: Error) =>
            this.#error(c, 'formatFailed', `Falha ao trocar o formato: ${e.message}`),
          );
        return;
      }
      default:
        return this.#error(
          c,
          'unknownMessage',
          `Tipo de mensagem desconhecido: ${String((msg as { type: unknown }).type).slice(0, 40)}`,
        );
    }
  }

  #savedCaptureFormat() {
    const f = this.runtime.store.getSetting<string>(SETTINGS_KEYS.captureFormat);
    return isPacketFormat(f) ? f : undefined;
  }

  #hello(c: Client, msg: Extract<ClientMessage, { type: 'hello' }>) {
    const deviceId = typeof msg.deviceId === 'string' ? msg.deviceId.trim() : '';
    if (!DEVICE_ID_RE.test(deviceId)) {
      return this.#error(c, 'badDeviceId', 'deviceId inválido (use letras, números, "-" ou "_").');
    }
    const requestedName =
      typeof msg.deviceName === 'string' && msg.deviceName.trim()
        ? msg.deviceName.trim().slice(0, 40)
        : undefined;
    const store = this.runtime.store;
    let profile = store.getDeviceProfile(deviceId);
    if (!profile) {
      // updatedAt = 1: an edited local copy in the browser (updatedAt > 1) wins the reconcile.
      profile = store.saveDeviceProfile({
        ...createDefaultDeviceProfile(deviceId, requestedName ?? 'Dispositivo'),
        updatedAt: 1,
      });
    } else {
      profile = normalizeDeviceProfile(profile, deviceId);
    }
    const reHello = c.deviceId !== null;
    c.deviceId = deviceId;
    const prev = this.#devices.get(deviceId);
    this.#devices.set(deviceId, {
      deviceId,
      name: profile.name,
      lastSeenAt: Date.now(),
      currentView: prev?.currentView ?? null,
    });
    this.#pruneDevices();

    this.#send(c, {
      type: 'welcome',
      protocolVersion: WS_PROTOCOL_VERSION,
      serverVersion: this.options.serverVersion,
      deviceId,
    });
    if (msg.protocolVersion !== WS_PROTOCOL_VERSION) {
      this.#send(c, {
        type: 'notice',
        level: 'warn',
        code: 'protocolMismatch',
        message: `Versão do protocolo diferente (painel ${String(msg.protocolVersion)}, servidor ${WS_PROTOCOL_VERSION}). Recarregue a página.`,
        ttlMs: 10_000,
      });
    }
    this.#send(c, { type: 'deviceProfile', profile });
    this.#send(c, { type: 'status', status: this.status() });
    this.#send(c, { type: 'sessionChanged', session: this.runtime.session });
    const frame = this.runtime.liveFrame;
    if (frame) this.#send(c, { type: 'frame', frame });
    if (!reHello) this.scheduleStatus();
  }
}
