import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gt7Runtime, type SeedResult, seedSyntheticData } from '@gt7/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGt7McpServer } from './server.ts';

let dir: string;
let rt: Gt7Runtime;
let seed: SeedResult;
let client: Client;
let trackId: string;

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}
const json = (res: CallToolResult) => {
  const c = res.content[0];
  if (c?.type !== 'text') throw new Error('not text');
  return JSON.parse(c.text);
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gt7-mcp-tasks-'));
  rt = new Gt7Runtime({ dataDir: dir, record: false });
  seed = await seedSyntheticData(rt, [{ profile: 'amateur', laps: 2, seed: 4 }]);
  trackId = seed.trackId!;
  const server = createGt7McpServer({ store: rt.store, analysis: rt.analysis, tasks: rt.tasks });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(ct);
}, 60_000);

afterAll(async () => {
  await client?.close();
  await rt?.close();
  rmSync(dir, { recursive: true, force: true });
});

const BRAKE = { action: 'brake', amount: 'm20', comparator: 'later' };

describe('MCP tools for the engineer tasks', () => {
  it('lists the five tools; only the dictionary and the list are read-only', async () => {
    const { tools } = await client.listTools();
    const by = (n: string) => tools.find((t) => t.name === n);
    expect(by('get_task_dictionary')?.annotations?.readOnlyHint).toBe(true);
    expect(by('list_engineer_tasks')?.annotations?.readOnlyHint).toBe(true);
    for (const n of ['propose_engineer_task', 'update_engineer_task', 'withdraw_engineer_task']) {
      expect(by(n)?.annotations?.readOnlyHint, n).toBe(false);
    }
    expect(by('withdraw_engineer_task')?.annotations?.destructiveHint).toBe(true);
  });

  it('shows the dictionary the server composes from', async () => {
    const d = json(await call('get_task_dictionary'));
    expect(d.version).toBe(1);
    expect(Object.keys(d.actions.stems)).toEqual(['brake', 'throttle', 'steer', 'enter']);
    expect(d.examples.length).toBeGreaterThanOrEqual(5);
  });

  it('composes the sentence and keeps a proposal for the driver; a dry run creates nothing', async () => {
    const dry = json(
      await call('propose_engineer_task', {
        track_id: trackId,
        where: { corner: 1, phase: 'entry' },
        say: BRAKE,
        dry_run: true,
      }),
    );
    expect(dry).toMatchObject({ ok: true, dryRun: true });
    expect(dry.taskId).toBeUndefined();
    expect(dry.spoken['pt-BR']).toBe('Foco. Na T1, entrada. Freie vinte metros mais tarde.');
    expect(rt.tasks.list()).toHaveLength(0);

    const made = json(
      await call('propose_engineer_task', {
        track_id: trackId,
        where: { corner: 1, phase: 'entry' },
        say: BRAKE,
        why: 'perde 0,12 s na entrada da T1',
        agent: 'claude-code',
      }),
    );
    expect(made).toMatchObject({ ok: true, status: 'proposed' });
    const stored = rt.store.getTask(made.taskId)!;
    expect(stored).toMatchObject({
      status: 'proposed',
      source: 'agent',
      agent: 'claude-code',
      carCode: null,
    });
    expect(stored.why).toBe('perde 0,12 s na entrada da T1');
    // not spoken before the approval
    expect(rt.store.getActiveTasks(trackId, null)).toEqual([]);

    const list = json(await call('list_engineer_tasks', { track_id: trackId }));
    expect(list.tasks).toHaveLength(1);
    expect(list.tasks[0]).toMatchObject({
      id: made.taskId,
      status: 'proposed',
      spoken: 'Foco. Na T1, entrada. Freie vinte metros mais tarde.',
    });
  });

  it('turns a position in metres into the place, and refuses what the dictionary cannot say', async () => {
    const atM = json(
      await call('propose_engineer_task', {
        track_id: trackId,
        where: { atM: 1500 },
        say: { action: 'gearUp', gear: 4 },
        dry_run: true,
      }),
    );
    expect(atM.ok).toBe(true);
    expect(JSON.stringify(atM.where)).toMatch(/corner|between|after/);

    const bad = await call('propose_engineer_task', {
      track_id: trackId,
      where: { corner: 1 },
      say: { action: 'dance' },
    });
    expect(bad.isError).toBe(true);
    expect(json(bad).valid).toContain('brake');
    expect(rt.store.listTaskMisses()[0]).toMatchObject({ group: 'invalidAction' });

    const two = await call('propose_engineer_task', {
      track_id: trackId,
      where: { corner: 1, sector: 2 },
      say: BRAKE,
    });
    expect(two.isError).toBe(true);
    expect(
      (await call('propose_engineer_task', { track_id: 'nope', where: { corner: 1 }, say: BRAKE }))
        .isError,
    ).toBe(true);
  });

  it('lets the agent edit and withdraw an open proposal, but never a decided task', async () => {
    const made = json(
      await call('propose_engineer_task', {
        track_id: trackId,
        where: { corner: 2 },
        say: { action: 'dose' },
      }),
    );
    const edited = json(
      await call('update_engineer_task', {
        task_id: made.taskId,
        say: { action: 'progressive', purpose: 'traction' },
        why: 'saída patina',
      }),
    );
    expect(edited.task.spoken).toBe(
      'Foco. Na T2. Acelere de forma progressiva, para ganhar tração.',
    );
    expect(edited.task.why).toBe('saída patina');

    expect(json(await call('withdraw_engineer_task', { task_id: made.taskId }))).toEqual({
      ok: true,
    });
    expect(rt.store.getTask(made.taskId)).toBeNull();

    const kept = json(
      await call('propose_engineer_task', {
        track_id: trackId,
        where: { corner: 2 },
        say: { action: 'dose' },
      }),
    );
    rt.tasks.setStatus(kept.taskId, 'active');
    const locked = await call('update_engineer_task', { task_id: kept.taskId, note: 'x' });
    expect(locked.isError).toBe(true);
    expect((await call('withdraw_engineer_task', { task_id: kept.taskId })).isError).toBe(true);
    expect(rt.store.getTask(kept.taskId)?.status).toBe('active');
  });

  it('credits the proposal to the in-app coach when the server is made for it', async () => {
    const server = createGt7McpServer({
      store: rt.store,
      analysis: rt.analysis,
      tasks: rt.tasks,
      taskSource: 'coach',
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const c2 = new Client({ name: 'coach', version: '0.0.0' });
    await c2.connect(ct);
    const res = (await c2.callTool({
      name: 'propose_engineer_task',
      arguments: { track_id: trackId, where: { corner: 3 }, say: { action: 'trailBrake' } },
    })) as CallToolResult;
    expect(rt.store.getTask(json(res).taskId)?.source).toBe('coach');
    await c2.close();
  });
});
