/**
 * Minimal zip container (stored or raw-deflate entries, no zip64, no encryption) so a Bono backup
 * is a plain `.zip` the user can open and inspect. Entries are streamed through files, so large raw
 * recordings never sit fully in memory.
 */

import {
  closeSync,
  createReadStream,
  createWriteStream,
  fstatSync,
  openSync,
  readSync,
  writeSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { crc32, createInflateRaw, deflateRawSync } from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const MAX = 0xffffffff;
const CHUNK = 1 << 20;

export interface ZipEntry {
  name: string;
  method: 0 | 8;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** dos date/time for "now" (zip has no timezone; local time is the convention). */
function dosDateTime(d = new Date()): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  readonly #fd: number;
  readonly #entries: ZipEntry[] = [];
  #offset = 0;
  #closed = false;

  constructor(path: string) {
    this.#fd = openSync(path, 'w');
  }

  #write(buf: Buffer): void {
    writeSync(this.#fd, buf);
    this.#offset += buf.length;
    if (this.#offset > MAX) throw new Error('Backup grande demais para o formato zip (4 GB).');
  }

  #header(
    name: string,
    method: 0 | 8,
    crc: number,
    csize: number,
    size: number,
    extra?: { time: number; date: number },
  ): Buffer {
    const nameBuf = Buffer.from(name, 'utf8');
    const { time, date } = extra ?? dosDateTime();
    const h = Buffer.alloc(30 + nameBuf.length);
    h.writeUInt32LE(LOCAL_SIG, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8 names
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc >>> 0, 14);
    h.writeUInt32LE(csize, 18);
    h.writeUInt32LE(size, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(h, 30);
    return h;
  }

  /** Adds an in-memory entry (deflated when that makes it smaller). */
  addBuffer(name: string, data: Buffer): void {
    const crc = crc32(data);
    const deflated = deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const localOffset = this.#offset;
    this.#write(this.#header(name, useDeflate ? 8 : 0, crc, body.length, data.length));
    this.#write(body);
    this.#entries.push({
      name,
      method: useDeflate ? 8 : 0,
      crc,
      compressedSize: body.length,
      size: data.length,
      localOffset,
    });
  }

  /** Adds a file as stored (the big files here, .gt7rec and traces, are already compressed). */
  addFileStored(name: string, path: string): void {
    const fd = openSync(path, 'r');
    try {
      const size = fstatSync(fd).size;
      let crc = 0;
      const buf = Buffer.alloc(CHUNK);
      for (let pos = 0; pos < size; ) {
        const n = readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
        if (n <= 0) break;
        crc = crc32(buf.subarray(0, n), crc);
        pos += n;
      }
      const localOffset = this.#offset;
      this.#write(this.#header(name, 0, crc, size, size));
      for (let pos = 0; pos < size; ) {
        const n = readSync(fd, buf, 0, Math.min(CHUNK, size - pos), pos);
        if (n <= 0) break;
        this.#write(buf.subarray(0, n));
        pos += n;
      }
      this.#entries.push({
        name,
        method: 0,
        crc,
        compressedSize: size,
        size,
        localOffset,
      });
    } finally {
      closeSync(fd);
    }
  }

  /** Writes the central directory and closes the file. */
  finish(): void {
    if (this.#closed) return;
    this.#closed = true;
    const start = this.#offset;
    const { time, date } = dosDateTime();
    for (const e of this.#entries) {
      const nameBuf = Buffer.from(e.name, 'utf8');
      const c = Buffer.alloc(46 + nameBuf.length);
      c.writeUInt32LE(CENTRAL_SIG, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(time, 12);
      c.writeUInt16LE(date, 14);
      c.writeUInt32LE(e.crc >>> 0, 16);
      c.writeUInt32LE(e.compressedSize, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(nameBuf.length, 28);
      c.writeUInt32LE(e.localOffset, 42);
      nameBuf.copy(c, 46);
      this.#write(c);
    }
    const size = this.#offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(EOCD_SIG, 0);
    end.writeUInt16LE(this.#entries.length, 8);
    end.writeUInt16LE(this.#entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    this.#write(end);
    closeSync(this.#fd);
  }

  abort(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      closeSync(this.#fd);
    } catch {
      // already closed
    }
  }
}

/** Entries of a zip, read from its central directory. */
export function readZipEntries(path: string): ZipEntry[] {
  const fd = openSync(path, 'r');
  try {
    const total = fstatSync(fd).size;
    const tailLen = Math.min(total, 65_557);
    const tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, total - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Este arquivo não é um backup do Bono (zip inválido).');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset + cdSize > total) throw new Error('O arquivo de backup está incompleto.');
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOffset);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== CENTRAL_SIG)
        throw new Error('O arquivo de backup está corrompido.');
      const method = cd.readUInt16LE(p + 10);
      if (method !== 0 && method !== 8) throw new Error('Método de compressão não suportado.');
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      entries.push({
        name: cd.toString('utf8', p + 46, p + 46 + nameLen),
        method,
        crc: cd.readUInt32LE(p + 16),
        compressedSize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        localOffset: cd.readUInt32LE(p + 42),
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

/** Start of an entry's data (after its local header). */
function dataStart(fd: number, e: ZipEntry): number {
  const h = Buffer.alloc(30);
  readSync(fd, h, 0, 30, e.localOffset);
  if (h.readUInt32LE(0) !== LOCAL_SIG) throw new Error('O arquivo de backup está corrompido.');
  return e.localOffset + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
}

/** Extracts one entry to `dest`, checking its size and CRC. */
export async function extractEntry(zipPath: string, e: ZipEntry, dest: string): Promise<void> {
  const fd = openSync(zipPath, 'r');
  let start: number;
  try {
    start = dataStart(fd, e);
  } finally {
    closeSync(fd);
  }
  let crc = 0;
  let size = 0;
  const source = createReadStream(zipPath, {
    start,
    end: start + e.compressedSize - 1,
    highWaterMark: CHUNK,
  });
  const verify = async function* (chunks: AsyncIterable<Buffer>) {
    for await (const chunk of chunks) {
      crc = crc32(chunk, crc);
      size += chunk.length;
      yield chunk;
    }
  };
  if (e.compressedSize === 0) {
    await pipeline(verify((async function* () {})()), createWriteStream(dest));
  } else if (e.method === 8) {
    await pipeline(source, createInflateRaw(), verify, createWriteStream(dest));
  } else {
    await pipeline(source, verify, createWriteStream(dest));
  }
  if (size !== e.size || crc >>> 0 !== e.crc >>> 0) {
    throw new Error(`O arquivo de backup está corrompido (${e.name}).`);
  }
}

/** Reads a small entry into memory. */
export async function readEntryBuffer(zipPath: string, e: ZipEntry): Promise<Buffer> {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'bono-zip-'));
  try {
    const out = join(dir, 'entry');
    await extractEntry(zipPath, e, out);
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
