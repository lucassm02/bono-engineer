import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { type SeedResult, seedSyntheticData } from '@gt7/core';
import type {
  ApiComparison,
  ApiDistanceDelta,
  ApiLapAnalysis,
  ApiLapDrivingEvents,
  ApiLapTrace,
  ApiMicrosectors,
  ApiRedetectCornersResult,
  ApiTraces,
  ApiTrackAnalysis,
  ApiTrackSectors,
  CoachConfig,
  CoachReport,
  CoachReportSummary,
  ConsistencyReport,
  CornerLossReport,
  EvolutionReport,
  SessionSummary,
} from '@gt7/shared';
import { lateralDifference } from '@gt7/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';
import type { CoachStreamLike, CoachStreamParams } from './coach/service.ts';

// Ports reserved for this test file (468xx range).
const HTTP_PORT = 46870;
const TOKEN_PORT = 46871;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  base = BASE,
): Promise<{ status: number; body: T; headers: Headers; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body: parsed as T, headers: res.headers, text };
}

/** Parses an SSE body into events. */
function parseSse(text: string): { event: string; data: Record<string, unknown> }[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const ev = /^event: (.+)$/m.exec(b)?.[1] ?? '';
      const data = /^data: (.+)$/m.exec(b)?.[1] ?? '{}';
      return { event: ev, data: JSON.parse(data) as Record<string, unknown> };
    });
}

// ---------------------------------------------------------------------------------------------
// Fake Claude client: replays scripted turns, records the requests
// ---------------------------------------------------------------------------------------------

type Turn =
  | { text?: string; tools?: { name: string; input: Record<string, unknown> }[] }
  | { error: Error };

class FakeClaude {
  readonly requests: CoachStreamParams[] = [];
  readonly keys: string[] = [];
  script: Turn[] = [];
  #n = 0;

  factory = (apiKey: string) => {
    this.keys.push(apiKey);
    return { stream: (params: CoachStreamParams) => this.#stream(params) };
  };

  #stream(params: CoachStreamParams): CoachStreamLike {
    // snapshot: the service keeps appending to the same array
    this.requests.push(structuredClone(params));
    const turn = this.script.shift() ?? { text: 'fim' };
    const listeners: ((d: string, s: string) => void)[] = [];
    const id = ++this.#n;
    return {
      on(_ev: 'text', fn: (d: string, s: string) => void) {
        listeners.push(fn);
        return this;
      },
      async finalMessage() {
        await new Promise((r) => setTimeout(r, 5));
        if ('error' in turn) throw turn.error;
        const content: Anthropic.Beta.BetaContentBlock[] = [];
        if (turn.text) {
          const parts = turn.text.match(/.{1,12}/gs) ?? [];
          let snap = '';
          for (const p of parts) {
            snap += p;
            for (const l of listeners) l(p, snap);
          }
          content.push({ type: 'text', text: turn.text, citations: null } as never);
        }
        for (const [i, t] of (turn.tools ?? []).entries()) {
          content.push({
            type: 'tool_use',
            id: `toolu_${id}_${i}`,
            name: t.name,
            input: t.input,
          } as never);
        }
        return {
          id: `msg_${id}`,
          type: 'message',
          role: 'assistant',
          model: params.model,
          content,
          stop_reason: turn.tools?.length ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 50,
            cache_creation_input_tokens: 0,
          },
        } as unknown as Anthropic.Beta.BetaMessage;
      },
    };
  }
}

describe('analysis REST, MCP over HTTP and the AI coach', () => {
  let dir: string;
  let server: Gt7Server;
  let seed: SeedResult;
  let amLaps: string[];
  const fake = new FakeClaude();

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gt7-server-analysis-'));
    server = await createApp({
      port: HTTP_PORT,
      host: '127.0.0.1',
      webDist: null,
      firewall: { platform: 'linux' },
      hub: { keepAliveMs: 0 },
      runtime: { dataDir: join(dir, 'data'), record: false, persistConsoleIp: false },
      coach: { clientFactory: fake.factory, env: {} },
    });
    seed = await seedSyntheticData(server.runtime, [
      { profile: 'amateur', laps: 3, seed: 4 },
      { profile: 'pro', laps: 1, seed: 9, reference: { driverName: 'Líder Mundial' } },
    ]);
    amLaps = seed.sessions[0]!.lapIds;
    await server.app.listen({ port: HTTP_PORT, host: '127.0.0.1' });
  }, 90_000);

  afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('GET /api/analysis/tracks/:id → polyline, corners, sectors, records', async () => {
    const r = await api<ApiTrackAnalysis>('GET', `/api/analysis/tracks/${seed.trackId}`);
    expect(r.status).toBe(200);
    expect(r.body.polyline.x.length).toBeGreaterThan(100);
    expect(r.body.polyline.x.length).toBe(r.body.polyline.z.length);
    expect(r.body.polyline.stepM).toBeGreaterThan(0);
    expect(r.body.corners.length).toBeGreaterThanOrEqual(8);
    expect(r.body.corners[0]).toHaveProperty('apexX');
    expect(r.body.sectorStartsM[0]).toBe(0);
    expect(r.body.references[0]?.driverName).toBe('Líder Mundial');
    const missing = await api<{ error: { code: string } }>('GET', '/api/analysis/tracks/nope');
    expect(missing.status).toBe(404);
  });

  it('lap analysis, compare, delta, microsectors, consistency, evolution', async () => {
    const la = await api<ApiLapAnalysis>('GET', `/api/analysis/laps/${amLaps[0]}`);
    expect(la.status).toBe(200);
    expect(la.body.metrics.length).toBe(la.body.corners.length);
    expect(la.body.validity.lapId).toBe(amLaps[0]);

    const evs = await api<ApiLapDrivingEvents>('GET', `/api/analysis/laps/${amLaps[0]}/events`);
    expect(evs.status).toBe(200);
    expect(evs.body.lapId).toBe(amLaps[0]);
    expect(evs.body.trackId).toBe(seed.trackId);
    expect(Array.isArray(evs.body.events)).toBe(true);
    for (const e of evs.body.events) expect(['high', 'medium', 'low']).toContain(e.confidence);
    expect(evs.body.model.maxLatAccMps2).toBeGreaterThan(0);
    const noLap = await api('GET', '/api/analysis/laps/nao-existe/events');
    expect(noLap.status).toBe(404);

    const cmp = await api<ApiComparison>('GET', `/api/analysis/compare?lap=${amLaps[0]}&ref=auto`);
    expect(cmp.status).toBe(200);
    expect(cmp.body.referenceLap.id).toBe(seed.referenceLapId);
    expect(cmp.body.comparison.rows.length).toBeGreaterThan(0);
    expect(cmp.body.comparison.keyFindings?.length).toBeGreaterThan(0);
    expect(cmp.body.comparison.sectorDeltasMs?.length).toBeGreaterThan(0);
    expect(cmp.body.markdown).toContain('|');
    const same = await api<{ error: { code: string; message: string } }>(
      'GET',
      `/api/analysis/compare?lap=${amLaps[0]}&ref=${amLaps[0]}`,
    );
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe('invalidArgument');
    expect((await api('GET', '/api/analysis/compare')).status).toBe(400);
    expect((await api('GET', '/api/analysis/compare?lap=ghost')).status).toBe(404);

    const d = await api<ApiDistanceDelta>(
      'GET',
      `/api/analysis/delta?lap=${amLaps[0]}&ref=bestReference&stepM=10`,
    );
    expect(d.status).toBe(200);
    expect(d.body.stepM).toBeCloseTo(10, 1);
    expect(d.body.totalS).toBeGreaterThan(0);

    const ms = await api<ApiMicrosectors>(
      'GET',
      `/api/analysis/microsectors?laps=${amLaps.join(',')}&ref=${seed.referenceLapId}`,
    );
    expect(ms.status).toBe(200);
    expect(ms.body.referenceLapId).toBe(seed.referenceLapId);
    expect(ms.body.report.theoreticalBestMs).toBeLessThanOrEqual(ms.body.report.bestLapMs);

    const loss = await api<CornerLossReport>(
      'GET',
      `/api/analysis/compare/corner-loss?lap=${amLaps[0]}&ref=auto&topN=2`,
    );
    expect(loss.status).toBe(200);
    expect(loss.body.lapA).toBe(amLaps[0]);
    expect(loss.body.rows.length).toBeLessThanOrEqual(2);
    expect(loss.body.rows[0]?.lossMs ?? 20).toBeGreaterThanOrEqual(20);
    expect((await api('GET', '/api/analysis/compare/corner-loss')).status).toBe(400);

    const sec = await api<ApiTrackSectors>('GET', `/api/analysis/tracks/${seed.trackId}/sectors`);
    expect(sec.status).toBe(200);
    expect(sec.body.table.rows.length).toBeGreaterThanOrEqual(2);
    expect(sec.body.table.idealLapMs).toBeLessThanOrEqual(sec.body.table.bestLapMs);
    expect(sec.body.laps.some((l) => l.lapId === sec.body.table.rows[0]!.bestLapId)).toBe(true);
    const noLaps = await api('GET', `/api/analysis/tracks/${seed.trackId}/sectors?carCode=999999`);
    expect(noLaps.status).toBe(400);

    const sum = await api<SessionSummary>(
      'GET',
      `/api/sessions/${seed.sessions[0]!.sessionId}/summary`,
    );
    expect(sum.status).toBe(200);
    expect(sum.body.sessionId).toBe(seed.sessions[0]!.sessionId);
    expect(sum.body.laps.total).toBeGreaterThan(0);
    expect(sum.body.best?.timeMs).toBeGreaterThan(0);
    expect(sum.body.pace?.top5AvgMs).toBeGreaterThan(0);
    expect((await api('GET', '/api/sessions/nao-existe/summary')).status).toBe(404);

    const cs = await api<ConsistencyReport>(
      'GET',
      `/api/analysis/consistency?sessionId=${seed.sessions[0]!.sessionId}`,
    );
    expect(cs.status).toBe(200);
    expect(cs.body.lapIds.length).toBeGreaterThanOrEqual(2);
    const cl = await api<ConsistencyReport>(
      'GET',
      `/api/analysis/consistency?laps=${amLaps.slice(0, 2).join(',')}`,
    );
    expect(cl.body.lapIds).toHaveLength(2);
    expect((await api('GET', '/api/analysis/consistency')).status).toBe(400);

    const ev = await api<EvolutionReport>('GET', `/api/analysis/evolution?trackId=${seed.trackId}`);
    expect(ev.status).toBe(200);
    expect(ev.body.days.length).toBeGreaterThanOrEqual(1);
  });

  it('traces share one distance grid; aliases and errors', async () => {
    const r = await api<ApiTraces>(
      'GET',
      `/api/analysis/traces?laps=${amLaps[0]},${seed.referenceLapId}&channels=speed,throttle,brake,gear,steering&stepM=5&from=100&to=600`,
    );
    expect(r.status).toBe(200);
    expect(r.body.fromM).toBe(100);
    expect(r.body.distanceM.length).toBe(101);
    expect(r.body.laps).toHaveLength(2);
    for (const l of r.body.laps) {
      expect(Object.keys(l.channels)).toEqual(['speed', 'throttle', 'brake', 'gear', 'steering']);
      expect(l.channels.speed).toHaveLength(r.body.distanceM.length);
    }
    // spec 17: two laps on the same track line → their lateral offsets give the map difference
    const lat = await api<ApiTraces>(
      'GET',
      `/api/analysis/traces?laps=${amLaps[0]},${seed.referenceLapId}&channels=offset,x,z&stepM=5`,
    );
    expect(lat.status).toBe(200);
    const [mine, theirs] = lat.body.laps.map((l) => l.channels.offset!);
    const diff = lateralDifference(mine!, theirs!);
    const known = diff.filter((v): v is number => v !== null);
    expect(known.length).toBeGreaterThan(50);
    expect(lateralDifference(mine!, mine!).every((v) => v === null || v === 0)).toBe(true);
    expect(Math.max(...known.map(Math.abs))).toBeLessThan(25);

    const capped = await api<ApiTraces>(
      'GET',
      `/api/analysis/traces?laps=${amLaps[0]}&channels=speedKmh&maxPoints=50`,
    );
    expect(capped.body.distanceM.length).toBeLessThanOrEqual(51);
    const bad = await api<{ error: { message: string } }>(
      'GET',
      `/api/analysis/traces?laps=${amLaps[0]}&channels=warp`,
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/Canal desconhecido/);
  });

  it('chart.png, lap trace JSON, CSV export and corner re-detection', async () => {
    const png = await fetch(`${BASE}/api/analysis/chart.png?lap=${amLaps[0]}&corner=T1&width=800`);
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await png.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual(PNG_SIGNATURE);

    const tr = await api<ApiLapTrace>(
      'GET',
      `/api/laps/${amLaps[0]}/trace?channels=speedKmh,brake`,
    );
    expect(tr.status).toBe(200);
    expect(Object.keys(tr.body.channels).sort()).toEqual(['brake', 'speedKmh']);
    expect(tr.body.channels.speedKmh).toHaveLength(tr.body.length);

    const csv = await api('GET', `/api/laps/${amLaps[0]}/export.csv?stepM=5`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain('.csv');
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'distance_m,time_s,speed_kmh,throttle_pct,brake_pct,gear,rpm,steering_rad,lat_g,lon_g,x,y,z',
    );
    expect(lines.length).toBeGreaterThan(500);
    expect(lines[1]!.split(',')).toHaveLength(13);

    const re = await api<ApiRedetectCornersResult>(
      'POST',
      `/api/tracks/${seed.trackId}/redetect-corners`,
    );
    expect(re.status).toBe(200);
    expect(re.body.detected).toBe(true);
    expect(re.body.corners.length).toBeGreaterThanOrEqual(8);
    expect((await api('POST', '/api/tracks/nope/redetect-corners')).status).toBe(404);
  });

  it('MCP over HTTP at /mcp: initialize, tools/list, get_live_state', async () => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['compare_laps', 'get_live_state', 'render_comparison_chart']),
    );
    const live = (await client.callTool({
      name: 'get_live_state',
      arguments: {},
    })) as CallToolResult;
    expect(live.isError).toBeFalsy();
    const text = live.content[0]?.type === 'text' ? live.content[0].text : '';
    expect(JSON.parse(text)).toHaveProperty('connection');
    await client.close();
    expect((await fetch(`${BASE}/mcp`)).status).toBe(405);
  });

  it('--token protects /mcp', async () => {
    const tokDir = mkdtempSync(join(tmpdir(), 'gt7-server-token-'));
    const s2 = await createApp({
      port: TOKEN_PORT,
      host: '127.0.0.1',
      webDist: null,
      token: 'segredo123',
      firewall: { platform: 'linux' },
      hub: { keepAliveMs: 0 },
      runtime: { dataDir: tokDir, record: false, persistConsoleIp: false },
    });
    try {
      await s2.app.listen({ port: TOKEN_PORT, host: '127.0.0.1' });
      const url = `http://127.0.0.1:${TOKEN_PORT}/mcp`;
      const init = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        },
      };
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      const denied = await fetch(url, { method: 'POST', headers, body: JSON.stringify(init) });
      expect(denied.status).toBe(401);
      const ok = await fetch(url, {
        method: 'POST',
        headers: { ...headers, authorization: 'Bearer segredo123' },
        body: JSON.stringify(init),
      });
      expect(ok.status).toBe(200);
      expect(
        ((await ok.json()) as { result: { serverInfo: unknown } }).result.serverInfo,
      ).toBeTruthy();
    } finally {
      await s2.close();
      rmSync(tokDir, { recursive: true, force: true });
    }
  });

  describe('coach', () => {
    it('config: no key → debrief 400; PUT stores the key (never returned)', async () => {
      const c0 = await api<CoachConfig>('GET', '/api/coach/config');
      expect(c0.body.hasKey).toBe(false);
      expect(c0.body.model).toBe('claude-opus-5-5');
      expect(c0.body.models.map((m) => m.id)).toContain('claude-sonnet-5-5');
      const no = await api<{ error: { code: string; message: string } }>(
        'POST',
        '/api/coach/debrief',
        {},
      );
      expect(no.status).toBe(400);
      expect(no.body.error.code).toBe('noKey');
      expect(no.body.error.message).toMatch(/chave da API/i);
      expect((await api('PUT', '/api/coach/config', { apiKey: 'curta' })).status).toBe(400);
      const c1 = await api<CoachConfig>('PUT', '/api/coach/config', {
        apiKey: 'sk-ant-test-0000000000000000wxyz',
        effort: 'medium',
      });
      expect(c1.status).toBe(200);
      expect(c1.body).toMatchObject({ hasKey: true, keySource: 'settings', keyLast4: 'wxyz' });
      expect(c1.text).not.toContain('sk-ant-test');
      expect(c1.body.effort).toBe('medium');
    });

    it('debrief streams SSE, runs MCP tools (incl. chart image) and saves the report', async () => {
      fake.script = [
        {
          text: 'Vou comparar.',
          tools: [
            { name: 'compare_laps', input: { lap_id: amLaps[0], reference: 'auto' } },
            { name: 'render_comparison_chart', input: { lap_id: amLaps[0], corner: 'T1' } },
          ],
        },
        { tools: [{ name: 'rename_track', input: { track_id: seed.trackId, name: 'X' } }] },
        {
          text: '## Resumo\nVocê perde tempo na **T1**.\n\n## Plano para o próximo stint\n1. Frear 10 m depois.',
        },
      ];
      const res = await api('POST', '/api/coach/debrief', {
        lapId: amLaps[0],
        question: 'Onde perco?',
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const events = parseSse(res.text);
      expect(events[0]?.event).toBe('start');
      const reportId = events[0]!.data.reportId as string;
      const tools = events.filter((e) => e.event === 'tool');
      expect(tools.filter((e) => e.data.status === 'running').map((e) => e.data.name)).toEqual([
        'compare_laps',
        'render_comparison_chart',
        'rename_track',
      ]);
      expect(
        tools.find((e) => e.data.name === 'compare_laps' && e.data.status !== 'running')?.data
          .status,
      ).toBe('done');
      // write tools are not exposed to the model → error result
      expect(
        tools.find((e) => e.data.name === 'rename_track' && e.data.status !== 'running')?.data
          .status,
      ).toBe('error');
      const text = events
        .filter((e) => e.event === 'text')
        .map((e) => e.data.delta)
        .join('');
      expect(text).toContain('Vou comparar.');
      expect(text).toContain('Plano para o próximo stint');
      const done = events.at(-1)!;
      expect(done.event).toBe('done');
      expect(done.data.reportId).toBe(reportId);
      expect((done.data.usage as { requests: number }).requests).toBe(3);

      // requests: system prompt, read-only MCP tools, adaptive thinking, cache, fallbacks
      const first = fake.requests.at(-3)!;
      expect(first.model).toBe('claude-opus-5-5');
      expect(first.system).toContain('engenheiro de pista');
      expect(first.thinking).toEqual({ type: 'adaptive' });
      expect(first.output_config).toEqual({ effort: 'medium' });
      expect(first.fallbacks).toBe('default');
      const toolNames = (first.tools ?? []).map((t) => (t as { name: string }).name);
      expect(toolNames).toContain('compare_laps');
      expect(toolNames).not.toContain('rename_track');
      const firstUser = first.messages[0]!.content as string;
      expect(firstUser).toContain(amLaps[0]);
      expect(firstUser).toContain('Onde perco?');
      // the second request carries the tool results: JSON text + the chart as an image
      const second = fake.requests.at(-2)!;
      const results = second.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
      expect(results.map((r) => r.type)).toEqual(['tool_result', 'tool_result']);
      const chart = results[1]!.content as { type: string }[];
      expect(chart.map((c) => c.type)).toContain('image');
      expect(fake.keys.at(-1)).toBe('sk-ant-test-0000000000000000wxyz');

      const list = await api<CoachReportSummary[]>(
        'GET',
        `/api/coach/reports?trackId=${seed.trackId}`,
      );
      expect(list.body[0]?.id).toBe(reportId);
      expect(list.body[0]?.status).toBe('done');
      const rep = await api<CoachReport>('GET', `/api/coach/reports/${reportId}`);
      expect(rep.body.markdown).toContain('## Resumo');
      expect(rep.body.lapId).toBe(amLaps[0]);
      expect(rep.body.transcript.map((t) => t.role)).toEqual(['user', 'assistant']);
      expect(rep.body.transcript[1]!.tools?.map((t) => t.name)).toContain('compare_laps');
      expect(rep.body).not.toHaveProperty('messages');

      // follow-up chat continues the same conversation (append-only)
      fake.script = [{ text: 'Na T1, freie no cone de 100 m.' }];
      const chat = await api('POST', '/api/coach/chat', { reportId, message: 'E a T1?' });
      const chatEvents = parseSse(chat.text);
      expect(chatEvents.at(-1)?.event).toBe('done');
      const replay = fake.requests.at(-1)!;
      expect(replay.messages.length).toBe(7);
      expect(replay.messages.at(-1)).toEqual({ role: 'user', content: 'E a T1?' });
      const rep2 = await api<CoachReport>('GET', `/api/coach/reports/${reportId}`);
      expect(rep2.body.transcript.map((t) => t.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
      expect(rep2.body.markdown).toContain('## Resumo');

      expect((await api('DELETE', `/api/coach/reports/${reportId}`)).status).toBe(200);
      expect((await api('GET', `/api/coach/reports/${reportId}`)).status).toBe(404);
    });

    it('caps the tool loop and maps API errors to pt-BR error events', async () => {
      fake.script = Array.from({ length: 12 }, () => ({
        tools: [{ name: 'list_tracks', input: {} }],
      }));
      fake.script.push({ text: 'Resposta final.' });
      const res = await api('POST', '/api/coach/debrief', {
        sessionId: seed.sessions[0]!.sessionId,
        focusCorner: 'T2',
      });
      const events = parseSse(res.text);
      expect(events.filter((e) => e.event === 'tool' && e.data.status === 'running')).toHaveLength(
        12,
      );
      const last = fake.requests.at(-1)!;
      expect(last.tool_choice).toEqual({ type: 'none' });
      expect(events.at(-1)?.event).toBe('done');

      fake.script = [
        {
          error: Anthropic.APIError.generate(
            401,
            { error: { message: 'bad key' } },
            'bad key',
            new Headers(),
          ),
        },
      ];
      const bad = parseSse((await api('POST', '/api/coach/debrief', {})).text);
      expect(bad.at(-1)).toMatchObject({ event: 'error', data: { code: 'invalidKey' } });
      expect(bad.at(-1)!.data.message).toMatch(/inválida/);
      fake.script = [
        {
          error: Anthropic.APIError.generate(
            529,
            { error: { message: 'overloaded' } },
            'x',
            new Headers(),
          ),
        },
      ];
      const busy = parseSse((await api('POST', '/api/coach/debrief', {})).text);
      expect(busy.at(-1)).toMatchObject({ event: 'error', data: { code: 'overloaded' } });
      expect(
        (await api('POST', '/api/coach/chat', { reportId: 'nope', message: 'oi' })).status,
      ).toBe(404);
    });
  });
});
