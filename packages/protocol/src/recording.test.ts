import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { encodePacket } from './encode.ts';
import { parsePacket } from './parse.ts';
import { loadRecording, RecordingReader, RecordingWriter } from './recording.ts';
import { generateLaps } from './simulator/synthetic/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'gt7rec-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('recording', () => {
  it('writes and reads back header and records', async () => {
    const { packets } = generateLaps({ laps: 0, format: 'B', seed: 5 });
    const subset = packets.slice(0, 600);
    const path = join(dir, 'a.gt7rec');
    const w = await RecordingWriter.open(path, {
      format: 'B',
      startTime: 1_700_000_000_000,
      meta: { source: 'test', n: subset.length },
    });
    subset.forEach((p, i) => {
      w.write(encodePacket(p, 'B'), Math.round((i * 1000) / 60));
    });
    await w.close();
    expect(w.count).toBe(subset.length);

    const r = await RecordingReader.open(path);
    expect(r.header.format).toBe('B');
    expect(r.header.version).toBe(1);
    expect(r.header.startTime).toBe(1_700_000_000_000);
    expect(r.header.meta).toEqual({ source: 'test', n: subset.length });
    let i = 0;
    for await (const rec of r) {
      expect(rec.tMs).toBe(Math.round((i * 1000) / 60));
      expect(rec.data.byteLength).toBe(316);
      expect(parsePacket(rec.data).packetId).toBe(subset[i]!.packetId);
      i++;
    }
    expect(i).toBe(subset.length);
  });

  it('tolerates a truncated file (crash while recording)', async () => {
    const { packets } = generateLaps({ laps: 0, format: 'A', seed: 6 });
    const path = join(dir, 'b.gt7rec');
    const w = await RecordingWriter.open(path, { format: 'A' });
    for (const p of packets.slice(0, 1000)) w.write(encodePacket(p, 'A'));
    await w.close();
    const full = readFileSync(path);
    const cut = join(dir, 'b-cut.gt7rec');
    writeFileSync(cut, full.subarray(0, Math.floor(full.length * 0.6)));
    const { header, records } = await loadRecording(cut);
    expect(header.format).toBe('A');
    expect(records.length).toBeGreaterThan(0);
    expect(records.length).toBeLessThan(1000);
    for (const rec of records) expect(rec.data.byteLength).toBe(296);
  });

  it('rejects files that are not recordings', async () => {
    const path = join(dir, 'c.gt7rec');
    writeFileSync(path, 'hello');
    await expect(RecordingReader.open(path)).rejects.toThrow();
  });
});
