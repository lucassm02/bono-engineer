import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME, type ThemeKey, withAlpha } from './theme.ts';

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

function tokenValue(name: string): string | null {
  const m = new RegExp(String.raw`--${name}:\s*(#[0-9a-fA-F]{6})`).exec(css);
  return m ? m[1]!.toLowerCase() : null;
}

const MAP: Partial<Record<ThemeKey, string>> = {
  surface0: 'surface-0',
  surface1: 'surface-1',
  surface2: 'surface-2',
  surface3: 'surface-3',
  surface4: 'surface-4',
  lineSoft: 'line-soft',
  line: 'line',
  lineStrong: 'line-strong',
  text: 'text',
  text2: 'text-2',
  text3: 'text-3',
  accent: 'accent',
  gain: 'gain',
  loss: 'loss',
  warn: 'warn',
  purple: 'purple',
  info: 'info',
  chart1: 'chart-1',
  chart2: 'chart-2',
  chart3: 'chart-3',
  chart4: 'chart-4',
  chart5: 'chart-5',
};

describe('theme.ts espelha tokens.css', () => {
  for (const [key, token] of Object.entries(MAP)) {
    it(`${key} = --${token}`, () => {
      expect(THEME[key as ThemeKey]).toBe(tokenValue(token as string));
    });
  }
  it('withAlpha converte hex', () => {
    expect(withAlpha('#66e4f6', 0.5)).toBe('rgba(102, 228, 246, 0.500)');
  });
});
