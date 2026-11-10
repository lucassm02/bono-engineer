/**
 * Espelho em TypeScript dos tokens de `styles/tokens.css`, para o que não enxerga `var(--x)`:
 * canvas (mapa, círculo de G, gráficos uPlot) e cores de séries. Um teste (`theme.test.ts`)
 * compara este arquivo com o CSS e falha se os dois divergirem. Para mudar uma cor, mude nos dois.
 */

export const THEME = {
  surface0: '#05080c',
  surface1: '#080d13',
  surface2: '#0d141c',
  surface3: '#131c26',
  surface4: '#1a2632',
  lineSoft: '#16212c',
  line: '#223140',
  lineStrong: '#324658',
  text: '#eef3f7',
  text2: '#a9b7c4',
  text3: '#7b8b9a',
  accent: '#66e4f6',
  gain: '#2fe08a',
  loss: '#ff5160',
  warn: '#ffc83d',
  purple: '#b88bff',
  info: '#5b9dff',
  /** Séries de gráfico (dado, não interface): volta analisada, referência, extras. */
  chart1: '#66e4f6',
  chart2: '#b88bff',
  chart3: '#ff9f4a',
  chart4: '#5b9dff',
  chart5: '#ff7ac6',
  font: 'Bahnschrift, "DIN Alternate", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif',
} as const;

export type ThemeKey = keyof typeof THEME;

/** `#rrggbb` + alfa 0..1 → `rgba(...)`. Para preenchimentos translúcidos em canvas. */
export function withAlpha(hex: string, alpha: number): string {
  const n = hex.replace('#', '');
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Cor de cada série da comparação, na ordem: volta analisada, referência, extras. */
export const SERIES_COLORS = [THEME.chart1, THEME.chart2, THEME.chart3, THEME.chart4, THEME.chart5];
