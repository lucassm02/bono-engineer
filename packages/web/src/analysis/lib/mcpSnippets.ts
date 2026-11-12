/**
 * Connection snippets for the MCP agents. The web (HTTP) endpoint is the main way: one address, no
 * paths of the PC in it. The local command (stdio) stays as an alternative for the Bono closed.
 */

import type { ApiMcpInfo } from '@gt7/shared';

const quote = (a: string) => (/[\s"'`$&|;<>()]/.test(a) ? `"${a.replaceAll('"', '\\"')}"` : a);
/** A TOML basic string (JSON escaping is valid TOML for paths and plain text). */
const toml = (s: string) => JSON.stringify(s);

/** Name of the environment variable that carries the token for Codex. */
export const CODEX_TOKEN_VAR = 'BONO_TOKEN';

/** Address of the MCP server of the running Bono (web / streamable HTTP). */
export function mcpWebUrl(info: ApiMcpInfo): string {
  return info.http.localUrl;
}

/** `claude mcp add` for the web endpoint (with the token header when the access is protected). */
export function claudeCodeWeb(info: ApiMcpInfo): string {
  const header = info.http.tokenRequired ? ' --header "Authorization: Bearer <seu-token>"' : '';
  return `claude mcp add --transport http bono ${mcpWebUrl(info)}${header}`;
}

/** `~/.codex/config.toml` block for the web endpoint. */
export function codexWebToml(info: ApiMcpInfo): string {
  return [
    '[mcp_servers.bono]',
    `url = ${toml(mcpWebUrl(info))}`,
    ...(info.http.tokenRequired ? [`bearer_token_env_var = ${toml(CODEX_TOKEN_VAR)}`] : []),
  ].join('\n');
}

/** `codex mcp add` line and the equivalent ~/.codex/config.toml block for the local command. */
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
