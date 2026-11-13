/** Small JSON file with what the window remembers (size/position, one-time hints). */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isLanguage, type Language } from '@gt7/shared';
import { parseWindowState, type WindowState } from './window-state.ts';

export interface DesktopState {
  window: WindowState | null;
  trayHintShown: boolean;
  language?: Language;
  updates?: { lastVersion?: string; dismissedVersion?: string; seenVersion?: string };
  /** Data folder chosen by the user; missing = the per-user default. Kept here, not in the data. */
  dataDir?: string;
}

export function parseDesktopState(raw: unknown): DesktopState {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const updates = r.updates as Record<string, unknown> | null | undefined;
  const versions = Object.fromEntries(
    ['lastVersion', 'dismissedVersion', 'seenVersion']
      .filter((key) => typeof updates?.[key] === 'string')
      .map((key) => [key, updates?.[key]]),
  );
  return {
    ...(Object.keys(versions).length ? { updates: versions } : {}),
    window: parseWindowState(r.window),
    trayHintShown: r.trayHintShown === true,
    ...(isLanguage(r.language) ? { language: r.language } : {}),
    ...(typeof r.dataDir === 'string' && r.dataDir.trim() ? { dataDir: r.dataDir } : {}),
  };
}

export function readDesktopState(file: string): DesktopState {
  try {
    return parseDesktopState(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return parseDesktopState(null);
  }
}

/** Atomic-ish write (temp file + rename). Never throws: losing the window position is harmless. */
export function writeDesktopState(file: string, state: DesktopState): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, file);
  } catch {
    // ignore
  }
}
