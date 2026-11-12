/** Plain-text version of a session summary, to copy or share (pt-BR by default; no server). */

import type { SessionSummary, SummarySuggestion } from './analysis.ts';

export interface SummaryTextFormat {
  lapTime: (ms: number) => string;
  /** Signed seconds, e.g. `−0,400`. */
  delta: (ms: number) => string;
  trackName?: string;
  /** Translates a pt-BR template (default: identity). */
  translate?: (message: string, ...values: unknown[]) => string;
}

const fill = (template: string, values: readonly unknown[]) =>
  template.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? ''));

/** The sentence of a suggestion with its values inserted. */
export function suggestionText(
  tip: SummarySuggestion,
  translate: SummaryTextFormat['translate'] = undefined,
): string {
  return translate ? translate(tip.text, ...tip.values) : fill(tip.text, tip.values);
}

export function summaryToText(s: SessionSummary, format: SummaryTextFormat): string {
  const t = format.translate ?? ((message: string, ...values: unknown[]) => fill(message, values));
  const lines: string[] = [];
  lines.push(format.trackName ? `${t('Sessão')} · ${format.trackName}` : t('Sessão'));
  lines.push(
    t('Voltas: {0} ({1} válidas, {2} inválidas)', s.laps.total, s.laps.valid, s.laps.invalid),
  );
  if (s.best) {
    lines.push(
      s.best.deltaMs === null
        ? t('Melhor volta: {0} (primeira vez nesta pista)', format.lapTime(s.best.timeMs))
        : t(
            'Melhor volta: {0} ({1} vs. recorde anterior)',
            format.lapTime(s.best.timeMs),
            format.delta(s.best.deltaMs),
          ),
    );
  }
  if (s.pace) {
    lines.push(
      t(
        'Ritmo: média das 5 melhores {0}, mediana {1}',
        format.lapTime(s.pace.top5AvgMs),
        format.lapTime(s.pace.medianMs),
      ),
    );
  }
  if (s.consistency) {
    lines.push(
      t(
        'Regularidade: desvio de {0} s',
        (s.consistency.stdDevMs / 1000).toFixed(3).replace('.', ','),
      ),
    );
  }
  for (const tip of s.suggestions) lines.push(`• ${suggestionText(tip, format.translate)}`);
  return lines.join('\n');
}
