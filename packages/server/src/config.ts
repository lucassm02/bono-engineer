/**
 * Server configuration from CLI args + environment variables (CLI wins).
 *
 *   --port N          GT7_PORT        HTTP/WebSocket port (default 8770)
 *   --host ADDR       GT7_HOST        bind address (default 0.0.0.0 = whole LAN)
 *   --data DIR        GT7_DATA        data dir (default <repo>/data; with --sim <repo>/data/demo)
 *   --ps-ip IP        GT7_PS_IP       console IP (default: saved, else broadcast discovery)
 *   --format F        GT7_FORMAT      live packet format A | B | ~ | C (default: saved, else ~)
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
import { DEFAULT_HTTP_PORT, isPacketFormat, type PacketFormat } from '@gt7/shared';

/** Repository root (packages/server/src → ../../..). */
export const REPO_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const DEFAULT_WEB_DIST = join(REPO_ROOT, 'packages', 'web', 'dist');

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
  host: string;
  dataDir: string;
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
}

export class ConfigError extends Error {}

export const HELP_TEXT = `GT7 Race Engineer — servidor

Uso: npm start -- [opções]     (npm run demo = --sim, npm run dev = --dev)

  --port N          porta HTTP/WebSocket (padrão 8770; env GT7_PORT)
  --host ADDR       endereço de escuta (padrão 0.0.0.0 = toda a rede; env GT7_HOST)
  --data DIR        pasta de dados (padrão <repo>/data; com --sim, <repo>/data/demo; env GT7_DATA ou GT7_DATA_DIR)
  --ps-ip IP        IP do PlayStation (padrão: o salvo, senão busca na rede; env GT7_PS_IP)
  --format F        formato do pacote ao vivo: A | B | ~ | C (env GT7_FORMAT)
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

  const port = int(str('port') ?? env.GT7_PORT, 'port', 1, 65535) ?? DEFAULT_HTTP_PORT;
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

  const dataArg = str('data') ?? (env.GT7_DATA || env.GT7_DATA_DIR || undefined);
  const dataDir = dataArg
    ? resolve(dataArg)
    : simOn
      ? join(REPO_ROOT, 'data', 'demo')
      : join(REPO_ROOT, 'data');

  let open = !envFlag(env.GT7_NO_OPEN);
  if (values.open === true) open = true;
  if (values['no-open'] === true) open = false;

  return {
    port,
    host,
    dataDir,
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
