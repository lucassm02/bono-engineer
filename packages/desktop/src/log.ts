/** Console + file log (a packaged GUI app has no console). The file is capped at ~1 MB. */

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_BYTES = 1024 * 1024;
let file: string | null = null;

export function initLog(path: string): void {
  file = path;
  try {
    mkdirSync(dirname(path), { recursive: true });
    if (statSync(path).size > MAX_BYTES) renameSync(path, `${path}.old`);
  } catch {
    // no file yet / not writable: console only
  }
}

export function logFilePath(): string | null {
  return file;
}

export function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  if (!file) return;
  try {
    appendFileSync(file, `${line}\n`);
  } catch {
    // ignore
  }
}
