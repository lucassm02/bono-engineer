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
  dir = mkdtempSync(join(tmpdir(), 'gt7-mcp-coach-'));
  rt = new Gt7Runtime({ dataDir: dir, record: false });
  seed = await seedSyntheticData(rt, [{ profile: 'amateur', laps: 4, seed: 4 }]);
  trackId = seed.trackId!;
  const server = createGt7McpServer({ store: rt.store, analysis: rt.analysis });
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

describe('MCP tools that expose goals, summaries, sectors, drills and the week', () => {
  it('lists the new tools as read-only', async () => {
    const { tools } = await client.listTools();
    for (const name of [
      'get_goal',
      'get_session_summary',
      'get_sectors',
      'list_corner_drills',
      'get_weekly_summary',
    ]) {
      const t = tools.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      expect(t!.annotations?.readOnlyHint).toBe(true);
    }
  });

  it('get_goal: no goal yet, then the active goal with how far it is', async () => {
    const before = json(await call('get_goal', { track_id: trackId }));
    expect(before.goal).toBeNull();
    expect(before.bestLap).toMatch(/^\d+:\d{2},\d{3}$|^\d+:\d{2}\.\d{3}$/);
    expect(before.suggestion).not.toBeNull();

    // A goal 2 s under the best lap: not reached, 2 s to go.
    const bestMs = rt.store.listLapsForTrack(trackId, { validOnly: true })[0]!.timeMs;
    rt.store.setGoal(trackId, null, bestMs - 2000);
    const after = json(await call('get_goal', { track_id: trackId }));
    expect(after.goal.reached).toBe(false);
    expect(after.goal.remaining_s).toBe(2);
    expect(after.goal.car).toBe('qualquer');
  });

  it('get_session_summary: defaults to the latest session and carries tips as sentences', async () => {
    const sum = json(await call('get_session_summary'));
    expect(sum.sessionId).toBe(seed.sessions[0]!.sessionId);
    expect(sum.laps.total).toBeGreaterThan(0);
    expect(sum.bestLap.time).toBeTruthy();
    expect(Array.isArray(sum.tips)).toBe(true);
    const missing = await call('get_session_summary', { session_id: 'nope' });
    expect(missing.isError).toBe(true);
  });

  it('get_sectors: best per sector and the ideal lap', async () => {
    const res = json(await call('get_sectors', { track_id: trackId }));
    expect(res.sectors.length).toBeGreaterThanOrEqual(2);
    expect(res.sectors[0]).toMatchObject({ sector: 1 });
    expect(res.idealLap).toBeTruthy();
    expect(res.gain_s).toBeGreaterThanOrEqual(0);
  });

  it('list_corner_drills: summarises the stored drills, newest first', async () => {
    const track = rt.store.getTrack(trackId)!;
    const corner = track.corners[0]!;
    const pass = (n: number, timeMs: number) => ({
      n,
      timeMs,
      entrySpeedKmh: 180,
      minSpeedKmh: 90,
      exitSpeedKmh: 140,
      brakePointM: 80,
      at: Date.now(),
    });
    rt.store.saveDrill({
      id: 'drill-1',
      sessionId: seed.sessions[0]!.sessionId,
      trackId: trackId,
      cornerId: corner.id,
      passes: [pass(1, 3600), pass(2, 3450), pass(3, 3500)],
      startedAt: Date.now() - 60_000,
      endedAt: Date.now() - 30_000,
      targetMs: 3400,
    });
    const res = json(await call('list_corner_drills', { track_id: trackId }));
    expect(res.drills).toHaveLength(1);
    expect(res.drills[0]).toMatchObject({
      corner: corner.id,
      passes: 3,
      best_s: 3.45,
      first_s: 3.6,
      last_s: 3.5,
      improvement_s: 0.15,
      target_s: 3.4,
    });
    const byCorner = json(
      await call('list_corner_drills', { track_id: trackId, corner_id: corner.id }),
    );
    expect(byCorner.drills).toHaveLength(1);
    const none = json(await call('list_corner_drills', { track_id: trackId, corner_id: 'T99' }));
    expect(none.drills).toEqual([]);
  });

  it('get_weekly_summary: this week has the seeded sessions and a shareable text; an old one is empty', async () => {
    const w = json(await call('get_weekly_summary'));
    expect(w.sessions).toBeGreaterThanOrEqual(1);
    expect(w.laps).toBeGreaterThan(0);
    expect(w.tracks[0]).toMatchObject({ trackId: trackId, firstTime: true });
    expect(w.shareableText).toContain('Minha semana no Bono');
    expect(w.shareableText).toContain('primeira vez');
    const old = json(await call('get_weekly_summary', { weeks_ago: 30 }));
    expect(old.sessions).toBe(0);
    expect(old.shareableText).toContain('Nenhuma volta nesta semana.');
  });
});
