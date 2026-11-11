/**
 * Guided tour (spec 04), pure part: the steps of the two tours, the state saved in `gt7.tour.v1`
 * and the geometry that places the balloon next to the highlighted element. The component is
 * `components/ui/Tour.tsx`; the store, the demo and the "not while driving" rule are in
 * `state/tour.ts`.
 *
 * Every step points at `data-tour="…"` attributes that exist in the real screens. A selector may
 * list several anchors separated by commas: the highlight then covers all of them (e.g. gear and
 * speed). `lib/tour.test.ts` checks that every anchor exists in the source.
 */

import type { ViewId } from '@gt7/shared';
import { t as uiText } from './i18n.ts';
import { loadJson, saveJson } from './storage.ts';

export type TourId = 'live' | 'analysis';

export interface TourStep {
  id: string;
  /** CSS selector(s) of the anchor(s), always `[data-tour="…"]`. */
  selector: string;
  title: string;
  /** At most 160 characters. */
  body: string;
  /** Hash route that must be open for the anchor to exist (the tour navigates there). */
  route?: string;
  /** Live views that show the anchor; the first one enabled on the device is opened. */
  views?: readonly ViewId[];
}

/** Longest body a step may have (spec 04). */
export const TOUR_BODY_MAX = 160;

/** Anchors, in the order the steps use them. */
export const TOUR_ANCHORS = {
  contextBar: 'context-bar',
  delta: 'delta',
  gear: 'gear',
  speed: 'speed',
  sectors: 'sectors',
  dots: 'dots',
  menu: 'menu',
  lock: 'lock',
  nav: 'nav',
  trackCard: 'track-card',
  navCompare: 'nav-compare',
  navCapture: 'nav-capture',
  setupAgain: 'setup-again',
} as const;

const anchor = (...names: string[]) => names.map((n) => `[data-tour="${n}"]`).join(',');

/** Tour of the live panel (7 steps). Runs on the demo, see `state/tour.ts`. */
export function liveTourSteps(): TourStep[] {
  const A = TOUR_ANCHORS;
  return [
    {
      id: 'context',
      selector: anchor(A.contextBar),
      title: uiText('Pista e engenheiro'),
      body: uiText('Aqui o Bono diz em que pista você está e se o engenheiro está pronto.'),
    },
    {
      id: 'delta',
      selector: anchor(A.delta),
      title: uiText('O delta'),
      body: uiText('Verde: você está mais rápido que a referência. Vermelho: mais lento.'),
      views: ['corrida', 'deltaGrande'],
    },
    {
      id: 'gear-speed',
      selector: anchor(A.gear, A.speed),
      title: uiText('Marcha e velocidade'),
      body: uiText('O que você precisa ler de relance, sempre no mesmo lugar.'),
      views: ['corrida'],
    },
    {
      id: 'sectors',
      selector: anchor(A.sectors),
      title: uiText('Setores'),
      body: uiText('Cada setor mostra a diferença para a sua melhor volta.'),
      views: ['corrida'],
    },
    {
      id: 'dots',
      selector: anchor(A.dots),
      title: uiText('Trocar de tela'),
      body: uiText(
        'Deslize para o lado ou use as setas para trocar de tela. Segure a tela para escolher quais mostrar.',
      ),
    },
    {
      id: 'menu',
      selector: anchor(A.menu),
      title: uiText('Menu'),
      body: uiText('Ligue o engenheiro, troque a voz e vá para o histórico por aqui. Atalho: M.'),
    },
    {
      id: 'lock',
      selector: anchor(A.lock),
      title: uiText('Cadeado'),
      body: uiText('Trava os gestos durante a volta. Segure para destravar.'),
    },
  ];
}

/** Tour of the analysis area (5 steps). */
export function analysisTourSteps(): TourStep[] {
  const A = TOUR_ANCHORS;
  return [
    {
      id: 'nav',
      selector: anchor(A.nav),
      title: uiText('Barra lateral'),
      body: uiText('Ao vivo, Início, Comparar, Gravar volta, Coach, Guia e Ajustes.'),
      route: '#/inicio',
    },
    {
      id: 'track-card',
      selector: anchor(A.trackCard),
      title: uiText('Cartão de pista'),
      body: uiText('Cada pista guarda suas sessões, melhor volta e evolução.'),
      route: '#/inicio',
    },
    {
      id: 'compare',
      selector: anchor(A.navCompare),
      title: uiText('Comparar voltas'),
      body: uiText('Escolha uma volta e uma referência e veja onde está o tempo.'),
    },
    {
      id: 'capture',
      selector: anchor(A.navCapture),
      title: uiText('Gravar volta de replay'),
      body: uiText('Capture a volta de um piloto melhor para usar de referência.'),
    },
    {
      id: 'setup-again',
      selector: anchor(A.setupAgain),
      title: uiText('Ajustes'),
      body: uiText('Você pode refazer o tour e o assistente quando quiser.'),
      route: '#/config?s=sobre',
    },
  ];
}

export function tourSteps(id: TourId): TourStep[] {
  return id === 'live' ? liveTourSteps() : analysisTourSteps();
}

/** Anchor names a selector uses (`[data-tour="a"],[data-tour="b"]` → `['a', 'b']`). */
export function selectorAnchors(selector: string): string[] {
  return [...selector.matchAll(/\[data-tour="([^"]+)"\]/g)].map((m) => m[1] ?? '');
}

// ---------------------------------------------------------------------------------------------
// Saved state
// ---------------------------------------------------------------------------------------------

export const TOUR_STATE_KEY = 'gt7.tour.v1';

export type TourOutcome = 'done' | 'skipped';
export type HintId = 'engineerSpoke' | 'lapWithoutReference' | 'sessionSaved';
export const HINT_IDS: readonly HintId[] = ['engineerSpoke', 'lapWithoutReference', 'sessionSaved'];

export interface TourState {
  live?: TourOutcome;
  analysis?: TourOutcome;
  /** One-time hints already shown. */
  hints: Partial<Record<HintId, true>>;
}

export function parseTourState(saved: unknown): TourState {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const outcome = (v: unknown): TourOutcome | undefined =>
    v === 'done' || v === 'skipped' ? v : undefined;
  const hints: TourState['hints'] = {};
  const raw = (typeof s.hints === 'object' && s.hints !== null ? s.hints : {}) as Record<
    string,
    unknown
  >;
  for (const id of HINT_IDS) if (raw[id] === true) hints[id] = true;
  const live = outcome(s.live);
  const analysis = outcome(s.analysis);
  return { ...(live && { live }), ...(analysis && { analysis }), hints };
}

export function loadTourState(): TourState {
  return parseTourState(loadJson<unknown>(TOUR_STATE_KEY));
}

export function saveTourState(state: TourState): void {
  saveJson(TOUR_STATE_KEY, state);
}

export function withOutcome(state: TourState, tour: TourId, outcome: TourOutcome): TourState {
  return { ...state, [tour]: outcome };
}

export function withHint(state: TourState, hint: HintId): TourState {
  return { ...state, hints: { ...state.hints, [hint]: true } };
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Smallest box that holds all the boxes (null when there is none). */
export function unionBox(boxes: readonly Box[]): Box | null {
  const first = boxes[0];
  if (!first) return null;
  let x0 = first.x;
  let y0 = first.y;
  let x1 = first.x + first.w;
  let y1 = first.y + first.h;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Grows a box and keeps it inside the viewport. */
export function padBox(b: Box, pad: number, vp: { w: number; h: number }): Box {
  const x0 = Math.max(0, b.x - pad);
  const y0 = Math.max(0, b.y - pad);
  const x1 = Math.min(vp.w, b.x + b.w + pad);
  const y1 = Math.min(vp.h, b.y + b.h + pad);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** True when the box is at least partly on screen (neighbour slots of the carousel are not). */
export function isOnScreen(b: Box, vp: { w: number; h: number }): boolean {
  return b.w > 0 && b.h > 0 && b.x < vp.w && b.y < vp.h && b.x + b.w > 0 && b.y + b.h > 0;
}

export type BalloonSide = 'bottom' | 'top' | 'right' | 'left' | 'center';

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Where the balloon goes: below the target if it fits, else above, to the right, to the left; when
 * the target is too big for any of them, the balloon sits over the free edge of the screen. It
 * never leaves the viewport.
 */
export function placeBalloon(
  target: Box,
  size: { w: number; h: number },
  vp: { w: number; h: number },
  gap = 14,
  margin = 12,
): { x: number; y: number; side: BalloonSide } {
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  const fitX = (x: number) => clamp(x, margin, vp.w - size.w - margin);
  const fitY = (y: number) => clamp(y, margin, vp.h - size.h - margin);
  const below = vp.h - (target.y + target.h) - margin;
  const above = target.y - margin;
  const right = vp.w - (target.x + target.w) - margin;
  const left = target.x - margin;
  if (below >= size.h + gap) {
    return { x: fitX(cx - size.w / 2), y: target.y + target.h + gap, side: 'bottom' };
  }
  if (above >= size.h + gap) {
    return { x: fitX(cx - size.w / 2), y: target.y - gap - size.h, side: 'top' };
  }
  if (right >= size.w + gap) {
    return { x: target.x + target.w + gap, y: fitY(cy - size.h / 2), side: 'right' };
  }
  if (left >= size.w + gap) {
    return { x: target.x - gap - size.w, y: fitY(cy - size.h / 2), side: 'left' };
  }
  return {
    x: fitX(cx - size.w / 2),
    y: cy < vp.h / 2 ? vp.h - size.h - margin : margin,
    side: 'center',
  };
}

/** Step to show after `from` going `dir`, or `null` past either end. */
export function stepAfter(from: number, dir: 1 | -1, total: number): number | null {
  const next = from + dir;
  return next < 0 || next >= total ? null : next;
}
