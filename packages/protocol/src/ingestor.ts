/**
 * UDP ingestor: one socket bound to the client port, heartbeat on an independent timer, Salsa20
 * decrypt + magic validation + parse, link state and packet-loss statistics (study §2–§4).
 *
 * Never throws on bad input; socket errors are reported through the `warning` event.
 */

import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import { networkInterfaces } from 'node:os';
import {
  GT7_CLIENT_PORT,
  GT7_CONSOLE_PORT,
  type IngestorState,
  type IngestorStats,
  type PacketFormat,
  type TelemetryPacket,
} from '@gt7/shared';
import { decryptPacket } from './crypto.ts';
import { tryParsePacket } from './parse.ts';

export interface Gt7IngestorOptions {
  /** Console IP. Optional when `discovery` is enabled. */
  consoleIp?: string;
  /** Heartbeat format (default 'A', the most compatible). */
  format?: PacketFormat;
  /** Local UDP port to bind (default 33740). */
  bindPort?: number;
  /** Local address to bind (default 0.0.0.0). */
  bindAddress?: string;
  /** Console UDP port (default 33739). */
  consolePort?: number;
  /** Heartbeat interval (default 1000 ms). */
  heartbeatIntervalMs?: number;
  /** No packet for this long → `timeout` state (default 3000 ms). */
  timeoutMs?: number;
  /** Heartbeat pause when switching format (default 15000 ms). */
  formatSwitchCooldownMs?: number;
  /** Stats emission interval (default 1000 ms). */
  statsIntervalMs?: number;
  /**
   * Try to find the console by sending heartbeats to the subnet broadcast address(es) and learning
   * the IP from the first valid responder. Undocumented, network dependent. Default false.
   */
  discovery?: boolean;
  /** Explicit broadcast addresses for discovery (default: computed from local interfaces). */
  broadcastAddresses?: string[];
  /** Only accept packets from the console IP once known (default false: any valid packet). */
  strictSource?: boolean;
}

export interface IngestedPacket {
  packet: TelemetryPacket;
  /** Decrypted bytes (bytes 0x40..0x43 are garbage), e.g. for recording. */
  raw: Uint8Array;
  /** Epoch ms when the datagram was received. */
  receivedAt: number;
  /** performance.now() at receive time (monotonic, for dt computations). */
  monoMs: number;
  remote: { address: string; port: number };
}

export interface Gt7IngestorEvents {
  packet: [IngestedPacket];
  state: [IngestorState, IngestorState];
  stats: [IngestorStats];
  /** Console IP learned through discovery. */
  discovered: [string];
  /** Non-fatal problems (socket errors, xor mismatch...). */
  warning: [Error];
}

/** Gaps larger than this (10 s of packets) are treated as a stream reset, not loss. */
const LOSS_GAP_RESET = 600;
/** This many consecutive backwards packetIds means the stream restarted (not duplicates). */
const DUP_STREAK_RESET = 30;

/** Subnet broadcast addresses of the active IPv4 interfaces. */
export function localBroadcastAddresses(): string[] {
  const out = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      const ip = ni.address.split('.').map(Number);
      const mask = ni.netmask.split('.').map(Number);
      if (ip.length !== 4 || mask.length !== 4) continue;
      out.add(ip.map((b, i) => (b | (~(mask[i] ?? 0) & 0xff)) & 0xff).join('.'));
    }
  }
  return out.size ? [...out] : ['255.255.255.255'];
}

export class Gt7Ingestor extends EventEmitter<Gt7IngestorEvents> {
  readonly options: Required<Omit<Gt7IngestorOptions, 'consoleIp' | 'broadcastAddresses'>> & {
    broadcastAddresses?: string[];
  };
  #consoleIp: string | null;
  #format: PacketFormat;
  #socket: Socket | null = null;
  #state: IngestorState = 'stopped';
  #hbTimer: NodeJS.Timeout | null = null;
  #watchdog: NodeJS.Timeout | null = null;
  #statsTimer: NodeJS.Timeout | null = null;
  #switchTimer: NodeJS.Timeout | null = null;
  #switchResolve: (() => void) | null = null;

  // stats
  #received = 0;
  #lost = 0;
  #duplicates = 0;
  #decryptFailures = 0;
  #invalidSize = 0;
  #resets = 0;
  #heartbeats = 0;
  #lastPacketAt: number | null = null;
  #lastPacketMono = 0;
  #lastPacketId: number | null = null;
  #receivedFormat: PacketFormat | null = null;
  #winReceived = 0;
  #winLost = 0;
  #winStart = 0;
  #lastStats: IngestorStats | null = null;
  #warnedXor = false;
  #dupStreak = 0;

  constructor(opts: Gt7IngestorOptions = {}) {
    super();
    this.options = {
      format: opts.format ?? 'A',
      bindPort: opts.bindPort ?? GT7_CLIENT_PORT,
      bindAddress: opts.bindAddress ?? '0.0.0.0',
      consolePort: opts.consolePort ?? GT7_CONSOLE_PORT,
      heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 1000,
      timeoutMs: opts.timeoutMs ?? 3000,
      formatSwitchCooldownMs: opts.formatSwitchCooldownMs ?? 15000,
      statsIntervalMs: opts.statsIntervalMs ?? 1000,
      discovery: opts.discovery ?? false,
      strictSource: opts.strictSource ?? false,
      ...(opts.broadcastAddresses ? { broadcastAddresses: opts.broadcastAddresses } : {}),
    };
    this.#consoleIp = opts.consoleIp ?? null;
    this.#format = this.options.format;
    if (!this.#consoleIp && !this.options.discovery) {
      throw new Error('Gt7Ingestor: consoleIp is required unless discovery is enabled');
    }
  }

  get state(): IngestorState {
    return this.#state;
  }

  get format(): PacketFormat {
    return this.#format;
  }

  get consoleIp(): string | null {
    return this.#consoleIp;
  }

  /** Latest stats snapshot (computed on demand). */
  get stats(): IngestorStats {
    return this.#lastStats ?? this.#computeStats(performance.now());
  }

  /** Binds the socket and starts heartbeats. Resolves once bound. */
  async start(): Promise<void> {
    if (this.#socket) return;
    const sock = createSocket({ type: 'udp4', reuseAddr: false });
    this.#socket = sock;
    sock.on('message', (msg, rinfo) => this.#onMessage(msg, rinfo));
    sock.on('error', (err) => this.emit('warning', err));
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      sock.once('error', onErr);
      sock.bind(this.options.bindPort, this.options.bindAddress, () => {
        sock.off('error', onErr);
        resolve();
      });
    }).catch((e) => {
      this.#socket = null;
      sock.close();
      throw e;
    });
    if (this.options.discovery) {
      try {
        sock.setBroadcast(true);
      } catch (e) {
        this.emit('warning', e as Error);
      }
    }
    this.#winStart = performance.now();
    this.#setState('connecting');
    this.#startHeartbeats();
    this.#watchdog = setInterval(() => this.#checkTimeout(), Math.min(250, this.options.timeoutMs));
    this.#statsTimer = setInterval(() => this.#emitStats(), this.options.statsIntervalMs);
  }

  /** Stops heartbeats and closes the socket. */
  async stop(): Promise<void> {
    this.#stopHeartbeats();
    for (const t of [this.#watchdog, this.#statsTimer, this.#switchTimer]) if (t) clearInterval(t);
    this.#watchdog = this.#statsTimer = this.#switchTimer = null;
    this.#switchResolve?.();
    this.#switchResolve = null;
    const sock = this.#socket;
    this.#socket = null;
    if (sock) await new Promise<void>((r) => sock.close(() => r()));
    this.#setState('stopped');
  }

  /** Changes the console IP (resets the loss tracker). */
  setConsoleIp(ip: string): void {
    this.#consoleIp = ip;
    this.#lastPacketId = null;
    this.#sendHeartbeat();
  }

  /**
   * Switches the packet format. The console locks the first format of a session, so heartbeats
   * are paused for `cooldownMs` (state `switchingFormat`) before sending the new format.
   * Resolves when heartbeats resume.
   */
  setFormat(format: PacketFormat, cooldownMs = this.options.formatSwitchCooldownMs): Promise<void> {
    if (format === this.#format && this.#state !== 'switchingFormat') return Promise.resolve();
    this.#format = format;
    if (!this.#socket) return Promise.resolve();
    if (this.#switchTimer) clearTimeout(this.#switchTimer);
    this.#switchResolve?.();
    this.#stopHeartbeats();
    this.#setState('switchingFormat');
    return new Promise<void>((resolve) => {
      this.#switchResolve = resolve;
      this.#switchTimer = setTimeout(() => {
        this.#switchTimer = null;
        this.#switchResolve = null;
        this.#lastPacketId = null;
        if (this.#socket) {
          this.#setState(this.#isFresh() ? 'connected' : 'connecting');
          this.#startHeartbeats();
        }
        resolve();
      }, cooldownMs);
    });
  }

  // ------------------------------------------------------------------------------------------

  #setState(s: IngestorState): void {
    if (s === this.#state) return;
    const prev = this.#state;
    this.#state = s;
    this.emit('state', s, prev);
  }

  #startHeartbeats(): void {
    this.#stopHeartbeats();
    this.#sendHeartbeat();
    this.#hbTimer = setInterval(() => this.#sendHeartbeat(), this.options.heartbeatIntervalMs);
  }

  #stopHeartbeats(): void {
    if (this.#hbTimer) clearInterval(this.#hbTimer);
    this.#hbTimer = null;
  }

  #sendHeartbeat(): void {
    const sock = this.#socket;
    if (!sock || this.#state === 'switchingFormat') return;
    const msg = Buffer.from(this.#format, 'latin1');
    const targets = this.#consoleIp
      ? [this.#consoleIp]
      : (this.options.broadcastAddresses ?? localBroadcastAddresses());
    for (const ip of targets) {
      sock.send(msg, this.options.consolePort, ip, (err) => {
        if (err) this.emit('warning', err);
      });
      this.#heartbeats++;
    }
  }

  #isFresh(): boolean {
    return (
      this.#lastPacketAt !== null &&
      performance.now() - this.#lastPacketMono < this.options.timeoutMs
    );
  }

  #checkTimeout(): void {
    if (this.#state === 'connected' && !this.#isFresh()) this.#setState('timeout');
  }

  #onMessage(msg: Buffer, rinfo: RemoteInfo): void {
    try {
      if (this.options.strictSource && this.#consoleIp && rinfo.address !== this.#consoleIp) {
        return;
      }
      const dec = decryptPacket(msg);
      if (!dec) {
        if (
          msg.byteLength === 296 ||
          msg.byteLength === 316 ||
          msg.byteLength === 344 ||
          msg.byteLength === 368
        ) {
          this.#decryptFailures++;
        } else {
          this.#invalidSize++;
        }
        return;
      }
      if (dec.xorMismatch && !this.#warnedXor) {
        this.#warnedXor = true;
        this.emit(
          'warning',
          new Error(
            `XOR mismatch for format ${dec.format}: key 0x${dec.xorKey.toString(16)} worked`,
          ),
        );
      }
      const packet = tryParsePacket(dec.plain, dec.format);
      if (!packet) {
        this.#decryptFailures++;
        return;
      }
      // Loss / duplicate tracking by packetId.
      const id = packet.packetId;
      const last = this.#lastPacketId;
      if (last !== null) {
        const gap = id - last;
        if (gap === 1) {
          // in order
        } else if (gap > 1 && gap <= LOSS_GAP_RESET) {
          this.#lost += gap - 1;
          this.#winLost += gap - 1;
        } else if (gap <= 0 && gap > -LOSS_GAP_RESET && this.#dupStreak < DUP_STREAK_RESET) {
          this.#duplicates++;
          this.#dupStreak++;
          return;
        } else {
          this.#resets++;
        }
      }
      this.#dupStreak = 0;
      this.#lastPacketId = id;

      const now = Date.now();
      const mono = performance.now();
      this.#received++;
      this.#winReceived++;
      this.#lastPacketAt = now;
      this.#lastPacketMono = mono;
      this.#receivedFormat = dec.format;

      if (!this.#consoleIp && this.options.discovery) {
        this.#consoleIp = rinfo.address;
        this.emit('discovered', rinfo.address);
      }
      if (this.#state === 'connecting' || this.#state === 'timeout') this.#setState('connected');

      this.emit('packet', {
        packet,
        raw: dec.plain,
        receivedAt: now,
        monoMs: mono,
        remote: { address: rinfo.address, port: rinfo.port },
      });
    } catch (e) {
      // A listener threw or something unexpected: never crash the socket loop.
      this.emit('warning', e instanceof Error ? e : new Error(String(e)));
    }
  }

  #computeStats(nowMono: number): IngestorStats {
    const winS = Math.max(0.001, (nowMono - this.#winStart) / 1000);
    const expected = this.#winReceived + this.#winLost;
    return {
      state: this.#state,
      format: this.#format,
      receivedFormat: this.#receivedFormat,
      consoleAddress: this.#consoleIp,
      rateHz: this.#winReceived / winS,
      received: this.#received,
      lost: this.#lost,
      lossPct: expected > 0 ? (this.#winLost / expected) * 100 : 0,
      duplicates: this.#duplicates,
      decryptFailures: this.#decryptFailures,
      invalidSize: this.#invalidSize,
      resets: this.#resets,
      lastPacketAt: this.#lastPacketAt,
      heartbeatsSent: this.#heartbeats,
    };
  }

  #emitStats(): void {
    const now = performance.now();
    const s = this.#computeStats(now);
    this.#lastStats = s;
    this.#winStart = now;
    this.#winReceived = 0;
    this.#winLost = 0;
    this.emit('stats', s);
  }
}
