import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Gt7Runtime, type SeedResult, seedSyntheticData } from '@gt7/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountMcpHttp } from './http.ts';
import { createGt7McpServer } from './server.ts';

let dir: string;
let rt: Gt7Runtime;
let seed: SeedResult;
let client: Client;
let amLap: string;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}
function text(res: CallToolResult, i = 0): string {
  const c = res.content[i];
  if (c?.type !== 'text') throw new Error(`content ${i} is not text`);
  return c.text;
}
const json = (res: CallToolResult) => JSON.parse(text(res));
const size = (res: CallToolResult) =>
  res.content.reduce((a, c) => a + (c.type === 'text' ? c.text.length : 0), 0);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gt7-mcp-'));
  rt = new Gt7Runtime({ dataDir: dir, record: false });
  seed = await seedSyntheticData(rt, [
    { profile: 'amateur', laps: 3, seed: 4 },
    { profile: 'pro', laps: 1, seed: 9, reference: { driverName: 'Líder Mundial' } },
  ]);
  amLap = seed.sessions[0]!.lapIds[0]!;
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

describe('GT7 MCP server (in-memory client)', () => {
  it('lists the tools with input schemas', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of [
      'list_tracks',
      'get_track',
      'list_sessions',
      'list_laps',
      'list_reference_laps',
      'get_lap_summary',
      'compare_laps',
      'get_corner_detail',
      'get_consistency',
      'get_microsectors',
      'get_trace',
      'get_evolution',
      'render_comparison_chart',
      'get_live_state',
      'rename_corner',
      'rename_track',
    ]) {
      expect(names).toContain(n);
    }
    const cmp = tools.find((t) => t.name === 'compare_laps')!;
    expect(cmp.inputSchema.properties).toHaveProperty('lap_id');
    expect(cmp.description).toMatch(/curva a curva/);
  });

  it('lists tracks, sessions, laps and references', async () => {
    const tracks = json(await call('list_tracks')).tracks;
    expect(tracks).toHaveLength(1);
    expect(tracks[0].corners).toBe(10);
    const sessions = json(await call('list_sessions', { track_id: seed.trackId })).sessions;
    expect(sessions.length).toBe(2);
    const laps = json(await call('list_laps', { session_id: seed.sessions[0]!.sessionId }));
    expect(laps.laps).toHaveLength(3);
    expect(laps.bestLapId).toBeTruthy();
    expect(laps.laps[0].time).toMatch(/^1:3\d,\d{3}$/);
    const refs = json(await call('list_reference_laps')).references;
    expect(refs).toHaveLength(1);
    expect(refs[0].driver).toBe('Líder Mundial');
    const track = json(await call('get_track', { track_id: seed.trackId }));
    expect(track.corners[0]).toMatchObject({ id: 'T1', kind: 'hairpin' });
  });

  it('compare_laps returns ranked findings, one action per corner, bounded size', async () => {
    const res = await call('compare_laps', { lap_id: amLap });
    expect(res.isError).toBeFalsy();
    const j = json(res);
    expect(j.referenceKind).toBe('auto');
    expect(j.reference.driver).toBe('Líder Mundial');
    expect(j.delta_s).toBeGreaterThan(2);
    expect(j.corners).toHaveLength(10);
    expect(j.findings.length).toBeGreaterThan(0);
    expect(j.plan.length).toBeGreaterThan(3);
    expect(new Set(j.plan.map((p: { c: string }) => p.c)).size).toBe(j.plan.length);
    expect(j.refReplay).toBe(true);
    expect(text(res, 1)).toContain('### Plano: uma ação por curva');
    expect(size(res)).toBeLessThan(12_000);
  });

  it('get_trace honours step and point caps; rejects step < 2 m', async () => {
    const res = await call('get_trace', {
      lap_id: amLap,
      channels: ['speedKmh', 'brake', 'deltaS'],
      step_m: 2,
      max_points: 50,
    });
    const j = json(res);
    expect(j.points).toBeLessThanOrEqual(50);
    expect(j.speedKmh).toHaveLength(j.points);
    expect(j.deltaS.at(-1)).toBeGreaterThan(2);
    const bad = await call('get_trace', { lap_id: amLap, step_m: 0.5 }).catch((e: Error) => e);
    expect(bad instanceof Error || (bad as CallToolResult).isError).toBe(true);
  });

  it('get_corner_detail, consistency, microsectors, evolution and lap summary', async () => {
    const cd = await call('get_corner_detail', {
      corner: 't1',
      lap_ids: [seed.referenceLapId, amLap],
    });
    const c = json(cd);
    expect(c.corner.id).toBe('T1');
    expect(c.laps[1].windowDelta_s).toBeGreaterThan(0.3);
    expect(c.traces.distance_m.length).toBeLessThanOrEqual(160);
    expect(size(cd)).toBeLessThan(24_000);

    const cons = json(await call('get_consistency', { session_id: seed.sessions[0]!.sessionId }));
    expect(cons.lapIds).toHaveLength(3);
    expect(cons.corners_meanSd).toHaveLength(10);

    const ms = json(
      await call('get_microsectors', {
        lap_ids: seed.sessions[0]!.lapIds,
        reference_lap_id: seed.referenceLapId,
      }),
    );
    expect(ms.count).toBe(25);
    expect(ms.laps[0].microDeltaVsRef_ms).toHaveLength(25);

    const ev = json(await call('get_evolution', { track_id: seed.trackId }));
    expect(ev.baseline.kind).toBe('reference');
    expect(ev.days[0].lost_ms).toHaveLength(ev.cornerIds.length);

    const sum = json(await call('get_lap_summary', { lap_id: amLap }));
    expect(sum.summary.corners).toHaveLength(10);
  });

  it('errors are reported as tool errors with a pt-BR message', async () => {
    const res = await call('compare_laps', { lap_id: 'nao-existe' });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/não encontrada/);
  });

  it('render_comparison_chart returns a PNG image (full lap and corner zoom)', async () => {
    for (const args of [{ lap_id: amLap }, { lap_id: amLap, corner: 'T8' }]) {
      const res = await call('render_comparison_chart', args);
      expect(res.isError).toBeFalsy();
      const img = res.content[0]!;
      expect(img.type).toBe('image');
      if (img.type !== 'image') return;
      expect(img.mimeType).toBe('image/png');
      const buf = Buffer.from(img.data, 'base64');
      expect([...buf.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
      expect(buf.length).toBeGreaterThan(20_000);
      expect(buf.length).toBeLessThan(600_000);
      expect(text(res, 1)).toMatch(/Gráfico/);
    }
  });

  it('get_live_state explains the HTTP transport when there is no runtime', async () => {
    expect(text(await call('get_live_state'))).toMatch(/localhost:8770\/mcp/);
  });

  it('rename_corner / rename_track write and are visible to other tools', async () => {
    const r1 = await call('rename_corner', {
      track_id: seed.trackId,
      corner_id: 't1',
      name: 'Grampo',
    });
    expect(text(r1)).toMatch(/Grampo/);
    await call('rename_track', { track_id: seed.trackId, name: 'Synthetic Ring' });
    const track = json(await call('get_track', { track_id: seed.trackId }));
    expect(track.name).toBe('Synthetic Ring');
    expect(track.corners[0].name).toBe('Grampo');
    const cmp = await call('compare_laps', { lap_id: amLap });
    expect(text(cmp, 1)).toContain('Grampo');
  });

  it('prompts and resources', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'debrief_sessao',
      'foco_curva',
      'plano_treino',
    ]);
    const p = await client.getPrompt({ name: 'debrief_sessao', arguments: {} });
    const msg = p.messages[0]!.content;
    expect(msg.type).toBe('text');
    if (msg.type === 'text') {
      expect(msg.text).toContain('compare_laps');
      expect(msg.text).toMatch(/UMA ação/);
      expect(msg.text).toContain(seed.sessions[0]!.sessionId!); // live session, not the capture
    }
    const f = await client.getPrompt({ name: 'foco_curva', arguments: { curva: 'T1' } });
    expect(JSON.stringify(f.messages)).toContain('get_corner_detail');
    const res = await client.listResources();
    expect(res.resources.map((r) => r.uri)).toContain('gt7://tracks');
    const tr = await client.readResource({ uri: `gt7://tracks/${seed.trackId}` });
    expect(JSON.parse((tr.contents[0] as { text: string }).text).corners).toHaveLength(10);
  });

  it('get_live_state with a runtime returns the connection state', async () => {
    const server = createGt7McpServer({ store: rt.store, runtime: rt });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const c2 = new Client({ name: 'live', version: '0' });
    await c2.connect(ct);
    const res = (await c2.callTool({ name: 'get_live_state', arguments: {} })) as CallToolResult;
    expect(JSON.parse(text(res))).toHaveProperty('connection');
    await c2.close();
  });
});

describe('transports', () => {
  it('stdio entry answers initialize + tools/list as a child process', async () => {
    const require = createRequire(import.meta.url);
    const tsxLoader = pathToFileURL(require.resolve('tsx')).href;
    const entry = fileURLToPath(new URL('./stdio.ts', import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--disable-warning=ExperimentalWarning', '--import', tsxLoader, entry, '--data', dir],
      cwd: tmpdir(),
      stderr: 'pipe',
    });
    const c = new Client({ name: 'stdio-test', version: '0' });
    await c.connect(transport);
    expect(c.getServerVersion()?.name).toBe('bono-engineer');
    const { tools } = await c.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(16);
    const res = (await c.callTool({ name: 'list_tracks', arguments: {} })) as CallToolResult;
    expect(JSON.parse(text(res)).tracks).toHaveLength(1);
    await c.close();
  }, 30_000);

  it('HTTP mount (stateless Streamable HTTP) answers initialize and tools', async () => {
    const app = Fastify();
    mountMcpHttp(app, { store: rt.store, analysis: rt.analysis });
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const c = new Client({ name: 'http-test', version: '0' });
      await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
      expect(c.getServerVersion()?.name).toBe('bono-engineer');
      const { tools } = await c.listTools();
      expect(tools.map((t) => t.name)).toContain('compare_laps');
      const res = (await c.callTool({
        name: 'list_laps',
        arguments: { track_id: seed.trackId },
      })) as CallToolResult;
      expect(JSON.parse(text(res)).laps.length).toBe(4);
      await c.close();
      const get = await app.inject({ method: 'GET', url: '/mcp' });
      expect(get.statusCode).toBe(405);
    } finally {
      await app.close();
    }
  });
});
