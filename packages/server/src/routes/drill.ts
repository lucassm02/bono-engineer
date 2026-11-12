/**
 * /api/drill — the corner drill (spec 18): GET the one in progress, POST to start one on a corner
 * of the track being driven, DELETE to stop it (the passes are kept with the session).
 * GET /api/sessions/:id/drills and /api/tracks/:id/drills?corner= list the stored ones.
 */

import {
  type ApiDrillStart,
  type ApiDrillState,
  type ApiDrillStop,
  type CornerDrill,
  drillSummary,
  GOAL_RANGE_MS,
} from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import {
  badRequest,
  bodyObject,
  conflict,
  isSafeId,
  notFound,
  type Obj,
  optNumber,
  queryString,
  reqString,
} from '../http.ts';
import type { RouteContext } from './context.ts';

function idParam(params: unknown, key = 'id'): string {
  const v = (params as Obj)[key];
  if (typeof v !== 'string' || !isSafeId(v)) throw badRequest('Identificador inválido.');
  return v;
}

export function drillRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { runtime } = ctx;
  const store = runtime.store;

  app.get('/drill', async (): Promise<ApiDrillState> => ({ drill: runtime.drill }));

  app.post('/drill', async (req): Promise<ApiDrillState> => {
    const b = bodyObject(req.body) as Obj & Partial<ApiDrillStart>;
    const cornerId = reqString(b, 'cornerId', 'cornerId', 20);
    const targetMs = optNumber(b, 'targetMs', 'targetMs', {
      min: 1000,
      max: GOAL_RANGE_MS[1],
    });
    const drill = runtime.startCornerDrill(cornerId, { targetMs: targetMs ?? null });
    if (!drill) {
      throw conflict(
        'Para treinar uma curva, dirija na pista: ela precisa estar identificada e ter curvas detectadas.',
        'noCorner',
      );
    }
    return { drill };
  });

  app.delete('/drill', async (): Promise<ApiDrillStop> => {
    const drill = runtime.stopCornerDrill();
    return { drill, summary: drill ? drillSummary(drill.passes) : null };
  });

  app.get('/sessions/:id/drills', async (req): Promise<CornerDrill[]> => {
    const id = idParam(req.params);
    if (!store.getSession(id)) throw notFound('Sessão não encontrada.');
    return store.listDrills(id);
  });

  app.get('/tracks/:id/drills', async (req): Promise<CornerDrill[]> => {
    const id = idParam(req.params);
    if (!store.getTrack(id)) throw notFound('Pista não encontrada.');
    const corner = queryString(req.query as Obj, 'corner');
    if (!corner || corner.length > 20) throw badRequest('Informe a curva em "corner".');
    return store.listDrillsForCorner(id, corner);
  });
}
