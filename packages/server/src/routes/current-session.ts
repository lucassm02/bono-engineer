/**
 * /api/session/*: the session in progress and "Pista de hoje" (spec 06). The hint is the driver's
 * choice of track, kept in memory by the core: it makes the session open with the track's line,
 * corners and reference loaded, and the first closed lap checks it against the geometry.
 */

import {
  type ApiSessionCurrent,
  isTyreCompound,
  MAX_WEAR_MULTIPLIER,
  type TyreCompound,
} from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import { badRequest, bodyObject, conflict, isSafeId, notFound, optBoolean } from '../http.ts';
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

  /** Body `{ compound: TyreCompound | null }`: the tyres the driver says are on the car. */
  app.put('/session/tyres', async (req): Promise<{ compound: TyreCompound | null }> => {
    const b = bodyObject(req.body);
    if (!('compound' in b)) throw badRequest('Informe "compound" (um pneu ou null).');
    const c = b.compound;
    if (c !== null && !isTyreCompound(c)) throw badRequest('Pneu desconhecido.');
    const compound = runtime.setTyreCompound(c);
    hub.scheduleStatus();
    return { compound };
  });

  /** Body `{ visitId, compound }`: a replacement compound, or null to keep the same set. */
  app.put('/session/pit-tyres', async (req) => {
    const { visitId, compound } = bodyObject(req.body);
    if (typeof visitId !== 'string' || !isSafeId(visitId))
      throw badRequest('Parada no box inválida.');
    if (compound !== null && !isTyreCompound(compound)) throw badRequest('Pneu desconhecido.');
    if (!runtime.confirmPitTyres(visitId, compound))
      throw conflict('A decisão de pneus dessa parada já foi encerrada.', 'pitTyresExpired');
    hub.scheduleStatus();
    return { ok: true };
  });

  app.post('/session/tyre-wear-warning', async (req) => {
    const { sessionId, setNumber, stage = 'pit' } = bodyObject(req.body);
    if (
      typeof sessionId !== 'string' ||
      !isSafeId(sessionId) ||
      typeof setNumber !== 'number' ||
      !Number.isSafeInteger(setNumber) ||
      setNumber < 1
    )
      throw badRequest('Identificação do jogo de pneus inválida.');
    if (stage !== 'prepare' && stage !== 'pit') throw badRequest('Etapa de aviso inválida.');
    if (!runtime.recordTyreWearWarning(sessionId, setNumber, stage))
      throw conflict('Esse jogo de pneus deixou de estar ativo.');
    return { ok: true };
  });

  /** Body `{ multiplier: number }`: the tyre wear rate the game is set to. */
  app.put('/session/tyre-wear-rate', async (req): Promise<{ multiplier: number }> => {
    const b = bodyObject(req.body);
    const m = b.multiplier;
    if (typeof m !== 'number' || !Number.isFinite(m))
      throw badRequest(`Informe "multiplier" (0 a ${MAX_WEAR_MULTIPLIER}).`);
    const multiplier = runtime.setWearMultiplier(m);
    hub.scheduleStatus();
    return { multiplier };
  });
}
