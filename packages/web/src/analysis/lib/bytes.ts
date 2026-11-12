/** "12,4 MB", "830 KB": tamanho de arquivo legível, na língua do app. */

import { getLanguage } from '../../lib/i18n.ts';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number, language: string = getLanguage()): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)} ${UNITS[unit]}`;
}
