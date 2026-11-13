/**
 * Engineer tasks (spec 20): the contracts shared by the store, the REST API, the MCP tools, the
 * live frame and the app. The sentence is composed once (by `composeTask`, in the MCP or the API)
 * and stored; the radio only plays what is stored.
 *
 * Endpoints (JSON):
 *   GET    /api/tasks?trackId=&status=       → ApiTaskList
 *   POST   /api/tasks                        ← ApiTaskCreate → EngineerTask (the driver's own task, active)
 *   POST   /api/tasks/preview                ← ApiTaskCreate → ApiTaskPreview (composes, creates nothing)
 *   PATCH  /api/tasks/:id                    ← ApiTaskPatch → EngineerTask
 *   POST   /api/tasks/:id/spoken             → { ok: true } (the radio said it: counts it)
 *   DELETE /api/tasks/:id                    → { ok: true }
 *   GET    /api/tasks/dictionary             → TaskDictionaryView
 *   GET    /api/tasks/misses  DELETE same    → TaskMiss[] / { ok: true }
 *   GET    /api/tasks/voice?voice=alex       → ApiTaskVoice (state of the downloaded voice)
 *   PUT    /api/tasks/voice                  ← { enabled, voice? } → ApiTaskVoice (opt-in; starts the download)
 *   POST   /api/tasks/voice/download         ← { voice } → ApiTaskVoice
 *   DELETE /api/tasks/voice?voice=alex       → ApiTaskVoice
 *   GET    /api/tasks/voice/file/:file       → the audio (WAV)
 */

import type { Id } from './domain.ts';
import type { Language } from './language.ts';
import type { TaskComposeError, TaskSay, TaskWhere } from './radio/tasks.ts';

/** `proposed` waits for the driver; `stale`: the corner it refers to changed or disappeared. */
export const TASK_STATUSES = [
  'proposed',
  'active',
  'paused',
  'done',
  'dismissed',
  'stale',
] as const;
export type EngineerTaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_SOURCES = ['agent', 'coach', 'driver'] as const;
export type EngineerTaskSource = (typeof TASK_SOURCES)[number];

export const TASK_LIMITS = {
  /** Active tasks per track and car. */
  activePerTrackCar: 20,
  /** All tasks kept. */
  total: 200,
  /** Open proposals per track. */
  proposalsPerTrack: 10,
  noteChars: 140,
  whyChars: 280,
  agentChars: 60,
} as const;

export interface EngineerTask {
  id: Id;
  trackId: Id;
  /** Null = any car. */
  carCode: number | null;
  where: TaskWhere;
  say: TaskSay;
  /** The composed sentence: piece ids (stable) in speaking order. */
  ids: string[];
  /** The dictionary version it was composed with. */
  dictionaryVersion: number;
  /** The sentence in text, in each language (panel and approval screen). */
  spoken: Record<Language, string>;
  /** Free text shown on the panel only (never spoken). */
  note: string | null;
  /** Why the agent asks for it, shown on the approval screen and the panel. */
  why: string | null;
  source: EngineerTaskSource;
  /** Name the agent gave itself ("claude-code", "chatgpt"...). */
  agent: string | null;
  status: EngineerTaskStatus;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
  spokenCount: number;
  lastSpokenAt: number | null;
}

/** A request the dictionary could not say, counted to grow the dictionary from real demand. */
export interface TaskMiss {
  id: Id;
  /** The part that failed (action, where, combination...). */
  group: string;
  /** What was asked, as text. */
  text: string;
  count: number;
  firstAt: number;
  lastAt: number;
}

/** What the live frame carries for one active task: the points where it must be said. */
export interface LiveTask {
  id: Id;
  /** Clip keys in speaking order (what the radio plays). */
  keys: string[];
  /** Lap distances (m) where the sentence must be finished; one per place it applies. */
  atM: number[];
  /** Panel text (pt-BR, also the key the panel uses to find the task). */
  text: string;
  /** The sentence in each language, for the panel. */
  texts?: Record<Language, string>;
  note: string | null;
}

export interface ApiTaskList {
  tasks: EngineerTask[];
  /** Proposals waiting for the driver (all tracks). */
  proposals: number;
}

export interface ApiTaskCreate {
  trackId: Id;
  carCode?: number | null;
  where: TaskWhere;
  say: TaskSay;
  note?: string | null;
  why?: string | null;
}

export interface ApiTaskPreview {
  ok: boolean;
  /** The sentence, when it composes. */
  text?: Record<Language, string>;
  /** Clip keys, for "Ouvir". */
  keys?: string[];
  estimatedMs?: number;
  error?: TaskComposeError;
}

export interface ApiTaskPatch {
  status?: EngineerTaskStatus;
  carCode?: number | null;
  where?: TaskWhere;
  say?: TaskSay;
  note?: string | null;
}

/** State of the downloaded voice of the tasks (the audio pack of one voice). */
export interface ApiTaskVoice {
  /** The driver allowed the download (opt-in, global). */
  enabled: boolean;
  /** The voice pack name (`alex`, `en-nick`...). */
  voice: string;
  /** `unavailable`: this app version has no pack for the voice. */
  status: 'idle' | 'downloading' | 'ready' | 'failed' | 'unavailable';
  /** 0–1 while downloading. */
  progress: number | null;
  /** Size of the file (bytes), null when unavailable. */
  bytes: number | null;
  error: string | null;
  /** File name served at `/api/tasks/voice/file/<file>` when ready. */
  file: string | null;
}
