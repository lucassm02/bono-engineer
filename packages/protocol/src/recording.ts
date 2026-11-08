/**
 * Session recording format (.gt7rec): a gzip stream containing
 *
 *   header:  "GT7R" | u16 version | u8 format char | u8 reserved | f64 startTime (epoch ms)
 *            | u32 metaLength | meta JSON (utf-8)
 *   records: u32 tMs (since startTime) | u16 length | decrypted packet bytes
 *
 * All integers little-endian. The writer issues a Z_SYNC_FLUSH periodically so a crash loses at
 * most `flushIntervalMs` of data; the reader tolerates a truncated tail (partial gzip block or
 * partial record) and simply stops there.
 */

import { once } from 'node:events';
import { createReadStream, createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { createGunzip, createGzip, type Gzip, constants as zc } from 'node:zlib';
import { isPacketFormat, type PacketFormat } from '@gt7/shared';

export const RECORDING_MAGIC = 'GT7R';
export const RECORDING_VERSION = 1;
export const RECORDING_EXTENSION = '.gt7rec';

export interface RecordingMeta {
  /** Free-form metadata: source ('live' | 'synthetic' | ...), console ip, car, notes... */
  [key: string]: unknown;
}

export interface RecordingHeader {
  version: number;
  format: PacketFormat;
  /** Epoch ms of t = 0. */
  startTime: number;
  meta: RecordingMeta;
}

export interface RecordingRecord {
  /** ms since header.startTime. */
  tMs: number;
  /** Decrypted packet bytes. */
  data: Uint8Array;
}

function encodeHeader(h: RecordingHeader): Buffer {
  const meta = Buffer.from(JSON.stringify(h.meta ?? {}), 'utf8');
  const b = Buffer.alloc(4 + 2 + 1 + 1 + 8 + 4 + meta.length);
  b.write(RECORDING_MAGIC, 0, 'latin1');
  b.writeUInt16LE(h.version, 4);
  b.writeUInt8(h.format.charCodeAt(0), 6);
  b.writeUInt8(0, 7);
  b.writeDoubleLE(h.startTime, 8);
  b.writeUInt32LE(meta.length, 16);
  meta.copy(b, 20);
  return b;
}

export interface RecordingWriterOptions {
  format: PacketFormat;
  /** Epoch ms of t = 0 (default: now). */
  startTime?: number;
  meta?: RecordingMeta;
  /** Periodic sync flush interval (default 1000 ms; 0 disables). */
  flushIntervalMs?: number;
}

/** Streaming writer. Create with {@link RecordingWriter.open}. */
export class RecordingWriter {
  readonly path: string;
  readonly header: RecordingHeader;
  #gzip: Gzip;
  #file: WriteStream;
  #timer: NodeJS.Timeout | null = null;
  #closed = false;
  #count = 0;
  #bytes = 0;
  #lastT = 0;

  private constructor(path: string, header: RecordingHeader, flushIntervalMs: number) {
    this.path = path;
    this.header = header;
    mkdirSync(dirname(path), { recursive: true });
    this.#file = createWriteStream(path);
    this.#gzip = createGzip();
    this.#gzip.pipe(this.#file);
    this.#gzip.write(encodeHeader(header));
    if (flushIntervalMs > 0) {
      this.#timer = setInterval(() => {
        if (!this.#closed) this.#gzip.flush(zc.Z_SYNC_FLUSH);
      }, flushIntervalMs);
      this.#timer.unref();
    }
  }

  static async open(path: string, opts: RecordingWriterOptions): Promise<RecordingWriter> {
    const header: RecordingHeader = {
      version: RECORDING_VERSION,
      format: opts.format,
      startTime: opts.startTime ?? Date.now(),
      meta: opts.meta ?? {},
    };
    const w = new RecordingWriter(path, header, opts.flushIntervalMs ?? 1000);
    await once(w.#file, 'open');
    return w;
  }

  /** Number of records written. */
  get count(): number {
    return this.#count;
  }

  /** Uncompressed bytes written (records only). */
  get bytes(): number {
    return this.#bytes;
  }

  /**
   * Appends a decrypted packet. `tMs` defaults to now − startTime; it is clamped to be monotonic.
   */
  write(data: Uint8Array, tMs?: number): void {
    if (this.#closed) throw new Error('RecordingWriter is closed');
    if (data.byteLength > 0xffff) throw new Error('record too large');
    let t = Math.round(tMs ?? Date.now() - this.header.startTime);
    if (t < this.#lastT) t = this.#lastT;
    if (t > 0xffffffff) t = 0xffffffff;
    this.#lastT = t;
    const rec = Buffer.alloc(6 + data.byteLength);
    rec.writeUInt32LE(t, 0);
    rec.writeUInt16LE(data.byteLength, 4);
    rec.set(data, 6);
    this.#gzip.write(rec);
    this.#count++;
    this.#bytes += rec.length;
  }

  /** Flushes and closes the file. Safe to call twice. */
  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    const done = once(this.#file, 'close');
    this.#gzip.end();
    await done;
  }
}

type ParsedItem =
  | { kind: 'header'; header: RecordingHeader }
  | { kind: 'record'; record: RecordingRecord };

async function* parseRecordingStream(path: string): AsyncGenerator<ParsedItem> {
  const gunzip = createGunzip({ finishFlush: zc.Z_SYNC_FLUSH });
  const src = createReadStream(path);
  src.on('error', (e) => gunzip.destroy(e));
  src.pipe(gunzip);
  let pending: Buffer = Buffer.alloc(0);
  let header: RecordingHeader | null = null;
  try {
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let off = 0;
      if (!header) {
        if (pending.length < 20) continue;
        if (pending.toString('latin1', 0, 4) !== RECORDING_MAGIC) {
          throw new Error(`not a GT7 recording: ${path}`);
        }
        const metaLen = pending.readUInt32LE(16);
        if (pending.length < 20 + metaLen) continue;
        const fmt = String.fromCharCode(pending.readUInt8(6));
        if (!isPacketFormat(fmt)) throw new Error(`invalid format in recording header: ${fmt}`);
        header = {
          version: pending.readUInt16LE(4),
          format: fmt,
          startTime: pending.readDoubleLE(8),
          meta: JSON.parse(pending.toString('utf8', 20, 20 + metaLen)) as RecordingMeta,
        };
        off = 20 + metaLen;
        yield { kind: 'header', header };
      }
      while (pending.length - off >= 6) {
        const len = pending.readUInt16LE(off + 4);
        if (pending.length - off < 6 + len) break;
        const tMs = pending.readUInt32LE(off);
        const data = new Uint8Array(pending.subarray(off + 6, off + 6 + len));
        off += 6 + len;
        yield { kind: 'record', record: { tMs, data } };
      }
      pending = pending.subarray(off);
    }
  } catch (err) {
    // Truncated / corrupted tail: stop gracefully if we already have the header.
    if (!header) throw err;
  } finally {
    src.destroy();
    gunzip.destroy();
  }
  if (!header) throw new Error(`empty or truncated recording header: ${path}`);
}

/** Async reader: `const r = await RecordingReader.open(p); for await (const rec of r) ...` */
export class RecordingReader implements AsyncIterable<RecordingRecord> {
  readonly header: RecordingHeader;
  #gen: AsyncGenerator<ParsedItem>;
  #used = false;

  private constructor(header: RecordingHeader, gen: AsyncGenerator<ParsedItem>) {
    this.header = header;
    this.#gen = gen;
  }

  static async open(path: string): Promise<RecordingReader> {
    const gen = parseRecordingStream(path);
    const first = await gen.next();
    if (first.done || first.value.kind !== 'header') {
      throw new Error(`empty or truncated recording header: ${path}`);
    }
    return new RecordingReader(first.value.header, gen);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<RecordingRecord> {
    if (this.#used) throw new Error('RecordingReader can only be iterated once');
    this.#used = true;
    for await (const item of this.#gen) {
      if (item.kind === 'record') yield item.record;
    }
  }

  /** Stops reading and releases the file. */
  async close(): Promise<void> {
    await this.#gen.return(undefined);
  }
}

/** Loads a whole recording in memory (fine for sessions up to ~1 h ≈ 70 MB). */
export async function loadRecording(
  path: string,
): Promise<{ header: RecordingHeader; records: RecordingRecord[] }> {
  const reader = await RecordingReader.open(path);
  const records: RecordingRecord[] = [];
  for await (const r of reader) records.push(r);
  return { header: reader.header, records };
}
