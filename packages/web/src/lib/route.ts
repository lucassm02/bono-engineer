/**
 * Hash router (no dependency): `#/analise/...` opens the analysis & settings area, anything else
 * (empty hash, `#/`, `#/painel`) is the live dashboard. Hash routing works the same on the Vite dev
 * server, the Fastify static server and inside the installed PWA (no server rewrite needed).
 *
 *   #/inicio                          home: history organised by track (default outside a race)
 *   #/analise                         all sessions list
 *   #/analise/sessao/:sessionId       session detail (laps)
 *   #/analise/sessao/:sessionId/resumo   session summary (spec 12)
 *   #/analise/comparar?lap=&ref=&extra=a,b   lap comparison
 *   #/analise/pista/:trackId?session= track page (consistency, evolution)
 *   #/captura                         reference capture
 *   #/config                          settings
 *   #/coach[/:reportId]?session=&lap=&ref=&corner=   AI coach
 *   #/guia?q=&classe=&topico=         driving guide (coach knowledge base)
 *   #/ajuda?t=<topic>&q=              help center (topics, search)
 *   #/ajuda/<article-id>              one help article
 */

export type RouteName =
  | 'live'
  | 'home'
  | 'sessions'
  | 'session'
  | 'summary'
  | 'compare'
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
  /** Normalised path without the query (`/analise/sessao/abc`). */
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
  const out: Record<string, string> = {};
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

/** Parses `location.hash` (with or without the leading `#`). */
export function parseRoute(hash: string): Route {
  let h = hash.startsWith('#') ? hash.slice(1) : hash;
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
  if (segs.length === 0 || (a === 'painel' && segs.length === 1)) return r('live');
  if (a === 'inicio' && segs.length === 1) return r('home');
  if (a === 'analise') {
    if (segs.length === 1) return r('sessions');
    if (b === 'sessao' && c && segs.length === 3) return r('session', { id: c });
    if (b === 'sessao' && c && segs.length === 4 && segs[3] === 'resumo') {
      return r('summary', { id: c });
    }
    if (b === 'comparar' && segs.length === 2) return r('compare');
    if (b === 'pista' && c && segs.length === 3) return r('track', { id: c });
    return r('notFound');
  }
  if (a === 'captura' && segs.length === 1) return r('capture');
  if (a === 'config' && segs.length === 1) return r('config');
  if (a === 'guia' && segs.length === 1) return r('guide');
  if (a === 'diarias' && segs.length === 1) return r('dailies');
  if (a === 'ajuda') {
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

/** Builds a hash href: `href('/analise/comparar', { lap: 'a', ref: 'auto' })` → `#/analise/comparar?lap=a&ref=auto`. */
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
  home: () => '#/inicio',
  sessions: (q: { track?: string; car?: string | number } = {}) =>
    href('/analise', { track: q.track, car: q.car }),
  session: (id: string) => href(`/analise/sessao/${encodeURIComponent(id)}`),
  /** Session summary: best lap, pace, consistency, what to do next. */
  summary: (id: string) => href(`/analise/sessao/${encodeURIComponent(id)}/resumo`),
  compare: (q: { lap?: string; ref?: string; extra?: string[]; corner?: string }) =>
    href('/analise/comparar', {
      lap: q.lap,
      ref: q.ref,
      extra: q.extra?.length ? q.extra.join(',') : undefined,
      corner: q.corner,
    }),
  track: (id: string, q: { session?: string; tab?: string; from?: 'dailies' } = {}) =>
    href(`/analise/pista/${encodeURIComponent(id)}`, {
      session: q.session,
      tab: q.tab,
      from: q.from,
    }),
  capture: (q: { daily?: number | string } = {}) => href('/captura', { daily: q.daily }),
  /** Daily Races of the week (DG EDGE). */
  dailies: () => href('/diarias'),
  guide: (q: { q?: string; classe?: string; topico?: string } = {}) =>
    href('/guia', { q: q.q, classe: q.classe, topico: q.topico }),
  /** Help center: `help()` home, `help('discord')` a topic, `help(undefined, 'no-signal')` one article. */
  help: (topic?: string, article?: string) =>
    article ? href(`/ajuda/${encodeURIComponent(article)}`) : href('/ajuda', { t: topic }),
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
