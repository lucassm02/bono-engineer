/**
 * /api/session/*: the session in progress and "Pista de hoje" (spec 06). The hint is the driver's
 * choice of track, kept in memory by the core: it makes the session open with the track's line,
 * corners and reference loaded, and the first closed lap checks it against the geometry.
 */

import type { ApiSessionCurrent } from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import { badRequest, bodyObject, isSafeId, notFound, optBoolean } from '../http.ts';
import type { RouteContext } from './context.ts';

export function currentSessionRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { runtime, hub } = ctx;

  /** The open session (null while none) and what is known of its track. */
  app.get('/session/current', async (): Promise<ApiSessionCurrent> => runtime.getSessionCurrent());

  /**
   * Body `{ trackId: string | null, force?: boolean }`. `null` = "Reconhecer sozinho". Only saved
   * tracks are accepted (404 otherwise). `force` keeps the track even if the first lap disagrees.
   */
  app.put('/session/track-hint', async (req): Promise<ApiSessionCurrent> => {
    const b = bodyObject(req.body);
    if (!('trackId' in b)) throw badRequest('Informe "trackId" (uma pista salva ou null).');
    const id = b.trackId;
    if (id !== null && (typeof id !== 'string' || !isSafeId(id))) {
      throw badRequest('Identificador de pista inválido.');
    }
    const force = optBoolean(b, 'force', 'force');
    if (id !== null && !runtime.store.getTrack(id)) throw notFound('Pista não encontrada.');
    runtime.setTrackHint(id, { force: force === true });
    hub.scheduleStatus();
    return runtime.getSessionCurrent();
  });
}
