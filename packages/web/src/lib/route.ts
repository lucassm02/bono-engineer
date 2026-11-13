/**
 * Hash router (no dependency): `#/analysis/...` opens the analysis & settings area, anything else
 * (empty hash, `#/`, `#/live`) is the live dashboard. Hash routing works the same on the Vite dev
 * server, the Fastify static server and inside the installed PWA (no server rewrite needed).
 *
 *   #/home                            home: history organised by track (default outside a race)
 *   #/analysis                        all sessions list
 *   #/analysis/session/:sessionId     session detail (laps)
 *   #/analysis/session/:sessionId/summary   session summary (spec 12)
 *   #/analysis/week?w=N               weekly summary (N weeks back, default 0)
 *   #/analysis/compare?lap=&ref=&extra=a,b   lap comparison
 *   #/analysis/lap/:lapId?ref=&mode=&corner=  replay of one lap (reference ghost, mode=time|distance)
 *   #/analysis/track/:trackId?tab=&session=   track page (tabs: best, sessions, evolution, sectors,
 *                                     references, corners, tasks)
 *   #/capture                         reference capture
 *   #/config?s=<group|anchor>         settings
 *   #/coach[/:reportId]?session=&lap=&ref=&corner=   AI coach
 *   #/guide?q=&class=&topic=          driving guide (coach knowledge base)
 *   #/help?t=<topic>&q=               help center (topics, search)
 *   #/help/<article-id>               one help article
 *   #/dailies                         Daily Races of the week
 *
 * Links written before the routes were renamed to English (`#/inicio`, `#/analise/pista/…?tab=sessoes`…)
 * still open: `canonicalHash` rewrites them.
 */

export type RouteName =
  | 'live'
  | 'home'
  | 'sessions'
  | 'session'
  | 'summary'
  | 'weekly'
  | 'compare'
  | 'replay'
  | 'track'
  | 'capture'
  | 'config'
  | 'coach'
  | 'guide'
  | 'help'
  | 'dailies'
  | 'notFound';

export interface Route {
  name: RouteName;
  /** Path parameters (`id`). */
  params: Record<string, string>;
  /** Query string of the hash (`#/x?a=1`). */
  query: Record<string, string>;
  /** Normalised path without the query (`/analysis/session/abc`). */
  path: string;
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!qs) return out;
  for (const part of qs.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = decode((eq < 0 ? part : part.slice(0, eq)).replace(/\+/g, ' '));
    const v = eq < 0 ? '' : decode(part.slice(eq + 1).replace(/\+/g, ' '));
    if (k) out[k] = v;
  }
  return out;
}

/** First path segment saved or linked before the routes were renamed to English. */
const LEGACY_ROOT: Record<string, string> = {
  inicio: 'home',
  analise: 'analysis',
  captura: 'capture',
  guia: 'guide',
  diarias: 'dailies',
  ajuda: 'help',
  painel: 'live',
};
/** Second segment of `/analysis/…`. */
const LEGACY_ANALYSIS: Record<string, string> = {
  sessao: 'session',
  semana: 'week',
  comparar: 'compare',
  volta: 'lap',
  pista: 'track',
};
const LEGACY_QUERY: Record<string, string> = { modo: 'mode', classe: 'class', topico: 'topic' };
/** Values of the `tab` query of the track page. */
const LEGACY_TABS: Record<string, string> = {
  melhores: 'best',
  sessoes: 'sessions',
  evolucao: 'evolution',
  setores: 'sectors',
  referencias: 'references',
  curvas: 'corners',
  tarefas: 'tasks',
};
const LEGACY_HELP_ARTICLES: Record<string, string> = {
  atalhos: 'shortcuts',
  'backup-e-pasta': 'backup-and-folder',
  'celular-nao-abre': 'phone-cannot-connect',
  'coach-ia': 'ai-coach',
  'combustivel-e-pneus': 'fuel-and-tyres',
  'como-ele-fala': 'radio-calls',
  'corridas-diarias': 'daily-races',
  'delta-e-referencia': 'delta-and-reference',
  'discord-atraso': 'discord-latency',
  'discord-com-problema': 'discord-troubleshooting',
  'discord-configurar': 'discord-setup',
  'discord-ouvir-no-ps5': 'discord-on-ps5',
  'engenheiro-mudo': 'engineer-silent',
  'escolher-a-pista': 'choose-track',
  'escolher-a-voz': 'choose-voice',
  gestos: 'gestures',
  'historico-e-voltas': 'history-and-laps',
  'idioma-e-dados': 'language-and-data',
  'ligar-o-engenheiro': 'enable-engineer',
  'meta-da-pista': 'track-goal',
  'meta-pela-corrida-diaria': 'daily-race-goal',
  'onde-fica-cada-coisa': 'settings-overview',
  'onde-perde-tempo': 'where-you-lose-time',
  'pista-nao-reconhecida': 'unrecognized-track',
  'primeiros-passos': 'getting-started',
  'reconhecer-a-pista': 'track-recognition',
  'refazer-assistente': 'redo-setup',
  'replay-da-volta': 'lap-replay',
  'resumo-da-semana': 'weekly-summary',
  'resumo-da-sessao': 'session-summary',
  'sem-sinal': 'no-signal',
  'setores-e-volta-ideal': 'sectors-and-optimal-lap',
  'tarefas-do-engenheiro': 'engineer-tasks',
  'telas-e-aparelhos': 'screens-and-devices',
  'treinar-uma-curva': 'corner-drill',
  'ver-os-tours': 'guided-tours',
};
const LEGACY_QUERY_VALUES: Record<string, Record<string, string>> = {
  mode: { tempo: 'time', distancia: 'distance' },
  tab: LEGACY_TABS,
  s: {
    inicio: 'overview',
    engenheiro: 'engineer',
    painel: 'display',
    contas: 'accounts',
    sobre: 'about',
    idioma: 'language',
    conexao: 'connection',
    captura: 'capture',
    celular: 'remote-access',
    dispositivos: 'devices',
    aparelhos: 'devices',
    dados: 'data',
    diarias: 'dailies',
    telas: 'screens',
    ia: 'mcp',
  },
  t: {
    inicio: 'start',
    engenheiro: 'engineer',
    'ao-vivo': 'live',
    pistas: 'tracks',
    configuracoes: 'settings',
    problemas: 'problems',
    atalhos: 'keys',
  },
  topic: {
    todos: 'all',
    geral: 'general',
    classe: 'class',
    diagnostico: 'diagnostics',
    afinacao: 'setup',
    glossario: 'glossary',
    fonte: 'sources',
  },
  from: { diarias: 'dailies' },
};

/**
 * The hash with the English route names: `#/analise/pista/x?tab=sessoes` → `#/analysis/track/x?tab=sessions`.
 * Hashes that are already current (or unknown) come back unchanged.
 */
export function canonicalHash(hash: string): string {
  const lead = hash.startsWith('#') ? '#' : '';
  const body = hash.startsWith('#') ? hash.slice(1) : hash;
  const qi = body.indexOf('?');
  const path = qi < 0 ? body : body.slice(0, qi);
  const query = qi < 0 ? '' : body.slice(qi + 1);
  const segs = path.split('/');
  // segs[0] is '' for a leading slash
  const at = segs[0] === '' ? 1 : 0;
  let changed = false;
  const root = decode(segs[at] ?? '');
  if (Object.hasOwn(LEGACY_ROOT, root)) {
    segs[at] = LEGACY_ROOT[root]!;
    changed = true;
  }
  const second = decode(segs[at + 1] ?? '');
  if (segs[at] === 'analysis' && Object.hasOwn(LEGACY_ANALYSIS, second)) {
    segs[at + 1] = LEGACY_ANALYSIS[second]!;
    changed = true;
  }
  if (segs[at] === 'analysis' && segs[at + 1] === 'session' && segs[at + 3] === 'resumo') {
    segs[at + 3] = 'summary';
    changed = true;
  }
  if (segs[at] === 'help' && Object.hasOwn(LEGACY_HELP_ARTICLES, second)) {
    segs[at + 1] = LEGACY_HELP_ARTICLES[second]!;
    changed = true;
  }
  let nextQuery = query;
  if (query) {
    nextQuery = query
      .split('&')
      .map((part) => {
        const eq = part.indexOf('=');
        const key = eq < 0 ? part : part.slice(0, eq);
        let value = eq < 0 ? '' : part.slice(eq + 1);
        const decodedKey = decode(key);
        const renamed = Object.hasOwn(LEGACY_QUERY, decodedKey) ? LEGACY_QUERY[decodedKey]! : key;
        const values = Object.hasOwn(LEGACY_QUERY_VALUES, renamed)
          ? LEGACY_QUERY_VALUES[renamed]
          : undefined;
        const decodedValue = decode(value);
        if (values && Object.hasOwn(values, decodedValue)) value = values[decodedValue]!;
        if (renamed !== key || (eq >= 0 && value !== part.slice(eq + 1))) changed = true;
        return eq < 0 ? renamed : `${renamed}=${value}`;
      })
      .join('&');
  }
  if (!changed) return hash;
  return `${lead}${segs.join('/')}${nextQuery ? `?${nextQuery}` : ''}`;
}

/** Parses `location.hash` (with or without the leading `#`). */
export function parseRoute(hash: string): Route {
  let h = canonicalHash(hash);
  h = h.startsWith('#') ? h.slice(1) : h;
  const qi = h.indexOf('?');
  const query = parseQuery(qi < 0 ? '' : h.slice(qi + 1));
  h = qi < 0 ? h : h.slice(0, qi);
  const segs = h
    .split('/')
    .filter(Boolean)
    .map((s) => decode(s));
  const path = `/${segs.join('/')}`;
  const r = (name: RouteName, params: Record<string, string> = {}): Route => ({
    name,
    params,
    query,
    path,
  });
  const [a, b, c] = segs;
  if (segs.length === 0 || (a === 'live' && segs.length === 1)) return r('live');
  if (a === 'home' && segs.length === 1) return r('home');
  if (a === 'analysis') {
    if (segs.length === 1) return r('sessions');
    if (b === 'session' && c && segs.length === 3) return r('session', { id: c });
    if (b === 'session' && c && segs.length === 4 && segs[3] === 'summary') {
      return r('summary', { id: c });
    }
    if (b === 'week' && segs.length === 2) return r('weekly');
    if (b === 'compare' && segs.length === 2) return r('compare');
    if (b === 'lap' && c && segs.length === 3) return r('replay', { id: c });
    if (b === 'track' && c && segs.length === 3) return r('track', { id: c });
    return r('notFound');
  }
  if (a === 'capture' && segs.length === 1) return r('capture');
  if (a === 'config' && segs.length === 1) return r('config');
  if (a === 'guide' && segs.length === 1) return r('guide');
  if (a === 'dailies' && segs.length === 1) return r('dailies');
  if (a === 'help') {
    if (segs.length === 1) return r('help');
    if (b && segs.length === 2) return r('help', { id: b });
  }
  if (a === 'coach') {
    if (segs.length === 1) return r('coach');
    if (b && segs.length === 2) return r('coach', { id: b });
  }
  return r('notFound');
}

/** True for routes of the analysis area (lazy chunk). */
export function isAnalysisRoute(route: Route): boolean {
  return route.name !== 'live';
}

type QueryValue = string | number | null | undefined | false;

/** Builds a hash href: `href('/analysis/compare', { lap: 'a', ref: 'auto' })` → `#/analysis/compare?lap=a&ref=auto`. */
export function href(path: string, query: Record<string, QueryValue> = {}): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `#${p}${qs ? `?${qs}` : ''}`;
}

export const routes = {
  live: () => '#/',
  home: () => '#/home',
  sessions: (q: { track?: string; car?: string | number } = {}) =>
    href('/analysis', { track: q.track, car: q.car }),
  session: (id: string) => href(`/analysis/session/${encodeURIComponent(id)}`),
  /** Session summary: best lap, pace, consistency, what to do next. */
  summary: (id: string) => href(`/analysis/session/${encodeURIComponent(id)}/summary`),
  /** Weekly summary: `weeksAgo` 0 = the last 7 days. */
  weekly: (weeksAgo = 0) => href('/analysis/week', { w: weeksAgo > 0 ? weeksAgo : undefined }),
  compare: (q: { lap?: string; ref?: string; extra?: string[]; corner?: string }) =>
    href('/analysis/compare', {
      lap: q.lap,
      ref: q.ref,
      extra: q.extra?.length ? q.extra.join(',') : undefined,
      corner: q.corner,
    }),
  /** Replay of one lap; `ref` = a lap id or personalBest / bestReference / sessionBest / auto. */
  replay: (id: string, q: { ref?: string; mode?: 'time' | 'distance'; corner?: string } = {}) =>
    href(`/analysis/lap/${encodeURIComponent(id)}`, {
      ref: q.ref,
      mode: q.mode === 'time' ? 'time' : undefined,
      corner: q.corner,
    }),
  track: (id: string, q: { session?: string; tab?: string; from?: 'dailies' } = {}) =>
    href(`/analysis/track/${encodeURIComponent(id)}`, {
      session: q.session,
      tab: q.tab,
      from: q.from,
    }),
  capture: (q: { daily?: number | string } = {}) => href('/capture', { daily: q.daily }),
  /** Daily Races of the week (DG EDGE). */
  dailies: () => href('/dailies'),
  guide: (q: { q?: string; class?: string; topic?: string } = {}) =>
    href('/guide', { q: q.q, class: q.class, topic: q.topic }),
  /** Help center: `help()` home, `help('discord')` a topic, `help(undefined, 'no-signal')` one article. */
  help: (topic?: string, article?: string) =>
    article ? href(`/help/${encodeURIComponent(article)}`) : href('/help', { t: topic }),
  config: (section?: string) => href('/config', { s: section }),
  coach: (q: { id?: string; session?: string; lap?: string; ref?: string; corner?: string } = {}) =>
    href(q.id ? `/coach/${encodeURIComponent(q.id)}` : '/coach', {
      session: q.session,
      lap: q.lap,
      ref: q.ref,
      corner: q.corner,
    }),
};

/** Navigates (adds a history entry unless `replace`). */
export function navigate(to: string, replace = false): void {
  if (typeof location === 'undefined') return;
  const target = to.startsWith('#') ? to : `#${to}`;
  if (replace) {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${target}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = target;
  }
}
