/**
 * FakeConsole: a UDP server that behaves like a PS4/PS5 running GT7's Simulator Interface.
 *
 * - Listens on `port` (default 33739) for 1-byte heartbeats ('A' | 'B' | '~' | 'C').
 * - Streams ENCRYPTED packets at `rateHz` to the heartbeat sender's IP on `targetPort` (33740).
 * - Locks the first heartbeat's format; it can only change after no heartbeat for
 *   `formatLockMs` (mimics the real console, which requires a heartbeat pause to switch).
 * - Stops streaming after `heartbeatTimeoutMs` without heartbeats.
 * - Source: synthetic generator (infinite) or a recording (real-time replay, loops).
 */

import { createSocket, type Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import {
  GT7_CLIENT_PORT,
  GT7_CONSOLE_PORT,
  isPacketFormat,
  PACKET_SIZES,
  type PacketFormat,
} from '@gt7/shared';
import { encryptPacket } from '../crypto.ts';
import { encodePacket } from '../encode.ts';
import { loadRecording, type RecordingRecord } from '../recording.ts';
import { Rng } from './synthetic/rng.ts';
import { type SyntheticOptions, SyntheticSession } from './synthetic/session.ts';

function packetIdOf(data: Uint8Array): number {
  if (data.byteLength < 0x74) return 0;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(0x70, true);
}

export type FakeConsoleSource =
  | ({ kind: 'synthetic' } & Omit<SyntheticOptions, 'format' | 'rateHz'>)
  | { kind: 'recording'; file: string; loop?: boolean };

export interface FakeConsoleOptions {
  /** Port to listen for heartbeats (default 33739). */
  port?: number;
  /** Bind address (default 0.0.0.0; use 127.0.0.1 for local-only). */
  host?: string;
  /** Port packets are sent to on the heartbeat sender (default 33740). */
  targetPort?: number;
  /** Stop streaming after this long without heartbeat (default 20000 ms). */
  heartbeatTimeoutMs?: number;
  /** Format can change only after this long without heartbeat (default 10000 ms). */
  formatLockMs?: number;
  /** Packet rate for the synthetic source (default 60). */
  rateHz?: number;
  source?: FakeConsoleSource;
  /** Seed for IV seeds (default 1). */
  seed?: number;
}

export interface FakeConsoleEvents {
  heartbeat: [format: PacketFormat, address: string];
  streaming: [active: boolean, target: string | null, format: PacketFormat | null];
  formatLocked: [format: PacketFormat];
  warning: [Error];
}

export class FakeConsole extends EventEmitter<FakeConsoleEvents> {
  readonly options: Required<Omit<FakeConsoleOptions, 'source'>> & { source: FakeConsoleSource };
  #socket: Socket | null = null;
  #timer: NodeJS.Timeout | null = null;
  #lastHeartbeatMono = 0;
  #target: string | null = null;
  #format: PacketFormat | null = null;
  #streaming = false;
  #startMono = 0;
  #sent = 0;
  #rng: Rng;
  // sources
  #synthetic: SyntheticSession | null = null;
  #records: RecordingRecord[] = [];
  #recIdx = 0;
  #recLoopOffsetMs = 0;
  #recPacketIdShift = 0;

  constructor(opts: FakeConsoleOptions = {}) {
    super();
    this.options = {
      port: opts.port ?? GT7_CONSOLE_PORT,
      host: opts.host ?? '0.0.0.0',
      targetPort: opts.targetPort ?? GT7_CLIENT_PORT,
      heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? 20_000,
      formatLockMs: opts.formatLockMs ?? 10_000,
      rateHz: opts.rateHz ?? 60,
      seed: opts.seed ?? 1,
      source: opts.source ?? { kind: 'synthetic', profile: 'pro' },
    };
    this.#rng = new Rng(this.options.seed ^ 0x5eed);
  }

  /** Packets sent since start. */
  get sent(): number {
    return this.#sent;
  }

  get streaming(): boolean {
    return this.#streaming;
  }

  get format(): PacketFormat | null {
    return this.#format;
  }

  /** The synthetic session (null for recording sources). */
  get synthetic(): SyntheticSession | null {
    return this.#synthetic;
  }

  async start(): Promise<void> {
    if (this.#socket) return;
    const src = this.options.source;
    if (src.kind === 'recording') {
      const { records } = await loadRecording(src.file);
      if (records.length === 0) throw new Error(`recording has no packets: ${src.file}`);
      this.#records = records;
    } else {
      this.#synthetic = new SyntheticSession({ ...src, format: 'C', rateHz: this.options.rateHz });
    }
    const sock = createSocket('udp4');
    this.#socket = sock;
    sock.on('message', (msg, rinfo) => this.#onHeartbeat(msg, rinfo.address));
    sock.on('error', (err) => this.emit('warning', err));
    await new Promise<void>((resolve, reject) => {
      sock.once('error', reject);
      sock.bind(this.options.port, this.options.host, () => {
        sock.off('error', reject);
        resolve();
      });
    });
    this.#timer = setInterval(() => this.#tick(), 4);
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#setStreaming(false);
    const sock = this.#socket;
    this.#socket = null;
    if (sock) await new Promise<void>((r) => sock.close(() => r()));
  }

  // ------------------------------------------------------------------------------------------

  #onHeartbeat(msg: Buffer, address: string): void {
    if (msg.length < 1) return;
    const ch = String.fromCharCode(msg[0]!);
    if (!isPacketFormat(ch)) return;
    const now = performance.now();
    const silentFor = now - this.#lastHeartbeatMono;
    this.#lastHeartbeatMono = now;
    this.emit('heartbeat', ch, address);
    if (this.#format === null || (silentFor >= this.options.formatLockMs && ch !== this.#format)) {
      this.#format = ch;
      this.emit('formatLocked', ch);
    }
    this.#target = address;
    if (!this.#streaming) this.#setStreaming(true);
  }

  #setStreaming(active: boolean): void {
    if (active === this.#streaming) return;
    this.#streaming = active;
    if (active) {
      this.#startMono = performance.now();
      this.#sent = 0;
      this.#recIdx = 0;
      this.#recLoopOffsetMs = 0;
    }
    this.emit('streaming', active, this.#target, this.#format);
  }

  #tick(): void {
    try {
      if (!this.#streaming) return;
      const now = performance.now();
      if (now - this.#lastHeartbeatMono > this.options.heartbeatTimeoutMs) {
        this.#setStreaming(false);
        return;
      }
      if (this.#records.length > 0) {
        this.#tickRecording(now);
        return;
      }
      const due = Math.floor(((now - this.#startMono) / 1000) * this.options.rateHz);
      // never burst more than 0.5 s of packets (e.g. after the process was suspended)
      if (due - this.#sent > this.options.rateHz / 2) {
        this.#sent = due - 1;
      }
      while (this.#sent < due) {
        this.#sendOne();
        this.#sent++;
      }
    } catch (e) {
      this.emit('warning', e instanceof Error ? e : new Error(String(e)));
    }
  }

  #tickRecording(now: number): void {
    const elapsedMs = now - this.#startMono;
    const t0 = this.#records[0]?.tMs ?? 0;
    let guard = 0;
    while (guard++ < 120) {
      const rec = this.#records[this.#recIdx];
      if (!rec) return;
      const dueAt = rec.tMs - t0 + this.#recLoopOffsetMs;
      if (dueAt > elapsedMs) return;
      if (elapsedMs - dueAt > 500) {
        // fell behind (suspended process): resync instead of bursting
        this.#recLoopOffsetMs += elapsedMs - dueAt;
      }
      this.#sendOne();
      this.#sent++;
      const src = this.options.source;
      if (src.kind === 'recording' && src.loop === false && this.#recIdx === 0 && this.#sent > 1) {
        this.#setStreaming(false);
        return;
      }
    }
  }

  #nextPlain(format: PacketFormat): Uint8Array {
    if (this.#synthetic) {
      return encodePacket(this.#synthetic.next(), format);
    }
    // recording: pace by recorded timestamps relative to the stream start
    const rec = this.#records[this.#recIdx]!;
    this.#recIdx++;
    if (this.#recIdx >= this.#records.length) {
      const src = this.options.source;
      this.#recIdx = 0;
      if (!(src.kind === 'recording' && src.loop === false)) {
        const first = this.#records[0]!;
        const last = this.#records.at(-1)!;
        this.#recLoopOffsetMs += last.tMs - first.tMs + 1000 / this.options.rateHz;
        this.#recPacketIdShift += packetIdOf(last.data) - packetIdOf(first.data) + 1;
      }
    }
    const want = PACKET_SIZES[format];
    const data = rec.data.byteLength > want ? rec.data.slice(0, want) : rec.data.slice();
    // keep packetIds increasing across loops
    if (this.#recPacketIdShift && data.byteLength >= 0x74) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      dv.setInt32(0x70, (dv.getInt32(0x70, true) + this.#recPacketIdShift) | 0, true);
    }
    return data;
  }

  #sendOne(): void {
    const sock = this.#socket;
    const format = this.#format;
    const target = this.#target;
    if (!sock || !format || !target) return;
    const plain = this.#nextPlain(format);
    const sendFormat = plain.byteLength === PACKET_SIZES[format] ? format : null;
    const fmt =
      sendFormat ??
      (Object.keys(PACKET_SIZES) as PacketFormat[]).find(
        (f) => PACKET_SIZES[f] === plain.byteLength,
      );
    if (!fmt) return;
    const cipher = encryptPacket(plain, fmt, this.#rng.u32());
    sock.send(cipher, this.options.targetPort, target, (err) => {
      if (err) this.emit('warning', err);
    });
  }
}
