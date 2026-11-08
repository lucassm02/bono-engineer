/** /api/sessions, /api/laps, /api/references, /api/recordings. */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { ListLapsOptions } from '@gt7/core';
import type { Lap, ReferenceMeta, Session, SessionDetail } from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import {
  badRequest,
  bodyObject,
  conflict,
  isSafeId,
  notFound,
  type Obj,
  optNullableString,
  optNumber,
  optString,
  queryBool,
  queryInt,
  queryString,
} from '../http.ts';
import type { RouteContext } from './context.ts';

function idParam(params: unknown, key = 'id'): string {
  const v = (params as Obj)[key];
  if (typeof v !== 'string' || !isSafeId(v)) throw badRequest('Identificador inválido.');
  return v;
}

export function sessionRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { runtime } = ctx;
  const store = runtime.store;

  const getSession = (id: string): Session => {
    const s = store.getSession(id);
    if (!s) throw notFound('Sessão não encontrada.');
    return s;
  };
  const getLap = (id: string): Lap => {
    const l = store.getLap(id);
    if (!l) throw notFound('Volta não encontrada.');
    return l;
  };
  const isActive = (id: string) => runtime.session?.id === id;

  // ------------------------------------------------------------------------------- sessions

  app.get('/sessions', async (req) => {
    const q = req.query as Obj;
    const mode = queryString(q, 'mode');
    if (mode !== undefined && mode !== 'live' && mode !== 'replayCapture') {
      throw badRequest('O parâmetro "mode" deve ser live ou replayCapture.');
    }
    const trackId = queryString(q, 'trackId');
    const carCode = queryInt(q, 'carCode', 'carCode');
    return store.listSessions({
      ...(trackId ? { trackId } : {}),
      ...(carCode !== undefined ? { carCode } : {}),
      ...(mode ? { mode } : {}),
      limit: queryInt(q, 'limit', 'limit', { min: 1, max: 1000 }) ?? 200,
      offset: queryInt(q, 'offset', 'offset', { min: 0 }) ?? 0,
    });
  });

  app.get('/sessions/:id', async (req): Promise<SessionDetail> => {
    const id = idParam(req.params);
    const session = getSession(id);
    return { session, laps: store.listLaps(id), active: isActive(id) };
  });

  app.get('/sessions/:id/laps', async (req) => {
    const id = idParam(req.params);
    getSession(id);
    return store.listLaps(id);
  });

  app.delete('/sessions/:id', async (req) => {
    const id = idParam(req.params);
    getSession(id);
    if (isActive(id))
      throw conflict('Não é possível apagar a sessão em andamento.', 'sessionActive');
    await store.deleteSession(id);
    return { ok: true, id };
  });

  // ------------------------------------------------------------------------------------ laps

  app.get('/laps', async (req) => {
    const q = req.query as Obj;
    const sessionId = queryString(q, 'sessionId');
    const trackId = queryString(q, 'trackId');
    if (!sessionId && !trackId) {
      throw badRequest('Informe "sessionId" ou "trackId" para listar voltas.');
    }
    if (sessionId) {
      getSession(sessionId);
      return store.listLaps(sessionId);
    }
    const refs = queryString(q, 'references');
    if (refs !== undefined && !['include', 'exclude', 'only'].includes(refs)) {
      throw badRequest('O parâmetro "references" deve ser include, exclude ou only.');
    }
    const orderBy = queryString(q, 'orderBy');
    if (orderBy !== undefined && orderBy !== 'time' && orderBy !== 'startedAt') {
      throw badRequest('O parâmetro "orderBy" deve ser time ou startedAt.');
    }
    const carCode = queryInt(q, 'carCode', 'carCode');
    const validOnly = queryBool(q, 'validOnly');
    const limit = queryInt(q, 'limit', 'limit', { min: 1, max: 10000 });
    const opts: ListLapsOptions = {
      ...(carCode !== undefined ? { carCode } : {}),
      ...(validOnly !== undefined ? { validOnly } : {}),
      ...(refs === 'only' ? { referencesOnly: true } : {}),
      ...(refs === 'exclude' ? { includeReferences: false } : {}),
      ...(orderBy ? { orderBy } : {}),
      ...(limit !== undefined ? { limit } : {}),
    };
    return store.listLapsForTrack(trackId!, opts);
  });

  app.get('/laps/:id', async (req) => getLap(idParam(req.params)));

  app.delete('/laps/:id', async (req) => {
    const id = idParam(req.params);
    getLap(id);
    await store.deleteLap(id);
    return { ok: true, id };
  });

  /** Marks a lap as reference (or updates its metadata). */
  app.put('/laps/:id/reference', async (req) => {
    const id = idParam(req.params);
    const lap = getLap(id);
    const b = req.body === undefined || req.body === null ? {} : bodyObject(req.body);
    const source = optString(b, 'source', 'source', 20);
    if (source !== undefined && !['replayCapture', 'import', 'own'].includes(source)) {
      throw badRequest('O campo "source" deve ser replayCapture, import ou own.');
    }
    const prev = lap.referenceMeta;
    const driverName = optString(b, 'driverName', 'driverName', 80)?.trim();
    const carName = optNullableString(b, 'carName', 'carName', 80);
    const notes = optNullableString(b, 'notes', 'notes', 500);
    const meta: ReferenceMeta = {
      driverName: driverName || prev?.driverName || 'Você',
      source: (source as ReferenceMeta['source'] | undefined) ?? prev?.source ?? 'own',
      rankingTimeMs:
        optNumber(b, 'rankingTimeMs', 'rankingTimeMs', { min: 1, max: 3_600_000 }) ??
        prev?.rankingTimeMs ??
        null,
      carName: carName === undefined ? (prev?.carName ?? null) : carName,
      notes: notes === undefined ? (prev?.notes ?? null) : notes,
      capturedAt: prev?.capturedAt ?? Date.now(),
    };
    const saved = store.setReference(id, meta);
    runtime.refreshTrack();
    return saved;
  });

  app.delete('/laps/:id/reference', async (req) => {
    const id = idParam(req.params);
    getLap(id);
    const saved = store.setReference(id, null);
    runtime.refreshTrack();
    return saved;
  });

  // ------------------------------------------------------------------------------ references

  app.get('/references', async (req) => {
    const trackId = queryString(req.query as Obj, 'trackId');
    return store.listReferenceLaps(trackId);
  });

  // ------------------------------------------------------------------------------ recordings

  app.get('/recordings/:sessionId', async (req, reply) => {
    const id = idParam(req.params, 'sessionId');
    const s = getSession(id);
    if (!s.recordingFile) throw notFound('Esta sessão não tem gravação.', 'noRecording');
    const abs = resolve(store.dataDir, s.recordingFile);
    const rel = relative(store.dataDir, abs);
    if (rel.startsWith('..') || resolve(store.dataDir, rel) !== abs) {
      throw badRequest('Caminho de gravação inválido.');
    }
    if (!existsSync(abs)) throw notFound('Arquivo de gravação não encontrado.', 'noRecording');
    const size = statSync(abs).size;
    reply
      .type('application/octet-stream')
      .header('content-disposition', `attachment; filename="gt7-${id}.gt7rec"`)
      .header('cache-control', 'no-store');
    // A session in progress is still being written: do not promise a length.
    if (!isActive(id)) reply.header('content-length', String(size));
    return reply.send(createReadStream(abs));
  });
}
