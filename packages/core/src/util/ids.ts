/** Opaque, time-sortable ids: 9 base-36 chars of epoch ms + 10 random base-36 chars. */

import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId(now = Date.now()): string {
  const ts = Math.max(0, Math.floor(now)).toString(36).padStart(9, '0');
  const rnd = randomBytes(10);
  let r = '';
  for (const b of rnd) r += ALPHABET[b % 36];
  return ts + r;
}

/** Deterministic id factory for tests: prefix + zero-padded counter. */
export function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}${String(++n).padStart(6, '0')}`;
}
