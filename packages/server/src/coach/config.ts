/**
 * Coach configuration: API key (env ANTHROPIC_API_KEY wins over the saved one), model and effort,
 * persisted in the settings table. The key is never returned by the API (only hasKey + last 4).
 */

import type { Gt7Store } from '@gt7/core';
import type { CoachConfig, CoachConfigPatch, CoachEffort, CoachModelOption } from '@gt7/shared';

export const COACH_SETTINGS = {
  apiKey: 'coach.apiKey',
  model: 'coach.model',
  effort: 'coach.effort',
} as const;

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

  key(): ResolvedKey | null {
    const env = this.env.ANTHROPIC_API_KEY?.trim();
    if (env) return { key: env, source: 'env' };
    const saved = this.store.getSetting<string>(COACH_SETTINGS.apiKey);
    return typeof saved === 'string' && saved.trim()
      ? { key: saved.trim(), source: 'settings' }
      : null;
  }

  model(): string {
    const m = this.store.getSetting<string>(COACH_SETTINGS.model);
    return typeof m === 'string' && MODEL_ID.test(m) ? m : DEFAULT_COACH_MODEL;
  }

  effort(): CoachEffort {
    const e = this.store.getSetting<string>(COACH_SETTINGS.effort);
    return (COACH_EFFORTS as readonly string[]).includes(e ?? '')
      ? (e as CoachEffort)
      : DEFAULT_COACH_EFFORT;
  }

  config(): CoachConfig {
    const k = this.key();
    return {
      hasKey: !!k,
      keySource: k?.source ?? null,
      keyLast4: k ? k.key.slice(-4) : null,
      model: this.model(),
      defaultModel: DEFAULT_COACH_MODEL,
      models: COACH_MODELS,
      effort: this.effort(),
      maxToolIterations: MAX_TOOL_ITERATIONS,
    };
  }

  /** Validated patch (throws Error with a pt-BR message on invalid input). */
  update(patch: CoachConfigPatch): CoachConfig {
    if (patch.apiKey !== undefined) {
      const k = patch.apiKey?.trim() ?? '';
      if (!k) this.store.deleteSetting(COACH_SETTINGS.apiKey);
      else {
        if (k.length < 20 || k.length > 300 || /\s/.test(k)) {
          throw new Error(
            'Chave da API inválida (copie a chave completa do Console da Anthropic).',
          );
        }
        this.store.setSetting(COACH_SETTINGS.apiKey, k);
      }
    }
    if (patch.model !== undefined) {
      if (!MODEL_ID.test(patch.model)) throw new Error('Modelo inválido.');
      this.store.setSetting(COACH_SETTINGS.model, patch.model);
    }
    if (patch.effort !== undefined) {
      if (!COACH_EFFORTS.includes(patch.effort)) {
        throw new Error('Esforço inválido: use low, medium ou high.');
      }
      this.store.setSetting(COACH_SETTINGS.effort, patch.effort);
    }
    return this.config();
  }
}
