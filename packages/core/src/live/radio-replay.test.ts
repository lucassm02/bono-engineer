/**
 * Radio decisions replayed from a recorded-like session: synthetic packets (deterministic for a
 * seed, out lap + flying laps) → LiveEngine frames → radio decision engine (@gt7/shared).
 */

import { generateLaps } from '@gt7/protocol';
import {
  DEFAULT_RADIO_PREFERENCES,
  type LiveFrame,
  type RadioDecision,
  RadioEngine,
  type RadioMode,
  radioEngineConfig,
  type TelemetryPacket,
} from '@gt7/shared';
import { FUEL_SHORT } from '@gt7/shared/radio-phrases';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { LiveEngine } from './live-engine.ts';

const FRAME_MS = 1000 / 60;
const T0 = 1_700_000_000_000;
const SESSION = generateLaps({ profile: 'pro', seed: 11, laps: 3, format: '~' });

function frames(packets: readonly TelemetryPacket[]): LiveFrame[] {
  const engine = new LiveEngine({
    context: new MemoryEngineContext({ idFactory: sequentialIds('t') }),
    idFactory: sequentialIds('x'),
  });
  const out: LiveFrame[] = [];
  packets.forEach((packet, i) => {
    engine.push(packet, T0 + i * FRAME_MS);
    const frame = engine.snapshot();
    if (frame) out.push(frame);
  });
  return out;
}

function replay(source: readonly LiveFrame[], mode: RadioMode): readonly RadioDecision[] {
  const radio = new RadioEngine({
    // Fixed durations: the replay must not depend on the voice packs.
    utteranceMs: (u) => (typeof u === 'string' ? 1200 : 900 + 500 * u.length),
    config: radioEngineConfig({ ...DEFAULT_RADIO_PREFERENCES, mode }),
  });
  for (const frame of source) radio.step(frame, { audio: 'ready' });
  return radio.log;
}

const spoken = (log: readonly RadioDecision[]) =>
  log.filter((d) => d.outcome === 'spoken').map((d) => `${d.ruleId}:${d.key}`);

describe('rádio em replay de sessão', () => {
  // A 30-lap race: the measured consumption does not reach the flag.
  const race = frames(SESSION.packets.map((p) => ({ ...p, totalLaps: 30 })));

  it('produces the same decisions, instants and phrases on every replay', () => {
    for (const mode of ['training', 'qualifying', 'race'] as const) {
      const first = replay(race, mode);
      expect(first.length).toBeGreaterThan(0);
      expect(replay(race, mode)).toEqual(first);
      // Re-deriving the frames from the packets gives the same log as well.
      expect(replay(frames(SESSION.packets.map((p) => ({ ...p, totalLaps: 30 }))), mode)).toEqual(
        first,
      );
    }
  });

  it('Corrida: cold tyres on the out lap, then the fuel projection, without a reference', () => {
    const log = replay(race, 'race');
    expect(spoken(log)).toEqual(['tyresWarmUp:cold', 'fuel:short']);
    const fuel = log.find((d) => d.ruleId === 'fuel' && d.outcome === 'spoken')!;
    expect(fuel.utterance).toBe(FUEL_SHORT);
    expect(fuel.evidence).toMatchObject({
      perLapL: expect.any(Number),
      raceLapsLeft: expect.any(Number),
    });
    expect(log.find((d) => d.ruleId === 'tyresWarmUp')).toMatchObject({ phase: 'outLap', lap: 0 });
  });

  it('Classificação: silent on the flying laps, the result after the line', () => {
    const log = replay(race, 'qualifying');
    const results = log.filter((d) => d.ruleId === 'lapResult');
    expect(results.length).toBeGreaterThan(0);
    for (const d of log.filter((d) => d.outcome === 'spoken' && d.phase === 'timedLap'))
      expect(d.ruleId === 'lapResult' || d.priority === 'critical').toBe(true);
  });

  it('time trial without consumption (fuel stays full): fuel rules stay silent', () => {
    const trial = frames(SESSION.packets.map((p) => ({ ...p, fuelLevel: 100, fuelCapacity: 100 })));
    const log = replay(trial, 'race');
    expect(log.filter((d) => d.ruleId === 'fuel').map((d) => d.outcome)).toEqual(['suppressed']);
  });
});
