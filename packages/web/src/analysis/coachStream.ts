/**
 * Coach streaming: POST /api/coach/debrief | /api/coach/chat answered with Server-Sent Events
 * (`start`, `text`, `tool`, `done`, `error`, see shared/coach.ts), read with fetch + ReadableStream.
 */

import type {
  CoachAskRequest,
  CoachChatRequest,
  CoachDebriefRequest,
  CoachErrorCode,
  CoachSseEvent,
  CoachToolStatus,
  CoachUsage,
} from '@gt7/shared';
import { humanizeError } from '../lib/copy.ts';
import { getLanguage } from '../lib/i18n.ts';
import { errorFromResponse, OFFLINE_MESSAGE } from './api.ts';
import { parseSseJson, readSse } from './lib/sse.ts';

export interface CoachToolCall {
  id: string;
  name: string;
  status: CoachToolStatus;
  summary?: string;
}

export interface CoachStreamHandlers {
  onStart?: (reportId: string, model: string) => void;
  onText: (delta: string) => void;
  onTool: (t: CoachToolCall) => void;
  onDone: (reportId: string, usage: CoachUsage | null) => void;
  onError: (code: CoachErrorCode | string, message: string, reportId?: string) => void;
}

/** Dispatches one parsed SSE message to the handlers; returns true for terminal events. */
export function dispatchCoachEvent(event: string, data: unknown, h: CoachStreamHandlers): boolean {
  const d = (data ?? {}) as Record<string, unknown>;
  switch (event as CoachSseEvent['event']) {
    case 'start':
      h.onStart?.(String(d.reportId ?? ''), String(d.model ?? ''));
      return false;
    case 'text':
      if (typeof d.delta === 'string') h.onText(d.delta);
      return false;
    case 'tool':
      h.onTool({
        id: String(d.id ?? d.name ?? ''),
        name: String(d.name ?? ''),
        status: (d.status as CoachToolStatus) ?? 'running',
        ...(typeof d.summary === 'string' ? { summary: d.summary } : {}),
      });
      return false;
    case 'done':
      h.onDone(String(d.reportId ?? ''), (d.usage as CoachUsage) ?? null);
      return true;
    case 'error':
      h.onError(
        String(d.code ?? 'internal'),
        String(d.message ?? 'Erro no coach.'),
        typeof d.reportId === 'string' ? d.reportId : undefined,
      );
      return true;
    default:
      return false;
  }
}

export async function streamCoach(
  path: '/api/coach/debrief' | '/api/coach/chat' | '/api/coach/ask',
  body: CoachDebriefRequest | CoachChatRequest | CoachAskRequest,
  h: CoachStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'accept-language': getLanguage(),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      h.onError('aborted', 'Interrompido.');
      return;
    }
    h.onError('offline', OFFLINE_MESSAGE);
    return;
  }
  if (!res.ok) {
    const err = await errorFromResponse(res);
    h.onError(err.code, err.message);
    return;
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('text/event-stream')) {
    h.onError('apiError', 'Resposta inesperada do servidor (não é um stream de eventos).');
    return;
  }
  let finished = false;
  try {
    await readSse(
      res,
      (m) => {
        if (finished) return;
        finished = dispatchCoachEvent(m.event, parseSseJson(m), h);
      },
      signal,
    );
  } catch (e) {
    if (!finished) {
      finished = true;
      if ((e as Error).name === 'AbortError' || signal.aborted)
        h.onError('aborted', 'Interrompido.');
      else h.onError('internal', `A conexão caiu: ${humanizeError(e).text}`);
    }
    return;
  }
  if (!finished) {
    if (signal.aborted) h.onError('aborted', 'Interrompido.');
    else h.onError('internal', 'O stream terminou sem concluir o relatório.');
  }
}
