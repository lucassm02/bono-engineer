import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type SeedResult, seedSyntheticData } from '../dev/seed.ts';
import { Gt7Runtime } from '../runtime/runtime.ts';
import { AnalysisError, CORNER_SIGNATURE_KEY, carryOverNames } from './analysis-service.ts';
import { AnalysisCornerHintProvider } from './corner-hints.ts';

const DAY = 24 * 3600_000;
const BASE = new Date(2026, 9, 1, 12).getTime();

let dir: string;
let rt: Gt7Runtime;
let seed: SeedResult;
let amateurDay1: string[];
let amateurDay3: string[];
let otherCarLap: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gt7-analysis-svc-'));
  rt = new Gt7Runtime({ dataDir: dir, record: false });
  seed = await seedSyntheticData(rt, [
    { profile: 'amateur', laps: 3, seed: 4, startAt: BASE },
    {
      profile: 'pro',
      laps: 1,
      seed: 9,
      reference: { driverName: 'Top 1' },
      startAt: BASE + 3600_000,
    },
    { profile: 'amateur', laps: 3, seed: 5, startAt: BASE + 2 * DAY },
    { profile: 'pro', laps: 1, seed: 11, startAt: BASE + 2 * DAY + 3600_000, carCode: 4321 },
  ]);
  amateurDay1 = seed.sessions[0]!.lapIds;
  amateurDay3 = seed.sessions[2]!.lapIds;
  otherCarLap = seed.sessions[3]!.lapIds[0]!;
}, 60_000);

afterAll(async () => {
  await rt.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('AnalysisService', () => {
  it('detects and persists the corners of a new track after its first lap', async () => {
    expect(seed.trackId).toBeTruthy();
    expect(seed.referenceLapId).toBeTruthy();
    const track = rt.store.getTrack(seed.trackId!)!;
    expect(track.corners).toHaveLength(10);
    expect(track.corners.map((c) => c.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `T${i + 1}`),
    );
    expect(track.corners[0]!.kind).toBe('hairpin');
    expect(rt.store.getSetting(`${CORNER_SIGNATURE_KEY}${track.id}`)).toMatchObject({ v: 1 });
    // the live engine got the corners too (refreshTrack after detection)
    expect(rt.engine.trackInfo).toBeNull(); // session ended → active track forgotten
    // idempotent: a second call does not re-detect
    const again = await rt.analysis.ensureTrackCorners(track.id);
    expect(again.detected).toBe(false);
  });

  it('keeps user corner names when corners are re-detected', async () => {
    const trackId = seed.trackId!;
    rt.analysis.renameCorner(trackId, 'T1', 'Grampo');
    const res = await rt.analysis.ensureTrackCorners(trackId, { force: true });
    expect(res.detected).toBe(true);
    expect(res.corners[0]!.name).toBe('Grampo');
    expect(res.corners.filter((c) => c.name)).toHaveLength(1);
    // pure helper: nearest apex, same direction only
    const prev = [{ ...res.corners[1]!, apexM: res.corners[1]!.apexM + 20, name: 'X' }];
    expect(carryOverNames(res.corners, prev, 4000)[1]!.name).toBe('X');
    rt.analysis.renameCorner(trackId, 'T1', null);
  });

  it('compares an amateur lap with the captured pro replay (expected findings)', async () => {
    const r = await rt.analysis.compareLaps(amateurDay1[0]!, 'bestReference');
    expect(r.referenceKind).toBe('bestReference');
    expect(r.referenceLap.id).toBe(seed.referenceLapId);
    const cmp = r.comparison;
    expect(cmp.referenceIsReplay).toBe(true);
    expect(cmp.totalDeltaMs).toBeGreaterThan(2000);
    expect(cmp.totalDeltaMs).toBe(r.lap.timeMs - r.referenceLap.timeMs);
    expect(cmp.rows).toHaveLength(10);
    expect(cmp.topLosses).toHaveLength(3);
    expect(cmp.keyFindings!.length).toBeGreaterThan(3);
    const kinds = new Set(cmp.findings!.map((f) => f.kind));
    // the synthetic amateur brakes early, releases before turning and coasts
    expect(kinds.has('brakeEarlier')).toBe(true);
    expect(kinds.has('noTrailBraking') || kinds.has('coasting')).toBe(true);
    expect(cmp.warnings.some((w) => w.includes('replay'))).toBe(true);
    expect(r.markdown).toContain('## Comparação');
    expect(JSON.stringify(r.summary).length).toBeLessThan(6000);
    expect(r.summary).toMatchObject({ refDriver: 'Top 1', sameCar: true });
  });

  it('resolves symbolic references and validates the arguments', async () => {
    const lap = amateurDay3[1]!;
    const auto = await rt.analysis.compareLaps(lap, 'auto');
    expect(auto.referenceLap.id).toBe(seed.referenceLapId);
    const pb = rt.analysis.resolveReference(lap, 'personalBest')!;
    expect(pb.isReference).toBe(false);
    expect(pb.id).not.toBe(lap);
    const sb = rt.analysis.resolveReference(lap, 'sessionBest')!;
    expect(amateurDay3).toContain(sb.id);
    await expect(rt.analysis.compareLaps(lap, lap)).rejects.toBeInstanceOf(AnalysisError);
    await expect(rt.analysis.compareLaps('nope', 'auto')).rejects.toMatchObject({
      code: 'notFound',
    });
  });

  it('warns when the cars differ', async () => {
    const r = await rt.analysis.compareLaps(otherCarLap, amateurDay1[0]!);
    expect(r.comparison.warnings[0]).toMatch(/Carros diferentes/);
    expect(r.summary).toMatchObject({ sameCar: false });
  });

  it('caches prepared laps and comparisons; corner renames invalidate', async () => {
    const lap = amateurDay1[1]!;
    const before = rt.analysis.cacheStats.comparisons;
    const a = await rt.analysis.compareLaps(lap, 'bestReference');
    const b = await rt.analysis.compareLaps(lap, 'bestReference');
    expect(b.comparison).toBe(a.comparison);
    const after = rt.analysis.cacheStats.comparisons;
    expect(after.misses).toBe(before.misses + 1);
    expect(after.hits).toBe(before.hits + 1);
    rt.analysis.renameCorner(seed.trackId!, 'T8', 'Curva do Lago');
    const c = await rt.analysis.compareLaps(lap, 'bestReference');
    expect(c.comparison).not.toBe(a.comparison);
    expect(c.comparison.rows[7]!.corner.name).toBe('Curva do Lago');
    expect(rt.analysis.cacheStats.prepared.hits).toBeGreaterThan(0);
  });

  it('lap analysis: metrics, validity and AI summary', async () => {
    const la = await rt.analysis.getLapAnalysis(amateurDay1[0]!);
    expect(la.metrics).toHaveLength(10);
    expect(la.validity.valid).toBe(true);
    expect(la.sectorStartsM).toHaveLength(3);
    expect(la.summary).toMatchObject({ lapId: amateurDay1[0] });
  });

  it('track analysis: map, corners with positions, sectors and records', async () => {
    const ta = await rt.analysis.getTrackAnalysis(seed.trackId!, { maxMapPoints: 300 });
    expect(ta.map!.x.length).toBeLessThanOrEqual(300);
    expect(ta.corners.every((c) => Number.isFinite(c.apexX))).toBe(true);
    expect(ta.sectors).toHaveLength(3);
    expect([seed.referenceLapId, otherCarLap]).toContain(ta.records.overallBestLapId);
    expect(ta.records.references).toHaveLength(1);
    expect(ta.records.cars.length).toBe(2);
    expect(ta.lapCount).toBe(8);
  });

  it('consistency, microsectors, traces, chart data and delta', async () => {
    const cons = await rt.analysis.getConsistency({ sessionId: seed.sessions[0]!.sessionId! });
    expect(cons.lapIds).toHaveLength(3);
    expect(cons.corners).toHaveLength(10);
    expect('metrics' in cons).toBe(false);

    const ms = await rt.analysis.getMicrosectors(amateurDay1, {
      referenceLapId: seed.referenceLapId!,
    });
    expect(ms.report.laps).toHaveLength(4);
    expect(ms.report.theoreticalBestMs).toBeLessThanOrEqual(ms.report.bestLapMs);
    expect(ms.colors).toHaveLength(3);

    const tr = await rt.analysis.getResampledTrace(amateurDay1[0]!, {
      stepM: 1,
      maxPoints: 200,
      channels: ['speedKmh', 'deltaS'],
    });
    expect(tr.distanceM.length).toBeLessThanOrEqual(200);
    expect(Number.isFinite(tr.channels.deltaS!.at(-1)!)).toBe(true);

    const chart = await rt.analysis.getChartData([seed.referenceLapId!, amateurDay1[0]!], {
      cornerId: 't1',
      maxPoints: 150,
    });
    expect(chart.distanceM.length).toBeLessThanOrEqual(150);
    expect(chart.markers.some((m) => m.label.startsWith('T1'))).toBe(true);

    const d = await rt.analysis.getDeltaTrace(amateurDay1[0]!, seed.referenceLapId!);
    const r = rt.store.getLap(amateurDay1[0]!)!;
    const ref = rt.store.getLap(seed.referenceLapId!)!;
    expect(Math.abs(d.totalS * 1000 - (r.timeMs - ref.timeMs))).toBeLessThan(5);
  });

  it('evolution aggregates days and computes trends vs the reference', async () => {
    const ev = await rt.analysis.getEvolution(seed.trackId!);
    expect(ev.carCode).toBe(rt.store.getLap(amateurDay1[0]!)!.carCode);
    expect(ev.baseline).toMatchObject({ kind: 'reference', lapId: seed.referenceLapId });
    expect(ev.days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-03']);
    expect(ev.days[0]!.laps).toBe(3);
    expect(ev.days[0]!.corners).toHaveLength(10);
    expect(ev.days[0]!.gapToBaselineMs).toBeGreaterThan(0);
    expect(ev.days[0]!.corners[0]!.timeLostMs).not.toBeNull();
    expect(ev.trends[0]!.metric).toBe('lapTimeMs');
    expect(ev.trends[0]!.message).toMatch(/Melhor volta/);
  });

  it('AnalysisCornerHintProvider gives reference targets from the analysis metrics', async () => {
    const track = rt.store.getTrack(seed.trackId!)!;
    const lap = rt.store.getLap(seed.referenceLapId!)!;
    const trace = (await rt.store.loadTrace(lap.id))!;
    const provider = new AnalysisCornerHintProvider(rt.analysis);
    const t = provider.targetsFor({ track, corner: track.corners[0]!, reference: { lap, trace } })!;
    const la = await rt.analysis.getLapAnalysis(lap.id);
    expect(t.referenceBrakePointM).toBeCloseTo(la.metrics[0]!.brakePointM!, 3);
    expect(t.referenceMinSpeedKmh).toBeCloseTo(la.metrics[0]!.minSpeedKmh, 3);
    expect(t.referenceGearAtApex).toBe(la.metrics[0]!.gearAtApex);
    expect(t.referenceThrottleOnM).toBeCloseTo(la.metrics[0]!.throttlePickupM!, 3);
    expect(provider.targetsFor({ track, corner: track.corners[0]!, reference: null })).toBeNull();
  });
});
