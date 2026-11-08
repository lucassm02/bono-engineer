/**
 * Pure data shaping for the comparison page: trace series for uPlot, corner zoom ranges, map
 * lookups (distance ↔ position) and the corner-table metric definitions/colouring.
 */

import type {
  ApiTraces,
  Corner,
  CornerComparisonRow,
  CornerMetricKey,
  CornerMetrics,
  MicrosectorColor,
} from '@gt7/shared';

// ---------------------------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------------------------

export type Series = (number | null)[];

/** Channels requested from /api/analysis/traces for the comparison (aliases). */
export const COMPARE_TRACE_CHANNELS = [
  'speed',
  'throttle',
  'brake',
  'gear',
  'steering',
  'delta',
  'x',
  'z',
] as const;

export interface PanelDef {
  key: 'speed' | 'throttle' | 'brake' | 'gear' | 'steering' | 'delta';
  label: string;
  unit: string;
  /** Multiplier applied to the raw channel (pedals 0–1 → %). */
  scale: number;
  height: number;
  stepped?: boolean;
  /** Fixed y range (else auto). */
  range?: [number, number];
  digits: number;
}

export const COMPARE_PANELS: PanelDef[] = [
  { key: 'speed', label: 'Velocidade', unit: 'km/h', scale: 1, height: 190, digits: 0 },
  {
    key: 'throttle',
    label: 'Acelerador',
    unit: '%',
    scale: 100,
    height: 90,
    range: [0, 100],
    digits: 0,
  },
  { key: 'brake', label: 'Freio', unit: '%', scale: 100, height: 90, range: [0, 100], digits: 0 },
  { key: 'gear', label: 'Marcha', unit: '', scale: 1, height: 80, stepped: true, digits: 0 },
  { key: 'steering', label: 'Volante', unit: '°', scale: 180 / Math.PI, height: 90, digits: 0 },
  { key: 'delta', label: 'Delta acumulado', unit: 's', scale: 1, height: 120, digits: 3 },
];

/** One channel of a lap from the traces response, scaled; nulls preserved. */
export function lapSeries(traces: ApiTraces, lapId: string, key: string, scale = 1): Series {
  const lap = traces.laps.find((l) => l.lapId === lapId);
  const raw = lap?.channels[key];
  if (!raw) return traces.distanceM.map(() => null);
  return raw.map((v) => (v === null || !Number.isFinite(v) ? null : v * scale));
}

export function isAllNull(s: ArrayLike<number | null>): boolean {
  for (let i = 0; i < s.length; i++)
    if (s[i] !== null && Number.isFinite(s[i] as number)) return false;
  return true;
}

/** uPlot aligned data `[x, ...series]` for one panel and the given laps (order kept). */
export function panelData(traces: ApiTraces, panel: PanelDef, lapIds: string[]): Series[] {
  return [traces.distanceM, ...lapIds.map((id) => lapSeries(traces, id, panel.key, panel.scale))];
}

/** Index of the last grid point ≤ d (grid sorted ascending); −1 before the start. */
export function gridIndex(grid: ArrayLike<number>, d: number): number {
  let lo = 0;
  let hi = grid.length - 1;
  if (hi < 0 || d < grid[0]!) return -1;
  if (d >= grid[hi]!) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (grid[mid]! <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation of a series at distance d (null when outside or on a gap). */
export function valueAt(grid: ArrayLike<number>, values: Series, d: number): number | null {
  const i = gridIndex(grid, d);
  if (i < 0) return null;
  const v0 = values[i];
  if (v0 === null || v0 === undefined) return null;
  if (i >= grid.length - 1) return v0;
  const v1 = values[i + 1];
  if (v1 === null || v1 === undefined) return v0;
  const x0 = grid[i]!;
  const x1 = grid[i + 1]!;
  const t = x1 > x0 ? (d - x0) / (x1 - x0) : 0;
  return v0 + (v1 - v0) * Math.min(1, Math.max(0, t));
}

/** Nearest point (squared distance) of a polyline to (px, pz); −1 when empty. */
export function nearestIndex(
  xs: ArrayLike<number | null>,
  zs: ArrayLike<number | null>,
  px: number,
  pz: number,
): number {
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  const n = Math.min(xs.length, zs.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const z = zs[i];
    if (x === null || z === null || x === undefined || z === undefined) continue;
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Microsector colour covering distance d (null outside). */
export function colorAt(colors: MicrosectorColor[], d: number): MicrosectorColor | null {
  for (const c of colors) if (d >= c.fromM && d < c.toM) return c;
  const last = colors[colors.length - 1];
  return last && d >= last.toM - 1e-6 && d <= last.toM + 1 ? last : null;
}

// ---------------------------------------------------------------------------------------------
// Corners
// ---------------------------------------------------------------------------------------------

export function cornerLabel(c: Pick<Corner, 'id' | 'name'>): string {
  return c.name ? `${c.id} · ${c.name}` : c.id;
}

/**
 * Zoom range of a corner: from a bit before the earliest brake point (or the comparison zone /
 * entry − 80 m) to the exit + 60 m, clamped to the lap.
 */
export function cornerRange(
  corner: Pick<Corner, 'entryM' | 'exitM'>,
  row: Pick<CornerComparisonRow, 'zone' | 'a' | 'b'> | null | undefined,
  lengthM: number,
): [number, number] {
  const starts = [corner.entryM - 80];
  if (row?.zone) starts.push(row.zone.fromM - 10);
  for (const m of [row?.a?.brakePointM, row?.b?.brakePointM]) {
    if (m !== null && m !== undefined && Number.isFinite(m)) starts.push(m - 25);
  }
  const from = Math.max(0, Math.min(...starts));
  const to = Math.min(lengthM, corner.exitM + 60);
  return to > from ? [from, to] : [0, lengthM];
}

// ---------------------------------------------------------------------------------------------
// Corner table metrics
// ---------------------------------------------------------------------------------------------

export type Tone = 'gain' | 'loss' | 'neutral' | 'warn';

export interface MetricDef {
  key: CornerMetricKey;
  label: string;
  short: string;
  unit: string;
  digits: number;
  /** Which direction of the diff (subject − reference) is better; null = no colouring. */
  better: 'higher' | 'lower' | null;
  /** |diff| below this is neutral. */
  deadband: number;
  /** Explains the diff sign (pt-BR, for tooltips). */
  hint: string;
}

export const CORNER_METRICS: MetricDef[] = [
  {
    key: 'brakePointM',
    label: 'Ponto de frenagem',
    short: 'Frenagem',
    unit: 'm',
    digits: 0,
    better: 'higher',
    deadband: 5,
    hint: '+ = você freia mais tarde que a referência',
  },
  {
    key: 'minSpeedKmh',
    label: 'Velocidade mínima',
    short: 'V-mín',
    unit: 'km/h',
    digits: 1,
    better: 'higher',
    deadband: 2,
    hint: '+ = você contorna mais rápido',
  },
  {
    key: 'throttlePickupM',
    label: 'Retomada do acelerador',
    short: 'Retomada',
    unit: 'm',
    digits: 0,
    better: 'lower',
    deadband: 8,
    hint: '− = você acelera antes',
  },
  {
    key: 'coastingS',
    label: 'Roda livre',
    short: 'Roda livre',
    unit: 's',
    digits: 2,
    better: 'lower',
    deadband: 0.1,
    hint: '+ = mais tempo sem pedal',
  },
  {
    key: 'exitSpeedKmh',
    label: 'Velocidade de saída',
    short: 'Saída',
    unit: 'km/h',
    digits: 1,
    better: 'higher',
    deadband: 3,
    hint: '+ = você sai mais rápido',
  },
  {
    key: 'trailBrakingS',
    label: 'Trail braking',
    short: 'Trail',
    unit: 's',
    digits: 2,
    better: 'higher',
    deadband: 0.1,
    hint: '+ = mais freio durante a entrada',
  },
];

/** Colour of a diff (subject − reference) for a metric definition. */
export function metricTone(
  def: Pick<MetricDef, 'better' | 'deadband'>,
  diff: number | null | undefined,
): Tone {
  if (diff === null || diff === undefined || !Number.isFinite(diff)) return 'neutral';
  if (Math.abs(diff) < def.deadband || def.better === null) return 'neutral';
  const good = def.better === 'higher' ? diff > 0 : diff < 0;
  return good ? 'gain' : 'loss';
}

/** Time lost colour (ms, + = slower), ±10 ms neutral. */
export function timeTone(ms: number | null | undefined, deadbandMs = 10): Tone {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || Math.abs(ms) < deadbandMs) {
    return 'neutral';
  }
  return ms > 0 ? 'loss' : 'gain';
}

/** Lateral offset is not good/bad per se: highlight (warn) above 1.2 m at the apex. */
export function offsetTone(m: number | null | undefined): Tone {
  return m !== null && m !== undefined && Math.abs(m) >= 1.2 ? 'warn' : 'neutral';
}

export function metricDiff(row: CornerComparisonRow, key: CornerMetricKey): number | null {
  const d = row.diff[key];
  if (d !== undefined) return d;
  const a = row.a[key as keyof CornerMetrics] as number | null;
  const b = row.b[key as keyof CornerMetrics] as number | null;
  return typeof a === 'number' && typeof b === 'number' ? a - b : null;
}

export type CornerSort = 'order' | 'timeLost';

export function sortRows(rows: CornerComparisonRow[], by: CornerSort): CornerComparisonRow[] {
  const out = [...rows];
  if (by === 'timeLost') out.sort((x, y) => y.timeLostMs - x.timeLostMs);
  else out.sort((x, y) => x.corner.index - y.corner.index);
  return out;
}

/** "+12" / "−3,5" with the true minus sign; empty for null. */
export function signed(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const r = Number(Math.abs(v).toFixed(digits));
  const s = r === 0 ? '±' : v > 0 ? '+' : '−';
  return `${s}${r.toFixed(digits).replace('.', ',')}`;
}

export function fixed(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  return v.toFixed(digits).replace('.', ',');
}
