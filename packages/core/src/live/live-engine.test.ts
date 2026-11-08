import { generateLaps, getSyntheticTrack } from '@gt7/protocol';
import { SimulatorFlags, type TelemetryPacket } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { type CompletedLap, type LapDiscardedInfo, LiveEngine } from './live-engine.ts';

const FRAME_MS = 1000 / 60;

interface Run {
  engine: LiveEngine;
  laps: CompletedLap[];
  discarded: LapDiscardedInfo[];
  /** per packet: [lapCount, distanceM, deltaMs, predictedLapMs, currentLapMs] sampled from snapshots */
  samples: {
    lap: number;
    dist: number | null;
    delta: number | null;
    predicted: number | null;
    t: number;
  }[];
}

function run(
  packets: TelemetryPacket[],
  engine: LiveEngine,
  opts: { sampleEvery?: number; t0?: number } = {},
): Run {
  const laps: CompletedLap[] = [];
  const discarded: LapDiscardedInfo[] = [];
  const samples: Run['samples'] = [];
  engine.on('lapCompleted', (l) => laps.push(l));
  engine.on('lapDiscarded', (d) => discarded.push(d));
  const every = opts.sampleEvery ?? 0;
  const t0 = opts.t0 ?? 1_700_000_000_000;
  packets.forEach((p, i) => {
    engine.push(p, t0 + i * FRAME_MS);
    if (every && i % every === 0) {
      const f = engine.snapshot();
      if (f)
        samples.push({
          lap: f.lap.lap,
          dist: f.distanceM,
          delta: f.lap.delta.ms,
          predicted: f.lap.predictedLapMs,
          t: f.lap.currentLapMs,
        });
    }
  });
  return { engine, laps, discarded, samples };
}

function newEngine(ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') })) {
  return new LiveEngine({ context: ctx, idFactory: sequentialIds('x') });
}

describe('LiveEngine lap timing', () => {
  const gen = generateLaps({ profile: 'pro', seed: 11, laps: 3, format: 'A' });

  it('closes every lap with the ground-truth time; packet count within 1 frame', () => {
    const r = run(gen.packets, newEngine());
    expect(r.laps.map((l) => l.lap.number)).toEqual([1, 2, 3]);
    r.laps.forEach((l, i) => {
      const truth = gen.laps[i]!.timeMs;
      expect(l.lap.timeMs).toBe(truth);
      expect(Math.abs(l.countedTimeMs - truth)).toBeLessThanOrEqual(17);
      expect(l.lap.valid).toBe(true);
      expect(l.lap.flags).toEqual([]);
    });
  });

  it('without lastLapMs, the counted time is used (within 1 frame)', () => {
    const stripped = gen.packets.map((p) => ({ ...p, lastLapMs: -1, bestLapMs: -1 }));
    const engine = new LiveEngine({ lapCloseWaitPackets: 5 });
    const r = run(stripped.concat(continuation(stripped, 10)), engine);
    expect(r.laps).toHaveLength(3);
    r.laps.forEach((l, i) => {
      expect(Math.abs(l.lap.timeMs - gen.laps[i]!.timeMs)).toBeLessThanOrEqual(17);
      expect(l.gameTimeMs).toBeNull();
    });
  });

  it('sectors sum to the lap time and the track is identified once', () => {
    const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
    const r = run(gen.packets, newEngine(ctx));
    expect(ctx.tracks.size).toBe(1);
    const track = [...ctx.tracks.values()][0]!;
    expect(track.name).toBe('Pista desconhecida 1');
    expect(Math.abs(track.lengthM - getSyntheticTrack().lengthM)).toBeLessThan(25);
    for (const l of r.laps) {
      expect(l.lap.sectorTimesMs).toHaveLength(3);
      const sum = l.lap.sectorTimesMs.reduce<number>((s, v) => s + (v ?? Number.NaN), 0);
      expect(sum).toBe(l.lap.timeMs);
      expect(l.lap.trackId).toBe(track.id);
    }
    // first lap: everything is a record
    expect(r.laps[0]!.event.sectorStatus).toEqual(['overallBest', 'overallBest', 'overallBest']);
    expect(r.laps.every((l) => l.event.sectorStatus.every((s) => s !== 'pending'))).toBe(true);
  });

  it('C format uses the game clock and matches as well', () => {
    const genC = generateLaps({ profile: 'pro', seed: 5, laps: 2, format: 'C' });
    const r = run(genC.packets, newEngine());
    expect(r.laps).toHaveLength(2);
    r.laps.forEach((l, i) => {
      expect(l.lap.timeMs).toBe(genC.laps[i]!.timeMs);
    });
  });
});

/** A few packets after the end so the lap-close wait can expire (same lap, increasing ids). */
function continuation(packets: TelemetryPacket[], n: number): TelemetryPacket[] {
  const last = packets.at(-1)!;
  return Array.from({ length: n }, (_, i) => ({ ...last, packetId: last.packetId + i + 1 }));
}

describe('LiveEngine delta', () => {
  const pro = generateLaps({ profile: 'pro', seed: 21, laps: 3, format: 'A' });

  it('delta vs itself is ~0 across the lap', () => {
    const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
    const first = run(pro.packets, newEngine(ctx));
    const lap2 = first.laps[1]!;
    const engine = newEngine(ctx);
    engine.setDeltaReference('reference', lap2.lap.id);
    const second = run(pro.packets, engine, { sampleEvery: 10 });
    const during = second.samples.filter((s) => s.lap === 2 && s.delta !== null);
    expect(during.length).toBeGreaterThan(400);
    const maxAbs = Math.max(...during.map((s) => Math.abs(s.delta!)));
    expect(maxAbs).toBeLessThan(25);
    expect(second.laps[1]!.event.deltaMs).toBe(0);
  });

  it('amateur vs pro: delta ends near the lap time difference, grows in braking zones', () => {
    const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
    const first = run(pro.packets, newEngine(ctx));
    const ref = first.laps[1]!;
    const am = generateLaps({ profile: 'amateur', seed: 7, laps: 2, format: 'A' });
    const engine = newEngine(ctx);
    engine.setDeltaReference('reference', ref.lap.id);
    const r = run(am.packets, engine, { sampleEvery: 1 });
    expect(ctx.tracks.size).toBe(1); // same track recognized
    const amLap1 = r.laps[0]!;
    const diff = amLap1.lap.timeMs - ref.lap.timeMs;
    expect(diff).toBeGreaterThan(1000);
    const lap1 = r.samples.filter((s) => s.lap === 1 && s.delta !== null);
    const end = lap1.at(-1)!;
    expect(Math.abs(end.delta! - diff)).toBeLessThan(150);
    expect(amLap1.event.deltaMs).toBe(diff);
    // predicted lap close to the actual near the end of the lap
    const late = lap1.filter((s) => s.dist !== null && s.dist > 0.985 * ref.lengthM);
    expect(late.length).toBeGreaterThan(5);
    for (const s of late) expect(Math.abs(s.predicted! - amLap1.lap.timeMs)).toBeLessThan(120);
    // braking zones: delta grows from 150 m before the corner entry to the entry
    const corners = getSyntheticTrack().corners;
    const at = (d: number) => {
      let best = lap1[0]!;
      for (const s of lap1) if (Math.abs(s.dist! - d) < Math.abs(best.dist! - d)) best = s;
      return best.delta!;
    };
    let growing = 0;
    for (const c of corners) if (at(c.entryM) - at(Math.max(5, c.entryM - 150)) > -5) growing++;
    expect(growing).toBeGreaterThanOrEqual(corners.length - 2);
  });
});

describe('LiveEngine robustness', () => {
  const gen = generateLaps({ profile: 'pro', seed: 31, laps: 3, format: 'A' });
  const lapStart = (n: number) => gen.packets.findIndex((p) => p.lapCount === n);

  it('pause mid-lap: flagged, invalid, time excludes the pause', () => {
    const k = lapStart(2) + 2000;
    const pausedFrames = 180;
    const out: TelemetryPacket[] = [];
    gen.packets.forEach((p, i) => {
      const shift = i > k ? pausedFrames : 0;
      out.push({ ...p, packetId: p.packetId + shift });
      if (i === k) {
        for (let j = 1; j <= pausedFrames; j++) {
          out.push({
            ...p,
            packetId: p.packetId + j,
            flags: p.flags | SimulatorFlags.Paused,
            speedMps: p.speedMps,
          });
        }
      }
    });
    const states: string[] = [];
    const engine = newEngine();
    engine.on('stateChanged', (s) => states.push(s));
    const r = run(out, engine);
    expect(states).toContain('paused');
    expect(r.laps).toHaveLength(3);
    const l2 = r.laps[1]!;
    expect(l2.lap.flags).toContain('paused');
    expect(l2.lap.valid).toBe(false);
    expect(Math.abs(l2.countedTimeMs - gen.laps[1]!.timeMs)).toBeLessThanOrEqual(17);
    expect(r.laps[2]!.lap.valid).toBe(true);
  });

  it('dropped packets: time still counted, lap flagged incomplete', () => {
    const k = lapStart(2) + 1500;
    const out = gen.packets.filter((_, i) => i < k || i >= k + 40);
    const r = run(out, newEngine());
    expect(r.laps).toHaveLength(3);
    const l2 = r.laps[1]!;
    expect(l2.lap.flags).toContain('incompleteData');
    expect(l2.lap.lostPackets).toBe(40);
    expect(Math.abs(l2.countedTimeMs - gen.laps[1]!.timeMs)).toBeLessThanOrEqual(17);
    expect(r.laps[0]!.lap.valid).toBe(true);
    expect(r.laps[2]!.lap.valid).toBe(true);
  });

  it('restart mid-lap discards the lap and keeps timing the next ones', () => {
    const cut = lapStart(1) + 1200;
    const second = generateLaps({
      profile: 'pro',
      seed: 32,
      laps: 2,
      format: 'A',
      firstPacketId: gen.packets[cut]!.packetId + 1,
    });
    const r = run(gen.packets.slice(0, cut + 1).concat(second.packets), newEngine());
    expect(r.discarded.some((d) => d.reason === 'restart' && d.lapNumber === 1)).toBe(true);
    expect(r.laps.map((l) => l.lap.timeMs)).toEqual(second.laps.map((l) => l.timeMs));
  });

  it('teleport mid-lap is flagged as discontinuity', () => {
    const k = lapStart(2) + 1000;
    const out = gen.packets.map((p, i) =>
      i >= k && i < k + 3 ? { ...p, position: { ...p.position, x: p.position.x + 400 } } : p,
    );
    const r = run(out, newEngine());
    expect(r.laps[1]!.lap.flags).toContain('discontinuity');
    expect(r.laps[1]!.lap.valid).toBe(false);
  });
});
