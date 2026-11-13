import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { humanizeError, noReferenceHint } from './copy.ts';
import { DELTA_REFERENCE_LABELS } from './labels.ts';
import { diagnosticRows, isNewcomer, NEWCOMER_DAYS, parseUsage, resetUsage } from './usage.ts';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== 'copy.ts')
      out.push(path);
  }
  return out;
}

/** Texts shown to the driver that the glossary (spec 01) retired. Product names stay as they are. */
const RETIRED =
  /\bpain[eé]l\b|\bpain[eé]is\b|top capturado|melhor capturada|captura de refer[eê]ncia|dispositivo remoto/i;
const ALLOWED = /GT7 Dashboard/;

describe('glossary (spec 01, C1)', () => {
  it('no retired term in the text of any screen', () => {
    const found: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        // only literals that read like text (with a space): identifiers such as `group: 'painel'` stay
        for (const m of line.matchAll(
          /(['"`])((?:\\.|(?!\1)[^\\\n])*\s(?:\\.|(?!\1)[^\\\n])*)\1/g,
        )) {
          const text = (m[2] ?? '').replace(ALLOWED, '');
          if (RETIRED.test(text))
            found.push(`${file.replace(SRC, '')}:${i + 1}: ${text.slice(0, 80)}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it('the reference delta is called "Volta de referência"', () => {
    expect(DELTA_REFERENCE_LABELS.reference).toBe('Volta de referência');
  });
});

describe('noReferenceHint', () => {
  it('always says what to do', () => {
    expect(noReferenceHint('reference')).toMatch(/volta de replay/);
    expect(noReferenceHint('personalBest')).toMatch(/mais uma volta/);
    expect(noReferenceHint('sessionBest')).toMatch(/mais uma volta/);
  });
});

describe('humanizeError (spec 01, C4)', () => {
  it('drops the Electron prefix and keeps the original as technical detail', () => {
    const h = humanizeError(
      "Error invoking remote method 'discord:validate': Error: Token inválido.",
    );
    expect(h.text).toBe('Token inválido.');
    expect(h.detail).toContain('Error invoking remote method');
  });

  it('explains network failures in plain words', () => {
    const h = humanizeError(new TypeError('Failed to fetch'));
    expect(h.text).toMatch(/falar com o Bono/);
    expect(h.detail).toBe('Failed to fetch');
  });

  it('turns parse errors and system codes into sentences', () => {
    expect(humanizeError('Unexpected token < in JSON at position 0').text).toMatch(
      /não deu para ler/,
    );
    expect(humanizeError('listen EADDRINUSE: address already in use').text).toMatch(/Windows/);
  });

  it('keeps a clean message as it is, with no detail', () => {
    const h = humanizeError('Não encontrado.');
    expect(h).toEqual({ text: 'Não encontrado.', detail: null });
  });

  it('never returns an empty text', () => {
    expect(humanizeError('').text).not.toBe('');
    expect(humanizeError(undefined).text).not.toBe('');
  });
});

describe('usage counters (spec 01, RF4)', () => {
  it('parses what was saved and ignores garbage', () => {
    const now = 1_000_000;
    expect(parseUsage(null, now)).toEqual({ since: now, counters: {} });
    expect(
      parseUsage({ since: 5, counters: { menuOpens: 3, tourStarts: 'x', other: 9 } }, now),
    ).toEqual({ since: 5, counters: { menuOpens: 3 } });
  });

  it('shows the diagnostic rows without touching the network', () => {
    const rows = diagnosticRows(Date.now());
    expect(rows.map((r) => r.id)).toEqual([
      'since',
      'menu',
      'setup',
      'tour-live',
      'tour-analysis',
      'tour-runs',
    ]);
    expect(rows.find((r) => r.id === 'menu')?.value).toBe('0');
  });

  it('uses the singular for one day of usage', () => {
    const now = Date.now();
    resetUsage(now - 24 * 60 * 60 * 1000);
    expect(diagnosticRows(now)[0]?.value).toBe('há 1 dia');
    resetUsage(now);
  });

  it('is a newcomer only during the first week', () => {
    const day = 24 * 60 * 60 * 1000;
    expect(isNewcomer(Date.now())).toBe(true);
    // the first read recorded "since": a week and a day later the labels are gone
    expect(isNewcomer(Date.now() + (NEWCOMER_DAYS + 1) * day)).toBe(false);
  });
});
