/**
 * "Resumo da semana" as an image to share: a pure model of what the card says (tested) and the
 * canvas drawing of it (checked in the browser). 1080 px wide, in the Pit Wall colours.
 */

import { formatDriving, WEEKLY_MAX_TRACKS, type WeeklySummary } from '@gt7/shared';
import { THEME } from '../../lib/theme.ts';

export interface WeeklyImageFormat {
  lapTime: (ms: number) => string;
  /** Signed seconds, e.g. `−0,424`. */
  delta: (ms: number) => string;
  date: (ms: number) => string;
  car: (carCode: number) => string;
  /** Translates a pt-BR template. */
  t: (message: string, ...values: unknown[]) => string;
}

export type WeeklyTone = 'gain' | 'loss' | 'neutral';

export interface WeeklyImageRow {
  name: string;
  car: string;
  best: string;
  /** "−0,424 vs. recorde" / "primeira vez" / "". */
  change: string;
  tone: WeeklyTone;
  /** "meta batida" / "faltam 1,500 para a meta" / "". */
  goal: string;
}

export interface WeeklyImageModel {
  title: string;
  range: string;
  stats: { label: string; value: string }[];
  rows: WeeklyImageRow[];
  /** Tracks beyond the ones drawn. */
  more: number;
  goals: string[];
  empty: boolean;
}

export function weeklyImageModel(s: WeeklySummary, f: WeeklyImageFormat): WeeklyImageModel {
  const rows = s.tracks.slice(0, WEEKLY_MAX_TRACKS).map((r): WeeklyImageRow => {
    const best = r.bestMs === null ? '–' : f.lapTime(r.bestMs);
    let change = '';
    let tone: WeeklyTone = 'neutral';
    if (r.firstTime) change = f.t('primeira vez');
    else if (r.deltaMs !== null) {
      tone = r.deltaMs < 0 ? 'gain' : r.deltaMs > 0 ? 'loss' : 'neutral';
      change =
        r.deltaMs < 0
          ? f.t('{0} vs. recorde', f.delta(r.deltaMs))
          : f.t('{0} do recorde', f.delta(r.deltaMs));
    }
    const goal = r.goal
      ? r.goal.reached
        ? f.t('meta batida')
        : f.t('faltam {0} para a meta', f.delta(r.goal.remainingMs).replace('+', ''))
      : '';
    return { name: r.trackName ?? f.t('Pista'), car: f.car(r.carCode), best, change, tone, goal };
  });
  return {
    title: f.t('Minha semana no Bono'),
    range: f.t('{0} a {1}', f.date(s.fromMs), f.date(s.toMs - 1)),
    stats: [
      { label: f.t('Sessões'), value: String(s.sessions) },
      { label: f.t('Voltas'), value: String(s.laps) },
      { label: f.t('Na pista'), value: formatDriving(s.drivingMs) },
      { label: f.t('Recordes'), value: String(s.records) },
    ],
    rows,
    more: Math.max(0, s.tracks.length - rows.length),
    goals: s.goalsReached.map((g) =>
      f.t('Meta batida: {0} em {1}', f.lapTime(g.targetMs), g.trackName ?? f.t('Pista')),
    ),
    empty: s.sessions === 0,
  };
}

const W = 1080;
const PAD = 64;
const TONE: Record<WeeklyTone, string> = {
  gain: THEME.gain,
  loss: THEME.loss,
  neutral: THEME.text2,
};

/** Height of the card for a model (rows and goals vary). */
export function weeklyImageHeight(m: WeeklyImageModel): number {
  const rows = m.rows.length;
  return 360 + (m.empty ? 160 : rows * 150 + (m.more ? 60 : 0) + m.goals.length * 64 + 40) + 90;
}

/** Draws the card on a canvas of 1080 × weeklyImageHeight(model). */
export function drawWeeklyImage(
  ctx: CanvasRenderingContext2D,
  m: WeeklyImageModel,
  footer: string,
): void {
  const H = weeklyImageHeight(m);
  const font = (px: number, weight = 600) => `${weight} ${px}px ${THEME.font}`;

  ctx.fillStyle = THEME.surface1;
  ctx.fillRect(0, 0, W, H);
  // Accent bar on top
  ctx.fillStyle = THEME.purple;
  ctx.fillRect(0, 0, W, 10);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = THEME.text;
  ctx.font = font(64, 800);
  ctx.fillText(m.title, PAD, 130);
  ctx.fillStyle = THEME.text2;
  ctx.font = font(34, 500);
  ctx.fillText(m.range, PAD, 184);

  // Stats row
  const colW = (W - PAD * 2) / m.stats.length;
  m.stats.forEach((st, i) => {
    const x = PAD + i * colW;
    ctx.fillStyle = THEME.surface2;
    ctx.fillRect(x, 230, colW - 16, 120);
    ctx.fillStyle = THEME.text3;
    ctx.font = font(24, 600);
    ctx.fillText(st.label.toUpperCase(), x + 20, 270);
    ctx.fillStyle = THEME.text;
    ctx.font = font(40, 800);
    ctx.fillText(st.value, x + 20, 328);
  });

  let y = 410;
  if (m.empty) {
    ctx.fillStyle = THEME.text2;
    ctx.font = font(36, 500);
    ctx.fillText('–', PAD, y + 60);
  }
  for (const r of m.rows) {
    ctx.fillStyle = THEME.surface2;
    ctx.fillRect(PAD, y, W - PAD * 2, 134);
    ctx.fillStyle = TONE[r.tone];
    ctx.fillRect(PAD, y, 8, 134);
    ctx.fillStyle = THEME.text;
    ctx.font = font(36, 700);
    ctx.fillText(clip(ctx, r.name, 560), PAD + 32, y + 52);
    ctx.fillStyle = THEME.text3;
    ctx.font = font(26, 500);
    ctx.fillText(clip(ctx, r.car, 560), PAD + 32, y + 90);
    if (r.goal) {
      ctx.fillStyle = THEME.purple;
      ctx.fillText(clip(ctx, r.goal, 560), PAD + 32, y + 122);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = THEME.text;
    ctx.font = font(52, 800);
    ctx.fillText(r.best, W - PAD - 28, y + 66);
    ctx.fillStyle = TONE[r.tone];
    ctx.font = font(28, 600);
    ctx.fillText(r.change, W - PAD - 28, y + 108);
    ctx.textAlign = 'left';
    y += 150;
  }
  if (m.more > 0) {
    ctx.fillStyle = THEME.text3;
    ctx.font = font(28, 500);
    ctx.fillText(`+${m.more}`, PAD, y + 24);
    y += 60;
  }
  for (const g of m.goals) {
    ctx.fillStyle = THEME.purple;
    ctx.font = font(34, 700);
    ctx.fillText(clip(ctx, g, W - PAD * 2), PAD, y + 40);
    y += 64;
  }

  ctx.fillStyle = THEME.text3;
  ctx.font = font(26, 500);
  ctx.fillText(footer, PAD, H - 40);
}

function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

/** The card as a PNG (null when the canvas cannot be encoded). */
export function weeklyImageBlob(m: WeeklyImageModel, footer: string): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = weeklyImageHeight(m);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  drawWeeklyImage(ctx, m, footer);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
