/**
 * Engineer tasks (spec 20): the instructions the driver approved, said at their place on the lap.
 * Each task of the frame carries the clip keys of its sentence and the lap distances where the
 * sentence must be FINISHED (`atM`). The rule times the speech like the corner calls: it starts
 * when the sentence just fits before the point (speed, output latency and the driver's reaction
 * time included), never while braking or cornering, once per lap, at most N per lap, and not on
 * the out lap. Said at Essencial too: the driver asked for it.
 */

import { BRAKE_ON_THRESHOLD } from '../analysis.ts';
import type { LiveTask } from '../tasks.ts';
import { CORNERING_G } from './context.ts';
import { REACTION_MS } from './cues.ts';
import type { RadioCandidate, RadioRule } from './types.ts';

/** Two spoken points closer than this (m) are not both said: the older task wins. */
export const TASK_MIN_GAP_M = 150;
/** Starts the sentence at most this long (ms) before it has to start to finish at the point. */
export const TASK_LEAD_MS = 1500;
/** Duration (ms) assumed for the timing when the pack has no clip (the panel still shows it). */
const FALLBACK_MS = 3000;
/** Speeds under this (m/s) are too slow to time a call. */
const MIN_SPEED_MS = 8;

interface PlanItem {
  taskId: string;
  index: number;
  atM: number;
  keys: readonly string[];
  text: string;
  /** False: kept for the panel because an older task has a point within TASK_MIN_GAP_M. */
  speak: boolean;
}

interface TaskState {
  lap: number;
  spokenInLap: number;
  done: Set<string>;
  planKey: string;
  plan: PlanItem[];
}

const wrapDist = (m: number, lengthM: number) => ((m % lengthM) + lengthM) % lengthM;
const gapM = (a: number, b: number, lengthM: number) => {
  const d = Math.abs(wrapDist(a - b, lengthM));
  return Math.min(d, lengthM - d);
};

/** The points of the active tasks in creation order; a point near an older one stays on the panel. */
export function planTasks(tasks: readonly LiveTask[], lengthM: number): PlanItem[] {
  const plan: PlanItem[] = [];
  for (const t of tasks) {
    t.atM.forEach((atM, index) => {
      const clash = plan.some((p) => p.speak && gapM(p.atM, atM, lengthM) < TASK_MIN_GAP_M);
      plan.push({ taskId: t.id, index, atM, keys: t.keys, text: t.text, speak: !clash });
    });
  }
  return plan;
}

export const taskRule: RadioRule<TaskState> = {
  id: 'tasks',
  priority: 'instruction',
  modes: ['training', 'qualifying', 'race'],
  requires: ['progress'],
  init: () => ({ lap: -1, spokenInLap: 0, done: new Set(), planKey: '', plan: [] }),
  evaluate(ctx, s) {
    const { frame, config } = ctx;
    const settings = config.tasks;
    const tasks = frame.tasks;
    if (!tasks?.length || !settings.enabled || !settings.modes.includes(config.mode)) return [];
    if (ctx.phase === 'outLap') return [];
    const lengthM = frame.track?.lengthM;
    const d = frame.distanceM;
    if (!lengthM || d === null) return [];

    const lap = frame.lap.lap;
    if (lap !== s.lap) {
      s.lap = lap;
      s.spokenInLap = 0;
      s.done = new Set([...s.done].filter((k) => k.endsWith(`:${lap}`)));
    }
    const planKey = `${lengthM}|${tasks.map((t) => `${t.id}@${t.atM.join(',')}`).join(';')}`;
    if (planKey !== s.planKey) {
      s.planKey = planKey;
      s.plan = planTasks(tasks, lengthM);
    }

    const car = frame.car;
    const speed = Math.max(ctx.approachSpeedKmh, car.speedKmh) / 3.6;
    if (speed < MIN_SPEED_MS) return [];
    // Never start while braking or cornering: only on a straight.
    const busy =
      (car.brakeRaw ?? car.brake) >= BRAKE_ON_THRESHOLD ||
      Math.abs(frame.g?.lateral ?? 0) >= CORNERING_G;

    const out: RadioCandidate[] = [];
    for (const item of s.plan) {
      const key = `task:${item.taskId}:${item.index}:${lap}`;
      if (s.done.has(key)) continue;
      const aheadM = wrapDist(item.atM - d, lengthM);
      const etaMs = (aheadM / speed) * 1000;
      const budgetMs = etaMs - REACTION_MS - config.anticipationMs;
      const durationMs = ctx.utteranceMs([...item.keys]) ?? FALLBACK_MS;
      const slackMs = budgetMs - durationMs - ctx.outputLatencyMs;
      if (slackMs > TASK_LEAD_MS) continue; // not yet
      if (slackMs < 0) {
        s.done.add(key); // no longer fits before the point: skip it this lap
        continue;
      }
      if (busy) continue;
      const overLimit = s.spokenInLap >= settings.maxPerLap;
      const panelOnly = !item.speak || overLimit;
      out.push({
        key,
        utterance: [...item.keys],
        label: item.text,
        evidence: {
          taskId: item.taskId,
          atM: Math.round(item.atM),
          aheadM: Math.round(aheadM),
          speedKmh: Math.round(speed * 3.6),
          ...(panelOnly ? { reason: item.speak ? 'limite por volta' : 'tarefa próxima' } : {}),
        },
        deadlineT: ctx.t + etaMs - REACTION_MS - config.anticipationMs,
        approved: true,
        ...(panelOnly ? { panelOnly: true } : {}),
      });
    }
    return out;
  },
  delivered(candidate, s) {
    s.done.add(candidate.key);
    if (!candidate.panelOnly) s.spokenInLap++;
  },
};
