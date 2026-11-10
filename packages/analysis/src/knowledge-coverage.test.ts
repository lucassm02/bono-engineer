/**
 * Guards the coach knowledge base (packages/shared/src/knowledge): every diagnostic code that the
 * analysis can produce must have its pt-BR text there. The codes are collected from the analysis
 * SOURCE (`kind: '…'` in findings.ts and validity.ts) and from the shared type unions, so a new
 * diagnostic added to either fails this test until `DIAGNOSTICS` gets its entry.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_DIAGNOSTIC_CODES, knowledgeFor, knowledgeTopic } from '@gt7/shared';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, p), 'utf8').replace(/\r\n/g, '\n');

/** `kind: 'xyz'` occurrences (object literals that build findings / issues). */
function producedKinds(src: string): string[] {
  return [...src.matchAll(/\bkind:\s*'([A-Za-z]+)'/g)].map((m) => m[1]!);
}

/** String members of `kind: | 'a' | 'b'` (CornerFinding) and `type LapIssueKind = …` unions. */
function unionMembers(src: string, startMarker: string): string[] {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`marker not found: ${startMarker}`);
  const rest = src.slice(start + startMarker.length);
  const end = rest.search(/;\s*\n/);
  return [...rest.slice(0, end).matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]!);
}

describe('coach knowledge covers every diagnostic of the analysis', () => {
  const known = new Set<string>(ALL_DIAGNOSTIC_CODES);

  it('findings.ts codes have knowledge entries', () => {
    const kinds = new Set(producedKinds(read('findings.ts')));
    expect(kinds.size).toBeGreaterThanOrEqual(12);
    for (const k of kinds) expect(known.has(k), `findings.ts: ${k} sem texto na base`).toBe(true);
  });

  it('validity.ts issue codes have knowledge entries', () => {
    const kinds = new Set(producedKinds(read('validity.ts')));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
    for (const k of kinds) expect(known.has(k), `validity.ts: ${k} sem texto na base`).toBe(true);
  });

  it('the shared type unions are fully covered (and nothing extra is invented)', () => {
    const shared = read('../../shared/src/analysis.ts');
    const corner = unionMembers(shared, 'export interface CornerFinding {\n  kind:');
    const lap = unionMembers(shared, 'export type LapIssueKind =');
    expect(corner.length).toBeGreaterThanOrEqual(17);
    expect(lap.length).toBeGreaterThanOrEqual(6);
    expect([...corner, ...lap].sort()).toEqual([...known].sort());
  });

  it('each code renders as a topic and in a brief', () => {
    for (const code of known) {
      expect(knowledgeTopic(`diagnostico/${code}`), code).toContain(code);
      expect(knowledgeFor({ carGroup: '3', diagnosticCodes: [code] }), code).toContain(code);
    }
  });
});
