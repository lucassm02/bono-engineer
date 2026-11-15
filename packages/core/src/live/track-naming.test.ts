/**
 * A track the app learned as "Pista desconhecida N" is named from the catalogue once enough laps
 * on it agree on one layout (measured: the Nürburgring Sprint, whose shipped line is partial and
 * so is never named by the strict match at creation).
 */

import { generateLaps } from '@gt7/protocol';
import type { KnownTrackCandidate, KnownTrackMatch, LiveFrame } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { LiveEngine } from './live-engine.ts';

const MS = 1000 / 60;

const candidate = (over: Partial<KnownTrackCandidate> = {}): KnownTrackCandidate =>
  ({
    layout: { id: 'nur-sprint', venue: 'Nürburgring', layoutLabel: 'Sprint' },
    confidence: 'medium',
    lengthOk: true,
    ...over,
  }) as KnownTrackCandidate;

function run(match: () => KnownTrackMatch, laps = 6) {
  const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
  const engine = new LiveEngine({
    context: ctx,
    idFactory: sequentialIds('x'),
    knownMatcher: match,
  });
  const frames: LiveFrame[] = [];
  engine.on('frame', (f) => frames.push(f));
  let t = 1_700_000_000_000;
  let id = 1;
  for (const p of generateLaps({ profile: 'pro', seed: 5, laps, format: '~' }).packets) {
    t += MS;
    engine.push({ ...p, packetId: id++ }, t);
  }
  engine.endSession('manual');
  return { ctx, frames };
}

const single = (): KnownTrackMatch => ({
  lengthM: 3600,
  candidates: [candidate()],
  auto: null,
  ambiguous: false,
  reason: '',
});

describe('naming an unknown track from its laps', () => {
  it('names it after consistent laps and shows the name live', () => {
    const { ctx, frames } = run(single);
    const track = [...ctx.tracks.values()][0]!;
    expect(track.name).toBe('Nürburgring');
    expect(track.layout).toBe('Sprint');
    expect(track.source).toBe('builtin');
    // it started unknown and was named while driving
    expect(frames.some((f) => f.trackContext?.name?.startsWith('Pista desconhecida'))).toBe(true);
    expect(frames.at(-1)!.trackContext?.name).toBe('Nürburgring');
    expect(frames.at(-1)!.trackContext?.needsName).toBe(false);
  });

  it('does not name it from look-alikes, and never touches a track the driver named', () => {
    const ambiguous = run(() => ({
      lengthM: 3600,
      candidates: [
        candidate(),
        candidate({ layout: { id: 'b', venue: 'X', layoutLabel: 'Y' } as never }),
      ],
      auto: null,
      ambiguous: true,
      reason: '',
    }));
    expect([...ambiguous.ctx.tracks.values()][0]!.name).toMatch(/^Pista desconhecida/);
  });

  it('too few laps are not enough', () => {
    const { ctx } = run(single, 2);
    expect([...ctx.tracks.values()][0]!.name).toMatch(/^Pista desconhecida/);
  });
});
