/**
 * REST API under /api. Each area lives in its own file and receives the same RouteContext; a later
 * wave adds `analysis.ts` (`/api/analysis/*`, AnalysisService) here.
 */

import { API_PREFIX } from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import { captureRoutes } from './capture.ts';
import type { RouteContext } from './context.ts';
import { deviceRoutes } from './devices.ts';
import { sessionRoutes } from './sessions.ts';
import { statusRoutes } from './status.ts';
import { trackRoutes } from './tracks.ts';

export type { RouteContext } from './context.ts';

export type RouteModule = (app: FastifyInstance, ctx: RouteContext) => void;

export const ROUTE_MODULES: RouteModule[] = [
  statusRoutes,
  sessionRoutes,
  trackRoutes,
  deviceRoutes,
  captureRoutes,
];

export async function registerApi(
  app: FastifyInstance,
  ctx: RouteContext,
  extra: RouteModule[] = [],
): Promise<void> {
  await app.register(
    async (api) => {
      api.addHook('onSend', async (_req, reply, payload) => {
        if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
        return payload;
      });
      for (const mod of [...ROUTE_MODULES, ...extra]) mod(api, ctx);
    },
    { prefix: API_PREFIX },
  );
}
