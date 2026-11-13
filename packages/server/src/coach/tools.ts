/**
 * Bridge between the in-app coach and the GT7 MCP tools: an MCP client connected in-process
 * (InMemoryTransport) to `createGt7McpServer`, so the coach and external MCP clients share ONE
 * source of truth for tools (names, schemas, outputs, limits). Only read-only tools are exposed
 * to the model (rename_* stay with the user), plus `propose_engineer_task`: the driver approves it.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Gt7Runtime } from '@gt7/core';
import { createGt7McpServer } from '@gt7/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

type BetaTool = Anthropic.Beta.BetaTool;
type ToolResultContent = Exclude<
  Anthropic.Beta.BetaToolResultBlockParam['content'],
  string | undefined
>;

export interface ToolCallOutcome {
  content: ToolResultContent;
  isError: boolean;
}

interface McpContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** The only tools that write: the coach may PROPOSE a task (the driver approves in the app). */
export const COACH_WRITE_TOOLS: ReadonlySet<string> = new Set(['propose_engineer_task']);

export class McpToolBridge {
  readonly #runtime: Gt7Runtime;
  #client: Promise<Client> | null = null;
  #tools: Promise<BetaTool[]> | null = null;

  constructor(runtime: Gt7Runtime) {
    this.#runtime = runtime;
  }

  #connect(): Promise<Client> {
    this.#client ??= (async () => {
      const rt = this.#runtime;
      const server = createGt7McpServer({
        store: rt.store,
        analysis: rt.analysis,
        runtime: rt,
        tasks: rt.tasks,
        taskSource: 'coach',
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: 'gt7-coach', version: '0.1.0' });
      await client.connect(clientTransport);
      return client;
    })().catch((e) => {
      this.#client = null;
      throw e;
    });
    return this.#client;
  }

  /** MCP tools as Claude tool definitions (stable order; read-only tools only). */
  tools(): Promise<BetaTool[]> {
    this.#tools ??= (async () => {
      const client = await this.#connect();
      const { tools } = await client.listTools();
      return tools
        .filter((t) => t.annotations?.readOnlyHint !== false || COACH_WRITE_TOOLS.has(t.name))
        .map(
          (t): BetaTool => ({
            name: t.name,
            description: [t.title, t.description].filter(Boolean).join(' — ').slice(0, 1024),
            input_schema: {
              ...(t.inputSchema as Record<string, unknown>),
              type: 'object',
            } as BetaTool['input_schema'],
            // Streamed requests with client tools: inputs stream as generated; the MCP server
            // validates each input against its zod schema (invalid → isError result).
            eager_input_streaming: true,
          }),
        );
    })().catch((e) => {
      this.#tools = null;
      throw e;
    });
    return this.#tools;
  }

  /** Executes one tool call through the MCP client; never throws. */
  async call(name: string, input: unknown): Promise<ToolCallOutcome> {
    const allowed = (await this.tools()).some((t) => t.name === name);
    if (!allowed) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Ferramenta desconhecida: ${name}` }],
      };
    }
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Entrada inválida: esperado um objeto JSON.' }],
      };
    }
    try {
      const client = await this.#connect();
      const res = (await client.callTool({
        name,
        arguments: input as Record<string, unknown>,
      })) as { content?: McpContentItem[]; isError?: boolean };
      const content: ToolResultContent = [];
      for (const c of res.content ?? []) {
        if (c.type === 'text' && typeof c.text === 'string') {
          content.push({ type: 'text', text: c.text });
        } else if (c.type === 'image' && c.data && IMAGE_TYPES.has(c.mimeType ?? '')) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: c.mimeType as 'image/png',
              data: c.data,
            },
          });
        }
      }
      if (content.length === 0) content.push({ type: 'text', text: '(sem resultado)' });
      return { content, isError: !!res.isError };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Erro ao executar ${name}: ${(e as Error).message}` }],
      };
    }
  }

  async close(): Promise<void> {
    const c = this.#client;
    this.#client = null;
    this.#tools = null;
    if (c) await (await c.catch(() => null))?.close().catch(() => {});
  }
}
