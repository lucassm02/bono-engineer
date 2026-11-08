/**
 * @gt7/server — Fastify HTTP + WebSocket server (0.0.0.0:8770), REST API, LAN/QR and Windows
 * Firewall helpers. Entry point: main.ts; `createApp` is the factory used by main.ts and tests.
 */

export const SERVER_PACKAGE = '@gt7/server';

export { type CreateAppOptions, createApp, type Gt7Server, SERVER_VERSION } from './app.ts';
export { parseConfig, type ServerConfig, SIM_CLIENT_PORT, SIM_CONSOLE_PORT } from './config.ts';
export { FirewallChecker, firewallRules } from './firewall.ts';
export { HttpError } from './http.ts';
export { type HubOptions, type HubSocket, WsHub } from './hub.ts';
export { LanResolver, lanAddresses } from './lan.ts';
export type { RouteContext, RouteModule } from './routes/index.ts';
export { DemoConsole } from './sim.ts';
