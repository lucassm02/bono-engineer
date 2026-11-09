/**
 * Data folder of the stdio MCP server: `--data <dir>` / `--data=<dir>` > GT7_DATA / GT7_DATA_DIR >
 * the same per-user folder the app uses (`resolveDataDir()` of @gt7/core, e.g. `%APPDATA%\GT7 Race Engineer`).
 */

import { resolve } from 'node:path';
import { resolveDataDir } from '@gt7/core';

export function dataDirFromArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): string {
  const i = argv.indexOf('--data');
  if (i >= 0 && argv[i + 1]) return resolve(argv[i + 1]!);
  const eq = argv.find((a) => a.startsWith('--data='));
  if (eq) return resolve(eq.slice('--data='.length));
  return resolveDataDir({ env });
}
