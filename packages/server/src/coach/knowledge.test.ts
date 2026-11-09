import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gt7Runtime, seedSyntheticData } from '@gt7/core';
import { listCars } from '@gt7/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCoachTask, COACH_SYSTEM_PROMPT } from './prompt.ts';
import { McpToolBridge } from './tools.ts';

const huracan = listCars().find((c) => c.name === 'Huracan Gr.4')!;

let dir: string;
let rt: Gt7Runtime;
let bridge: McpToolBridge;
let sessionId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gt7-coach-know-'));
  rt = new Gt7Runtime({ dataDir: dir, record: false });
  const seed = await seedSyntheticData(rt, [
    { profile: 'amateur', laps: 3, seed: 4, carCode: huracan.id },
  ]);
  sessionId = seed.sessions[0]!.sessionId!;
  bridge = new McpToolBridge(rt);
}, 60_000);

afterAll(async () => {
  await bridge?.close();
  await rt?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('coach + driving knowledge base', () => {
  it('system prompt carries the rules and stays static (cache friendly)', () => {
    expect(COACH_SYSTEM_PROMPT).toContain('get_knowledge');
    expect(COACH_SYSTEM_PROMPT).toContain('NUNCA invente pontos de frenagem absolutos');
    expect(COACH_SYSTEM_PROMPT).toContain('regra geral');
    expect(COACH_SYSTEM_PROMPT).toContain('UMA ação principal por curva');
    // Nothing per-request in the cached prefix.
    expect(COACH_SYSTEM_PROMPT).not.toContain(sessionId);
    expect(COACH_SYSTEM_PROMPT.length).toBeLessThan(10_000);
  });

  it('the task embeds the class briefing of the car and asks for get_knowledge', () => {
    const session = rt.store.getSession(sessionId)!;
    const task = buildCoachTask(rt.store, {
      session,
      lap: null,
      track: null,
      reference: 'auto',
      focusCorner: null,
      question: null,
    });
    expect(task).toContain('BASE DE CONHECIMENTO DE PILOTAGEM');
    expect(task).toContain('Classe Gr.4');
    expect(task).toContain('get_knowledge');
    const corner = buildCoachTask(rt.store, {
      session,
      lap: null,
      track: null,
      reference: 'auto',
      focusCorner: 'T1',
      question: null,
    });
    expect(corner).toContain('Classe Gr.4');
    expect(corner).toContain('corner_kind');
  });

  it('exposes get_knowledge to the model and executes it through the bridge', async () => {
    const tools = await bridge.tools();
    const t = tools.find((x) => x.name === 'get_knowledge');
    expect(t).toBeDefined();
    expect((t?.description ?? '').length).toBeLessThanOrEqual(1024);
    const out = await bridge.call('get_knowledge', {
      car_code: huracan.id,
      diagnostics: ['brakeEarlier', 'softBraking'],
    });
    expect(out.isError).toBe(false);
    const first = out.content[0];
    expect(first?.type).toBe('text');
    const md = first?.type === 'text' ? first.text : '';
    expect(md).toContain('Classe Gr.4');
    expect(md).toContain('softBraking');
    expect(md.length).toBeLessThanOrEqual(6000);
  });
});
