/**
 * MCP stdio entry (Claude Desktop / Claude Code). Opens the Gt7Store (read/write) on the data dir
 * from `--data <dir>`, env GT7_DATA / GT7_DATA_DIR or, by default, the same per-user folder as the
 * app. stdout is the protocol: every log goes to stderr. Run with:
 *   node --disable-warning=ExperimentalWarning --import tsx packages/mcp/src/stdio.ts --data <dir>
 * The installed desktop app ships the same server as `mcp-stdio.cjs` (see stdio-main.ts).
 */

import { runStdio } from './stdio-main.ts';

await runStdio(process.argv.slice(2));
