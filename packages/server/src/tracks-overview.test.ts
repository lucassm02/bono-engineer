import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SeedResult, seedSyntheticData } from '@gt7/core';
import type { Lap, Session, Track } from '@gt7/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';
import {
  buildTrackOverview,
  buildTracksOverview,
  computeTrend,
  needsName,
  type TrackOverview,
  thumbnail,
} from './tracks-catalog.ts';

const track = (over: Partial<Track> = {}): Track => ({
  id: 't1',
  name: 'Pista desconhecida 1',
  layout: null,
  fingerprint: {} as Track['fingerprint'],
  lengthM: 5000,
  centerline: null,
  sectorGates: [],
  corners: [],
  source: 'auto',
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

const session = (id: string, startedAt: number, bestLapMs: number | null, over = {}): Session => ({
  id,
  trackId: 't1',
  carCode: 7,
  startedAt,
  endedAt: startedAt + 1000,
  format: 'B',
  mode: 'live',
  lapCount: 3,
  bestLapMs,
  recordingFile: null,
  ...over,
});

const lap = (id: string, sessionId: string, timeMs: number, over: Partial<Lap> = {}): Lap => ({
  id,
  sessionId,
  number: 1,
  timeMs,
  sectorTimesMs: [],
  valid: true,
  flags: [],
  isReference: false,
  referenceMeta: null,
  startedAt: 5000,
  carCode: 7,
  trackId: 't1',
  fuelUsedL: null,
  sampleCount: 10,
  lostPackets: 0,
  traceFile: null,
  ...over,
});

describe('tracks overview (pure)', () => {
  it('needsName only for automatic unknown names', () => {
    expect(needsName(track())).toBe(true);
    expect(needsName(track({ source: 'user' }))).toBe(false);
    expect(needsName(track({ name: 'Monza' }))).toBe(false);
  });

  it('thumbnail down-samples and rejects tiny lines', () => {
    const x = Array.from({ length: 1000 }, (_, i) => i);
    const t = thumbnail(x, x, 96)!;
    expect(t.x).toHaveLength(96);
    expect(t.x[0]).toBe(0);
    expect(thumbnail([1, 2], [1, 2])).toBeNull();
  });

  it('trend compares the last session with the previous one of the same car', () => {
    const a = session('a', 1000, 91000);
    const b = session('b', 2000, 90000);
    expect(computeTrend([a, b])).toMatchObject({ kind: 'improved', deltaMs: -1000, carCode: 7 });
    expect(computeTrend([b, session('c', 3000, 91500)])).toMatchObject({
      kind: 'worsened',
      deltaMs: 1500,
    });
    expect(computeTrend([a, session('d', 2000, 91010)]).kind).toBe('same');
    expect(computeTrend([a, session('e', 2000, 80000, { carCode: 9 })]).kind).toBe('none');
    expect(computeTrend([]).kind).toBe('none');
  });

  it('counts own laps only, keeps references apart and picks the best valid lap', () => {
    const laps = [
      lap('l1', 's1', 92000, { startedAt: 100 }),
      lap('l2', 's1', 90500, { startedAt: 200 }),
      lap('l3', 's1', 80000, { valid: false, startedAt: 300 }),
      lap('l4', 's2', 91000, { carCode: 9, startedAt: 400 }),
      lap('r1', 's3', 85000, { isReference: true, flags: ['replay'], startedAt: 500 }),
    ];
    const o = buildTrackOverview(track(), [session('s1', 100, 90500)], laps, null);
    expect(o.lapCount).toBe(4);
    expect(o.validLapCount).toBe(3);
    expect(o.best).toMatchObject({ lapId: 'l2', timeMs: 90500, carCode: 7 });
    expect(o.referenceCount).toBe(1);
    expect(o.bestReferenceMs).toBe(85000);
    expect(o.cars.map((c) => c.carCode)).toEqual([9, 7]);
    expect(o.cars.find((c) => c.carCode === 7)).toMatchObject({ laps: 3, bestMs: 90500 });
    expect(o.thumb).toBeNull();
    expect(o.sessionCount).toBe(1);
  });

  it('resolves carName/makerName from the catalogue and keeps carCode (unknown cars: null)', () => {
    const laps = [
      lap('l1', 's1', 90500, { carCode: 3337, startedAt: 200 }),
      lap('l2', 's1', 91000, { carCode: 999999, startedAt: 100 }),
    ];
    const o = buildTrackOverview(track(), [session('s1', 100, 90500)], laps, null);
    expect(o.best).toMatchObject({ carCode: 3337, carName: "A110 '17", makerName: 'Alpine' });
    const known = o.cars.find((c) => c.carCode === 3337);
    expect(known).toMatchObject({ carName: "A110 '17", makerName: 'Alpine' });
    const unknown = o.cars.find((c) => c.carCode === 999999);
    expect(unknown).toMatchObject({ carName: null, makerName: null });
    const t = computeTrend([session('a', 1000, 80000, { carCode: 3337 })]);
    expect(t).toMatchObject({ carCode: 3337, carName: "A110 '17" });
  });

  it('sorts tracks by most recent activity', () => {
    const t1 = track({ id: 'a', name: 'A' });
    const t2 = track({ id: 'b', name: 'B' });
    const out = buildTracksOverview({
      tracks: [t1, t2],
      sessions: [session('s1', 100, 1, { trackId: 'a' }), session('s2', 9000, 1, { trackId: 'b' })],
      lapsOf: (id) => [
        lap(`l-${id}`, `s-${id}`, 1000, { trackId: id, startedAt: id === 'a' ? 100 : 9000 }),
      ],
      centerlineOf: () => null,
    });
    expect(out.map((o) => o.id)).toEqual(['b', 'a']);
  });
});

const PORT = 46880;
const BASE = `http://127.0.0.1:${PORT}`;

describe('GET /api/tracks/overview', () => {
  let dir: string;
  let server: Gt7Server;
  let seed: SeedResult;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gt7-server-overview-'));
    server = await createApp({
      port: PORT,
      host: '127.0.0.1',
      webDist: null,
      firewall: { platform: 'linux' },
      hub: { keepAliveMs: 0 },
      runtime: { dataDir: join(dir, 'data'), record: false, persistConsoleIp: false },
      simulator: true,
    });
    seed = await seedSyntheticData(server.runtime, [
      { profile: 'amateur', laps: 3, seed: 4 },
      { profile: 'amateur', laps: 2, seed: 5 },
      { profile: 'pro', laps: 1, seed: 9, reference: { driverName: 'Líder Mundial' } },
    ]);
    await server.app.listen({ port: PORT, host: '127.0.0.1' });
  }, 90_000);

  afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns one card per track with thumbnail, best lap, trend and the demo flag', async () => {
    const res = await fetch(`${BASE}/api/tracks/overview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { simulator: boolean; tracks: TrackOverview[] };
    expect(body.simulator).toBe(true);
    expect(body.tracks).toHaveLength(1);
    const t = body.tracks[0]!;
    expect(t.id).toBe(seed.trackId);
    expect(t.needsName).toBe(true);
    expect(t.thumb?.x.length).toBeGreaterThan(20);
    expect(t.sessionCount).toBeGreaterThanOrEqual(2);
    expect(t.best?.timeMs).toBeGreaterThan(30_000);
    expect(t.referenceCount).toBe(1);
    expect(['improved', 'worsened', 'same', 'none']).toContain(t.trend.kind);
  });

  it('a rename confirms the name (needsName turns false)', async () => {
    const r = await fetch(`${BASE}/api/tracks/${seed.trackId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Autodromo Nazionale Monza', layout: 'Completo' }),
    });
    expect(r.status).toBe(200);
    const body = (await (await fetch(`${BASE}/api/tracks/overview`)).json()) as {
      tracks: TrackOverview[];
    };
    expect(body.tracks[0]).toMatchObject({
      name: 'Autodromo Nazionale Monza',
      layout: 'Completo',
      needsName: false,
      source: 'user',
    });
  });
});
