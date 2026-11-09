/** Small JSON file with what the window remembers (size/position, one-time hints). */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseWindowState, type WindowState } from './window-state.ts';

export interface DesktopState {
  window: WindowState | null;
  trayHintShown: boolean;
}

export function parseDesktopState(raw: unknown): DesktopState {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return { window: parseWindowState(r.window), trayHintShown: r.trayHintShown === true };
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
