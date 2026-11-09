/**
 * `npm run desktop`: builds what is needed (dashboard, bundle) and opens the app in Electron.
 * Extra arguments go to the app. The Electron binary is downloaded on first use if npm skipped it.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDesktop, DESKTOP_DIR } from './build.ts';

const require = createRequire(import.meta.url);

export function electronBinary(): string {
  const pkgDir = dirname(require.resolve('electron/package.json'));
  if (!existsSync(join(pkgDir, 'path.txt'))) {
    console.log('[desktop] baixando o Electron (só na primeira vez)…');
    const r = spawnSync(process.execPath, [join(pkgDir, 'install.js')], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('não consegui baixar o Electron (veja a mensagem acima).');
  }
  return require('electron') as unknown as string;
}

async function main(): Promise<void> {
  await buildDesktop();
  const bin = electronBinary();
  console.log('[desktop] abrindo o app…');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // would turn Electron into plain Node
  const child = spawn(bin, [DESKTOP_DIR, ...process.argv.slice(2)], { stdio: 'inherit', env });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`[desktop] erro: ${(e as Error).message}`);
    process.exit(1);
  });
}
