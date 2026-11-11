import { isLanguage, type Language } from '@gt7/shared';
import { useSyncExternalStore } from 'react';
import { translateMessage } from './messages.ts';
import { loadString, saveString } from './storage.ts';

const KEY = 'bono.language';
const saved = loadString(KEY);
let language: Language = isLanguage(saved) ? saved : 'pt-BR';
const listeners = new Set<() => void>();

declare global {
  interface Window {
    bonoDesktop?: {
      getLanguage(): Promise<Language | undefined>;
      setLanguage(language: Language): Promise<void>;
    };
  }
}

export const LANGUAGE_NAMES: Record<Language, string> = {
  'pt-BR': 'Português (Brasil)',
  en: 'English',
  es: 'Español',
};

export function getLanguage(): Language {
  return language;
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLanguage(next: Language): void {
  if (language === next) return;
  language = next;
  saveString(KEY, language);
  applyDocumentLanguage();
  void globalThis.window?.bonoDesktop?.setLanguage(language).catch(() => {});
  for (const listener of listeners) listener();
}

export function applyDocumentLanguage(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage);
}

/** The original Portuguese message doubles as a fallback. Values are inserted after lookup. */
export function t(message: string, ...values: unknown[]): string {
  return translateMessage(language, message, ...values);
}
