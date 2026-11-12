import { generateLaps } from '@gt7/protocol';
import { GOAL_CELEBRATION_MS, type Goal, type LiveFrame, type TelemetryPacket } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { type CompletedLap, LiveEngine } from './live-engine.ts';

const FRAME_MS = 1000 / 60;
const T0 = 1_700_000_000_000;

function drive(
  packets: TelemetryPacket[],
  engine: LiveEngine,
  ctx: MemoryEngineContext,
  goalFor: (laps: CompletedLap[]) => number | null,
) {
  const laps: CompletedLap[] = [];
  const frames: LiveFrame[] = [];
  engine.on('frame', (f) => frames.push(f));
  engine.on('lapCompleted', (l) => {
    laps.push(l);
    // the first lap creates the track: the goal is set right after it
    if (laps.length === 1) {
      const target = goalFor(laps);
      if (target !== null) {
        const goal: Goal = {
          id: 'goal-1',
          trackId: l.lap.trackId!,
          carCode: null,
          targetMs: target,
          createdAt: T0,
          achievedAt: null,
          achievedLapId: null,
        };
        ctx.goals.set(goal.id, goal);
        engine.refreshGoal();
      }
    }
  });
  for (const [i, p] of packets.entries()) engine.push(p, T0 + i * FRAME_MS);
  return { laps, frames };
}

describe('goal in the live engine', () => {
  const gen = generateLaps({ profile: 'pro', seed: 11, laps: 3, format: 'A' });
  const times = gen.laps.map((l) => l.timeMs);

  it('reaches the goal once, marks it and keeps it in the frame for the celebration', () => {
    const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
    const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('x') });
    const target = Math.max(times[1]!, times[2]!) + 1;
    const { laps, frames } = drive(gen.packets, engine, ctx, () => target);

    const reached = laps.filter((l) => l.event.goalReached);
    expect(reached).toHaveLength(1);
    expect(reached[0]!.lap.number).toBe(2);
    const stored = ctx.goals.get('goal-1')!;
    expect(stored.achievedLapId).toBe(reached[0]!.lap.id);
    expect(stored.achievedAt).not.toBeNull();

    const celebrating = frames.filter((f) => f.goal?.reachedLapMs != null);
    expect(celebrating.length).toBeGreaterThan(0);
    expect(celebrating[0]!.goal!.reachedLapMs).toBe(times[1]);
    expect(celebrating.every((f) => f.goal!.targetMs === target)).toBe(true);
    expect(GOAL_CELEBRATION_MS).toBeGreaterThan(0);
  });

  it('shows how far the lap is from the goal pace while driving, and never "reaches" a faster goal', () => {
    const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
    const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('x') });
    const target = Math.min(...times) - 2000;
    const { laps, frames } = drive(gen.packets, engine, ctx, () => target);

    expect(laps.some((l) => l.event.goalReached)).toBe(false);
    expect(ctx.goals.get('goal-1')!.achievedAt).toBeNull();
    // driving lap 2 slower than a goal pace 2 s faster: positive and growing towards ~2 s
    const lap2 = frames.filter((f) => f.lap.lap === 2 && f.goal?.deltaMs != null);
    expect(lap2.length).toBeGreaterThan(100);
    const last = lap2.at(-1)!.goal!.deltaMs!;
    expect(last).toBeGreaterThan(1200);
    expect(last).toBeLessThan(3200);
    expect(lap2[0]!.goal!.reachedLapMs).toBeNull();
  });

  it('has no goal block without a goal', () => {
    const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
    const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('x') });
    const { frames } = drive(gen.packets, engine, ctx, () => null);
    expect(frames.every((f) => f.goal === undefined)).toBe(true);
  });
});
