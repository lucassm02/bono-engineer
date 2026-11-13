/**
 * Engineer tasks (spec 20): the rules around the dictionary. An agent (MCP) or the in-app coach
 * only ever PROPOSES; the driver approves, pauses and removes. The sentence is composed here, once,
 * from the dictionary, and stored with its piece ids; the radio plays what is stored.
 *
 * Shared by the MCP tools and the REST routes so both behave the same.
 */

import {
  type ApiTaskPreview,
  composeTask,
  type EngineerTask,
  type EngineerTaskSource,
  type EngineerTaskStatus,
  type LiveTask,
  TASK_DICTIONARY_VERSION,
  TASK_LIMITS,
  type TaskComposeError,
  type TaskComposition,
  type TaskDictionaryView,
  type TaskSay,
  type TaskWhere,
  type Track,
  taskDictionaryView,
  taskPieceKey,
  taskTriggers,
} from '@gt7/shared';
import type { Gt7Store } from '../store/store.ts';
import { newId } from '../util/ids.ts';

export type TaskErrorCode = 'notFound' | 'invalid' | 'limit' | 'forbidden' | 'conflict';

/** A refusal with a pt-BR message (and, for a refused sentence, what is valid). */
export class TaskError extends Error {
  constructor(
    readonly code: TaskErrorCode,
    message: string,
    readonly valid?: readonly string[],
  ) {
    super(message);
    this.name = 'TaskError';
  }
}

export interface ProposeInput {
  trackId: string;
  carCode?: number | null;
  where: TaskWhere;
  say: TaskSay;
  note?: string | null;
  why?: string | null;
  /** `driver` tasks start active; the others wait for approval. */
  source: EngineerTaskSource;
  agent?: string | null;
  /** Compose and validate only; creates nothing and counts no miss. */
  dryRun?: boolean;
}

export interface ProposeResult {
  /** Absent in a dry run. */
  task: EngineerTask | null;
  composition: TaskComposition;
}

/** Statuses a driver may move a task to, from each status. */
const TRANSITIONS: Record<EngineerTaskStatus, readonly EngineerTaskStatus[]> = {
  proposed: ['active', 'dismissed'],
  active: ['paused', 'done', 'dismissed'],
  paused: ['active', 'done', 'dismissed'],
  done: ['active', 'dismissed'],
  dismissed: ['proposed', 'active'],
  stale: ['active', 'dismissed'],
};

const clip = (v: string | null | undefined, max: number): string | null => {
  const t = v?.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

function describeSay(say: TaskSay): string {
  return JSON.stringify(say ?? {}).slice(0, 280);
}

export class TaskService {
  constructor(
    readonly store: Gt7Store,
    /** Called after a change a screen may show (a new proposal, an approval...). */
    readonly onChange: () => void = () => {},
  ) {}

  dictionary(): TaskDictionaryView {
    return taskDictionaryView();
  }

  #track(trackId: string): Track {
    const track = this.store.getTrack(trackId);
    if (!track) throw new TaskError('notFound', 'Pista não encontrada.');
    return track;
  }

  /** Composes a request against a track (corners and lap length decide what `atM` means). */
  compose(trackId: string, where: TaskWhere, say: TaskSay) {
    const track = this.#track(trackId);
    return composeTask({ where, say }, { corners: track.corners, lengthM: track.lengthM });
  }

  /** The compose result as the API shows it (for the editor's live preview). */
  preview(trackId: string, where: TaskWhere, say: TaskSay): ApiTaskPreview {
    const r = this.compose(trackId, where, say);
    return r.ok
      ? {
          ok: true,
          text: r.composition.text,
          keys: r.composition.keys,
          estimatedMs: r.composition.estimatedMs,
        }
      : { ok: false, error: r.error };
  }

  #refuse(error: TaskComposeError, input: ProposeInput): never {
    if (!input.dryRun && error.code !== 'needsTrack') {
      this.store.recordTaskMiss(error.code, `${error.message} ${describeSay(input.say)}`);
    }
    throw new TaskError('invalid', error.message, error.valid);
  }

  /** Creates a proposal (or, for the driver, an active task). Throws TaskError. */
  propose(input: ProposeInput): ProposeResult {
    const track = this.#track(input.trackId);
    const composed = composeTask(
      { where: input.where, say: input.say },
      { corners: track.corners, lengthM: track.lengthM },
    );
    if (!composed.ok) this.#refuse(composed.error, input);
    const composition = (composed as { ok: true; composition: TaskComposition }).composition;
    if (input.dryRun) return { task: null, composition };

    if (this.store.countTasks() >= TASK_LIMITS.total) {
      throw new TaskError(
        'limit',
        `Há tarefas demais (${TASK_LIMITS.total}). Apague algumas no app.`,
      );
    }
    const driver = input.source === 'driver';
    if (!driver) {
      const open = this.store.countTasks({ trackId: input.trackId, status: 'proposed' });
      if (open >= TASK_LIMITS.proposalsPerTrack) {
        throw new TaskError(
          'limit',
          `Já há ${open} propostas esperando o piloto nesta pista. Peça para ele aprovar ou descartar antes.`,
        );
      }
    }
    const now = Date.now();
    const task = this.store.createTask({
      id: newId(),
      trackId: input.trackId,
      carCode: input.carCode ?? null,
      where: composition.where,
      say: input.say,
      ids: composition.ids,
      dictionaryVersion: TASK_DICTIONARY_VERSION,
      spoken: composition.text,
      note: clip(input.note, TASK_LIMITS.noteChars),
      why: clip(input.why, TASK_LIMITS.whyChars),
      source: input.source,
      agent: clip(input.agent, TASK_LIMITS.agentChars),
      status: driver ? 'active' : 'proposed',
      createdAt: now,
      updatedAt: now,
      approvedAt: driver ? now : null,
      spokenCount: 0,
      lastSpokenAt: null,
    });
    this.onChange();
    return { task, composition };
  }

  list(
    opts: { trackId?: string; status?: EngineerTaskStatus | readonly EngineerTaskStatus[] } = {},
  ) {
    return this.store.listTasks(opts);
  }

  proposalsCount(): number {
    return this.store.countTasks({ status: 'proposed' });
  }

  #get(id: string): EngineerTask {
    const t = this.store.getTask(id);
    if (!t) throw new TaskError('notFound', 'Tarefa não encontrada.');
    return t;
  }

  /** The driver changes the status (approve, pause, finish, dismiss). */
  setStatus(id: string, status: EngineerTaskStatus): EngineerTask {
    const t = this.#get(id);
    if (t.status === status) return t;
    if (!TRANSITIONS[t.status].includes(status)) {
      throw new TaskError('conflict', `Uma tarefa ${t.status} não pode passar a ${status}.`);
    }
    if (status === 'active') {
      const active = this.store
        .getActiveTasks(t.trackId, t.carCode)
        .filter((x) => x.id !== id && x.carCode === t.carCode).length;
      if (active >= TASK_LIMITS.activePerTrackCar) {
        throw new TaskError(
          'limit',
          `Já há ${TASK_LIMITS.activePerTrackCar} tarefas ativas para este carro nesta pista.`,
        );
      }
    }
    const next = this.store.updateTask(id, {
      status,
      ...(status === 'active' && t.approvedAt === null ? { approvedAt: Date.now() } : {}),
    })!;
    this.onChange();
    return next;
  }

  /** The driver edits a task: place, sentence, car or note; the sentence is composed again. */
  update(
    id: string,
    patch: { where?: TaskWhere; say?: TaskSay; carCode?: number | null; note?: string | null },
  ): EngineerTask {
    const t = this.#get(id);
    const next: Partial<EngineerTask> = {};
    if (patch.where !== undefined || patch.say !== undefined) {
      const r = this.compose(t.trackId, patch.where ?? t.where, patch.say ?? t.say);
      if (!r.ok) throw new TaskError('invalid', r.error.message, r.error.valid);
      next.where = r.composition.where;
      next.say = patch.say ?? t.say;
      next.ids = r.composition.ids;
      next.spoken = r.composition.text;
      next.dictionaryVersion = TASK_DICTIONARY_VERSION;
      if (t.status === 'stale') next.status = 'active';
    }
    if (patch.carCode !== undefined) next.carCode = patch.carCode;
    if (patch.note !== undefined) next.note = clip(patch.note, TASK_LIMITS.noteChars);
    const out = this.store.updateTask(id, next)!;
    this.onChange();
    return out;
  }

  /** An agent edits a proposal of its own kind that the driver has not decided yet. */
  agentUpdate(
    id: string,
    patch: { where?: TaskWhere; say?: TaskSay; note?: string | null; why?: string | null },
  ): EngineerTask {
    const t = this.#get(id);
    if (t.status !== 'proposed' || t.source === 'driver') {
      throw new TaskError(
        'forbidden',
        'Só dá para editar uma proposta que o piloto ainda não decidiu.',
      );
    }
    const updated = this.update(id, {
      ...(patch.where !== undefined ? { where: patch.where } : {}),
      ...(patch.say !== undefined ? { say: patch.say } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
    });
    if (patch.why !== undefined) {
      return this.store.updateTask(id, { why: clip(patch.why, TASK_LIMITS.whyChars) })!;
    }
    return updated;
  }

  /** An agent takes back a proposal that is still open. */
  withdraw(id: string): void {
    const t = this.#get(id);
    if (t.status !== 'proposed' || t.source === 'driver') {
      throw new TaskError('forbidden', 'Só dá para retirar uma proposta ainda não decidida.');
    }
    this.store.deleteTask(id);
    this.onChange();
  }

  /** The driver deletes a task. */
  remove(id: string): void {
    if (!this.store.deleteTask(id)) throw new TaskError('notFound', 'Tarefa não encontrada.');
    this.onChange();
  }

  markSpoken(id: string, at = Date.now()): void {
    this.store.markTaskSpoken(id, at);
  }

  /**
   * The tasks for the live frame: the active ones of this track and car, with the lap distances
   * where each sentence must finish. Tasks that point at something the track no longer has are
   * left out (and marked stale by `reconcileTrack`).
   */
  liveTasks(track: Track, carCode: number | null): LiveTask[] {
    const sorted = [...track.sectorGates].sort((a, b) => a.distanceM - b.distanceM);
    const sectorStartsM = sorted.length ? sorted.map((g) => g.distanceM) : undefined;
    const out: LiveTask[] = [];
    for (const t of this.store.getActiveTasks(track.id, carCode)) {
      const atM = taskTriggers(t.where, {
        corners: track.corners,
        lengthM: track.lengthM,
        ...(sectorStartsM ? { sectorStartsM } : {}),
      });
      const keys = t.ids.map((id) => taskPieceKey(id));
      if (atM.length === 0 || keys.some((k) => k === null)) continue;
      out.push({
        id: t.id,
        keys: keys as string[],
        atM,
        text: t.spoken['pt-BR'],
        texts: t.spoken,
        note: t.note,
      });
    }
    return out;
  }

  /** After the corners of a track changed: tasks that lost their place become `stale`. */
  reconcileTrack(track: Track): number {
    let stale = 0;
    for (const t of this.store.listTasks({
      trackId: track.id,
      status: ['active', 'paused', 'proposed'],
    })) {
      const atM = taskTriggers(t.where, { corners: track.corners, lengthM: track.lengthM });
      if (atM.length === 0) {
        this.store.updateTask(t.id, { status: 'stale' });
        stale++;
      }
    }
    if (stale > 0) this.onChange();
    return stale;
  }
}
