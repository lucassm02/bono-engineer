import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gt7Runtime, type SeedResult, seedSyntheticData } from '@gt7/core';
import { KNOWLEDGE_MAX_CHARS, listCars } from '@gt7/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { debriefTask, trainingPlanTask } from './prompts.ts';
import { createGt7McpServer } from './server.ts';

const huracan = listCars().find((c) => c.name === 'Huracan Gr.4')!;

let dir: string;
let rt: Gt7Runtime;
let seed: SeedResult;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}
function text(res: CallToolResult): string {
  const c = res.content[0];
  if (c?.type !== 'text') throw new Error('not text');
  return c.text;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gt7-mcp-know-'));
  rt = new Gt7Runtime({ dataDir: dir, record: false });
  seed = await seedSyntheticData(rt, [
    { profile: 'amateur', laps: 3, seed: 4, carCode: huracan.id },
    { profile: 'pro', laps: 1, seed: 9, reference: { driverName: 'Líder' } },
  ]);
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

describe('get_knowledge (MCP)', () => {
  it('is listed as a read-only tool with a short description', async () => {
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === 'get_knowledge');
    expect(t).toBeDefined();
    expect(t?.annotations?.readOnlyHint).toBe(true);
    expect((t?.description ?? '').length).toBeLessThanOrEqual(1024);
  });

  it('returns the class briefing and the diagnostics for a car code, within the size cap', async () => {
    const res = await call('get_knowledge', {
      car_code: huracan.id,
      diagnostics: ['brakeEarlier', 'noTrailBraking', 'lowerMinSpeed'],
    });
    expect(res.isError).toBeFalsy();
    const md = text(res);
    expect(md.length).toBeLessThanOrEqual(KNOWLEDGE_MAX_CHARS);
    expect(md).toContain('Classe Gr.4');
    expect(md).toContain('brakeEarlier');
    expect(md).toContain('noTrailBraking');
    expect(md).toContain('NUNCA invente pontos de frenagem absolutos');
  });

  it('honours max_chars and the class of the car', async () => {
    const small = text(
      await call('get_knowledge', {
        car_group: '1',
        diagnostics: ['brakeEarlier', 'slowerExit', 'exitSlip'],
        max_chars: 1500,
      }),
    );
    expect(small.length).toBeLessThanOrEqual(1500);
    expect(small).toContain('Classe Gr.1');
  });

  it('without arguments uses the car of the latest session', async () => {
    const md = text(await call('get_knowledge'));
    expect(md).toContain('sessão mais recente');
    expect(md).toContain('Princípios que valem sempre');
  });

  it('serves full topic pages, the index and a clear error for unknown topics', async () => {
    const page = text(await call('get_knowledge', { topic: 'gr4' }));
    expect(page).toContain('Gr.4');
    expect(page).toContain('Erros comuns');
    const diag = text(await call('get_knowledge', { topic: 'diagnostico/softBraking' }));
    expect(diag).toContain('softBraking');
    expect(text(await call('get_knowledge', { topic: 'indice' }))).toContain('classe/gr1');
    const bad = await call('get_knowledge', { topic: 'nao-existe' });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('nao-existe');
  });

  it('exposes the base as MCP resources', async () => {
    const list = await client.listResources();
    expect(list.resources.map((r) => r.uri)).toContain('gt7://knowledge');
    const idx = await client.readResource({ uri: 'gt7://knowledge' });
    expect((idx.contents[0] as { text: string }).text).toContain('diagnostico/brakeEarlier');
    const tpl = await client.listResourceTemplates();
    expect(tpl.resourceTemplates.map((t) => t.uriTemplate)).toContain('gt7://knowledge/{+topic}');
    const page = await client.readResource({ uri: 'gt7://knowledge/diagnostico/brakeEarlier' });
    expect((page.contents[0] as { text: string }).text).toContain('Freia mais cedo');
    const cls = await client.readResource({ uri: 'gt7://knowledge/classe/gr3' });
    expect((cls.contents[0] as { text: string }).text).toContain('Gr.3');
  });

  it('compare_laps plan carries the diagnostic code to feed get_knowledge', async () => {
    const lap = seed.sessions[0]!.lapIds[0]!;
    const res = await call('compare_laps', { lap_id: lap });
    const plan = JSON.parse(text(res)).plan as { code?: string }[];
    expect(plan.length).toBeGreaterThan(0);
    for (const p of plan) expect(typeof p.code).toBe('string');
  });
});

describe('prompts use the knowledge base', () => {
  it('debrief, corner focus and training plan mention get_knowledge and embed the class briefing', async () => {
    const sid = seed.sessions[0]!.sessionId!;
    const debrief = debriefTask(rt.store, { session_id: sid });
    expect(debrief).toContain('get_knowledge');
    expect(debrief).toContain('BASE DE CONHECIMENTO DE PILOTAGEM');
    expect(debrief).toContain('Classe Gr.4');
    const plan = trainingPlanTask(rt.store, {});
    expect(plan).toContain('geral/como-treinar');
    expect(plan).toContain('Classe Gr.4');

    const f = await client.getPrompt({ name: 'foco_curva', arguments: { curva: 'T1' } });
    const msg = f.messages[0]!.content;
    expect(msg.type === 'text' && msg.text.includes('get_knowledge')).toBe(true);
    const d = await client.getPrompt({ name: 'debrief_sessao', arguments: {} });
    const dm = d.messages[0]!.content;
    expect(
      dm.type === 'text' && dm.text.includes('NUNCA invente pontos de frenagem absolutos'),
    ).toBe(true);
  });
});
