import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedSyntheticData } from '@gt7/core';
import type { CoachConfig, CoachReport, CoachVerifyResult } from '@gt7/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Gt7Server } from './app.ts';
import { providerOfModel } from './coach/config.ts';
import {
  createOpenAiClient,
  OpenAiApiError,
  type OpenAiClientFactory,
  type OpenAiMessage,
  type OpenAiRequest,
  type OpenAiTurn,
  openAiApiError,
} from './coach/openai.ts';
import { sealOpenAiHistory, toOpenAiTools } from './coach/service.ts';

// Port reserved for this test file (468xx range).
const PORT = 46880;
const BASE = `http://127.0.0.1:${PORT}`;

async function call<T = unknown>(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
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
    // SSE or plain text
  }
  return { status: res.status, body: parsed as T, text };
}

function parseSse(text: string): { event: string; data: Record<string, unknown> }[] {
  return text
    .split('\n\n')
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return event && data ? { event, data: JSON.parse(data) as Record<string, unknown> } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
}

const turn = (over: Partial<OpenAiTurn>): OpenAiTurn => ({
  text: '',
  toolCalls: [],
  finishReason: 'stop',
  usage: { promptTokens: 200, completionTokens: 30, cachedTokens: 50 },
  ...over,
});

class FakeOpenAi {
  script: OpenAiTurn[] = [];
  requests: OpenAiRequest[] = [];
  keys: string[] = [];
  verifyError: Error | null = null;
  factory: OpenAiClientFactory = (key) => ({
    stream: async (req, { onText }) => {
      this.keys.push(key);
      // The service keeps appending to the same array: keep a snapshot of this request.
      this.requests.push(JSON.parse(JSON.stringify(req)) as OpenAiRequest);
      const next = this.script.shift();
      if (!next) throw new Error('script esgotado');
      if (next.text) onText(next.text);
      return next;
    },
    verify: async () => {
      if (this.verifyError) throw this.verifyError;
    },
  });
}

describe('AI coach with OpenAI', () => {
  let dir: string;
  let server: Gt7Server;
  const fake = new FakeOpenAi();

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'gt7-server-coach-openai-'));
    server = await createApp({
      port: PORT,
      host: '127.0.0.1',
      webDist: null,
      firewall: { platform: 'linux' },
      hub: { keepAliveMs: 0 },
      runtime: { dataDir: join(dir, 'data'), record: false, persistConsoleIp: false },
      coach: { openaiFactory: fake.factory, env: {} },
    });
    await seedSyntheticData(server.runtime, [{ profile: 'amateur', laps: 2, seed: 4 }]);
    await server.app.listen({ port: PORT, host: '127.0.0.1' });
  }, 90_000);

  afterAll(async () => {
    await server?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts with both providers and no key', async () => {
    const c = (await call<CoachConfig>('GET', '/api/coach/config')).body;
    expect(c.hasKey).toBe(false);
    expect(c.provider).toBe('anthropic');
    expect(c.providers.map((p) => [p.provider, p.hasKey, p.envVar])).toEqual([
      ['anthropic', false, 'ANTHROPIC_API_KEY'],
      ['openai', false, 'OPENAI_API_KEY'],
    ]);
    const openai = c.providers[1]!;
    expect(openai.model).toBe('gpt-5');
    expect(openai.models.map((m) => m.id)).toContain('gpt-5-mini');
    const ask = await call('POST', '/api/coach/ask', { message: 'Quais são meus pontos fracos?' });
    expect(ask.status).toBe(400);
    expect(JSON.stringify(ask.body)).toContain('noKey');
  });

  it('validates the OpenAI key and model, and keeps the providers apart', async () => {
    expect((await call('PUT', '/api/coach/config', { openaiApiKey: 'curta' })).status).toBe(400);
    expect(
      (await call('PUT', '/api/coach/config', { openaiModel: 'claude-opus-5-5' })).status,
    ).toBe(400);
    expect((await call('PUT', '/api/coach/config', { model: 'gpt-5' })).status).toBe(400);
    expect((await call('PUT', '/api/coach/config', { provider: 'gemini' })).status).toBe(400);

    const c = (
      await call<CoachConfig>('PUT', '/api/coach/config', {
        openaiApiKey: 'sk-test-abcdefghijklmnopqrstuvwxyz',
        openaiModel: 'gpt-5-mini',
      })
    ).body;
    // Only OpenAI has a key, so it becomes the active provider; the key is never returned.
    expect(c.provider).toBe('openai');
    expect(c.hasKey).toBe(true);
    expect(c.keyLast4).toBe('wxyz');
    expect(c.model).toBe('gpt-5-mini');
    expect(JSON.stringify(c)).not.toContain('sk-test');
    expect(c.providers[0]!.hasKey).toBe(false);
  });

  it('answers a free question with tools and keeps the chat going on OpenAI', async () => {
    fake.script = [
      turn({
        finishReason: 'tool_calls',
        toolCalls: [
          { id: 'call_1', type: 'function', function: { name: 'list_sessions', arguments: '{}' } },
        ],
      }),
      turn({ text: 'Seus tempos recentes estão estáveis.' }),
    ];
    const res = await call('POST', '/api/coach/ask', {
      message: 'Quais foram os tempos das minhas últimas sessões?',
    });
    expect(res.status).toBe(200);
    const events = parseSse(res.text);
    const names = events.map((e) => e.event);
    expect(names[0]).toBe('start');
    expect(names).toContain('tool');
    expect(names.at(-1)).toBe('done');
    const toolEvents = events.filter((e) => e.event === 'tool');
    expect(toolEvents.map((e) => [e.data.name, e.data.status])).toEqual([
      ['list_sessions', 'running'],
      ['list_sessions', 'done'],
    ]);
    const text = events
      .filter((e) => e.event === 'text')
      .map((e) => e.data.delta)
      .join('');
    expect(text).toBe('Seus tempos recentes estão estáveis.');
    const reportId = (events[0]!.data as { reportId: string }).reportId;
    expect(fake.keys[0]).toBe('sk-test-abcdefghijklmnopqrstuvwxyz');

    // First request: chat rules in the system prompt, GT7 tools, no chart tool (images).
    const first = fake.requests[0]!;
    expect(first.model).toBe('gpt-5-mini');
    const system = first.messages[0] as { role: string; content: string };
    expect(system.role).toBe('system');
    expect(system.content).toContain('CHAT do Coach IA');
    expect(first.tools.map((t) => t.function.name)).toContain('list_sessions');
    expect(first.tools.map((t) => t.function.name)).not.toContain('render_comparison_chart');
    // Second request carries the assistant tool call and the tool result.
    const second = fake.requests[1]!.messages;
    expect(second.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);

    const rep = (await call<CoachReport>('GET', `/api/coach/reports/${reportId}`)).body;
    expect(rep.kind).toBe('chat');
    expect(rep.model).toBe('gpt-5-mini');
    expect(rep.title).toBe('Quais foram os tempos das minhas últimas sessões?');
    expect(rep.markdown).toContain('estáveis');
    expect(rep.transcript.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(rep.transcript[1]!.tools).toEqual([{ name: 'list_sessions', isError: false }]);
    expect(rep.usage.requests).toBe(2);
    expect(rep.usage.cacheReadTokens).toBe(100);

    // A follow-up continues the same conversation, with the same provider.
    fake.script = [turn({ text: 'Claro, na T1 você perde 0,1 s.' })];
    const chat = await call('POST', '/api/coach/chat', { reportId, message: 'E na T1?' });
    expect(parseSse(chat.text).at(-1)?.event).toBe('done');
    const replay = fake.requests.at(-1)!.messages;
    expect(replay.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ]);
    expect((replay.at(-1) as { content: string }).content).toBe('E na T1?');
  });

  it('turns an OpenAI failure into a pt-BR error and keeps a failed first answer visible', async () => {
    fake.script = [];
    const res = await call('POST', '/api/coach/ask', { message: 'Oi' });
    const last = parseSse(res.text).at(-1)!;
    expect(last.event).toBe('error');
    expect(String(last.data.message)).toContain('Erro interno do coach');
    const id = String(last.data.reportId);
    const rep = (await call<CoachReport>('GET', `/api/coach/reports/${id}`)).body;
    expect(rep.status).toBe('error');
  });

  it('verifies the saved key', async () => {
    const ok = (await call<CoachVerifyResult>('POST', '/api/coach/verify', { provider: 'openai' }))
      .body;
    expect(ok).toMatchObject({ ok: true, provider: 'openai' });
    fake.verifyError = new OpenAiApiError(401, 'Incorrect API key');
    const bad = (await call<CoachVerifyResult>('POST', '/api/coach/verify', {})).body;
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('inválida');
    fake.verifyError = null;
    const none = (
      await call<CoachVerifyResult>('POST', '/api/coach/verify', { provider: 'anthropic' })
    ).body;
    expect(none).toMatchObject({ ok: false, provider: 'anthropic' });
  });
});

describe('OpenAI helpers', () => {
  it('tells the provider from the model id', () => {
    expect(providerOfModel('claude-opus-5-5')).toBe('anthropic');
    expect(providerOfModel('gpt-5')).toBe('openai');
    expect(providerOfModel('o4-mini')).toBe('openai');
  });

  it('maps API failures to pt-BR errors', () => {
    expect(openAiApiError(new OpenAiApiError(401, 'x')).code).toBe('invalidKey');
    expect(openAiApiError(new OpenAiApiError(429, 'x', 'insufficient_quota')).message).toContain(
      'crédito',
    );
    expect(openAiApiError(new OpenAiApiError(429, 'x')).code).toBe('rateLimited');
    expect(openAiApiError(new OpenAiApiError(503, 'x')).code).toBe('overloaded');
    expect(openAiApiError(new DOMException('a', 'AbortError')).code).toBe('aborted');
    expect(openAiApiError(new TypeError('fetch failed')).code).toBe('apiError');
  });

  it('answers the tool calls an aborted turn left open', () => {
    const messages: OpenAiMessage[] = [
      { role: 'user', content: 'oi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'list_sessions', arguments: '{}' } },
          { id: 'b', type: 'function', function: { name: 'list_laps', arguments: '{}' } },
        ],
      },
    ];
    sealOpenAiHistory(messages);
    expect(messages.slice(2).map((m) => m.role === 'tool' && m.tool_call_id)).toEqual(['a', 'b']);
    const before = messages.length;
    sealOpenAiHistory(messages);
    expect(messages.length).toBe(before);
  });

  it('converts MCP tools to function tools without the chart tool', () => {
    const tools = toOpenAiTools([
      { name: 'list_sessions', description: 'Sessões', input_schema: { properties: {} } },
      { name: 'render_comparison_chart', description: 'Gráfico', input_schema: {} },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      type: 'function',
      function: { name: 'list_sessions', parameters: { type: 'object' } },
    });
  });
});

describe('OpenAI streaming client', () => {
  const sse = (events: unknown[]) =>
    `${events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('')}`;

  function fakeFetch(body: string, status = 200, chunk = 17) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (status !== 200) {
        return new Response(
          JSON.stringify({ error: { message: 'Incorrect API key', code: 'x' } }),
          {
            status,
          },
        );
      }
      const bytes = new TextEncoder().encode(body);
      // Arbitrary chunk boundaries: events must survive being cut in the middle.
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
          c.close();
        },
      });
      return new Response(stream, { status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('streams text, assembles split tool calls and reads the usage', async () => {
    const body = sse([
      { choices: [{ delta: { content: 'Olá, ' } }] },
      { choices: [{ delta: { content: 'piloto.' } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_a', function: { name: 'list_sessions', arguments: '{"li' } },
              ],
            },
          },
        ],
      },
      {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'mit":3}' } }] } }],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, id: 'call_b', function: { name: 'list_laps', arguments: '{}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      {
        choices: [],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 15,
          prompt_tokens_details: { cached_tokens: 40 },
        },
      },
      '[DONE]',
    ]);
    const { impl, calls } = fakeFetch(body);
    const client = createOpenAiClient('sk-x', { fetchImpl: impl });
    const deltas: string[] = [];
    const res = await client.stream(
      {
        model: 'gpt-5',
        messages: [{ role: 'user', content: 'oi' }],
        tools: [
          {
            type: 'function',
            function: { name: 'list_sessions', description: '', parameters: {} },
          },
        ],
        maxTokens: 1000,
        reasoningEffort: 'high',
      },
      { onText: (d) => deltas.push(d) },
    );
    expect(deltas.join('')).toBe('Olá, piloto.');
    expect(res.text).toBe('Olá, piloto.');
    expect(res.finishReason).toBe('tool_calls');
    expect(res.toolCalls.map((c) => [c.id, c.function.name, c.function.arguments])).toEqual([
      ['call_a', 'list_sessions', '{"limit":3}'],
      ['call_b', 'list_laps', '{}'],
    ]);
    expect(res.usage).toEqual({ promptTokens: 120, completionTokens: 15, cachedTokens: 40 });

    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk-x');
    expect(sent).toMatchObject({
      model: 'gpt-5',
      stream: true,
      max_completion_tokens: 1000,
      reasoning_effort: 'high',
      tool_choice: 'auto',
    });
  });

  it('sends no reasoning effort to models that reject it, and no tools when there are none', async () => {
    const { impl, calls } = fakeFetch(
      sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }]),
    );
    await createOpenAiClient('sk-x', { fetchImpl: impl }).stream(
      {
        model: 'gpt-4.1',
        messages: [{ role: 'user', content: 'oi' }],
        tools: [],
        maxTokens: 10,
        reasoningEffort: 'high',
      },
      { onText: () => {} },
    );
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent.reasoning_effort).toBeUndefined();
    expect(sent.tools).toBeUndefined();
  });

  it('raises the API error with its status', async () => {
    const { impl } = fakeFetch('', 401);
    const client = createOpenAiClient('sk-bad', { fetchImpl: impl });
    await expect(client.verify()).rejects.toMatchObject({
      status: 401,
      message: 'Incorrect API key',
    });
    await expect(
      client.stream(
        { model: 'gpt-5', messages: [], tools: [], maxTokens: 1 },
        { onText: () => {} },
      ),
    ).rejects.toBeInstanceOf(OpenAiApiError);
  });
});
