/**
 * Minimal OpenAI Chat Completions client for the coach: one streamed request with function tools.
 * No SDK: a `fetch` that reads the Server-Sent Events, so the app needs no extra dependency and
 * tests can inject a fake client. The tool loop itself lives in `CoachService`.
 */

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export type OpenAiToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OpenAiRequest {
  model: string;
  messages: OpenAiMessage[];
  tools: OpenAiTool[];
  /** `none` forces the final answer (tool budget reached). */
  toolChoice?: 'auto' | 'none';
  maxTokens: number;
  /** Only sent to reasoning models (gpt-5, o-series). */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface OpenAiTurn {
  text: string;
  toolCalls: OpenAiToolCall[];
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number };
}

export interface OpenAiClient {
  stream(
    req: OpenAiRequest,
    opts: { signal?: AbortSignal; onText: (delta: string) => void },
  ): Promise<OpenAiTurn>;
  /** Cheap authenticated call used to test a key (GET /models). */
  verify(signal?: AbortSignal): Promise<void>;
}

export type OpenAiClientFactory = (apiKey: string) => OpenAiClient;

export class OpenAiApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'OpenAiApiError';
  }
}

/** Reasoning models take `reasoning_effort`; the others reject it. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model);
}

async function apiError(res: Response): Promise<OpenAiApiError> {
  let message = res.statusText || `HTTP ${res.status}`;
  let code: string | null = null;
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string | null } };
    if (body.error?.message) message = body.error.message;
    if (body.error?.code) code = body.error.code;
  } catch {
    // not JSON: keep the status text
  }
  return new OpenAiApiError(res.status, message, code);
}

export function createOpenAiClient(
  apiKey: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): OpenAiClient {
  const base = (opts.baseUrl ?? OPENAI_BASE_URL).replace(/\/+$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };
  return {
    async verify(signal) {
      const res = await doFetch(`${base}/models`, {
        headers: { authorization: headers.authorization },
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) throw await apiError(res);
    },

    async stream(req, { signal, onText }) {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
        max_completion_tokens: req.maxTokens,
      };
      if (req.tools.length > 0) {
        body.tools = req.tools;
        body.tool_choice = req.toolChoice ?? 'auto';
      }
      if (req.reasoningEffort && isReasoningModel(req.model)) {
        body.reasoning_effort = req.reasoningEffort;
      }
      const res = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) throw await apiError(res);
      if (!res.body) throw new OpenAiApiError(502, 'Resposta sem corpo da API da OpenAI.');

      const turn: OpenAiTurn = {
        text: '',
        toolCalls: [],
        finishReason: null,
        usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0 },
      };
      const partial = new Map<number, OpenAiToolCall>();

      const onEvent = (data: string) => {
        if (data === '[DONE]') return;
        let chunk: {
          choices?: {
            delta?: {
              content?: string | null;
              tool_calls?: {
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
            finish_reason?: string | null;
          }[];
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
          } | null;
          error?: { message?: string };
        };
        try {
          chunk = JSON.parse(data);
        } catch {
          return;
        }
        if (chunk.error?.message) throw new OpenAiApiError(500, chunk.error.message);
        if (chunk.usage) {
          turn.usage.promptTokens = chunk.usage.prompt_tokens ?? 0;
          turn.usage.completionTokens = chunk.usage.completion_tokens ?? 0;
          turn.usage.cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
        }
        const choice = chunk.choices?.[0];
        if (!choice) return;
        const delta = choice.delta;
        if (delta?.content) {
          turn.text += delta.content;
          onText(delta.content);
        }
        for (const tc of delta?.tool_calls ?? []) {
          let call = partial.get(tc.index);
          if (!call) {
            call = { id: '', type: 'function', function: { name: '', arguments: '' } };
            partial.set(tc.index, call);
          }
          if (tc.id) call.id = tc.id;
          if (tc.function?.name) call.function.name += tc.function.name;
          if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
        }
        if (choice.finish_reason) turn.finishReason = choice.finish_reason;
      };

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number = buffer.indexOf('\n\n');
        while (cut >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          for (const line of block.split('\n')) {
            if (line.startsWith('data:')) onEvent(line.slice(5).trim());
          }
          cut = buffer.indexOf('\n\n');
        }
      }
      for (const line of buffer.split('\n')) {
        if (line.startsWith('data:')) onEvent(line.slice(5).trim());
      }
      turn.toolCalls = [...partial.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
      return turn;
    },
  };
}

/** pt-BR error for an OpenAI failure (same codes as the Claude path). */
export function openAiApiError(e: unknown): {
  code: 'invalidKey' | 'rateLimited' | 'overloaded' | 'apiError' | 'aborted' | 'internal';
  message: string;
} {
  if (e instanceof Error && e.name === 'AbortError') {
    return { code: 'aborted', message: 'Análise interrompida.' };
  }
  if (e instanceof OpenAiApiError) {
    const s = e.status;
    if (s === 401) {
      return {
        code: 'invalidKey',
        message:
          'Chave da API da OpenAI inválida ou revogada (401). Confira a chave nas configurações do coach.',
      };
    }
    if (s === 403) {
      return {
        code: 'invalidKey',
        message: 'A chave da API da OpenAI não tem permissão para este modelo (403).',
      };
    }
    if (s === 429) {
      return {
        code: 'rateLimited',
        message:
          e.code === 'insufficient_quota'
            ? 'A conta da OpenAI está sem crédito ou atingiu o limite (429). Confira o saldo em platform.openai.com.'
            : 'Limite de uso da API da OpenAI atingido (429). Aguarde um pouco e tente de novo.',
      };
    }
    if (s === 404) {
      return {
        code: 'apiError',
        message: 'Modelo não encontrado na OpenAI (404). Escolha outro modelo nas configurações.',
      };
    }
    if (s >= 500) {
      return {
        code: 'overloaded',
        message: 'A API da OpenAI está indisponível no momento. Tente de novo em instantes.',
      };
    }
    return { code: 'apiError', message: `Erro da API da OpenAI (${s}): ${e.message}` };
  }
  if (e instanceof TypeError) {
    return {
      code: 'apiError',
      message: 'Sem conexão com a API da OpenAI. Verifique a internet do PC e tente de novo.',
    };
  }
  return { code: 'internal', message: `Erro interno do coach: ${(e as Error)?.message ?? e}` };
}
