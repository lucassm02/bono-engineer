/**
 * Server configuration from CLI args + environment variables (CLI wins). `npm start` needs NO
 * argument: every option below is an advanced override.
 *
 *   --port N          GT7_PORT        HTTP/WebSocket port (default 8770; if busy, the next free one)
 *   --host ADDR       GT7_HOST        bind address (default 0.0.0.0 = whole LAN)
 *   --data DIR        GT7_DATA        data dir (default: per-user folder, see core/util/data-dir.ts;
 *                                     with --sim its `demo` subfolder)
 *   --ps-ip IP        GT7_PS_IP       console IP (default: saved, else automatic discovery)
 *   --format F        GT7_FORMAT      pin the live packet format A | B | ~ | C (default: automatic)
 *   --token T         GT7_TOKEN       require this token for /api and /ws
 *   --sim             GT7_SIM=1       demo: in-process fake console with synthetic laps
 *   --sim-profile P                   pro | amateur (default amateur)
 *   --sim-laps N                      restart the synthetic session every N laps (0 = endless)
 *   --sim-seed N                      synthetic seed (default 7)
 *   --sim-replay                      synthetic replay mode (smoothed inputs)
 *   --dev                             also run the Vite dev server (npm run dev -w @gt7/web)
 *   --open / --no-open GT7_NO_OPEN=1  open the browser at startup (default: open)
 *   --no-record                       do not record raw sessions
 *   --verbose                         Fastify request logs
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveDataDir } from '@gt7/core';
import { DEFAULT_HTTP_PORT, isPacketFormat, type PacketFormat, PRODUCT_NAME } from '@gt7/shared';

/** Repository root (packages/server/src → ../../..). */
export const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const DEFAULT_WEB_DIST = join(REPO_ROOT, 'packages', 'web', 'dist');
/** Where the data lived before the per-user folder existed (migrated once, then ignored). */
export const LEGACY_DATA_DIR = join(REPO_ROOT, 'data');

/** Alternate UDP ports for the in-process simulator, so a real console on 33739/33740 is untouched. */
export const SIM_CONSOLE_PORT = 47739;
export const SIM_CLIENT_PORT = 47740;

export interface SimConfig {
  profile: 'pro' | 'amateur';
  laps: number;
  seed: number;
  replay: boolean;
  consolePort: number;
  clientPort: number;
}

export interface ServerConfig {
  port: number;
  /** The port was given by the user (--port / GT7_PORT): no automatic fallback to another one. */
  portExplicit: boolean;
  host: string;
  dataDir: string;
  /** The data folder was given by the user (--data / GT7_DATA): no migration, no default folder. */
  dataDirExplicit: boolean;
  webDist: string;
  consoleIp: string | null;
  liveFormat: PacketFormat | null;
  token: string | null;
  sim: SimConfig | null;
  dev: boolean;
  open: boolean;
  record: boolean | null;
  verbose: boolean;
  help: boolean;
  /**
   * Bundled MCP stdio server (`mcp-stdio.cjs`) to hand to MCP clients instead of the repo's
   * `packages/mcp/src/stdio.ts`. Set only by the desktop app, whose executable runs it as Node with
   * ELECTRON_RUN_AS_NODE=1 (the installed app has no repo, no tsx and no .ts sources).
   */
  mcpStdioScript?: string | null;
}

export class ConfigError extends Error {}

export const HELP_TEXT = `${PRODUCT_NAME} — servidor

Uso normal: npm start   (sem nenhuma opção; npm run demo = demonstração, npm run dev = desenvolvimento)

Tudo abaixo é opcional, para usuários avançados:
  --port N          porta HTTP/WebSocket (padrão 8770; se estiver ocupada usa a próxima livre; env GT7_PORT)
  --host ADDR       endereço de escuta (padrão 0.0.0.0 = toda a rede; env GT7_HOST)
  --data DIR        pasta de dados (padrão: pasta do usuário do Bono Engineer, com subpasta demo em --sim; env GT7_DATA ou GT7_DATA_DIR)
  --ps-ip IP        fixa o IP do PlayStation (padrão: o app encontra sozinho; env GT7_PS_IP)
  --format F        fixa o formato do pacote ao vivo: A | B | ~ | C (padrão: automático; env GT7_FORMAT)
  --token T         exige este token na API e no WebSocket (env GT7_TOKEN)
  --sim             demonstração: console falso com voltas sintéticas (env GT7_SIM=1)
  --sim-profile P   pro | amateur (padrão amateur)
  --sim-laps N      reinicia a sessão sintética a cada N voltas (0 = sem fim)
  --sim-seed N      semente do gerador sintético (padrão 7)
  --sim-replay      dados sintéticos em modo replay
  --dev             também inicia o Vite (npm run dev -w @gt7/web) em http://localhost:5173
  --no-open         não abre o navegador (env GT7_NO_OPEN=1)
  --no-record       não grava as sessões brutas
  --verbose         logs de requisição do Fastify
  -h, --help        esta ajuda`;

function int(v: string | undefined, name: string, min: number, max: number): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`--${name} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return n;
}

function envFlag(v: string | undefined): boolean {
  return v === '1' || v === 'true' || v === 'yes';
}

export function parseConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        port: { type: 'string' },
        host: { type: 'string' },
        data: { type: 'string' },
        'ps-ip': { type: 'string' },
        format: { type: 'string' },
        token: { type: 'string' },
        sim: { type: 'boolean' },
        'sim-profile': { type: 'string' },
        'sim-laps': { type: 'string' },
        'sim-seed': { type: 'string' },
        'sim-replay': { type: 'boolean' },
        dev: { type: 'boolean' },
        open: { type: 'boolean' },
        'no-open': { type: 'boolean' },
        'no-record': { type: 'boolean' },
        verbose: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    }));
  } catch (e) {
    throw new ConfigError((e as Error).message);
  }
  const str = (k: string) => (typeof values[k] === 'string' ? (values[k] as string) : undefined);

  const portArg = int(str('port') ?? env.GT7_PORT, 'port', 1, 65535);
  const port = portArg ?? DEFAULT_HTTP_PORT;
  const host = str('host') ?? env.GT7_HOST ?? '0.0.0.0';
  const simOn = values.sim === true || envFlag(env.GT7_SIM);

  const fmt = str('format') ?? env.GT7_FORMAT;
  if (fmt !== undefined && !isPacketFormat(fmt)) {
    throw new ConfigError('--format deve ser A, B, ~ ou C.');
  }

  const psIp = str('ps-ip') ?? env.GT7_PS_IP;
  if (psIp !== undefined && !/^\d{1,3}(\.\d{1,3}){3}$/.test(psIp)) {
    throw new ConfigError('--ps-ip deve ser um IPv4 (ex.: 192.168.0.20).');
  }

  let sim: SimConfig | null = null;
  if (simOn) {
    const profile = str('sim-profile') ?? 'amateur';
    if (profile !== 'pro' && profile !== 'amateur') {
      throw new ConfigError('--sim-profile deve ser pro ou amateur.');
    }
    sim = {
      profile,
      laps: int(str('sim-laps'), 'sim-laps', 0, 1000) ?? 0,
      seed: int(str('sim-seed'), 'sim-seed', 0, 2 ** 31 - 1) ?? 7,
      replay: values['sim-replay'] === true,
      consolePort: SIM_CONSOLE_PORT,
      clientPort: SIM_CLIENT_PORT,
    };
  }

  const dataArg = str('data') || env.GT7_DATA || env.GT7_DATA_DIR || undefined;
  const dataDir = resolveDataDir({ override: dataArg, demo: simOn, env });

  let open = !envFlag(env.GT7_NO_OPEN);
  if (values.open === true) open = true;
  if (values['no-open'] === true) open = false;

  return {
    port,
    portExplicit: portArg !== undefined,
    host,
    dataDir,
    dataDirExplicit: !!dataArg,
    webDist: DEFAULT_WEB_DIST,
    consoleIp: psIp ?? null,
    liveFormat: fmt ?? null,
    token: str('token') ?? env.GT7_TOKEN ?? null,
    sim,
    dev: values.dev === true,
    open,
    record: values['no-record'] === true ? false : null,
    verbose: values.verbose === true,
    help: values.help === true,
  };
}

export function webDistExists(dir: string): boolean {
  return existsSync(join(dir, 'index.html'));
}
