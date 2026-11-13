/** Plain-text version of the weekly summary, to copy or share (pt-BR by default; no server). */

import type { WeeklySummary } from './analysis.ts';

export interface WeeklyTextFormat {
  lapTime: (ms: number) => string;
  /** Signed seconds, e.g. `−0,400`. */
  delta: (ms: number) => string;
  /** `12/11`-style date. */
  date: (ms: number) => string;
  /** Name of a car for a car code. */
  car?: (carCode: number) => string;
  /** Translates a pt-BR template (default: identity). */
  translate?: (message: string, ...values: unknown[]) => string;
}

const fill = (template: string, values: readonly unknown[]) =>
  template.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? ''));

/** Time on track as "2 h 05 min" / "35 min". */
export function formatDriving(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** How many tracks and which rows make the shared text and image (the most driven first). */
export const WEEKLY_MAX_TRACKS = 5;

export function weeklyToText(s: WeeklySummary, format: WeeklyTextFormat): string {
  const t = format.translate ?? ((message: string, ...values: unknown[]) => fill(message, values));
  const lines: string[] = [];
  lines.push(t('Minha semana no Bono · {0} a {1}', format.date(s.fromMs), format.date(s.toMs - 1)));
  if (s.sessions === 0) {
    lines.push(t('Nenhuma volta nesta semana.'));
    return lines.join('\n');
  }
  lines.push(
    t(
      '{0} sessões · {1} voltas ({2} válidas) · {3} na pista',
      s.sessions,
      s.laps,
      s.validLaps,
      formatDriving(s.drivingMs),
    ),
  );
  if (s.records > 0) {
    lines.push(s.records === 1 ? t('1 recorde pessoal') : t('{0} recordes pessoais', s.records));
  }
  for (const g of s.goalsReached) {
    lines.push(
      `• ${t('Meta batida: {0} em {1}', format.lapTime(g.targetMs), g.trackName ?? t('Pista'))}`,
    );
  }
  lines.push('');
  for (const row of s.tracks.slice(0, WEEKLY_MAX_TRACKS)) {
    const name = row.trackName ?? t('Pista');
    const car = format.car ? ` (${format.car(row.carCode)})` : '';
    if (row.bestMs === null) {
      lines.push(`• ${name}${car}: ${t('{0} voltas, nenhuma válida', row.laps)}`);
      continue;
    }
    const change = row.firstTime
      ? t('primeira vez')
      : row.deltaMs === null
        ? ''
        : row.deltaMs < 0
          ? t('{0} contra o recorde anterior', format.delta(row.deltaMs))
          : t('{0} do recorde anterior', format.delta(row.deltaMs));
    const goal = row.goal
      ? row.goal.reached
        ? ` · ${t('meta batida')}`
        : ` · ${t('faltam {0} para a meta', format.delta(row.goal.remainingMs).replace('+', ''))}`
      : '';
    lines.push(
      `• ${name}${car}: ${format.lapTime(row.bestMs)}${change ? ` (${change})` : ''}${goal}`,
    );
  }
  return lines.join('\n');
}
