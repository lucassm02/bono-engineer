/**
 * /api/events/*: the Daily Races of the week, read from DG EDGE (see events/daily-service.ts).
 *
 *   GET  /api/events/dailies            the cached races (refreshed in the background when old)
 *   POST /api/events/dailies/refresh    a manual refresh (refused for ten minutes after any attempt)
 *   PUT  /api/events/dailies/enabled    `{ enabled: boolean }`: turns the integration on or off
 */

import type { FastifyInstance } from 'fastify';
import { badRequest, bodyObject } from '../http.ts';
import type { RouteContext } from './context.ts';

export function eventsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { dailies } = ctx;

  app.get('/events/dailies', async () => dailies.get());

  app.post('/events/dailies/refresh', async () => dailies.refresh());

  app.put('/events/dailies/enabled', async (req) => {
    const b = bodyObject(req.body);
    if (typeof b.enabled !== 'boolean') throw badRequest('Informe "enabled" (true ou false).');
    dailies.setEnabled(b.enabled);
    return dailies.snapshot();
  });
}
