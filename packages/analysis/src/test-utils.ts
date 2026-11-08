/**
 * Test helpers (not exported from the package): converts synthetic TelemetryPacket streams into
 * LapTrace objects following the LapSample definition in @gt7/shared domain.ts. Core has its own
 * production conversion; this one exists so analysis tests do not depend on core.
 */

import { type GeneratedSession, generateLaps } from '@gt7/protocol';
import {
  type LapSampleChannel,
  type LapTrace,
  pedalToUnit,
  type TelemetryPacket,
  wheelSlipRatios,
} from '@gt7/shared';

const G = 9.81;

const CHANNELS: LapSampleChannel[] = [
  'tMs',
  'distanceM',
  'packetId',
  'x',
  'y',
  'z',
  'speedKmh',
  'rpm',
  'gear',
  'throttle',
  'brake',
  'clutch',
  'steeringRad',
  'throttleRaw',
  'yawRate',
  'latG',
  'lonG',
  'vertG',
  'slipFL',
  'slipFR',
  'slipRL',
  'slipRR',
  'tyreTempFL',
  'tyreTempFR',
  'tyreTempRL',
  'tyreTempRR',
  'suspFL',
  'suspFR',
  'suspRL',
  'suspRR',
  'fuelL',
  'flags',
];

/** Converts the packets of ONE lap into a LapTrace (rate 60 Hz). */
export function packetsToLapTrace(
  packets: TelemetryPacket[],
  lapId: string,
  rateHz = 60,
): LapTrace {
  const n = packets.length;
  const ch = Object.fromEntries(CHANNELS.map((c) => [c, new Float64Array(n)])) as Record<
    LapSampleChannel,
    Float64Array
  >;
  let dist = 0;
  for (let i = 0; i < n; i++) {
    const p = packets[i]!;
    const prev = packets[i - 1];
    if (prev) dist += Math.hypot(p.position.x - prev.position.x, p.position.z - prev.position.z);
    const v = p.speedMps;
    const slips = wheelSlipRatios(p);
    const set = (c: LapSampleChannel, val: number) => {
      ch[c][i] = val;
    };
    set('tMs', p.currentLapMs ?? (i * 1000) / rateHz);
    set('distanceM', dist);
    set('packetId', p.packetId);
    set('x', p.position.x);
    set('y', p.position.y);
    set('z', p.position.z);
    set('speedKmh', v * 3.6);
    set('rpm', p.engineRpm);
    set('gear', p.gear);
    set('throttle', pedalToUnit(p.throttle));
    set('brake', pedalToUnit(p.brake));
    set('clutch', p.clutchPedal);
    set('steeringRad', p.steeringAngle ?? Number.NaN);
    set('throttleRaw', p.throttleRaw !== undefined ? pedalToUnit(p.throttleRaw) : Number.NaN);
    set('yawRate', p.angularVelocity.y);
    set('latG', p.sway ?? (v * p.angularVelocity.y) / G);
    const dv = prev ? ((p.speedMps - prev.speedMps) * rateHz) / G : 0;
    set('lonG', p.surge ?? dv);
    set('vertG', p.heave ?? Number.NaN);
    set('slipFL', slips[0]);
    set('slipFR', slips[1]);
    set('slipRL', slips[2]);
    set('slipRR', slips[3]);
    set('tyreTempFL', p.tyreTemp[0]);
    set('tyreTempFR', p.tyreTemp[1]);
    set('tyreTempRL', p.tyreTemp[2]);
    set('tyreTempRR', p.tyreTemp[3]);
    set('suspFL', p.suspensionHeight[0]);
    set('suspFR', p.suspensionHeight[1]);
    set('suspRL', p.suspensionHeight[2]);
    set('suspRR', p.suspensionHeight[3]);
    set('fuelL', p.fuelLevel);
    set('flags', p.flags);
  }
  return { lapId, sampleRateHz: rateHz, length: n, channels: ch };
}

/** Splits a synthetic session into complete flying laps (lapCount 1..N). */
export function packetsToLapTraces(
  packets: TelemetryPacket[],
  prefix: string,
  rateHz = 60,
): LapTrace[] {
  const byLap = new Map<number, TelemetryPacket[]>();
  for (const p of packets) {
    if (p.lapCount < 1) continue;
    let arr = byLap.get(p.lapCount);
    if (!arr) {
      arr = [];
      byLap.set(p.lapCount, arr);
    }
    arr.push(p);
  }
  const maxLap = Math.max(...byLap.keys());
  const out: LapTrace[] = [];
  for (const [lap, ps] of [...byLap.entries()].sort((a, b) => a[0] - b[0])) {
    if (lap === maxLap) continue; // the last lap is incomplete (single packet after crossing)
    out.push(packetsToLapTrace(ps, `${prefix}-${lap}`, rateHz));
  }
  return out;
}

/** Returns a copy of a trace with selected channel values replaced (for fault injection). */
export function mutateTrace(
  trace: LapTrace,
  fn: (ch: Record<LapSampleChannel, number[]>) => void,
): LapTrace {
  const ch = Object.fromEntries(
    Object.entries(trace.channels).map(([k, v]) => [k, Array.from(v as ArrayLike<number>)]),
  ) as Record<LapSampleChannel, number[]>;
  fn(ch);
  return { ...trace, length: ch.tMs.length, channels: ch };
}

// ---------------------------------------------------------------------------------------------
// Shared synthetic fixtures (lazy, cached per test process)
// ---------------------------------------------------------------------------------------------

export interface SyntheticFixture {
  session: GeneratedSession;
  traces: LapTrace[];
  lapTimesMs: number[];
  mistakes: string[][];
}

const cache = new Map<string, SyntheticFixture>();

/** Generates (once) a synthetic session and its lap traces. */
export function syntheticFixture(
  profile: 'amateur' | 'pro',
  laps: number,
  seed: number,
  replay = false,
): SyntheticFixture {
  const key = `${profile}-${laps}-${seed}-${replay}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const session = generateLaps({ profile, laps, seed, replay, format: replay ? 'B' : 'C' });
  const fx: SyntheticFixture = {
    session,
    traces: packetsToLapTraces(session.packets, `${profile}${replay ? 'R' : ''}${seed}`),
    lapTimesMs: session.laps.map((l) => l.timeMs),
    mistakes: session.laps.map((l) => l.mistakes),
  };
  cache.set(key, fx);
  return fx;
}
