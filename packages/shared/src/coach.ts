/**
 * In-app AI coach ("Debrief com IA") contracts — owned by @gt7/server (additive).
 *
 * Endpoints (JSON unless noted):
 *   GET  /api/coach/config                 → CoachConfig (never returns the key)
 *   PUT  /api/coach/config                 ← CoachConfigPatch → CoachConfig
 *   POST /api/coach/debrief                ← CoachDebriefRequest → text/event-stream (CoachSseEvent)
 *   POST /api/coach/chat                   ← CoachChatRequest → text/event-stream (CoachSseEvent)
 *   GET  /api/coach/reports?trackId=&limit= → CoachReportSummary[]
 *   GET  /api/coach/reports/:id            → CoachReport
 *   DELETE /api/coach/reports/:id          → { ok: true, id }
 */

import type { Id } from './domain.ts';

export type CoachEffort = 'low' | 'medium' | 'high';

export interface CoachModelOption {
  id: string;
  label: string;
  /** pt-BR one-liner (quality × cost/speed). */
  description: string;
}

/** Who answers: the Claude API (Anthropic) or the OpenAI API. Both use the same GT7 tools. */
export type CoachProvider = 'anthropic' | 'openai';
export const COACH_PROVIDERS: readonly CoachProvider[] = ['anthropic', 'openai'];

export function isCoachProvider(v: unknown): v is CoachProvider {
  return v === 'anthropic' || v === 'openai';
}

/** One provider's key and model state (inside `CoachConfig.providers`). */
export interface CoachProviderConfig {
  provider: CoachProvider;
  /** Display name ("Claude", "OpenAI"). */
  label: string;
  hasKey: boolean;
  keySource: 'env' | 'settings' | null;
  keyLast4: string | null;
  /** Environment variable that also provides the key. */
  envVar: string;
  /** Where the user creates a key. */
  keyUrl: string;
  /** Model used by new conversations of this provider. */
  model: string;
  defaultModel: string;
  models: CoachModelOption[];
}

/** GET /api/coach/config. The flat key/model fields describe the ACTIVE provider. */
export interface CoachConfig {
  /** An API key is available for the active provider (environment or saved). */
  hasKey: boolean;
  /** Where the key comes from: the environment variable wins over the saved one. */
  keySource: 'env' | 'settings' | null;
  /** Last 4 characters of the key in use, null without key. */
  keyLast4: string | null;
  /** Model used by new debriefs. */
  model: string;
  defaultModel: string;
  models: CoachModelOption[];
  effort: CoachEffort;
  /** Tool-loop cap per request. */
  maxToolIterations: number;
  /** Reports kept in the history; older finished ones are deleted (default 50). */
  maxReports: number;
  /** Provider used by new conversations (the one with a key, or the saved choice). */
  provider: CoachProvider;
  /** Both providers, with their own key and model. */
  providers: CoachProviderConfig[];
}

/**
 * PUT /api/coach/config body. `apiKey` / `model` are the Claude (Anthropic) ones; the OpenAI ones
 * have their own fields. `null` (or '') removes a saved key.
 */
export interface CoachConfigPatch {
  apiKey?: string | null;
  model?: string;
  openaiApiKey?: string | null;
  openaiModel?: string;
  /** Provider for new conversations. */
  provider?: CoachProvider;
  effort?: CoachEffort;
  /** 5–500; applied after each finished report. */
  maxReports?: number;
}

/** POST /api/coach/verify body / result: tests a saved key with a cheap call to the provider. */
export interface CoachVerifyRequest {
  provider?: CoachProvider;
}
export interface CoachVerifyResult {
  ok: boolean;
  provider: CoachProvider;
  /** pt-BR sentence for the user. */
  message: string;
}

/** POST /api/coach/ask body: a free question that starts a new chat (no session needed). */
export interface CoachAskRequest {
  message: string;
}

/** POST /api/coach/debrief body (all optional: default = latest live session, best lap). */
export interface CoachDebriefRequest {
  sessionId?: Id;
  lapId?: Id;
  /** Lap id or personalBest | sessionBest | bestReference | auto (default auto). */
  ref?: string;
  /** Corner id (T3) or name: deep-dive on one corner instead of the session debrief. */
  focusCorner?: string;
  /** Free question from the driver (added to the task). */
  question?: string;
}

/** POST /api/coach/chat body: follow-up in the conversation of a stored report. */
export interface CoachChatRequest {
  reportId: Id;
  message: string;
}

export type CoachToolStatus = 'running' | 'done' | 'error';

export interface CoachUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Model calls made (tool-loop iterations). */
  requests: number;
}

/**
 * Server-Sent Events of debrief/chat (`event: <name>` + `data: <JSON>`):
 * - `start` {reportId, model} once;
 * - `text` {delta} streamed answer text (Markdown);
 * - `tool` {id, name, status, summary?} for each tool call (running → done/error);
 * - `done` {reportId, usage, stopReason} at the end (report saved);
 * - `error` {code, message, reportId?} (pt-BR message), then the stream closes.
 */
export type CoachSseEvent =
  | { event: 'start'; data: { reportId: Id; model: string } }
  | { event: 'text'; data: { delta: string } }
  | {
      event: 'tool';
      data: { id: string; name: string; status: CoachToolStatus; summary?: string };
    }
  | { event: 'done'; data: { reportId: Id; usage: CoachUsage; stopReason: string | null } }
  | { event: 'error'; data: { code: CoachErrorCode; message: string; reportId?: Id } };

export type CoachErrorCode =
  | 'noKey'
  | 'invalidKey'
  | 'rateLimited'
  | 'overloaded'
  | 'refused'
  | 'limitReached'
  | 'apiError'
  | 'aborted'
  | 'internal';

/** One displayable turn of a report conversation (raw model messages are kept server-side). */
export interface CoachTranscriptEntry {
  role: 'user' | 'assistant';
  /** Markdown (assistant) or the user's text / task summary. */
  text: string;
  /** Tools called while producing this assistant turn. */
  tools?: { name: string; isError: boolean }[];
  at: number;
}

export type CoachReportStatus = 'running' | 'done' | 'error';

export interface CoachReportSummary {
  id: Id;
  createdAt: number;
  updatedAt: number;
  title: string;
  /** `chat` = a free conversation started from the question box (no session attached). */
  kind: 'debrief' | 'corner' | 'chat';
  trackId: Id | null;
  sessionId: Id | null;
  lapId: Id | null;
  reference: string | null;
  focusCorner: string | null;
  model: string;
  status: CoachReportStatus;
  /** First characters of the report (plain text). */
  preview: string;
  usage: CoachUsage;
}

/** GET /api/coach/reports/:id. */
export interface CoachReport extends CoachReportSummary {
  /** First assistant answer (the debrief) in Markdown. */
  markdown: string;
  transcript: CoachTranscriptEntry[];
  error: string | null;
}
