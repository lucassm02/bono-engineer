/**
 * Contadores locais de uso (spec 01, RF4). Servem só para o "Diagnóstico" de Configurações → Sobre:
 * quantas vezes o menu foi aberto, como foi o tour e quantos passos do assistente foram concluídos.
 * Ficam em `localStorage` deste navegador: nada sai do PC, não há identificador nem envio.
 *
 * Também guarda o dia do primeiro uso (rótulos de ajuda nos botões do ao vivo só na primeira
 * semana) e a última aba usada no menu do ao vivo.
 */

import { t as uiText } from './i18n.ts';
import { loadSetupState, SETUP_STEP_IDS } from './onboarding.ts';
import { loadJson, loadString, saveJson, saveString } from './storage.ts';
import { loadTourState } from './tour.ts';

export const USAGE_KEY = 'bono.usage.v1';
export const MENU_TAB_KEY = 'bono.menu.tab';

/** Primeira semana: os botões flutuantes mostram um rótulo curto (spec 01, A6). */
export const NEWCOMER_DAYS = 7;

export const USAGE_COUNTERS = [
  'menuOpens',
  'tourStarts',
  'tourFinished',
  'tourSkipped',
  'setupOpens',
] as const;
export type UsageCounter = (typeof USAGE_COUNTERS)[number];

export interface UsageState {
  /** Epoch ms do primeiro uso neste navegador. */
  since: number;
  counters: Partial<Record<UsageCounter, number>>;
}

export function parseUsage(raw: unknown, now = Date.now()): UsageState {
  const base: UsageState = { since: now, counters: {} };
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as { since?: unknown; counters?: unknown };
  const since = typeof o.since === 'number' && Number.isFinite(o.since) ? o.since : now;
  const counters: UsageState['counters'] = {};
  if (o.counters && typeof o.counters === 'object') {
    for (const key of USAGE_COUNTERS) {
      const v = (o.counters as Record<string, unknown>)[key];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) counters[key] = Math.floor(v);
    }
  }
  return { since, counters };
}

export function loadUsage(now = Date.now()): UsageState {
  return parseUsage(loadJson<unknown>(USAGE_KEY), now);
}

/** Soma 1 a um contador (silencioso: o armazenamento pode estar bloqueado). */
export function bumpUsage(name: UsageCounter, now = Date.now()): void {
  const state = loadUsage(now);
  state.counters[name] = (state.counters[name] ?? 0) + 1;
  saveJson(USAGE_KEY, state);
}

export function resetUsage(now = Date.now()): void {
  saveJson(USAGE_KEY, { since: now, counters: {} } satisfies UsageState);
}

/** Dentro da primeira semana de uso? O primeiro uso fica registrado na primeira leitura. */
export function isNewcomer(now = Date.now()): boolean {
  const raw = loadJson<unknown>(USAGE_KEY);
  if (!raw) {
    saveJson(USAGE_KEY, { since: now, counters: {} } satisfies UsageState);
    return true;
  }
  const { since } = parseUsage(raw, now);
  return now - since < NEWCOMER_DAYS * 24 * 60 * 60 * 1000;
}

export type MenuTabId = 'nav' | 'engineer' | 'panel';
const MENU_TABS: readonly MenuTabId[] = ['nav', 'engineer', 'panel'];

/** Última aba aberta no menu do ao vivo ("Navegar" na primeira vez). */
export function loadMenuTab(): MenuTabId {
  const saved = loadString(MENU_TAB_KEY);
  return MENU_TABS.find((t) => t === saved) ?? 'nav';
}

export function saveMenuTab(tab: MenuTabId): void {
  saveString(MENU_TAB_KEY, tab);
}

// ---------------------------------------------------------------------------------------------
// Diagnóstico (Configurações → Sobre)
// ---------------------------------------------------------------------------------------------

export interface DiagnosticRow {
  id: string;
  label: string;
  value: string;
}

function outcomeText(outcome: 'done' | 'skipped' | undefined): string {
  if (outcome === 'done') return uiText('concluído');
  if (outcome === 'skipped') return uiText('pulado');
  return uiText('ainda não feito');
}

/** Linhas do "Diagnóstico": só o que este navegador guardou, sem nada de rede. */
export function diagnosticRows(now = Date.now()): DiagnosticRow[] {
  const usage = loadUsage(now);
  const c = usage.counters;
  const setup = loadSetupState();
  const setupDone = Object.values(setup?.steps ?? {}).filter((v) => v === 'done').length;
  const tours = loadTourState();
  const days = Math.max(0, Math.floor((now - usage.since) / (24 * 60 * 60 * 1000)));
  return [
    {
      id: 'since',
      label: uiText('Uso neste navegador'),
      value: days === 0 ? uiText('desde hoje') : uiText('há {0} dias', String(days)),
    },
    { id: 'menu', label: uiText('Aberturas do menu ao vivo'), value: String(c.menuOpens ?? 0) },
    {
      id: 'setup',
      label: uiText('Passos do assistente concluídos'),
      value: uiText('{0} de {1}', String(setupDone), String(SETUP_STEP_IDS.length)),
    },
    { id: 'tour-live', label: uiText('Tour do ao vivo'), value: outcomeText(tours.live) },
    { id: 'tour-analysis', label: uiText('Tour do histórico'), value: outcomeText(tours.analysis) },
    {
      id: 'tour-runs',
      label: uiText('Vezes que um tour foi aberto'),
      value: String(c.tourStarts ?? 0),
    },
  ];
}
