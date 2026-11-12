/**
 * Server factory (used by main.ts and the tests): Fastify + WebSocket hub + REST API + static
 * dashboard, wired to a Gt7Runtime created here (so `statusExtras` reports LAN URLs and devices).
 */

import fastifyWebsocket from '@fastify/websocket';
import { Gt7Runtime, type Gt7RuntimeOptions } from '@gt7/core';
import { MCP_HTTP_PATH, mountMcpHttp } from '@gt7/mcp';
import { DEFAULT_HTTP_PORT, WS_PATH } from '@gt7/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import appPackage from '../../../package.json' with { type: 'json' };
import { registerAuth, registerOriginGuard } from './auth.ts';
import { CoachService, type CoachServiceOptions } from './coach/service.ts';
import { DailyRacesService, type DailyServiceOptions } from './events/daily-service.ts';
import { FirewallChecker, type FirewallCheckerOptions } from './firewall.ts';
import { type HubOptions, type HubSocket, WsHub } from './hub.ts';
import { INSTANCE_HEADER } from './identity.ts';
import { type InterfacesFn, LanResolver } from './lan.ts';
import { type RouteContext, type RouteModule, registerApi } from './routes/index.ts';
import { registerWeb } from './web.ts';

export const SERVER_VERSION = appPackage.version;

/** Max WebSocket message from a client (device profiles are a few KB). */
const WS_MAX_PAYLOAD = 256 * 1024;

export interface CreateAppOptions {
  /** Options of the Gt7Runtime created by the factory (`statusExtras` is set by the server). */
  runtime?: Omit<Gt7RuntimeOptions, 'statusExtras' | 'serverVersion'>;
  /** Public HTTP port (LAN URLs, firewall rule). Default 8770. */
  port?: number;
  /** Bind host, used to compute LAN URLs. Default 0.0.0.0. */
  host?: string;
  /** Built dashboard dir (packages/web/dist); null/missing → friendly "run npm run build" page. */
  webDist?: string | null;
  /** Optional access token for /api and /ws. */
  token?: string | null;
  serverVersion?: string;
  /** Demo mode flag (reported in /api/status). */
  simulator?: boolean;
  firewall?: Omit<FirewallCheckerOptions, 'httpPort'>;
  /** Network interfaces source (tests). */
  interfaces?: InterfacesFn;
  hub?: Omit<HubOptions, 'serverVersion' | 'firewall'>;
  /** Daily Races (DG EDGE) overrides, for tests: a fake fetch, a clock, no network. */
  dailies?: Partial<Pick<DailyServiceOptions, 'fetchFn' | 'now' | 'sleep' | 'origin'>>;
  /** Fastify logger (default off; main.ts prints its own messages). */
  logger?: boolean;
  /** Extra REST route modules mounted under /api (later waves). */
  extraRoutes?: RouteModule[];
  /** Mount the MCP server (Streamable HTTP) at /mcp (default true). */
  mcp?: boolean;
  /** Bundled MCP stdio server of the desktop app (see ServerConfig.mcpStdioScript). */
  mcpStdioScript?: string | null;
  /** In-app AI coach options (tests inject a fake Claude client factory). */
  coach?: CoachServiceOptions;
}

export interface Gt7Server {
  app: FastifyInstance;
  runtime: Gt7Runtime;
  hub: WsHub;
  lan: LanResolver;
  firewall: FirewallChecker;
  coach: CoachService;
  /** Stops accepting connections, closes sockets, the runtime (UDP) and the store. */
  close(): Promise<void>;
}

export async function createApp(opts: CreateAppOptions = {}): Promise<Gt7Server> {
  const port = opts.port ?? DEFAULT_HTTP_PORT;
  const host = opts.host ?? '0.0.0.0';
  const token = opts.token || null;
  const serverVersion = opts.serverVersion ?? SERVER_VERSION;

  const lan = new LanResolver({
    port,
    host,
    token,
    ...(opts.interfaces ? { interfaces: opts.interfaces } : {}),
  });
  const firewall = new FirewallChecker({ ...opts.firewall, httpPort: port });

  let hub: WsHub | null = null;
  const runtime = new Gt7Runtime({
    ...opts.runtime,
    serverVersion,
    statusExtras: () => ({ lanUrls: lan.urls(), devices: hub?.devices() ?? [] }),
  });
  hub = new WsHub(runtime, { ...opts.hub, serverVersion, firewall: () => firewall.status });
  const wsHub = hub;
  const coach = new CoachService(runtime, opts.coach);
  const dailies = new DailyRacesService({
    dataDir: runtime.store.dataDir,
    appVersion: serverVersion,
    enabled: {
      get: () => runtime.store.getSetting<boolean | null>('events.dgEdge.enabled', null),
      set: (value) => runtime.store.setSetting('events.dgEdge.enabled', value),
    },
    ...opts.dailies,
  });

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1024 * 1024,
    forceCloseConnections: true,
  });

  try {
    // Identity first, so even a 401/403 tells a second `npm start` "the app is already open here".
    app.addHook('onRequest', async (_req, reply) => {
      reply.header(INSTANCE_HEADER, opts.simulator ? 'demo' : 'real');
    });
    registerOriginGuard(app);
    registerAuth(app, token);
    await app.register(fastifyWebsocket, { options: { maxPayload: WS_MAX_PAYLOAD } });
    app.get(WS_PATH, { websocket: true }, (socket, req) => {
      wsHub.attach(socket as HubSocket, {
        ip: req.ip,
        ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
      });
    });

    const ctx: RouteContext = {
      runtime,
      hub: wsHub,
      lan,
      firewall,
      httpPort: port,
      tokenRequired: !!token,
      serverVersion,
      simulator: !!opts.simulator,
      coach,
      dailies,
      mcpStdioScript: opts.mcpStdioScript ?? null,
    };
    // Error/not-found handlers first: the /api child context inherits them at registration.
    await registerWeb(app, opts.webDist ?? null);
    await registerApi(app, ctx, opts.extraRoutes);
    if (opts.mcp !== false) {
      // Same store/analysis/runtime as the app: get_live_state works; --token protects it (auth.ts).
      mountMcpHttp(
        app,
        { store: runtime.store, analysis: runtime.analysis, runtime },
        { path: MCP_HTTP_PATH },
      );
    }
    await app.ready();
  } catch (e) {
    wsHub.closeAll();
    await coach.close().catch(() => {});
    await runtime.close().catch(() => {});
    throw e;
  }

  let closing: Promise<void> | null = null;
  const close = () => {
    closing ??= (async () => {
      wsHub.closeAll();
      await app.close().catch(() => {});
      await coach.close().catch(() => {});
      await runtime.close();
    })();
    return closing;
  };

  return { app, runtime, hub: wsHub, lan, firewall, coach, close };
}
