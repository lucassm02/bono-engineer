import type { Language } from '@gt7/shared';
import translations from './translations.json' with { type: 'json' };

const messages: Record<string, readonly string[]> = translations;

export function translateMessage(
  language: Language,
  message: string,
  ...values: unknown[]
): string {
  const localized =
    language !== 'pt-BR' && Object.hasOwn(messages, message)
      ? (messages[message]?.[language === 'en' ? 0 : 1] ?? message)
      : message;
  return values.length ? localized.replace(/\{(\d+)\}/g, (_, i) => String(values[i])) : localized;
}
