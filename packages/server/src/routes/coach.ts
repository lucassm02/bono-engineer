/**
 * /api/coach: in-app AI coach ("Debrief com IA"). Debrief and chat answer with Server-Sent Events
 * (`event: start|text|tool|done|error`); reports are persisted in coach_reports.
 */

import type {
  CoachDebriefRequest,
  CoachReport,
  CoachReportSummary,
  CoachSseEvent,
} from '@gt7/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { CoachError, type CoachRun } from '../coach/service.ts';
import {
  badRequest,
  bodyObject,
  HttpError,
  isSafeId,
  notFound,
  type Obj,
  optString,
  queryInt,
  queryString,
  reqString,
} from '../http.ts';
import type { RouteContext } from './context.ts';

/** Keep-alive comment interval on the SSE stream (proxies / idle sockets). */
const SSE_PING_MS = 15_000;

function start(fn: () => CoachRun): CoachRun {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CoachError) throw new HttpError(e.status, e.code, e.message);
    throw e;
  }
}

/** Streams a coach run as SSE on the raw response; aborts the model call on disconnect. */
async function streamRun(req: FastifyRequest, reply: FastifyReply, run: CoachRun): Promise<void> {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-coach-report-id': run.reportId,
  });
  res.flushHeaders?.();
  const ac = new AbortController();
  let finished = false;
  res.on('close', () => {
    if (!finished) ac.abort();
  });
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, SSE_PING_MS);
  ping.unref?.();
  const sink = {
    send(ev: CoachSseEvent) {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
    },
  };
  try {
    await run.execute(sink, ac.signal);
  } catch (e) {
    req.log.error(e, 'coach run failed');
    sink.send({
      event: 'error',
      data: { code: 'internal', message: `Erro interno do coach: ${(e as Error).message}` },
    });
  } finally {
    finished = true;
    clearInterval(ping);
    if (!res.writableEnded) res.end();
  }
}

export function coachRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const coach = ctx.coach;
  const store = ctx.runtime.store;

  app.get('/coach/config', async () => coach.config());

  app.put('/coach/config', async (req) => {
    const b = bodyObject(req.body);
    const known = ['apiKey', 'model', 'effort'];
    const unknown = Object.keys(b).filter((k) => !known.includes(k));
    if (unknown.length) throw badRequest(`Campo(s) desconhecido(s): ${unknown.join(', ')}.`);
    if (b.apiKey !== undefined && b.apiKey !== null && typeof b.apiKey !== 'string') {
      throw badRequest('O campo "apiKey" deve ser um texto (ou null para remover).');
    }
    const model = optString(b, 'model', 'model', 64);
    const effort = optString(b, 'effort', 'effort', 10);
    try {
      return coach.updateConfig({
        ...(b.apiKey !== undefined ? { apiKey: b.apiKey as string | null } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(effort !== undefined ? { effort: effort as 'low' | 'medium' | 'high' } : {}),
      });
    } catch (e) {
      if (e instanceof CoachError) throw new HttpError(e.status, e.code, e.message);
      throw e;
    }
  });

  app.post('/coach/debrief', async (req, reply) => {
    const b = req.body === undefined || req.body === null ? {} : bodyObject(req.body);
    const body: CoachDebriefRequest = {};
    const sessionId = optString(b, 'sessionId', 'sessionId', 128);
    const lapId = optString(b, 'lapId', 'lapId', 128);
    const ref = optString(b, 'ref', 'ref', 128);
    const focusCorner = optString(b, 'focusCorner', 'focusCorner', 60);
    const question = optString(b, 'question', 'question', 2000);
    if (sessionId) body.sessionId = sessionId;
    if (lapId) body.lapId = lapId;
    if (ref) body.ref = ref;
    if (focusCorner) body.focusCorner = focusCorner;
    if (question) body.question = question;
    const run = start(() => coach.startDebrief(body));
    await streamRun(req, reply, run);
  });

  app.post('/coach/chat', async (req, reply) => {
    const b = bodyObject(req.body);
    const reportId = reqString(b, 'reportId', 'reportId', 128);
    const message = reqString(b, 'message', 'message', 4000);
    const run = start(() => coach.startChat(reportId, message));
    await streamRun(req, reply, run);
  });

  app.get('/coach/reports', async (req): Promise<CoachReportSummary[]> => {
    const q = req.query as Obj;
    const trackId = queryString(q, 'trackId');
    if (trackId !== undefined && !isSafeId(trackId)) throw badRequest('trackId inválido.');
    const limit = queryInt(q, 'limit', 'limit', { min: 1, max: 500 }) ?? 50;
    return store.listCoachReports({ ...(trackId ? { trackId } : {}), limit });
  });

  app.get('/coach/reports/:id', async (req): Promise<CoachReport> => {
    const id = (req.params as Obj).id;
    if (typeof id !== 'string' || !isSafeId(id)) throw badRequest('Identificador inválido.');
    const r = store.getCoachReport(id);
    if (!r) throw notFound('Relatório não encontrado.');
    const { messages: _raw, ...report } = r;
    return report;
  });

  app.delete('/coach/reports/:id', async (req) => {
    const id = (req.params as Obj).id;
    if (typeof id !== 'string' || !isSafeId(id)) throw badRequest('Identificador inválido.');
    if (!store.deleteCoachReport(id)) throw notFound('Relatório não encontrado.');
    return { ok: true, id };
  });
}
