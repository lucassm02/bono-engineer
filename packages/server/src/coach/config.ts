/**
 * Coach configuration: API key (env ANTHROPIC_API_KEY wins over the saved one), model and effort,
 * persisted in the settings table. The key is never returned by the API (only hasKey + last 4).
 */

import type { Gt7Store } from '@gt7/core';
import {
  COACH_PROVIDERS,
  type CoachConfig,
  type CoachConfigPatch,
  type CoachEffort,
  type CoachModelOption,
  type CoachProvider,
  type CoachProviderConfig,
  isCoachProvider,
} from '@gt7/shared';

export const COACH_SETTINGS = {
  apiKey: 'coach.apiKey',
  model: 'coach.model',
  provider: 'coach.provider',
  openaiKey: 'coach.openaiKey',
  openaiModel: 'coach.openaiModel',
  effort: 'coach.effort',
  maxReports: 'coach.maxReports',
} as const;

export const DEFAULT_MAX_REPORTS = 50;
export const MIN_MAX_REPORTS = 5;
export const MAX_MAX_REPORTS = 500;

/** Most capable current model (default) + cheaper/faster options. */
export const DEFAULT_COACH_MODEL = 'claude-opus-5-5';

export const COACH_MODELS: CoachModelOption[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    description: 'O mais capaz: melhor diagnóstico e plano (padrão).',
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    description: 'Mais rápido e ~2× mais barato; ótimo para debriefs do dia a dia.',
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    description: 'O mais barato e rápido; respostas mais simples.',
  },
];

/** OpenAI models offered in the settings; any other model id can still be typed (and verified). */
export const DEFAULT_OPENAI_MODEL = 'gpt-5';

export const OPENAI_MODELS: CoachModelOption[] = [
  {
    id: 'gpt-5',
    label: 'GPT-5',
    description: 'O mais capaz da lista: melhor diagnóstico e plano (padrão).',
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 mini',
    description: 'Mais rápido e bem mais barato; ótimo para perguntas do dia a dia.',
  },
  {
    id: 'gpt-4.1',
    label: 'GPT-4.1',
    description: 'Respostas rápidas, sem raciocínio estendido.',
  },
];

/** Where each provider issues its API keys. */
export const KEY_URLS: Record<CoachProvider, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
};
export const ENV_VARS: Record<CoachProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};
const PROVIDER_LABELS: Record<CoachProvider, string> = { anthropic: 'Claude', openai: 'OpenAI' };

/** Model ids never overlap between the two providers: `claude-*` is Anthropic, the rest OpenAI. */
export function providerOfModel(model: string): CoachProvider {
  return model.startsWith('claude') ? 'anthropic' : 'openai';
}

export const COACH_EFFORTS: readonly CoachEffort[] = ['low', 'medium', 'high'];
export const DEFAULT_COACH_EFFORT: CoachEffort = 'high';

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
export const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

/** Tool-loop cap per request (model calls that may use tools). */
export const MAX_TOOL_ITERATIONS = 12;

const MODEL_ID = /^[a-z0-9][a-z0-9.-]{2,63}$/;

export interface ResolvedKey {
  key: string;
  source: 'env' | 'settings';
}

export class CoachSettings {
  constructor(
    readonly store: Gt7Store,
    readonly env: Record<string, string | undefined> = process.env,
  ) {}

  /** The key of one provider (the environment variable wins over the saved one). */
  keyFor(provider: CoachProvider): ResolvedKey | null {
    const env = this.env[ENV_VARS[provider]]?.trim();
    if (env) return { key: env, source: 'env' };
    const saved = this.store.getSetting<string>(
      provider === 'anthropic' ? COACH_SETTINGS.apiKey : COACH_SETTINGS.openaiKey,
    );
    return typeof saved === 'string' && saved.trim()
      ? { key: saved.trim(), source: 'settings' }
      : null;
  }

  /** The active provider: the saved choice when it has a key, else the one that has a key. */
  provider(): CoachProvider {
    const saved = this.store.getSetting<string>(COACH_SETTINGS.provider);
    if (isCoachProvider(saved) && this.keyFor(saved)) return saved;
    return (
      COACH_PROVIDERS.find((p) => this.keyFor(p)) ?? (isCoachProvider(saved) ? saved : 'anthropic')
    );
  }

  /** Key of the active provider. */
  key(): ResolvedKey | null {
    return this.keyFor(this.provider());
  }

  modelFor(provider: CoachProvider): string {
    const m = this.store.getSetting<string>(
      provider === 'anthropic' ? COACH_SETTINGS.model : COACH_SETTINGS.openaiModel,
    );
    if (typeof m === 'string' && MODEL_ID.test(m) && providerOfModel(m) === provider) return m;
    return provider === 'anthropic' ? DEFAULT_COACH_MODEL : DEFAULT_OPENAI_MODEL;
  }

  /** Model of the active provider. */
  model(): string {
    return this.modelFor(this.provider());
  }

  effort(): CoachEffort {
    const e = this.store.getSetting<string>(COACH_SETTINGS.effort);
    return (COACH_EFFORTS as readonly string[]).includes(e ?? '')
      ? (e as CoachEffort)
      : DEFAULT_COACH_EFFORT;
  }

  maxReports(): number {
    const n = this.store.getSetting<number>(COACH_SETTINGS.maxReports);
    return typeof n === 'number' &&
      Number.isInteger(n) &&
      n >= MIN_MAX_REPORTS &&
      n <= MAX_MAX_REPORTS
      ? n
      : DEFAULT_MAX_REPORTS;
  }

  #providerConfig(provider: CoachProvider): CoachProviderConfig {
    const k = this.keyFor(provider);
    return {
      provider,
      label: PROVIDER_LABELS[provider],
      hasKey: !!k,
      keySource: k?.source ?? null,
      keyLast4: k ? k.key.slice(-4) : null,
      envVar: ENV_VARS[provider],
      keyUrl: KEY_URLS[provider],
      model: this.modelFor(provider),
      defaultModel: provider === 'anthropic' ? DEFAULT_COACH_MODEL : DEFAULT_OPENAI_MODEL,
      models: provider === 'anthropic' ? COACH_MODELS : OPENAI_MODELS,
    };
  }

  config(): CoachConfig {
    const provider = this.provider();
    const active = this.#providerConfig(provider);
    return {
      hasKey: active.hasKey,
      keySource: active.keySource,
      keyLast4: active.keyLast4,
      model: active.model,
      defaultModel: active.defaultModel,
      models: active.models,
      effort: this.effort(),
      maxToolIterations: MAX_TOOL_ITERATIONS,
      maxReports: this.maxReports(),
      provider,
      providers: COACH_PROVIDERS.map((p) => this.#providerConfig(p)),
    };
  }

  #saveKey(provider: CoachProvider, value: string | null): void {
    const name = provider === 'anthropic' ? COACH_SETTINGS.apiKey : COACH_SETTINGS.openaiKey;
    const k = value?.trim() ?? '';
    if (!k) {
      this.store.deleteSetting(name);
      return;
    }
    if (k.length < 20 || k.length > 300 || /\s/.test(k)) {
      throw new Error(
        provider === 'anthropic'
          ? 'Chave da API inválida (copie a chave completa do Console da Anthropic).'
          : 'Chave da API inválida (copie a chave completa da plataforma da OpenAI).',
      );
    }
    this.store.setSetting(name, k);
  }

  #saveModel(provider: CoachProvider, model: string): void {
    if (!MODEL_ID.test(model) || providerOfModel(model) !== provider) {
      throw new Error(
        provider === 'anthropic'
          ? 'Modelo inválido: use um modelo Claude (claude-…).'
          : 'Modelo inválido: use um modelo da OpenAI (por exemplo gpt-5).',
      );
    }
    this.store.setSetting(
      provider === 'anthropic' ? COACH_SETTINGS.model : COACH_SETTINGS.openaiModel,
      model,
    );
  }

  /** Validated patch (throws Error with a pt-BR message on invalid input). */
  update(patch: CoachConfigPatch): CoachConfig {
    if (patch.apiKey !== undefined) this.#saveKey('anthropic', patch.apiKey);
    if (patch.openaiApiKey !== undefined) this.#saveKey('openai', patch.openaiApiKey);
    if (patch.model !== undefined) this.#saveModel('anthropic', patch.model);
    if (patch.openaiModel !== undefined) this.#saveModel('openai', patch.openaiModel);
    if (patch.provider !== undefined) {
      if (!isCoachProvider(patch.provider))
        throw new Error('Provedor inválido: use anthropic ou openai.');
      this.store.setSetting(COACH_SETTINGS.provider, patch.provider);
    }
    if (patch.effort !== undefined) {
      if (!COACH_EFFORTS.includes(patch.effort)) {
        throw new Error('Esforço inválido: use low, medium ou high.');
      }
      this.store.setSetting(COACH_SETTINGS.effort, patch.effort);
    }
    if (patch.maxReports !== undefined) {
      const n = patch.maxReports;
      if (!Number.isInteger(n) || n < MIN_MAX_REPORTS || n > MAX_MAX_REPORTS) {
        throw new Error(
          `Quantidade de relatórios inválida: use de ${MIN_MAX_REPORTS} a ${MAX_MAX_REPORTS}.`,
        );
      }
      this.store.setSetting(COACH_SETTINGS.maxReports, n);
    }
    return this.config();
  }
}
