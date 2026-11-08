/**
 * Streamable HTTP transport for the MCP server, mounted on a Fastify instance (the app server).
 *
 * Stateless mode (SDK guidance for simple servers): every POST creates a fresh McpServer +
 * transport, sharing one AnalysisService (and its caches) and the live runtime. GET/DELETE answer
 * 405 (no server-initiated streams / sessions). JSON responses are enabled.
 */

import { AnalysisService } from '@gt7/core';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { createGt7McpServer, type McpDeps } from './server.ts';

export const MCP_HTTP_PATH = '/mcp';

export interface MountMcpHttpOptions {
  /** Route path (default '/mcp'). */
  path?: string;
  /** DNS rebinding protection: allowed Host header values (e.g. ['localhost:8770']). */
  allowedHosts?: string[];
  allowedOrigins?: string[];
}

const jsonRpcError = (code: number, message: string) =>
  JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null });

/** Registers POST/GET/DELETE `path` on `app`, serving the GT7 MCP server (stateless). */
export function mountMcpHttp(
  app: FastifyInstance,
  deps: McpDeps,
  opts: MountMcpHttpOptions = {},
): void {
  const path = opts.path ?? MCP_HTTP_PATH;
  const shared: McpDeps = {
    ...deps,
    analysis: deps.analysis ?? deps.runtime?.analysis ?? new AnalysisService({ store: deps.store }),
  };
  const protect = !!(opts.allowedHosts?.length || opts.allowedOrigins?.length);

  app.post(path, async (req, reply) => {
    const server = createGt7McpServer(shared);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      ...(protect
        ? {
            enableDnsRebindingProtection: true,
            ...(opts.allowedHosts ? { allowedHosts: opts.allowedHosts } : {}),
            ...(opts.allowedOrigins ? { allowedOrigins: opts.allowedOrigins } : {}),
          }
        : {}),
    });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (e) {
      req.log.error(e, 'mcp request failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(jsonRpcError(-32603, 'Internal server error'));
      }
    }
  });

  app.route({
    method: ['GET', 'DELETE'],
    url: path,
    handler: async (_req, reply) =>
      reply
        .code(405)
        .header('allow', 'POST')
        .type('application/json')
        .send(jsonRpcError(-32000, 'Method not allowed: MCP stateless, use POST.')),
  });
}
