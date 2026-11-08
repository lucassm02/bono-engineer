/**
 * Custom grid ("Personalizada") layout: widget catalogue metadata, sanitising and an edit reducer
 * (pure). Items keep their array order as reading order; positions are always recomputed by
 * {@link packLayout} (CSS-grid-like sparse auto placement), so editing never needs drag & drop.
 */

import {
  DEFAULT_CUSTOM_LAYOUT,
  WIDGET_IDS,
  type WidgetGridLayout,
  type WidgetId,
  type WidgetPlacement,
} from '@gt7/shared';

export const GRID_COLUMNS_MIN = 2;
export const GRID_COLUMNS_MAX = 8;
export const WIDGET_H_MAX = 4;
export const LAYOUT_MAX_ITEMS = 16;

export interface WidgetMeta {
  label: string;
  /** Default size when added (cells). */
  w: number;
  h: number;
}

export const WIDGET_META: Record<WidgetId, WidgetMeta> = {
  delta: { label: 'Delta', w: 2, h: 1 },
  deltaBar: { label: 'Barra de delta', w: 2, h: 1 },
  currentLap: { label: 'Volta atual', w: 1, h: 1 },
  predictedLap: { label: 'Prevista', w: 1, h: 1 },
  lastLap: { label: 'Última volta', w: 1, h: 1 },
  bestLap: { label: 'Melhor volta', w: 1, h: 1 },
  lapCounter: { label: 'Contador de voltas', w: 1, h: 1 },
  sectors: { label: 'Setores', w: 3, h: 1 },
  gear: { label: 'Marcha', w: 1, h: 1 },
  speed: { label: 'Velocidade', w: 1, h: 1 },
  rpm: { label: 'RPM', w: 2, h: 1 },
  shiftLights: { label: 'Shift lights', w: 2, h: 1 },
  tyreTemps: { label: 'Temp. dos pneus', w: 1, h: 1 },
  tyreSlip: { label: 'Patinagem', w: 1, h: 1 },
  inputs: { label: 'Pedais', w: 1, h: 1 },
  steering: { label: 'Volante', w: 1, h: 1 },
  fuel: { label: 'Combustível', w: 1, h: 1 },
  gForce: { label: 'Forças G', w: 1, h: 1 },
  miniMap: { label: 'Mini-mapa', w: 1, h: 2 },
  boost: { label: 'Turbo', w: 1, h: 1 },
  oilPressure: { label: 'Pressão do óleo', w: 1, h: 1 },
  nextCorner: { label: 'Próxima curva', w: 2, h: 1 },
  flags: { label: 'Auxílios e alertas', w: 1, h: 1 },
  linkQuality: { label: 'Conexão', w: 1, h: 1 },
};

export function isWidgetId(v: unknown): v is WidgetId {
  return typeof v === 'string' && (WIDGET_IDS as readonly string[]).includes(v);
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** Sparse auto-placement in reading order; returns new placements and the row count. */
export function packLayout(
  items: WidgetPlacement[],
  columns: number,
): { items: WidgetPlacement[]; rows: number } {
  const occ: boolean[][] = [];
  const free = (x: number, y: number, w: number, h: number) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (occ[r]?.[c]) return false;
    return true;
  };
  const mark = (x: number, y: number, w: number, h: number) => {
    for (let r = y; r < y + h; r++) {
      occ[r] ??= [];
      for (let c = x; c < x + w; c++) occ[r]![c] = true;
    }
  };
  let cx = 0;
  let cy = 0;
  let rows = 0;
  const out = items.map((it) => {
    const w = Math.min(Math.max(1, it.w), columns);
    const h = Math.max(1, it.h);
    let x = cx;
    let y = cy;
    for (;;) {
      if (x + w > columns) {
        x = 0;
        y++;
        continue;
      }
      if (free(x, y, w, h)) break;
      x++;
    }
    mark(x, y, w, h);
    cx = x + w;
    cy = y;
    rows = Math.max(rows, y + h);
    return { ...it, x, y, w, h };
  });
  return { items: out, rows: Math.max(1, rows) };
}

/** Validates an untrusted layout (unknown widgets dropped, sizes clamped, keys unique), packed. */
export function sanitizeLayout(input: unknown): WidgetGridLayout {
  if (typeof input !== 'object' || input === null) return cloneDefault();
  const l = input as Partial<WidgetGridLayout>;
  const columns = clampInt(l.columns, GRID_COLUMNS_MIN, GRID_COLUMNS_MAX, 4);
  const raw = Array.isArray(l.items) ? l.items : [];
  const keys = new Set<string>();
  const items: WidgetPlacement[] = [];
  const sorted = [...raw]
    .filter(
      (i): i is WidgetPlacement => typeof i === 'object' && i !== null && isWidgetId(i.widget),
    )
    .sort(
      (a, b) => (Number(a.y) || 0) - (Number(b.y) || 0) || (Number(a.x) || 0) - (Number(b.x) || 0),
    );
  for (const it of sorted) {
    if (items.length >= LAYOUT_MAX_ITEMS) break;
    let key = typeof it.key === 'string' && it.key ? it.key : it.widget;
    if (keys.has(key)) key = uniqueKey(it.widget, keys);
    keys.add(key);
    const meta = WIDGET_META[it.widget];
    items.push({
      key,
      widget: it.widget,
      x: 0,
      y: 0,
      w: clampInt(it.w, 1, columns, meta.w),
      h: clampInt(it.h, 1, WIDGET_H_MAX, meta.h),
      ...(it.options ? { options: it.options } : {}),
    });
  }
  const packed = packLayout(items, columns);
  return { columns, rows: packed.rows, items: packed.items };
}

function cloneDefault(): WidgetGridLayout {
  return {
    ...DEFAULT_CUSTOM_LAYOUT,
    items: DEFAULT_CUSTOM_LAYOUT.items.map((i) => ({ ...i })),
  };
}

function uniqueKey(widget: WidgetId, used: Set<string>): string {
  if (!used.has(widget)) return widget;
  let n = 2;
  while (used.has(`${widget}-${n}`)) n++;
  return `${widget}-${n}`;
}

export type LayoutAction =
  | { type: 'add'; widget: WidgetId }
  | { type: 'remove'; key: string }
  | { type: 'move'; key: string; by: -1 | 1 }
  | { type: 'resize'; key: string; dw: number; dh: number }
  | { type: 'setColumns'; columns: number }
  | { type: 'reset' };

/** Applies an edit; returns the same object when nothing changed. */
export function reduceLayout(layout: WidgetGridLayout, a: LayoutAction): WidgetGridLayout {
  let columns = layout.columns;
  let items = layout.items;
  switch (a.type) {
    case 'add': {
      if (items.length >= LAYOUT_MAX_ITEMS) return layout;
      const meta = WIDGET_META[a.widget];
      const key = uniqueKey(a.widget, new Set(items.map((i) => i.key)));
      items = [
        ...items,
        { key, widget: a.widget, x: 0, y: 0, w: Math.min(meta.w, columns), h: meta.h },
      ];
      break;
    }
    case 'remove': {
      const next = items.filter((i) => i.key !== a.key);
      if (next.length === items.length) return layout;
      items = next;
      break;
    }
    case 'move': {
      const i = items.findIndex((it) => it.key === a.key);
      const j = i + a.by;
      if (i < 0 || j < 0 || j >= items.length) return layout;
      const next = [...items];
      next[i] = items[j]!;
      next[j] = items[i]!;
      items = next;
      break;
    }
    case 'resize': {
      const i = items.findIndex((it) => it.key === a.key);
      if (i < 0) return layout;
      const it = items[i]!;
      const w = Math.min(Math.max(1, it.w + a.dw), columns);
      const h = Math.min(Math.max(1, it.h + a.dh), WIDGET_H_MAX);
      if (w === it.w && h === it.h) return layout;
      items = items.map((x, k) => (k === i ? { ...x, w, h } : x));
      break;
    }
    case 'setColumns': {
      const c = Math.min(Math.max(GRID_COLUMNS_MIN, Math.round(a.columns)), GRID_COLUMNS_MAX);
      if (c === columns) return layout;
      columns = c;
      items = items.map((it) => ({ ...it, w: Math.min(it.w, c) }));
      break;
    }
    case 'reset':
      return cloneDefault();
  }
  const packed = packLayout(items, columns);
  return { columns, rows: packed.rows, items: packed.items };
}
