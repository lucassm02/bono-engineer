/**
 * The MCP stdio server as a function, so it has two entries: `stdio.ts` (repo, run with tsx) and
 * the desktop bundle `mcp-stdio.cjs` (packages/desktop/src/mcp-stdio.ts, run by the installed
 * app's executable with ELECTRON_RUN_AS_NODE=1). A CommonJS bundle cannot have top-level await,
 * hence the function. stdout is the protocol: every log goes to stderr.
 */

import { AnalysisService, Gt7Store } from '@gt7/core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dataDirFromArgs } from './data-dir.ts';
import { createGt7McpServer } from './server.ts';

export async function runStdio(argv: string[]): Promise<void> {
  // stdout belongs to the protocol: route stray console output to stderr
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;

  const dataDir = dataDirFromArgs(argv);
  const store = Gt7Store.open(dataDir);
  const analysis = new AnalysisService({ store, log: (m) => console.error(m) });
  const server = createGt7McpServer({ store, analysis });
  const transport = new StdioServerTransport();

  let closing = false;
  async function shutdown(code = 0): Promise<void> {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } catch {}
    await store.close();
    process.exit(code);
  }
  process.on('SIGINT', () => void shutdown(0));
  process.on('SIGTERM', () => void shutdown(0));
  process.stdin.on('end', () => void shutdown(0));
  transport.onclose = () => void shutdown(0);

  await server.connect(transport);
  console.error(`Bono Engineer MCP (stdio) pronto. Dados: ${dataDir}`);
}
