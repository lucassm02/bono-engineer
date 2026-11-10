/**
 * Programmatic server start: `startServer(options)` is everything `npm start` does except the
 * terminal (banner, signals, browser, Vite). main.ts is a thin CLI on top of it and the desktop
 * app (packages/desktop) calls it from Electron's main process.
 *
 * Steps: pick the port (or attach to an instance that is already running), create the app, listen,
 * start the optional demo console and the telemetry runtime, check the firewall.
 */

import type { Gt7RuntimeOptions } from '@gt7/core';
import { type CreateAppOptions, createApp, type Gt7Server } from './app.ts';
import type { ServerConfig } from './config.ts';
import { DemoConsole } from './sim.ts';
import { pickPort } from './startup.ts';

export type StartServerErrorKind = 'port-busy' | 'data' | 'listen';

/** Startup failure with a pt-BR message that is safe to show to the user. */
export class StartServerError extends Error {
  readonly kind: StartServerErrorKind;
  constructor(kind: StartServerErrorKind, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'StartServerError';
    this.kind = kind;
  }
}

export interface StartServerOptions {
  /** Parsed configuration (see `parseConfig`). The caller decides `webDist`, `dataDir`, `host`… */
  config: ServerConfig;
  /**
   * Called after the port was chosen and before the app is created, only when a server is really
   * going to start (main.ts builds the dashboard here).
   */
  prepare?: (cfg: ServerConfig) => Promise<void> | void;
  /** Start the telemetry runtime (UDP). Default true; tests that only need HTTP turn it off. */
  startRuntime?: boolean;
  /** Extra runtime options merged over the ones derived from `config` (tests). */
  runtimeOverrides?: Partial<Omit<Gt7RuntimeOptions, 'statusExtras'>>;
  /** Fastify test hooks forwarded to `createApp` (tests only). */
  appOverrides?: Partial<CreateAppOptions>;
}

export interface RunningServer {
  /**
   * True when a Bono Engineer of the same mode was already answering on the chosen port: no
   * new server was started, `server` is null and `stop()` does nothing.
   */
  attached: boolean;
  /** Configuration actually used (with the port that was picked). */
  config: ServerConfig;
  port: number;
  /** Address to open on this PC (http://localhost:<port>/, without the token). */
  url: string;
  /** Why the port is not the default one (null when it is, or when attached). */
  portNote: string | null;
  /** The live server (null when attached). */
  server: Gt7Server | null;
  demo: DemoConsole | null;
  /** Non-fatal problems found while starting (e.g. the UDP port is taken). */
  warnings: string[];
  /** Stops everything this call started. Idempotent. */
  stop(): Promise<void>;
}

/** Runtime options derived from the config (demo → fake console on alternate ports). */
export function runtimeOptions(cfg: ServerConfig): Omit<Gt7RuntimeOptions, 'statusExtras'> {
  const opts: Omit<Gt7RuntimeOptions, 'statusExtras'> = { dataDir: cfg.dataDir };
  if (cfg.sim) {
    opts.consoleIp = '127.0.0.1';
    opts.simulator = true;
    opts.persistConsoleIp = false; // the fake console's 127.0.0.1 never becomes a saved setting
    opts.ingestor = {
      bindAddress: '127.0.0.1',
      bindPort: cfg.sim.clientPort,
      consolePort: cfg.sim.consolePort,
      discovery: false,
    };
  } else if (cfg.consoleIp) {
    opts.consoleIp = cfg.consoleIp;
  }
  if (cfg.liveFormat) opts.liveFormat = cfg.liveFormat;
  if (cfg.record === false) opts.record = false;
  return opts;
}

export function udpBusyWarning(e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code;
  return code === 'EADDRINUSE'
    ? 'a porta UDP 33740 já está em uso (SimHub ou outro app de telemetria aberto?). ' +
        'O painel e o histórico funcionam, mas sem dados ao vivo.'
    : `a telemetria não iniciou: ${(e as Error).message}`;
}

export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  let cfg = opts.config;

  // Port: reuse the running instance, or the first free port from the default one.
  let portNote: string | null = null;
  if (!cfg.dev) {
    const choice = await pickPort(cfg.port, cfg.host, cfg.sim ? 'demo' : 'real', cfg.portExplicit);
    if (choice.kind === 'existing') {
      return {
        attached: true,
        config: { ...cfg, port: choice.port },
        port: choice.port,
        url: `http://localhost:${choice.port}/`,
        portNote: null,
        server: null,
        demo: null,
        warnings: [],
        stop: async () => {},
      };
    }
    if (choice.kind === 'busy') {
      throw new StartServerError(
        'port-busy',
        cfg.portExplicit
          ? `a porta ${choice.port} já está em uso por outro programa. Use --port com outro número.`
          : `nenhuma porta livre a partir da ${cfg.port}. Feche algum programa ou use --port.`,
      );
    }
    if (choice.skipped.length) {
      portNote = `a porta ${choice.skipped[0]} estava ocupada por outro programa; usando a ${choice.port}`;
    }
    cfg = { ...cfg, port: choice.port };
  }

  await opts.prepare?.(cfg);

  let server: Gt7Server;
  try {
    server = await createApp({
      runtime: { ...runtimeOptions(cfg), ...opts.runtimeOverrides },
      port: cfg.port,
      host: cfg.host,
      webDist: cfg.webDist,
      token: cfg.token,
      simulator: !!cfg.sim,
      logger: cfg.verbose,
      mcpStdioScript: cfg.mcpStdioScript ?? null,
      ...opts.appOverrides,
    });
  } catch (e) {
    throw new StartServerError(
      'data',
      `não consegui abrir os dados em ${cfg.dataDir}: ${(e as Error).message}`,
      e,
    );
  }

  try {
    await server.app.listen({ port: cfg.port, host: cfg.host });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    await server.close().catch(() => {});
    throw new StartServerError(
      'listen',
      code === 'EADDRINUSE'
        ? `a porta ${cfg.port} já está em uso (o app já está aberto?). Use --port para outra.`
        : `erro ao escutar em ${cfg.host}:${cfg.port}: ${(e as Error).message}`,
      e,
    );
  }

  const warnings: string[] = [];
  const demo = cfg.sim ? new DemoConsole(cfg.sim) : null;
  let stopping: Promise<void> | null = null;
  const stop = () => {
    stopping ??= (async () => {
      try {
        await server.close();
      } finally {
        await demo?.stop();
      }
    })();
    return stopping;
  };

  if (demo) {
    try {
      await demo.start();
    } catch (e) {
      warnings.push(`[sim] falha ao iniciar o console falso: ${(e as Error).message}`);
    }
  }
  if (opts.startRuntime !== false) {
    try {
      await server.runtime.start();
    } catch (e) {
      warnings.push(udpBusyWarning(e));
    }
  }
  await server.firewall.check().catch(() => null);

  return {
    attached: false,
    config: cfg,
    port: cfg.port,
    url: server.lan.localUrl(),
    portNote,
    server,
    demo,
    warnings,
    stop,
  };
}
