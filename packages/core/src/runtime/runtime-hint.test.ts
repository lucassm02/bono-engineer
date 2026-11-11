/**
 * Specs 05 and 06 at the runtime level: the track context travels in `status.sessionCapture`,
 * "Curvas prontas" is published when the corner detection ends, the hint is validated, and a
 * mismatch clears the caches of both tracks and reaches the listeners.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateLaps } from '@gt7/protocol';
import type { TelemetryPacket, TrackMismatchInfo } from '@gt7/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Gt7Runtime } from './runtime.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const FRAME_MS = 1000 / 60;
const drive = (seed: number, firstPacketId: number) =>
  generateLaps({ profile: 'pro', seed, laps: 2, format: 'A', outLapM: 300, firstPacketId });
const onOtherTrack = (p: TelemetryPacket): TelemetryPacket => ({
  ...p,
  position: { x: p.position.x * 1.6 + 2500, y: p.position.y, z: p.position.z * 1.6 - 800 },
});

function makeRuntime() {
  const dir = mkdtempSync(join(tmpdir(), 'gt7-runtime-hint-'));
  const runtime = new Gt7Runtime({ dataDir: join(dir, 'data'), record: false });
  cleanups.push(async () => {
    await runtime.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let t = 1_700_000_000_000;
  const feed = (ps: TelemetryPacket[]) => {
    for (const p of ps) {
      t += FRAME_MS;
      runtime.engine.push(p, t);
    }
  };
  return { runtime, feed };
}

describe('Gt7Runtime: contexto da pista e "Pista de hoje"', () => {
  it('o status traz a pista, a confiança e "curvas prontas" depois da análise', async () => {
    const { runtime, feed } = makeRuntime();
    expect(runtime.getSessionCapture().track).toMatchObject({ basis: 'none', hint: null });
    const a = drive(61, 1000);
    feed(a.packets.slice(0, 5));
    expect(runtime.getSessionCapture().track?.learning?.stage).toBe(1);
    feed(a.packets.slice(5));
    await runtime.whenAnalysisIdle();
    const track = runtime.getStatus().sessionCapture?.track;
    expect(track).toMatchObject({ confidence: 'confirmed', basis: 'lap', corners: 'ready' });
    expect(track?.name).toMatch(/^Pista desconhecida/);
    expect(runtime.getSessionCurrent()).toMatchObject({
      session: { id: runtime.session!.id },
      track: { trackId: track?.trackId },
    });
  });

  it('valida a pista da dica e publica o status', () => {
    const { runtime } = makeRuntime();
    const statuses = vi.fn();
    runtime.on('status', statuses);
    expect(() => runtime.setTrackHint('naoexiste')).toThrow(/não encontrada/);
    expect(runtime.engine.trackHint).toBeNull();
    expect(statuses).not.toHaveBeenCalled();
    runtime.store.insertTrack({
      id: 'x',
      name: 'Pista X',
      layout: null,
      fingerprint: {} as never,
      lengthM: 4000,
      centerline: null,
      sectorGates: [],
      corners: [],
      source: 'user',
      createdAt: 1,
      updatedAt: 1,
    });
    runtime.setTrackHint('x');
    expect(statuses).toHaveBeenCalled();
    expect(runtime.getSessionCurrent().track).toMatchObject({
      trackId: 'x',
      basis: 'hint',
      hint: { trackId: 'x' },
    });
    runtime.setTrackHint(null);
    expect(runtime.getSessionCurrent().track.hint).toBeNull();
  });

  it('uma divergência esvazia o cache das duas pistas e chega aos ouvintes', async () => {
    const { runtime, feed } = makeRuntime();
    const a = drive(61, 1000);
    feed(a.packets);
    const trackA = runtime.engine.track!.id;
    runtime.engine.endSession();
    const b = drive(62, a.packets.at(-1)!.packetId + 400);
    feed(b.packets.map(onOtherTrack));
    const trackB = runtime.engine.track!.id;
    runtime.engine.endSession();
    await runtime.whenAnalysisIdle();

    const invalidated: string[] = [];
    const original = runtime.analysis.invalidateTrack.bind(runtime.analysis);
    runtime.analysis.invalidateTrack = (id: string) => {
      invalidated.push(id);
      original(id);
    };
    const heard: TrackMismatchInfo[] = [];
    runtime.on('trackMismatch', (m) => heard.push(m));

    runtime.setTrackHint(trackA);
    feed(drive(63, b.packets.at(-1)!.packetId + 400).packets.map(onOtherTrack));
    await runtime.whenAnalysisIdle();

    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ hintedTrackId: trackA, detectedTrackId: trackB });
    expect(new Set(invalidated)).toEqual(new Set([trackA, trackB]));
    expect(runtime.session?.trackId).toBe(trackB);
    expect(runtime.getSessionCapture().track).toMatchObject({
      trackId: trackB,
      confidence: 'confirmed',
      hint: null,
    });
  });
});
