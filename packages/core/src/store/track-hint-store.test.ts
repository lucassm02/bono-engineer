/**
 * Spec 06 against the real SQLite store: a wrong "Pista de hoje" is reconciled in the database
 * (session, laps, records) without losing a lap, and no schema change was needed.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateLaps } from '@gt7/protocol';
import type { TelemetryPacket, TrackMismatchInfo } from '@gt7/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveEngine } from '../live/live-engine.ts';
import { sequentialIds } from '../util/ids.ts';
import { SCHEMA_VERSION } from './schema.ts';
import { Gt7Store } from './store.ts';
import { StoreEngineContext } from './store-context.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FRAME_MS = 1000 / 60;
const drive = (seed: number, firstPacketId: number) =>
  generateLaps({ profile: 'pro', seed, laps: 2, format: 'A', outLapM: 300, firstPacketId });
const onOtherTrack = (p: TelemetryPacket): TelemetryPacket => ({
  ...p,
  position: { x: p.position.x * 1.6 + 2500, y: p.position.y, z: p.position.z * 1.6 - 800 },
});

describe('Pista de hoje errada, no banco de verdade', () => {
  it('move a sessão e as voltas para a pista certa e os recordes acompanham', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gt7-hint-store-'));
    dirs.push(dir);
    const store = Gt7Store.open(dir);
    expect(store.schemaVersion).toBe(SCHEMA_VERSION); // nenhuma migração nova
    const engine = new LiveEngine({
      context: new StoreEngineContext(store, { idFactory: sequentialIds('t') }),
      idFactory: sequentialIds('s'),
    });
    const mismatches: TrackMismatchInfo[] = [];
    engine.on('trackMismatch', (m) => mismatches.push(m));
    let t = 1_700_000_000_000;
    const feed = (ps: TelemetryPacket[]) => {
      for (const p of ps) {
        t += FRAME_MS;
        engine.push(p, t);
      }
    };

    // circuit A, then circuit B (a session each), both saved
    const a = drive(61, 1000);
    feed(a.packets);
    const trackA = engine.track!.id;
    engine.endSession();
    const b = drive(62, a.packets.at(-1)!.packetId + 400);
    feed(b.packets.map(onOtherTrack));
    const trackB = engine.track!.id;
    engine.endSession();
    expect(store.listTracks()).toHaveLength(2);

    // the driver says A, but drives B
    engine.setTrackHint(trackA, { now: t });
    const c = drive(63, b.packets.at(-1)!.packetId + 400);
    feed(c.packets.map(onOtherTrack));

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ hintedTrackId: trackA, detectedTrackId: trackB });
    const sessionId = engine.session!.id;
    expect(store.getSession(sessionId)?.trackId).toBe(trackB);
    const laps = store.listLaps(sessionId);
    expect(laps).toHaveLength(2);
    expect(laps.every((l) => l.trackId === trackB)).toBe(true);
    // 2 laps of the first session on A are untouched; B has 2 + 2
    expect(store.listLapsForTrack(trackA)).toHaveLength(2);
    expect(store.listLapsForTrack(trackB)).toHaveLength(4);
    expect(store.getTrackRecords(trackB, laps[0]!.carCode, 3).personalBestLapMs).not.toBeNull();
    // asking again changes nothing
    expect(store.reassignSessionTrack(sessionId, trackB)).toBe(0);
    await store.close();
  });
});
