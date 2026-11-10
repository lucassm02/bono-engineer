/**
 * MCP stdio entry of the installed app, bundled as dist/mcp-stdio.cjs (inside app.asar). Run by the
 * app's own executable acting as Node:
 *   ELECTRON_RUN_AS_NODE=1 "Bono Engineer.exe" <...>\resources\app.asar\dist\mcp-stdio.cjs --data <dir>
 * The dashboard (Configurações → Integração com IA) shows the exact snippet with this
 * installation's paths (GET /api/mcp/info, see packages/server/src/routes/mcp-info.ts).
 */

import { runStdio } from '@gt7/mcp/stdio';

runStdio(process.argv.slice(2)).catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
