/**
 * `npm run desktop:dist`: builds the bundle and packages the Windows app with electron-builder
 * into packages/desktop/release (NSIS installer for the current user + a portable .exe; neither
 * needs admin rights or code signing).
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktop, DESKTOP_DIR } from './build.ts';
import { electronBinary } from './dev.ts';

const require = createRequire(import.meta.url);

async function main(): Promise<void> {
  await buildDesktop();
  electronBinary(); // makes sure the Electron binary is in the cache
  const cli = join(dirname(require.resolve('electron-builder/package.json')), 'cli.js');
  console.log('[desktop] gerando o pacote para Windows (electron-builder)…');
  const env: NodeJS.ProcessEnv = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }; // never try to sign
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(process.execPath, [cli, '--win', '--x64', ...process.argv.slice(2)], {
    cwd: DESKTOP_DIR,
    stdio: 'inherit',
    env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log('[desktop] pronto: packages/desktop/release');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`[desktop] erro: ${(e as Error).message}`);
    process.exit(1);
  });
}
