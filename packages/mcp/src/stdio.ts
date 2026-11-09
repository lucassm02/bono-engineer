/**
 * MCP stdio entry (Claude Desktop / Claude Code). Opens the Gt7Store (read/write) on the data dir
 * from `--data <dir>`, env GT7_DATA / GT7_DATA_DIR or, by default, the same per-user folder as the app. stdout is the protocol: every log goes
 * to stderr. Run with:
 *   node --disable-warning=ExperimentalWarning --import tsx packages/mcp/src/stdio.ts --data <dir>
 */

import { AnalysisService, Gt7Store } from '@gt7/core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dataDirFromArgs } from './data-dir.ts';
import { createGt7McpServer } from './server.ts';

// stdout belongs to the protocol: route stray console output to stderr
console.log = console.error;
console.info = console.error;
console.debug = console.error;

const dataDir = dataDirFromArgs(process.argv.slice(2));
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
console.error(`gt7-mcp (stdio) pronto. Dados: ${dataDir}`);
