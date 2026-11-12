import type { ApiMcpInfo } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { codexSnippets } from './mcpSnippets.ts';

const info = (over: Partial<ApiMcpInfo['stdio']>): ApiMcpInfo =>
  ({
    stdio: {
      command: 'C:\\Program Files\\Bono\\Bono.exe',
      args: ['app.asar\\mcp.cjs', '--data', 'C:\\Users\\Ana Maria\\Bono'],
      env: {},
      commandLine: '',
      npmCommandLine: null,
      ...over,
    },
  }) as ApiMcpInfo;

describe('codexSnippets', () => {
  it('quotes paths with spaces in the command and escapes backslashes in the TOML', () => {
    const s = codexSnippets(info({}));
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
