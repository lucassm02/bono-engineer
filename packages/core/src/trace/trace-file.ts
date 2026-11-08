/**
 * Lap trace file format (`<lapId>.bin.gz`): gzip of
 *
 *   "GT7T" | u16 version | u16 channelCount | u32 sampleCount | f32 sampleRateHz
 *   | u16 lapIdLength | lapId (utf-8)
 *   | channelCount × (u8 nameLength | name (ascii) | u8 dtype)        dtype: 1 = f32, 2 = f64
 *   | channel data blocks in the same order (little-endian, sampleCount values each)
 *
 * Unknown channels in a file are ignored on load; channels missing from a file load as NaN.
 */

import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { LapSampleChannel, LapTrace } from '@gt7/shared';
import { FLOAT64_CHANNELS, LAP_SAMPLE_CHANNELS } from './channels.ts';

export const TRACE_MAGIC = 'GT7T';
export const TRACE_VERSION = 1;
export const TRACE_EXTENSION = '.bin.gz';

const DTYPE_F32 = 1;
const DTYPE_F64 = 2;

/** Serializes (uncompressed) a trace. */
export function encodeTraceRaw(trace: LapTrace): Buffer {
  const n = trace.length;
  const lapId = Buffer.from(trace.lapId, 'utf8');
  const chans = LAP_SAMPLE_CHANNELS;
  let headerLen = 4 + 2 + 2 + 4 + 4 + 2 + lapId.length;
  for (const c of chans) headerLen += 1 + c.length + 1;
  let dataLen = 0;
  for (const c of chans) dataLen += n * (FLOAT64_CHANNELS.has(c) ? 8 : 4);
  const buf = Buffer.alloc(headerLen + dataLen);
  let o = 0;
  buf.write(TRACE_MAGIC, o, 'latin1');
  o += 4;
  buf.writeUInt16LE(TRACE_VERSION, o);
  o += 2;
  buf.writeUInt16LE(chans.length, o);
  o += 2;
  buf.writeUInt32LE(n, o);
  o += 4;
  buf.writeFloatLE(trace.sampleRateHz, o);
  o += 4;
  buf.writeUInt16LE(lapId.length, o);
  o += 2;
  lapId.copy(buf, o);
  o += lapId.length;
  for (const c of chans) {
    buf.writeUInt8(c.length, o++);
    buf.write(c, o, 'latin1');
    o += c.length;
    buf.writeUInt8(FLOAT64_CHANNELS.has(c) ? DTYPE_F64 : DTYPE_F32, o++);
  }
  for (const c of chans) {
    const col = trace.channels[c];
    if (FLOAT64_CHANNELS.has(c)) {
      for (let i = 0; i < n; i++, o += 8) buf.writeDoubleLE(Number(col[i] ?? Number.NaN), o);
    } else {
      for (let i = 0; i < n; i++, o += 4) buf.writeFloatLE(Number(col[i] ?? Number.NaN), o);
    }
  }
  return buf;
}

/** Parses an uncompressed trace buffer. */
export function decodeTraceRaw(buf: Buffer): LapTrace {
  let o = 0;
  if (buf.length < 18 || buf.toString('latin1', 0, 4) !== TRACE_MAGIC) {
    throw new Error('not a GT7 lap trace');
  }
  o = 4;
  const version = buf.readUInt16LE(o);
  o += 2;
  if (version > TRACE_VERSION) throw new Error(`unsupported trace version ${version}`);
  const nChan = buf.readUInt16LE(o);
  o += 2;
  const n = buf.readUInt32LE(o);
  o += 4;
  const sampleRateHz = buf.readFloatLE(o);
  o += 4;
  const idLen = buf.readUInt16LE(o);
  o += 2;
  const lapId = buf.toString('utf8', o, o + idLen);
  o += idLen;
  const defs: { name: string; dtype: number }[] = [];
  for (let k = 0; k < nChan; k++) {
    const len = buf.readUInt8(o++);
    const name = buf.toString('latin1', o, o + len);
    o += len;
    defs.push({ name, dtype: buf.readUInt8(o++) });
  }
  const known = new Set<string>(LAP_SAMPLE_CHANNELS);
  const channels = {} as LapTrace['channels'];
  for (const d of defs) {
    const size = d.dtype === DTYPE_F64 ? 8 : 4;
    if (o + size * n > buf.length) throw new Error('truncated trace file');
    if (known.has(d.name)) {
      const col = new Float64Array(n);
      if (size === 8) for (let i = 0; i < n; i++) col[i] = buf.readDoubleLE(o + i * 8);
      else for (let i = 0; i < n; i++) col[i] = buf.readFloatLE(o + i * 4);
      channels[d.name as LapSampleChannel] = col;
    }
    o += size * n;
  }
  for (const c of LAP_SAMPLE_CHANNELS) {
    if (!channels[c]) channels[c] = new Float64Array(n).fill(Number.NaN);
  }
  return { lapId, sampleRateHz, length: n, channels };
}

export function encodeTrace(trace: LapTrace): Buffer {
  return gzipSync(encodeTraceRaw(trace), { level: 6 });
}

export function decodeTrace(gz: Buffer): LapTrace {
  return decodeTraceRaw(gunzipSync(gz));
}

export async function writeTraceFile(path: string, trace: LapTrace): Promise<void> {
  await writeFile(path, encodeTrace(trace));
}

export async function readTraceFile(path: string): Promise<LapTrace> {
  return decodeTrace(await readFile(path));
}

export function readTraceFileSync(path: string): LapTrace {
  return decodeTrace(readFileSync(path));
}
