/**
 * REST API under /api. Each area lives in its own file and receives the same RouteContext
 * (analysis.ts = `/api/analysis/*` over AnalysisService, coach.ts = in-app AI debrief).
 */

import { API_PREFIX } from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import { analysisRoutes } from './analysis.ts';
import { captureRoutes } from './capture.ts';
import { coachRoutes } from './coach.ts';
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
  analysisRoutes,
  coachRoutes,
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
