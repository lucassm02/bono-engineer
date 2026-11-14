/** /api/sessions, /api/laps, /api/references, /api/recordings. */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ListLapsOptions } from '@gt7/core';
import {
  type ApiSessionPatch,
  type ApiSessionRace,
  type ApiSessionsKindBatch,
  deriveStints,
  ENGINEER_CUE_KINDS,
  type EngineerCueKind,
  type Lap,
  type ReferenceMeta,
  SESSION_KINDS,
  type Session,
  type SessionDetail,
  type SessionKind,
  type SessionSummary,
} from '@gt7/shared';
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
  reqString,
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
    const kind = queryString(q, 'kind');
    if (
      kind !== undefined &&
      kind !== 'none' &&
      !(SESSION_KINDS as readonly string[]).includes(kind)
    ) {
      throw badRequest('O parâmetro "kind" deve ser practice, qualifying, race ou none.');
    }
    const trackId = queryString(q, 'trackId');
    const carCode = queryInt(q, 'carCode', 'carCode');
    return store.listSessions({
      ...(kind ? { kind: kind as SessionKind | 'none' } : {}),
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
    const laps = store.listLaps(id);
    const stints = deriveStints(session.startedAt, laps, store.listSessionEvents(id));
    return { session, laps, stints, active: isActive(id) };
  });

  /** Parses the body of a kind change: a kind or null ("sem etiqueta"). */
  const parseKind = (b: Obj): SessionKind | null => {
    if (b.kind === null) return null;
    if (typeof b.kind === 'string' && (SESSION_KINDS as readonly string[]).includes(b.kind)) {
      return b.kind as SessionKind;
    }
    throw badRequest('"kind" deve ser practice, qualifying, race ou null.');
  };

  /** The driver sets the kind of a session (spec 21); the engine never overrides it afterwards. */
  app.patch('/sessions/:id', async (req): Promise<Session> => {
    const id = idParam(req.params);
    getSession(id);
    const body = bodyObject(req.body) as unknown as ApiSessionPatch;
    const kind = parseKind(body as unknown as Obj);
    if (isActive(id))
      runtime.engine.annotateSession({ kind, kindSource: kind === null ? null : 'user' });
    else store.setSessionKind(id, kind, 'user');
    return getSession(id);
  });

  /** The same kind for several sessions (the assistant of the history, the list menu). */
  app.patch('/sessions', async (req) => {
    const body = bodyObject(req.body) as unknown as ApiSessionsKindBatch;
    const kind = parseKind(body as unknown as Obj);
    const ids = (body as unknown as Obj).ids;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > 1000 ||
      !ids.every((x) => typeof x === 'string' && isSafeId(x))
    ) {
      throw badRequest('"ids" deve ser uma lista de 1 a 1000 identificadores de sessão.');
    }
    const active = ids.filter((x) => isActive(x as string)) as string[];
    // the open session lives in the engine (it would overwrite the store at its end)
    if (active.length > 0) {
      runtime.engine.annotateSession({ kind, kindSource: kind === null ? null : 'user' });
    }
    const changed = store.setSessionsKind(
      ids.filter((x) => !active.includes(x as string)) as string[],
      kind,
      'user',
    );
    return { ok: true, changed: changed + active.length };
  });

  /** The race of a session: its result and what happened (positions, cars, impacts). */
  app.get('/sessions/:id/race', async (req): Promise<ApiSessionRace> => {
    const id = idParam(req.params);
    return { session: getSession(id), events: store.listSessionEvents(id) };
  });

  /** Summary of the session (spec 12): best lap, pace, consistency, comparisons, tips. */
  app.get('/sessions/:id/summary', async (req): Promise<SessionSummary> => {
    const id = idParam(req.params);
    getSession(id);
    return runtime.analysis.getSessionSummary(id);
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

  app.get('/laps/:id/engineer-radio', async (req) => {
    const lap = getLap(idParam(req.params));
    return store.getEngineerRadioLogs(lap.id);
  });

  app.put('/laps/:id/engineer-radio', async (req) => {
    const lap = getLap(idParam(req.params));
    const body = bodyObject(req.body);
    const deviceId = reqString(body, 'deviceId', 'aparelho', 160);
    const referenceLapId = reqString(body, 'referenceLapId', 'referência', 160);
    if (!isSafeId(referenceLapId)) throw badRequest('Referência inválida.');
    if (!Array.isArray(body.calls) || body.calls.length === 0 || body.calls.length > 256) {
      throw badRequest('Informe entre 1 e 256 chamadas.');
    }
    const calls = body.calls.map((item) => {
      const row = bodyObject(item);
      const cornerId = reqString(row, 'cornerId', 'curva', 160);
      const kind = reqString(row, 'kind', 'tipo de chamada', 24);
      if (!(ENGINEER_CUE_KINDS as readonly string[]).includes(kind))
        throw badRequest('Tipo de chamada inválido.');
      const text = reqString(row, 'text', 'chamada', 120);
      const distanceM = optNumber(row, 'distanceM', 'posição da chamada', { min: 0, max: 100_000 });
      const actionDistanceM = optNumber(row, 'actionDistanceM', 'posição da ação', {
        min: 0,
        max: 100_000,
      });
      if (distanceM === undefined || actionDistanceM === undefined)
        throw badRequest('Informe as duas posições da chamada.');
      return { cornerId, kind: kind as EngineerCueKind, text, distanceM, actionDistanceM };
    });
    store.saveEngineerRadioLog(lap.id, { deviceId, referenceLapId, calls });
    return { ok: true };
  });

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
      // Renaming must not lose where the time came from (Onda 9a/10a).
      ...(prev?.timeSource ? { timeSource: prev.timeSource } : {}),
      ...(prev?.measuredTimeMs != null ? { measuredTimeMs: prev.measuredTimeMs } : {}),
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
    if (
      rel === '' ||
      rel.startsWith('..') ||
      isAbsolute(rel) ||
      resolve(store.dataDir, rel) !== abs
    ) {
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
