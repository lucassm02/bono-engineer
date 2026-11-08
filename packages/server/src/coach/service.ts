/**
 * In-app AI coach ("Debrief com IA"): a manual streaming tool loop over the Claude API whose tools
 * are the GT7 MCP tools (McpToolBridge). Each debrief becomes a stored report (coach_reports) with
 * the raw conversation, so follow-up questions continue the same conversation append-only
 * (thinking blocks and tool results are replayed unchanged).
 *
 * Limits: MAX_TOOL_ITERATIONS model calls with tools per request, then one final call with
 * `tool_choice: none`; cumulative input/output token caps trigger the same final call.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { EMPTY_COACH_USAGE, type Gt7Runtime, newId, type StoredCoachReport } from '@gt7/core';
import { latestDrivingSession } from '@gt7/mcp';
import {
  COMPARISON_REFERENCE_KINDS,
  type CoachConfig,
  type CoachConfigPatch,
  type CoachDebriefRequest,
  type CoachErrorCode,
  type CoachSseEvent,
  type CoachTranscriptEntry,
  type CoachUsage,
  type Lap,
  type Session,
} from '@gt7/shared';
import { CoachSettings, FALLBACK_MODELS, MAX_TOOL_ITERATIONS } from './config.ts';
import { buildCoachTask, COACH_SYSTEM_PROMPT, type CoachTarget, coachTitle } from './prompt.ts';
import { McpToolBridge } from './tools.ts';

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type ToolResultParam = Anthropic.Beta.BetaToolResultBlockParam;
type Message = Anthropic.Beta.BetaMessage;
export type CoachStreamParams = BetaMessageStreamParams;

/** The part of a Claude message stream the coach uses (BetaMessageStream satisfies it). */
export interface CoachStreamLike {
  on(event: 'text', listener: (delta: string, snapshot: string) => void): unknown;
  finalMessage(): Promise<Message>;
}

export interface CoachModelClient {
  stream(params: CoachStreamParams, opts: { signal?: AbortSignal }): CoachStreamLike;
}

/** Creates the Claude client for an API key (tests inject a fake). */
export type CoachClientFactory = (apiKey: string) => CoachModelClient;

export const defaultCoachClientFactory: CoachClientFactory = (apiKey) => {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return {
    stream: (params, opts) =>
      client.beta.messages.stream(params, opts.signal ? { signal: opts.signal } : {}),
  };
};

export interface CoachServiceOptions {
  clientFactory?: CoachClientFactory;
  /** Environment used for ANTHROPIC_API_KEY (default process.env). */
  env?: Record<string, string | undefined>;
  maxToolIterations?: number;
  /** Cumulative input tokens (incl. cache reads/writes) per request before the final call. */
  maxInputTokens?: number;
  /** Cumulative output tokens per request before the final call. */
  maxOutputTokens?: number;
  /** max_tokens of each model call (streamed). */
  maxTokensPerCall?: number;
}

/** Request error raised before streaming starts (mapped to an HTTP error by the route). */
export class CoachError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CoachError';
  }
}

export interface CoachSink {
  send(ev: CoachSseEvent): void;
}

/** A prepared debrief/chat: the report row exists; `execute` streams and persists. */
export interface CoachRun {
  reportId: string;
  execute(sink: CoachSink, signal: AbortSignal): Promise<void>;
}

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const FINAL_NOTE =
  'Limite de ferramentas/tokens desta análise atingido: escreva agora a resposta final com os ' +
  'dados que você já tem, sem chamar mais ferramentas.';

function addUsage(u: CoachUsage, m: Message): void {
  u.inputTokens += m.usage.input_tokens ?? 0;
  u.outputTokens += m.usage.output_tokens ?? 0;
  u.cacheReadTokens += m.usage.cache_read_input_tokens ?? 0;
  u.cacheWriteTokens += m.usage.cache_creation_input_tokens ?? 0;
  u.requests += 1;
}

/** pt-BR error for an API failure. */
export function coachApiError(e: unknown): { code: CoachErrorCode; message: string } {
  if (e instanceof Anthropic.APIUserAbortError) {
    return { code: 'aborted', message: 'Análise interrompida.' };
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return {
      code: 'apiError',
      message: 'Sem conexão com a API da Anthropic. Verifique a internet do PC e tente de novo.',
    };
  }
  if (e instanceof Anthropic.APIError) {
    const s = e.status;
    if (s === 401) {
      return {
        code: 'invalidKey',
        message:
          'Chave da API inválida ou revogada (401). Confira a chave nas configurações do coach.',
      };
    }
    if (s === 403) {
      return {
        code: 'invalidKey',
        message: 'A chave da API não tem permissão para este modelo (403).',
      };
    }
    if (s === 429) {
      return {
        code: 'rateLimited',
        message: 'Limite de uso da API atingido (429). Aguarde um pouco e tente de novo.',
      };
    }
    if (s === 529 || s === 503) {
      return {
        code: 'overloaded',
        message: 'A API da Anthropic está sobrecarregada no momento. Tente de novo em instantes.',
      };
    }
    if (s === 404) {
      return { code: 'apiError', message: 'Modelo não encontrado (404). Escolha outro modelo.' };
    }
    return { code: 'apiError', message: `Erro da API da Anthropic (${s ?? '?'}): ${e.message}` };
  }
  return { code: 'internal', message: `Erro interno do coach: ${(e as Error)?.message ?? e}` };
}

export class CoachService {
  readonly runtime: Gt7Runtime;
  readonly settings: CoachSettings;
  readonly tools: McpToolBridge;
  readonly #factory: CoachClientFactory;
  readonly #opts: Required<
    Pick<
      CoachServiceOptions,
      'maxToolIterations' | 'maxInputTokens' | 'maxOutputTokens' | 'maxTokensPerCall'
    >
  >;
  readonly #running = new Set<string>();

  constructor(runtime: Gt7Runtime, opts: CoachServiceOptions = {}) {
    this.runtime = runtime;
    this.settings = new CoachSettings(runtime.store, opts.env ?? process.env);
    this.tools = new McpToolBridge(runtime);
    this.#factory = opts.clientFactory ?? defaultCoachClientFactory;
    this.#opts = {
      maxToolIterations: opts.maxToolIterations ?? MAX_TOOL_ITERATIONS,
      maxInputTokens: opts.maxInputTokens ?? 800_000,
      maxOutputTokens: opts.maxOutputTokens ?? 64_000,
      maxTokensPerCall: opts.maxTokensPerCall ?? 32_000,
    };
  }

  config(): CoachConfig {
    return this.settings.config();
  }

  updateConfig(patch: CoachConfigPatch): CoachConfig {
    try {
      return this.settings.update(patch);
    } catch (e) {
      throw new CoachError(400, 'invalidInput', (e as Error).message);
    }
  }

  async close(): Promise<void> {
    await this.tools.close();
  }

  #apiKey(): string {
    const k = this.settings.key();
    if (!k) {
      throw new CoachError(
        400,
        'noKey',
        'Configure a chave da API da Anthropic para usar o Debrief com IA (variável ANTHROPIC_API_KEY ' +
          'ou nas configurações do coach).',
      );
    }
    return k.key;
  }

  #resolveTarget(req: CoachDebriefRequest): CoachTarget {
    const store = this.runtime.store;
    const ref = req.ref?.trim() || 'auto';
    if (!(COMPARISON_REFERENCE_KINDS as readonly string[]).includes(ref) && !SAFE_ID.test(ref)) {
      throw new CoachError(400, 'invalidInput', 'Referência inválida.');
    }
    if (req.lapId !== undefined && !SAFE_ID.test(req.lapId)) {
      throw new CoachError(400, 'invalidInput', 'Id de volta inválido.');
    }
    if (req.sessionId !== undefined && !SAFE_ID.test(req.sessionId)) {
      throw new CoachError(400, 'invalidInput', 'Id de sessão inválido.');
    }
    let lap: Lap | null = null;
    let session: Session | null = null;
    if (req.lapId) {
      lap = store.getLap(req.lapId);
      if (!lap) throw new CoachError(404, 'notFound', 'Volta não encontrada.');
      session = store.getSession(lap.sessionId);
    } else if (req.sessionId) {
      session = store.getSession(req.sessionId);
      if (!session) throw new CoachError(404, 'notFound', 'Sessão não encontrada.');
    } else {
      session = latestDrivingSession(store);
    }
    if (!lap && (!session || session.lapCount === 0)) {
      throw new CoachError(
        400,
        'noData',
        'Ainda não há voltas gravadas para analisar. Complete algumas voltas e tente de novo.',
      );
    }
    const trackId = lap?.trackId ?? session?.trackId ?? null;
    return {
      session,
      lap,
      track: trackId ? store.getTrack(trackId) : null,
      reference: ref,
      focusCorner: req.focusCorner?.trim() || null,
      question: req.question?.trim() || null,
    };
  }

  /** Validates the request, creates the report row and returns the run (throws CoachError). */
  startDebrief(req: CoachDebriefRequest): CoachRun {
    const apiKey = this.#apiKey();
    const target = this.#resolveTarget(req);
    const now = Date.now();
    const task = buildCoachTask(this.runtime.store, target);
    const report: StoredCoachReport = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      kind: target.focusCorner ? 'corner' : 'debrief',
      title: coachTitle(target),
      trackId: target.track?.id ?? null,
      sessionId: target.session?.id ?? null,
      lapId: target.lap?.id ?? null,
      reference: target.reference,
      focusCorner: target.focusCorner,
      model: this.settings.model(),
      status: 'running',
      preview: '',
      usage: { ...EMPTY_COACH_USAGE },
      markdown: '',
      transcript: [
        {
          role: 'user',
          text:
            target.question ??
            (target.focusCorner ? `Foco na curva ${target.focusCorner}` : 'Debrief da sessão'),
          at: now,
        },
      ],
      error: null,
      messages: [{ role: 'user', content: task } satisfies MessageParam],
    };
    this.runtime.store.saveCoachReport(report);
    return {
      reportId: report.id,
      execute: (sink, signal) => this.#execute(report, apiKey, true, sink, signal),
    };
  }

  /** Follow-up question in the conversation of a stored report (throws CoachError). */
  startChat(reportId: string, message: string): CoachRun {
    const apiKey = this.#apiKey();
    if (!SAFE_ID.test(reportId)) throw new CoachError(400, 'invalidInput', 'Id inválido.');
    const report = this.runtime.store.getCoachReport(reportId);
    if (!report) throw new CoachError(404, 'notFound', 'Relatório não encontrado.');
    if (this.#running.has(reportId) || report.status === 'running') {
      throw new CoachError(409, 'busy', 'Este relatório ainda está sendo gerado. Aguarde.');
    }
    const text = message.trim();
    if (!text) throw new CoachError(400, 'invalidInput', 'Escreva a pergunta.');
    const now = Date.now();
    report.transcript.push({ role: 'user', text, at: now });
    report.messages.push({ role: 'user', content: text } satisfies MessageParam);
    report.status = 'running';
    report.error = null;
    report.updatedAt = now;
    this.runtime.store.saveCoachReport(report);
    return {
      reportId,
      execute: (sink, signal) => this.#execute(report, apiKey, false, sink, signal),
    };
  }

  async #execute(
    report: StoredCoachReport,
    apiKey: string,
    isDebrief: boolean,
    sink: CoachSink,
    signal: AbortSignal,
  ): Promise<void> {
    this.#running.add(report.id);
    const messages = report.messages as MessageParam[];
    const turn: { text: string; tools: NonNullable<CoachTranscriptEntry['tools']> } = {
      text: '',
      tools: [],
    };
    const usage: CoachUsage = { ...EMPTY_COACH_USAGE };
    let stopReason: string | null = null;
    let failure: { code: CoachErrorCode; message: string } | null = null;
    sink.send({ event: 'start', data: { reportId: report.id, model: report.model } });
    try {
      stopReason = await this.#loop(report, apiKey, messages, turn, usage, sink, signal);
      if (stopReason === 'refusal') {
        failure = {
          code: 'refused',
          message: 'O modelo recusou esta solicitação. Reformule a pergunta e tente de novo.',
        };
      } else if (stopReason === 'limit') {
        failure = {
          code: 'limitReached',
          message: 'Limite de ferramentas/tokens atingido antes da resposta final.',
        };
      }
    } catch (e) {
      failure = signal.aborted
        ? coachApiError(new Anthropic.APIUserAbortError())
        : coachApiError(e);
    }
    sealHistory(messages);
    const now = Date.now();
    if (turn.text || turn.tools.length) {
      report.transcript.push({
        role: 'assistant',
        text: turn.text,
        ...(turn.tools.length ? { tools: turn.tools } : {}),
        at: now,
      });
    }
    if (isDebrief) report.markdown = turn.text;
    for (const k of Object.keys(usage) as (keyof CoachUsage)[]) report.usage[k] += usage[k];
    // A failed follow-up keeps the report usable (status of the debrief itself).
    report.status = isDebrief && failure && !turn.text ? 'error' : 'done';
    report.error = failure?.message ?? null;
    report.updatedAt = now;
    try {
      this.runtime.store.saveCoachReport(report);
    } catch {
      // store closed during shutdown
    }
    this.#running.delete(report.id);
    if (failure) {
      sink.send({ event: 'error', data: { ...failure, reportId: report.id } });
    } else {
      sink.send({ event: 'done', data: { reportId: report.id, usage, stopReason } });
    }
  }

  /** The tool loop; returns the final stop reason ('limit' when capped without an answer). */
  async #loop(
    report: StoredCoachReport,
    apiKey: string,
    messages: MessageParam[],
    turn: { text: string; tools: { name: string; isError: boolean }[] },
    usage: CoachUsage,
    sink: CoachSink,
    signal: AbortSignal,
  ): Promise<string | null> {
    const client = this.#factory(apiKey);
    const tools = await this.tools.tools();
    const model = report.model;
    const effort = this.settings.effort();
    let toolCalls = 0;
    let finalCall = false;
    let jsonRetries = 0;
    while (true) {
      if (signal.aborted) throw new Anthropic.APIUserAbortError();
      const params: CoachStreamParams = {
        model,
        max_tokens: this.#opts.maxTokensPerCall,
        system: COACH_SYSTEM_PROMPT,
        tools,
        messages,
        thinking: { type: 'adaptive' },
        output_config: { effort },
        cache_control: { type: 'ephemeral' },
        ...(finalCall ? { tool_choice: { type: 'none' } } : {}),
        ...(FALLBACK_MODELS.has(model)
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
          : {}),
      };
      const textBefore = turn.text;
      let firstDelta = true;
      const stream = client.stream(params, { signal });
      stream.on('text', (delta) => {
        if (firstDelta && turn.text && !turn.text.endsWith('\n\n')) {
          turn.text += '\n\n';
          sink.send({ event: 'text', data: { delta: '\n\n' } });
        }
        firstDelta = false;
        turn.text += delta;
        sink.send({ event: 'text', data: { delta } });
      });
      let msg: Message;
      try {
        msg = await stream.finalMessage();
        jsonRetries = 0;
      } catch (e) {
        // Only a tool input the SDK could not parse at all is retried (eager input streaming).
        if (e instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw e;
        turn.text = textBefore;
        continue;
      }
      addUsage(usage, msg);
      messages.push({ role: 'assistant', content: msg.content as ContentBlockParam[] });
      const toolUses = msg.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
      const stop = msg.stop_reason;
      if (stop === 'pause_turn') continue;
      if (stop !== 'tool_use' || toolUses.length === 0) {
        if (stop === 'max_tokens' && toolUses.length) return 'limit';
        if (stop === 'model_context_window_exceeded' || stop === 'compaction') return 'limit';
        return stop;
      }
      if (finalCall) return 'limit';

      toolCalls++;
      const results = await Promise.all(
        toolUses.map(async (tu): Promise<ToolResultParam> => {
          const summary = JSON.stringify(tu.input ?? {}).slice(0, 120);
          sink.send({
            event: 'tool',
            data: { id: tu.id, name: tu.name, status: 'running', summary },
          });
          const out = await this.tools.call(tu.name, tu.input);
          turn.tools.push({ name: tu.name, isError: out.isError });
          sink.send({
            event: 'tool',
            data: { id: tu.id, name: tu.name, status: out.isError ? 'error' : 'done' },
          });
          return {
            type: 'tool_result',
            tool_use_id: tu.id,
            content: out.content,
            ...(out.isError ? { is_error: true } : {}),
          };
        }),
      );
      const content: ContentBlockParam[] = [...results];
      const inputTotal = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
      if (
        toolCalls >= this.#opts.maxToolIterations ||
        inputTotal >= this.#opts.maxInputTokens ||
        usage.outputTokens >= this.#opts.maxOutputTokens
      ) {
        finalCall = true;
        content.push({ type: 'text', text: FINAL_NOTE });
      }
      messages.push({ role: 'user', content });
    }
  }
}

/**
 * Keeps the stored conversation replayable: a trailing assistant turn with tool_use blocks
 * (aborted/failed mid-loop) gets error tool_results, so a follow-up question is a valid request.
 */
export function sealHistory(messages: MessageParam[]): void {
  const last = messages.at(-1);
  if (last?.role !== 'assistant' || typeof last.content === 'string') return;
  const pending = last.content.filter(
    (b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === 'tool_use',
  );
  if (!pending.length) return;
  messages.push({
    role: 'user',
    content: pending.map((b) => ({
      type: 'tool_result' as const,
      tool_use_id: b.id,
      is_error: true,
      content: 'Execução interrompida antes do resultado.',
    })),
  });
}
