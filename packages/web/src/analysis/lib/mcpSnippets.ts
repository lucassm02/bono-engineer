/** Connection snippets for MCP agents the server does not already build (OpenAI Codex). */

import type { ApiMcpInfo } from '@gt7/shared';

const quote = (a: string) => (/[\s"'`$&|;<>()]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a);
/** A TOML basic string (JSON escaping is valid TOML for paths and plain text). */
const toml = (s: string) => JSON.stringify(s);

/** `codex mcp add` line and the equivalent ~/.codex/config.toml block. */
export function codexSnippets(info: ApiMcpInfo): { command: string; toml: string } {
  const { command, args, env } = info.stdio;
  const envEntries = Object.entries(env);
  const flags = envEntries.map(([k, v]) => ` --env ${k}=${quote(v)}`).join('');
  const block = [
    '[mcp_servers.bono]',
    `command = ${toml(command)}`,
    `args = [${args.map(toml).join(', ')}]`,
    ...(envEntries.length
      ? [`env = { ${envEntries.map(([k, v]) => `${k} = ${toml(v)}`).join(', ')} }`]
      : []),
  ].join('\n');
  return {
    command: `codex mcp add bono${flags} -- ${[command, ...args].map(quote).join(' ')}`,
    toml: block,
  };
}
