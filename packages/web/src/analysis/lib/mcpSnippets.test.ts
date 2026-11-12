import type { ApiMcpInfo } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { claudeCodeWeb, codexSnippets, codexWebToml, mcpWebUrl } from './mcpSnippets.ts';

const info = (stdio: Partial<ApiMcpInfo['stdio']> = {}, tokenRequired = false): ApiMcpInfo =>
  ({
    stdio: {
      command: 'C:\\Program Files\\Bono\\Bono.exe',
      args: ['app.asar\\mcp.cjs', '--data', 'C:\\Users\\Ana Maria\\Bono'],
      env: {},
      commandLine: '',
      npmCommandLine: null,
      ...stdio,
    },
    http: {
      path: '/mcp',
      localUrl: 'http://localhost:8770/mcp',
      lanUrls: [],
      tokenRequired,
    },
  }) as unknown as ApiMcpInfo;

describe('web (HTTP) snippets', () => {
  it('uses the address of the running Bono and no path of the PC', () => {
    const i = info();
    expect(mcpWebUrl(i)).toBe('http://localhost:8770/mcp');
    expect(claudeCodeWeb(i)).toBe('claude mcp add --transport http bono http://localhost:8770/mcp');
    expect(codexWebToml(i)).toBe('[mcp_servers.bono]\nurl = "http://localhost:8770/mcp"');
    expect(claudeCodeWeb(i)).not.toContain('Users');
  });

  it('asks for the token when the access is protected', () => {
    const i = info({}, true);
    expect(claudeCodeWeb(i)).toContain('--header "Authorization: Bearer <seu-token>"');
    expect(codexWebToml(i)).toContain('bearer_token_env_var = "BONO_TOKEN"');
  });
});

describe('codexSnippets (local command)', () => {
  it('quotes paths with spaces in the command and escapes backslashes in the TOML', () => {
    const s = codexSnippets(info());
    expect(s.command).toBe(
      'codex mcp add bono -- "C:\\Program Files\\Bono\\Bono.exe" app.asar\\mcp.cjs --data "C:\\Users\\Ana Maria\\Bono"',
    );
    expect(s.toml).toBe(
      [
        '[mcp_servers.bono]',
        'command = "C:\\\\Program Files\\\\Bono\\\\Bono.exe"',
        'args = ["app.asar\\\\mcp.cjs", "--data", "C:\\\\Users\\\\Ana Maria\\\\Bono"]',
      ].join('\n'),
    );
  });

  it('passes the environment of the installed app (Electron as Node)', () => {
    const s = codexSnippets(info({ env: { ELECTRON_RUN_AS_NODE: '1' } }));
    expect(s.command.startsWith('codex mcp add bono --env ELECTRON_RUN_AS_NODE=1 -- ')).toBe(true);
    expect(s.toml).toContain('env = { ELECTRON_RUN_AS_NODE = "1" }');
  });
});
