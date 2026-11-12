import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Gt7Store } from './store.ts';

const dirs: string[] = [];
function openStore(): Gt7Store {
  const d = mkdtempSync(join(tmpdir(), 'gt7-goals-'));
  dirs.push(d);
  return Gt7Store.open(d);
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('goals in the store', () => {
  it('keeps one active goal per track and car, and prefers the car-specific one', async () => {
    const store = openStore();
    store.setGoal('t1', null, 105_000, 1);
    expect(store.getActiveGoal('t1', 42)?.targetMs).toBe(105_000);

    store.setGoal('t1', 42, 104_000, 2);
    expect(store.getActiveGoal('t1', 42)?.targetMs).toBe(104_000);
    expect(store.getActiveGoal('t1', 7)?.targetMs).toBe(105_000);
    expect(store.getActiveGoal('t2', 42)).toBeNull();

    // replacing the goal of the same scope leaves one row, not two
    store.setGoal('t1', 42, 103_500.4, 3);
    expect(store.getActiveGoal('t1', 42)?.targetMs).toBe(103_500);
    const rows = store.db
      .prepare('SELECT count(*) AS c FROM goals WHERE track_id = ? AND car_code = ?')
      .get('t1', 42) as { c: number };
    expect(rows.c).toBe(1);
    await store.close();
  });

  it('marks a goal as reached once and moves it to the history', async () => {
    const store = openStore();
    const g = store.setGoal('t1', null, 105_000, 10);
    expect(store.markGoalAchieved(g.id, 'lap-1', 20)).toBe(true);
    expect(store.markGoalAchieved(g.id, 'lap-2', 30)).toBe(false);
    expect(store.getActiveGoal('t1', 1)).toBeNull();
    const history = store.listGoalHistory('t1');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ achievedAt: 20, achievedLapId: 'lap-1', targetMs: 105_000 });
    await store.close();
  });

  it('clears only the goal of the given scope and goes away with the track', async () => {
    const store = openStore();
    store.setGoal('t1', null, 105_000, 1);
    store.setGoal('t1', 42, 104_000, 2);
    expect(store.clearGoal('t1', 42)).toBe(true);
    expect(store.clearGoal('t1', 42)).toBe(false);
    expect(store.getActiveGoal('t1', 42)?.carCode).toBeNull();
    store.clearGoal('t1', null);
    expect(store.getActiveGoal('t1', 42)).toBeNull();
    await store.close();
  });
});
