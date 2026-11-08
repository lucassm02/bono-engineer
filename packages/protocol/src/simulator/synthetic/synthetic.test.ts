import { decodeFlags, isDriving, type TelemetryPacket } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { CAR, generateLaps, getSyntheticTrack, SyntheticSession } from './index.ts';

const LAPS = 4;
const pro = generateLaps({ profile: 'pro', laps: LAPS, seed: 1 });
const amateur = generateLaps({ profile: 'amateur', laps: LAPS, seed: 1 });

function lapPackets(packets: TelemetryPacket[], lap: number): TelemetryPacket[] {
  return packets.filter((p) => p.lapCount === lap);
}

describe('synthetic track', () => {
  const track = getSyntheticTrack();

  it('is a closed 3.5–4.5 km circuit with ~10 varied corners', () => {
    expect(track.lengthM).toBeGreaterThan(3500);
    expect(track.lengthM).toBeLessThan(4500);
    expect(track.corners.length).toBe(10);
    const kinds = new Set(track.corners.map((c) => c.kind));
    expect(kinds.has('hairpin')).toBe(true);
    expect(kinds.has('chicane')).toBe(true);
    expect(kinds.has('fast')).toBe(true);
    const first = track.samples[0]!;
    const last = track.samples.at(-1)!;
    expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeLessThan(3);
    for (const c of track.corners) {
      expect(c.entryM).toBeLessThan(c.apexM);
      expect(c.apexM).toBeLessThan(c.exitM);
    }
  });

  it('has gentle elevation changes', () => {
    const ys = track.samples.map((s) => s.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(40);
  });
});

describe('synthetic generator', () => {
  it('produces plausible lap times; pro is 2–6% faster than amateur', () => {
    expect(pro.laps.length).toBe(LAPS);
    expect(amateur.laps.length).toBe(LAPS);
    for (const l of [...pro.laps, ...amateur.laps]) {
      expect(l.timeMs).toBeGreaterThan(60_000);
      expect(l.timeMs).toBeLessThan(150_000);
    }
    const best = (ls: { timeMs: number }[]) => Math.min(...ls.map((l) => l.timeMs));
    const mean = (ls: { timeMs: number }[]) => ls.reduce((a, l) => a + l.timeMs, 0) / ls.length;
    const gapBest = best(amateur.laps) / best(pro.laps) - 1;
    const gapMean = mean(amateur.laps) / mean(pro.laps) - 1;
    expect(gapBest).toBeGreaterThan(0.02);
    expect(gapBest).toBeLessThan(0.06);
    expect(gapMean).toBeGreaterThan(0.02);
    expect(gapMean).toBeLessThan(0.065);
  });

  it('pro laps are consistent, amateur laps vary', () => {
    const spread = (ls: { timeMs: number }[]) =>
      Math.max(...ls.map((l) => l.timeMs)) - Math.min(...ls.map((l) => l.timeMs));
    expect(spread(pro.laps)).toBeLessThan(150);
    expect(spread(amateur.laps)).toBeGreaterThan(spread(pro.laps));
  });

  it('keeps values in physical bounds', () => {
    for (const p of [...pro.packets, ...amateur.packets]) {
      expect(p.speedMps).toBeGreaterThanOrEqual(0);
      expect(p.speedMps).toBeLessThanOrEqual(CAR.topSpeedMps + 0.5);
      expect(Number.isInteger(p.throttle)).toBe(true);
      expect(Number.isInteger(p.brake)).toBe(true);
      expect(p.throttle).toBeGreaterThanOrEqual(0);
      expect(p.throttle).toBeLessThanOrEqual(255);
      expect(p.brake).toBeGreaterThanOrEqual(0);
      expect(p.brake).toBeLessThanOrEqual(255);
      expect(p.gear).toBeGreaterThanOrEqual(1);
      expect(p.gear).toBeLessThanOrEqual(7);
      expect(p.engineRpm).toBeLessThanOrEqual(CAR.limiterRpm);
      expect(isDriving(p.flags)).toBe(true);
    }
    const speeds = pro.packets.map((p) => p.speedMps * 3.6);
    expect(Math.max(...speeds)).toBeGreaterThan(230);
    expect(Math.min(...lapPackets(pro.packets, 2).map((p) => p.speedMps * 3.6))).toBeLessThan(80);
  });

  it('increments packetId and lapCount and reports lap times', () => {
    const ps = pro.packets;
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i]!.packetId).toBe(ps[i - 1]!.packetId + 1);
      const d = ps[i]!.lapCount - ps[i - 1]!.lapCount;
      expect(d === 0 || d === 1).toBe(true);
    }
    expect(ps[0]!.lapCount).toBe(0);
    expect(ps.at(-1)!.lapCount).toBe(LAPS + 1);
    expect(ps.at(-1)!.lastLapMs).toBe(pro.laps.at(-1)!.timeMs);
    expect(ps.at(-1)!.bestLapMs).toBe(Math.min(...pro.laps.map((l) => l.timeMs)));
    expect(lapPackets(ps, 1)[0]!.lastLapMs).toBe(-1);
    // C format current lap timer restarts at each lap
    const lap2 = lapPackets(ps, 2);
    expect(lap2[0]!.currentLapMs!).toBeLessThan(40);
    expect(lap2.at(-1)!.currentLapMs!).toBeGreaterThan(pro.laps[1]!.timeMs - 40);
  });

  it('lap duration in packets matches the reported lap time (60 Hz)', () => {
    const n = lapPackets(pro.packets, 2).length;
    expect(Math.abs(n / 60 - pro.laps[1]!.timeMs / 1000)).toBeLessThan(0.05);
  });

  it('is deterministic for a seed', () => {
    const again = generateLaps({ profile: 'amateur', laps: 1, seed: 1 });
    const first = generateLaps({ profile: 'amateur', laps: 1, seed: 1 });
    expect(again.packets.length).toBe(first.packets.length);
    expect(JSON.stringify(again.packets.slice(0, 3000))).toBe(
      JSON.stringify(first.packets.slice(0, 3000)),
    );
    const other = generateLaps({ profile: 'amateur', laps: 1, seed: 2 });
    expect(other.laps[0]!.timeMs).not.toBe(first.laps[0]!.timeMs);
  });

  it('pro trail-brakes, amateur coasts', () => {
    const overlap = (ps: TelemetryPacket[]) =>
      ps.filter((p) => p.brake > 25 && Math.abs(p.steeringAngle ?? 0) > 0.4).length;
    const coast = (ps: TelemetryPacket[]) => ps.filter((p) => p.brake < 3 && p.throttle < 3).length;
    const p2 = lapPackets(pro.packets, 2);
    const a2 = lapPackets(amateur.packets, 2);
    expect(overlap(p2)).toBeGreaterThan(overlap(a2) * 2);
    expect(coast(a2)).toBeGreaterThan(coast(p2) * 3);
  });

  it('warms up tyres and burns fuel', () => {
    const first = pro.packets[0]!;
    const last = pro.packets.at(-1)!;
    expect(Math.min(...last.tyreTemp)).toBeGreaterThan(Math.max(...first.tyreTemp));
    expect(Math.max(...last.tyreTemp)).toBeLessThan(120);
    const l2 = lapPackets(pro.packets, 2);
    const used = l2[0]!.fuelLevel - l2.at(-1)!.fuelLevel;
    expect(used).toBeGreaterThan(1.5);
    expect(used).toBeLessThan(4);
  });

  it('emits menu and loading packets before going on track', () => {
    const s = new SyntheticSession({ includeMenu: true, menuS: 1, loadingS: 0.5 });
    const ps = Array.from({ length: 120 }, () => s.next());
    expect(decodeFlags(ps[0]!.flags).paused).toBe(true);
    expect(decodeFlags(ps[0]!.flags).carOnTrack).toBe(false);
    expect(decodeFlags(ps[70]!.flags).loadingOrProcessing).toBe(true);
    expect(ps[0]!.speedMps).toBe(0);
    expect(isDriving(ps[119]!.flags)).toBe(true);
  });

  it('replay mode smooths inputs and does not consume fuel', () => {
    const live = generateLaps({ profile: 'pro', laps: 1, seed: 4 });
    const rep = generateLaps({ profile: 'pro', laps: 1, seed: 4, replay: true });
    const jumps = (ps: TelemetryPacket[]) =>
      ps.slice(1).reduce((m, p, i) => Math.max(m, Math.abs(p.brake - ps[i]!.brake)), 0);
    expect(jumps(rep.packets)).toBeLessThan(jumps(live.packets));
    expect(rep.packets.at(-1)!.fuelLevel).toBe(rep.packets[0]!.fuelLevel);
  });
});
