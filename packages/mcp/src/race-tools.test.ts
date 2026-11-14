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
let sessionId: string;

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}
const json = (res: CallToolResult) => {
  const c = res.content[0];
  if (c?.type !== 'text') throw new Error('not text');
  return JSON.parse(c.text);
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gt7-mcp-race-'));
  rt = new Gt7Runtime({ dataDir: dir, record: false });
  seed = await seedSyntheticData(rt, [{ profile: 'amateur', laps: 2, seed: 4 }]);
  sessionId = rt.store.listSessions({ limit: 1 })[0]!.id;
  const s = rt.store.getSession(sessionId)!;
  rt.store.saveSession({
    ...s,
    kind: 'race',
    kindSource: 'auto',
    raceTotalLaps: 4,
    fieldSize: 15,
    startPosition: 3,
    finishPosition: 6,
  });
  rt.store.addSessionEvents([
    {
      id: 'p1',
      sessionId,
      at: 1,
      kind: 'position',
      lap: 1,
      distanceM: null,
      data: { from: 3, to: 10 },
    },
    {
      id: 'i1',
      sessionId,
      at: 2,
      kind: 'impact',
      lap: 2,
      distanceM: 812.4,
      data: { speedBeforeKmh: 178, speedAfterKmh: 162 },
    },
    {
      id: 'c1',
      sessionId,
      at: 3,
      kind: 'cars',
      lap: 2,
      distanceM: null,
      data: { from: 15, to: 14 },
    },
  ]);
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

describe('MCP: session kinds and races (spec 21)', () => {
  it('list_sessions shows the kind and the result of a race, and filters by kind', async () => {
    const all = json(await call('list_sessions'));
    expect(all.sessions[0]).toMatchObject({
      kind: 'race',
      race: { laps: 4, startPosition: 3, finishPosition: 6, cars: 15 },
    });
    const races = json(await call('list_sessions', { kind: 'race' }));
    expect(races.sessions.map((s: { id: string }) => s.id)).toEqual([sessionId]);
    const none = json(await call('list_sessions', { kind: 'qualifying' }));
    expect(none.sessions).toEqual([]);
    expect(seed.trackId).toBeTruthy();
  });

  it('get_session_summary carries the way of the race: positions, cars out and impacts', async () => {
    const sum = json(await call('get_session_summary', { session_id: sessionId }));
    expect(sum.kind).toBe('race');
    expect(sum.race).toMatchObject({
      laps: 4,
      startPosition: 3,
      finishPosition: 6,
      cars: 15,
      positionChanges: [{ lap: 1, from: 3, to: 10 }],
      carsOut: [{ lap: 2, from: 15, to: 14 }],
      impacts: [{ lap: 2, distance_m: 812, speedBeforeKmh: 178, speedAfterKmh: 162 }],
    });
  });
});
