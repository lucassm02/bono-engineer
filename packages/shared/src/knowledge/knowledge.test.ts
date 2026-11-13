import { describe, expect, it } from 'vitest';
import { listCars } from '../cars/catalog.ts';
import {
  ALL_DIAGNOSTIC_CODES,
  CAR_CLASSES,
  CORNER_FINDING_CODES,
  CORNER_TYPE_ADVICE,
  DIAGNOSTICS,
  GENERAL_TOPICS,
  GLOSSARY,
  KNOWLEDGE_MAX_CHARS,
  KNOWLEDGE_SOURCES,
  knowledgeBrief,
  knowledgeFor,
  knowledgeFullMarkdown,
  knowledgeIndex,
  knowledgeStats,
  knowledgeTopic,
  LAP_ISSUE_CODES,
  parseCarGroup,
  resolveTopicId,
  SETUP_MAP,
  searchKnowledge,
} from './index.ts';

const DRIVING_GROUPS = ['1', '2', '3', '4', 'B', 'N'] as const;
const huracan = listCars().find((c) => c.name === 'Huracan Gr.4')!;

describe('knowledgeFor', () => {
  it('stays within the default size cap in the worst case', () => {
    for (const group of [...DRIVING_GROUPS, 'X', undefined]) {
      const md = knowledgeFor({
        carGroup: group,
        diagnosticCodes: ALL_DIAGNOSTIC_CODES,
        trackId: 'trial-mountain',
        cornerKind: 'hairpin',
      });
      expect(md.length).toBeLessThanOrEqual(KNOWLEDGE_MAX_CHARS);
      expect(md).toContain('NUNCA invente pontos de frenagem absolutos');
    }
  });

  it('respects a smaller cap (never below the safety lines) and shortens instead of overflowing', () => {
    const md = knowledgeFor({
      carGroup: '3',
      diagnosticCodes: ['brakeEarlier', 'noTrailBraking', 'lowerMinSpeed'],
      maxChars: 1500,
    });
    expect(md.length).toBeLessThanOrEqual(1500);
    expect(md).toContain('NUNCA invente');
    expect(md).toContain('brakeEarlier');
    const tiny = knowledgeFor({
      carGroup: '3',
      diagnosticCodes: ALL_DIAGNOSTIC_CODES,
      maxChars: 10,
    });
    expect(tiny.length).toBeLessThanOrEqual(1200);
  });

  it('adapts to the class of the car (by group or by carCode)', () => {
    const codes = ['brakeEarlier', 'noTrailBraking'];
    const gr4 = knowledgeFor({ carCode: huracan.id, diagnosticCodes: codes });
    expect(gr4).toContain('Huracan Gr.4');
    expect(gr4).toContain('Classe Gr.4');
    expect(gr4).toContain('Gr.4: o carro tem menos freio efetivo');
    expect(gr4).not.toContain('Classe Gr.1');
    const gr1 = knowledgeFor({ carGroup: 'Gr.1', diagnosticCodes: codes });
    expect(gr1).toContain('Classe Gr.1');
    expect(gr1).toContain('Gr.1: o downforce permite frear bem tarde');
    expect(gr1).not.toContain('Gr.4: o carro tem menos freio efetivo');
    expect(gr1).not.toBe(gr4);
  });

  it('falls back to the general principles when the group is unknown', () => {
    const md = knowledgeBrief({ carCode: 999999, diagnosticCodes: ['brakeEarlier'] });
    expect(md.group).toBeNull();
    expect(md.markdown).toContain('Classe do carro desconhecida');
    expect(md.markdown).toContain('Princípios que valem sempre');
    expect(md.markdown).toContain('variações por classe foram omitidas');
    expect(md.markdown).not.toContain('### Classe');
    const none = knowledgeFor();
    expect(none).toContain('Princípios que valem sempre');
  });

  it('reports unknown codes and caps the number of diagnostics', () => {
    const b = knowledgeBrief({
      carGroup: '3',
      diagnosticCodes: ['nope', ...ALL_DIAGNOSTIC_CODES, 'brakeEarlier'],
    });
    expect(b.unknownCodes).toEqual(['nope']);
    expect(b.diagnostics.length).toBeLessThanOrEqual(6);
    expect(b.diagnostics[0]).toBe(ALL_DIAGNOSTIC_CODES[0]);
    expect(b.markdown).toContain('Códigos sem texto na base: nope');
  });

  it('parses car groups loosely', () => {
    expect(parseCarGroup('Gr.3')).toBe('3');
    expect(parseCarGroup('gr b')).toBe('B');
    expect(parseCarGroup('n')).toBe('N');
    expect(parseCarGroup('9')).toBeNull();
    expect(parseCarGroup(null)).toBeNull();
  });
});

describe('diagnostics coverage', () => {
  it('has one entry for every corner finding and lap issue code', () => {
    expect([...ALL_DIAGNOSTIC_CODES].sort()).toEqual(
      [...CORNER_FINDING_CODES, ...LAP_ISSUE_CODES].sort(),
    );
    for (const code of ALL_DIAGNOSTIC_CODES) expect(DIAGNOSTICS[code].code).toBe(code);
  });

  it('every entry has its texts, and driving diagnostics vary by class', () => {
    for (const code of ALL_DIAGNOSTIC_CODES) {
      const d = DIAGNOSTICS[code];
      expect(d.title.length).toBeGreaterThan(5);
      expect(d.meaning.length).toBeGreaterThan(20);
      expect(d.causes.length).toBeGreaterThan(0);
      expect(d.fix.length).toBeGreaterThan(15);
      expect(d.drill.length).toBeGreaterThan(10);
      expect(d.src.length).toBeGreaterThan(0);
      if (d.area !== 'data') {
        for (const g of DRIVING_GROUPS) {
          expect(d.byGroup[g], `${code} sem variação para Gr.${g}`).toBeTruthy();
        }
      }
    }
  });
});

describe('sources', () => {
  it('have unique ids and well formed https links', () => {
    const ids = new Set<string>();
    for (const s of KNOWLEDGE_SOURCES) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.consultedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (s.url === null) {
        expect(s.access).toBe('sem-fonte-externa');
      } else {
        expect(s.url).toMatch(/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i);
        expect(s.url).not.toMatch(/\s/);
      }
    }
  });

  it('every source id used by the base exists', () => {
    const used = new Set<string>();
    const add = (xs: readonly string[] | undefined) => {
      for (const x of xs ?? []) used.add(x);
    };
    for (const t of GENERAL_TOPICS) for (const p of t.points) add(p.src);
    for (const k of Object.values(CORNER_TYPE_ADVICE)) for (const p of k.tips) add(p.src);
    for (const c of CAR_CLASSES) {
      add(c.src);
      for (const p of [...c.assists, ...c.style, ...c.mistakes, ...c.whatChanges]) add(p.src);
    }
    for (const d of Object.values(DIAGNOSTICS)) add(d.src);
    for (const e of SETUP_MAP) for (const p of e.adjustments) add(p.src);
    const known = new Set(KNOWLEDGE_SOURCES.map((s) => s.id));
    for (const id of used) expect(known.has(id), `fonte desconhecida: ${id}`).toBe(true);
    // Statements marked "sources" always cite at least one source.
    for (const t of GENERAL_TOPICS)
      for (const p of t.points) if (p.basis === 'sources') expect(p.src?.length).toBeGreaterThan(0);
  });

  it('marks the weakly supported classes honestly', () => {
    for (const g of ['2', 'N', 'X', 'B'] as const)
      expect(CAR_CLASSES.find((c) => c.group === g)?.evidence).toBe('baixa');
    expect(CAR_CLASSES.map((c) => c.group).sort()).toEqual(['1', '2', '3', '4', 'B', 'N', 'X']);
  });
});

describe('class examples', () => {
  it('are real cars of the catalogue and belong to the class', () => {
    const cars = listCars();
    for (const c of CAR_CLASSES) {
      for (const name of c.examples) {
        const hit = cars.find((x) => x.name === name || x.baseName === name);
        expect(hit, `${c.label}: exemplo fora do catálogo: ${name}`).toBeDefined();
        if (hit?.group) expect(hit.group, `${name} não é ${c.label}`).toBe(c.group);
      }
    }
  });
});

describe('index, topics and search', () => {
  it('lists unique topics and every one renders', () => {
    const idx = knowledgeIndex();
    expect(new Set(idx.map((t) => t.id)).size).toBe(idx.length);
    for (const t of idx) {
      const md = knowledgeTopic(t.id);
      expect(md, t.id).toBeTruthy();
      expect(md!.length).toBeGreaterThan(80);
    }
    expect(idx.filter((t) => t.kind === 'class')).toHaveLength(7);
    expect(idx.filter((t) => t.kind === 'diagnostics')).toHaveLength(ALL_DIAGNOSTIC_CODES.length);
  });

  it('resolves loose topic names and trims per-class variations', () => {
    expect(resolveTopicId('Gr.4')).toBe('class/gr4');
    expect(resolveTopicId('classe/gr4')).toBe('class/gr4');
    expect(resolveTopicId('geral/como-treinar')).toBe('general/how-to-practise');
    expect(resolveTopicId('brakeEarlier')).toBe('diagnostics/brakeEarlier');
    expect(resolveTopicId('trail-braking')).toBe('general/trail-braking');
    expect(resolveTopicId('inexistente')).toBeNull();
    expect(knowledgeTopic('inexistente')).toBeNull();
    const all = knowledgeTopic('diagnostics/brakeEarlier')!;
    const g4 = knowledgeTopic('diagnostics/brakeEarlier', { group: '4' })!;
    expect(all).toContain('Gr.1:');
    expect(g4).toContain('Gr.4:');
    expect(g4).not.toContain('Gr.1:');
  });

  it('searches without accents and by every word', () => {
    expect(searchKnowledge('subesterco').length).toBeGreaterThan(0);
    expect(searchKnowledge('SUBESTERÇO')).toEqual(searchKnowledge('subesterco'));
    expect(searchKnowledge('trail braking')[0]?.id).toContain('trail');
    expect(searchKnowledge('xyzzyplugh')).toEqual([]);
    expect(searchKnowledge('')).toHaveLength(knowledgeIndex().length);
  });

  it('keeps glossary ids unique and reports the size of the base', () => {
    expect(new Set(GLOSSARY.map((g) => g.id)).size).toBe(GLOSSARY.length);
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(20);
    const stats = knowledgeStats();
    expect(stats.topics).toBe(knowledgeIndex().length);
    expect(stats.chars).toBe(knowledgeFullMarkdown().length);
    expect(stats.chars).toBeGreaterThan(30_000);
  });
});

describe('honesty guards', () => {
  it('never embeds an absolute braking point (distances before a named corner)', () => {
    const all = knowledgeFullMarkdown();
    // A base without per-track data must not say "freie a 120 m do T3"/"placa de 150 m da curva 5".
    expect(all).not.toMatch(/\bT\d+\b[^.\n]{0,40}\b\d{2,3}\s*m\b/);
    expect(all).not.toMatch(/\b\d{2,3}\s*m\s+(antes|da)\s+(da\s+)?(curva|T\d)/i);
  });
});
