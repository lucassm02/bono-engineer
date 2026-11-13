import { generateLaps } from '@gt7/protocol';
import type { LiveFrame, LiveTask } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { LiveEngine } from './live-engine.ts';

const FRAME_MS = 1000 / 60;
const T0 = 1_700_000_000_000;

const TASK: LiveTask = {
  id: 'task-1',
  keys: ['Foco.', 'Na T1, entrada.'],
  atM: [400],
  text: 'Foco. Na T1, entrada.',
  note: null,
};

class TaskContext extends MemoryEngineContext {
  tasks: LiveTask[] = [];
  reads = 0;
  getLiveTasks(): LiveTask[] {
    this.reads++;
    return this.tasks;
  }
}

describe('engineer tasks in the live frame', () => {
  const gen = generateLaps({ profile: 'pro', seed: 11, laps: 3, format: 'A' });

  it('carries the active tasks once the track is known, and reads again only after a refresh', () => {
    const ctx = new TaskContext({ idFactory: sequentialIds('t') });
    const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('x') });
    const frames: LiveFrame[] = [];
    engine.on('frame', (f) => frames.push(f));
    let laps = 0;
    engine.on('lapCompleted', () => {
      laps++;
      if (laps === 1) {
        ctx.tasks = [TASK];
        engine.refreshTasks();
      }
    });
    for (const [i, p] of gen.packets.entries()) engine.push(p, T0 + i * FRAME_MS);

    expect(frames.some((f) => f.tasks === undefined)).toBe(true);
    const withTasks = frames.filter((f) => f.tasks);
    expect(withTasks.length).toBeGreaterThan(100);
    expect(withTasks[0]!.tasks).toEqual([TASK]);
    // cached: not one read per frame
    expect(ctx.reads).toBeLessThan(10);
  });
});
