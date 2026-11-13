/**
 * /api/tasks — the engineer tasks (spec 20). The agent (MCP) or the in-app coach proposes; here the
 * driver lists, approves (PATCH status → active), edits, pauses and deletes. A task created here is
 * the driver's own and starts active. The sentence is composed by TaskService from the dictionary.
 */

import { createReadStream } from 'node:fs';
import { TaskError, type TaskService } from '@gt7/core';
import {
  type ApiTaskCreate,
  type ApiTaskList,
  type ApiTaskPatch,
  type ApiTaskPreview,
  type ApiTaskVoice,
  type EngineerTask,
  type EngineerTaskStatus,
  TASK_STATUSES,
  type TaskDictionaryView,
  type TaskMiss,
  type TaskSay,
  type TaskWhere,
} from '@gt7/shared';
import type { FastifyInstance } from 'fastify';
import {
  badRequest,
  bodyObject,
  conflict,
  HttpError,
  isSafeId,
  notFound,
  type Obj,
  queryString,
  reqString,
} from '../http.ts';
import type { RouteContext } from './context.ts';

const STATUS_SET: ReadonlySet<string> = new Set(TASK_STATUSES);

function idParam(params: unknown): string {
  const v = (params as Obj).id;
  if (typeof v !== 'string' || !isSafeId(v)) throw badRequest('Identificador inválido.');
  return v;
}

function plainObject(v: unknown, label: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw badRequest(`O campo "${label}" deve ser um objeto.`);
  }
  return v as Obj;
}

function optCarCode(b: Obj): number | null | undefined {
  const v = b.carCode;
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1_000_000) {
    throw badRequest('O campo "carCode" deve ser o código de um carro ou null.');
  }
  return v;
}

function optNote(b: Obj): string | null | undefined {
  const v = b.note;
  if (v === undefined || v === null) return v;
  if (typeof v !== 'string' || v.length > 400)
    throw badRequest('O campo "note" deve ser um texto.');
  return v;
}

/** TaskService refusals become HTTP errors (what is valid goes in the message). */
function asHttp(e: unknown): never {
  if (!(e instanceof TaskError)) throw e;
  const valid = e.valid?.length ? ` Válidos: ${e.valid.slice(0, 40).join(', ')}.` : '';
  const message = `${e.message}${valid}`;
  if (e.code === 'notFound') throw notFound(message);
  if (e.code === 'invalid') throw badRequest(message, 'invalidTask');
  if (e.code === 'forbidden') throw new HttpError(403, 'forbidden', message);
  throw conflict(message, e.code === 'limit' ? 'taskLimit' : 'conflict');
}

function run<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    return asHttp(e);
  }
}

export function taskRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const tasks: TaskService = ctx.runtime.tasks;

  app.get('/tasks', async (req): Promise<ApiTaskList> => {
    const q = req.query as Obj;
    const trackId = queryString(q, 'trackId');
    if (trackId !== undefined && !isSafeId(trackId)) throw badRequest('Pista inválida.');
    const status = queryString(q, 'status');
    if (status !== undefined && !STATUS_SET.has(status)) throw badRequest('Status inválido.');
    return {
      tasks: tasks.list({
        ...(trackId ? { trackId } : {}),
        ...(status ? { status: status as EngineerTaskStatus } : {}),
      }),
      proposals: tasks.proposalsCount(),
    };
  });

  app.get('/tasks/dictionary', async (): Promise<TaskDictionaryView> => tasks.dictionary());

  app.get('/tasks/misses', async (): Promise<TaskMiss[]> => ctx.runtime.store.listTaskMisses());

  app.delete('/tasks/misses', async (): Promise<{ ok: true }> => {
    ctx.runtime.store.clearTaskMisses();
    return { ok: true };
  });

  // ---- the downloaded voice of the tasks (spec 20) --------------------------------------------

  const voiceParam = (v: unknown): string => {
    if (typeof v !== 'string' || !/^[a-z0-9-]{1,30}$/.test(v)) throw badRequest('Voz inválida.');
    return v;
  };

  app.get('/tasks/voice', async (req): Promise<ApiTaskVoice> => {
    return ctx.taskVoice.status(voiceParam(queryString(req.query as Obj, 'voice')));
  });

  /** The opt-in: turning it on with a voice starts the background download of that voice. */
  app.put('/tasks/voice', async (req): Promise<ApiTaskVoice> => {
    const b = bodyObject(req.body);
    if (typeof b.enabled !== 'boolean')
      throw badRequest('O campo "enabled" deve ser true ou false.');
    const voice = voiceParam(b.voice ?? 'alex');
    ctx.taskVoice.setEnabled(b.enabled);
    return b.enabled ? ctx.taskVoice.ensure(voice) : ctx.taskVoice.status(voice);
  });

  /** Downloads (or continues downloading) the voice; only when the driver allowed it. */
  app.post('/tasks/voice/download', async (req): Promise<ApiTaskVoice> => {
    const voice = voiceParam(bodyObject(req.body).voice);
    if (!ctx.taskVoice.enabled) {
      throw conflict('Ative o download da voz das tarefas primeiro.', 'voiceDisabled');
    }
    return ctx.taskVoice.ensure(voice);
  });

  app.delete('/tasks/voice', async (req): Promise<ApiTaskVoice> => {
    return ctx.taskVoice.remove(voiceParam(queryString(req.query as Obj, 'voice')));
  });

  app.get('/tasks/voice/file/:file', async (req, reply) => {
    const file = (req.params as Obj).file;
    const found = typeof file === 'string' ? await ctx.taskVoice.servable(file) : null;
    if (!found) throw notFound('Pacote de voz não encontrado.');
    return reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-length', found.bytes)
      .type('audio/wav')
      .send(createReadStream(found.path));
  });

  /** Composes without creating anything: the editor's live preview and "Ouvir". */
  app.post('/tasks/preview', async (req): Promise<ApiTaskPreview> => {
    const b = bodyObject(req.body);
    const trackId = reqString(b, 'trackId', 'trackId', 80);
    if (!isSafeId(trackId)) throw badRequest('Pista inválida.');
    return run(() =>
      tasks.preview(
        trackId,
        plainObject(b.where, 'where') as TaskWhere,
        plainObject(b.say, 'say') as unknown as TaskSay,
      ),
    );
  });

  /** The driver's own task: starts active. */
  app.post('/tasks', async (req, reply): Promise<EngineerTask> => {
    const b = bodyObject(req.body) as Obj & Partial<ApiTaskCreate>;
    const trackId = reqString(b, 'trackId', 'trackId', 80);
    if (!isSafeId(trackId)) throw badRequest('Pista inválida.');
    const carCode = optCarCode(b);
    const note = optNote(b);
    const r = run(() =>
      tasks.propose({
        trackId,
        carCode: carCode ?? null,
        where: plainObject(b.where, 'where') as TaskWhere,
        say: plainObject(b.say, 'say') as unknown as TaskSay,
        ...(note !== undefined ? { note } : {}),
        source: 'driver',
      }),
    );
    reply.code(201);
    return r.task!;
  });

  app.patch('/tasks/:id', async (req): Promise<EngineerTask> => {
    const id = idParam(req.params);
    const b = bodyObject(req.body) as Obj & Partial<ApiTaskPatch>;
    const carCode = optCarCode(b);
    const note = optNote(b);
    const status = b.status;
    if (status !== undefined && !STATUS_SET.has(status)) throw badRequest('Status inválido.');
    const where = b.where === undefined ? undefined : (plainObject(b.where, 'where') as TaskWhere);
    const say = b.say === undefined ? undefined : (plainObject(b.say, 'say') as unknown as TaskSay);
    return run(() => {
      let t: EngineerTask | null = null;
      if (where !== undefined || say !== undefined || carCode !== undefined || note !== undefined) {
        t = tasks.update(id, {
          ...(where ? { where } : {}),
          ...(say ? { say } : {}),
          ...(carCode !== undefined ? { carCode } : {}),
          ...(note !== undefined ? { note } : {}),
        });
      }
      if (status !== undefined) t = tasks.setStatus(id, status);
      if (!t) throw new TaskError('invalid', 'Nada para alterar.');
      return t;
    });
  });

  /** The radio said the task (a count for the panel; the engine itself keeps the once per lap). */
  app.post('/tasks/:id/spoken', async (req): Promise<{ ok: true }> => {
    const id = idParam(req.params);
    run(() => {
      if (!ctx.runtime.store.getTask(id)) throw new TaskError('notFound', 'Tarefa não encontrada.');
      tasks.markSpoken(id);
    });
    return { ok: true };
  });

  app.delete('/tasks/:id', async (req): Promise<{ ok: true }> => {
    run(() => tasks.remove(idParam(req.params)));
    return { ok: true };
  });
}
