/**
 * Driving knowledge base (pt-BR): data modules + the pure functions that turn them into compact
 * Markdown for the coach (`knowledgeFor`), a topic index (`knowledgeIndex`), full topic pages
 * (`knowledgeTopic`) and a search for the "Guia de pilotagem" page (`searchKnowledge`).
 *
 * No network, no Node/DOM APIs: runs in the server, the MCP server and the browser.
 */

import { type CarGroup, getCar, groupLabel, normalizeSearch } from '../cars/catalog.ts';
import { CAR_CLASSES, classFor } from './classes.ts';
import { ALL_DIAGNOSTIC_CODES, diagnosticFor } from './diagnostics.ts';
import { COACH_RULES, CORNER_TYPE_ADVICE, GENERAL_TOPICS } from './general.ts';
import { GLOSSARY } from './glossary.ts';
import { SETUP_HEADER, SETUP_MAP, SETUP_RULES } from './setup.ts';
import { getSource, KNOWLEDGE_SOURCES, sourceLabel } from './sources.ts';
import {
  BASIS_LABELS,
  type CarClassKnowledge,
  type DiagnosticKnowledge,
  type KnowledgeCornerKind,
  type Tip,
  type TopicRef,
} from './types.ts';

export * from './classes.ts';
export * from './diagnostics.ts';
export * from './general.ts';
export * from './glossary.ts';
export * from './setup.ts';
export * from './sources.ts';
export * from './types.ts';

/** Default size cap of `knowledgeFor` (characters; ≈ 1.500 tokens of pt-BR text). */
export const KNOWLEDGE_MAX_CHARS = 6000;
/** Most diagnostics described in one brief. */
export const KNOWLEDGE_MAX_DIAGNOSTICS = 6;
/** Lowest cap `knowledgeFor` accepts (below this the safety lines alone would not fit). */
export const KNOWLEDGE_MIN_CHARS = 1200;

export interface KnowledgeQuery {
  /** `1 | 2 | 3 | 4 | B | N | X` (also "Gr.3", "gr3"). Wins over `carCode`. */
  carGroup?: string | null | undefined;
  /** Game car id (telemetry `carCode`): mapped to its group through the car catalogue. */
  carCode?: number | null | undefined;
  /** Diagnostic codes present in the analysis (`CornerFinding.kind`), most costly first. */
  diagnosticCodes?: readonly string[] | undefined;
  trackId?: string | null | undefined;
  /** Corner type detected by the app (`hairpin`, `slow`, `medium`, `fast`, `kink`, `chicane`). */
  cornerKind?: string | null | undefined;
  /** Size cap in characters (default `KNOWLEDGE_MAX_CHARS`). */
  maxChars?: number | undefined;
}

export interface KnowledgeBrief {
  markdown: string;
  group: CarGroup | null;
  carName: string | null;
  /** Diagnostics described (known codes only, capped). */
  diagnostics: string[];
  /** Codes with no entry in the base. */
  unknownCodes: string[];
  /** True when the text had to be shortened to fit `maxChars`. */
  truncated: boolean;
}

const GROUPS: readonly CarGroup[] = ['1', '2', '3', '4', 'B', 'N', 'X'];

/** "Gr.3", "gr3", "3", "b" → CarGroup; anything else → null. */
export function parseCarGroup(v: string | number | null | undefined): CarGroup | null {
  if (v === null || v === undefined) return null;
  const s = String(v)
    .trim()
    .toUpperCase()
    .replace(/^GR\.?\s*/, '');
  return (GROUPS as readonly string[]).includes(s) ? (s as CarGroup) : null;
}

// ---------------------------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------------------------

function publishers(ids: readonly string[] | undefined): string {
  if (!ids?.length) return '';
  const names = new Set<string>();
  for (const id of ids) {
    const s = getSource(id);
    if (s && s.url !== null)
      names.add((s.publisher.split(' (')[0] ?? s.publisher).split(' / ')[0]!);
  }
  return [...names].join(', ');
}

/** "texto (regra geral)" / "texto (segundo DG-EDGE)". */
function tipText(t: Tip): string {
  const pub = t.basis === 'fonte' ? publishers(t.src) : '';
  const tag = pub ? `segundo ${pub}` : BASIS_LABELS[t.basis];
  return `${t.text} _(${tag})_`;
}

const bullets = (tips: readonly Tip[], max = tips.length): string =>
  tips
    .slice(0, max)
    .map((t) => `- ${tipText(t)}`)
    .join('\n');

function groupText(d: DiagnosticKnowledge, group: CarGroup | null): string | null {
  if (!group) return null;
  return d.byGroup[group] ?? null;
}

function sourceLine(ids: readonly string[]): string {
  const out: string[] = [];
  for (const id of ids) {
    const s = getSource(id);
    if (!s) continue;
    out.push(s.url ? `[${sourceLabel(id)}](${s.url})` : s.title);
  }
  return out.join('; ');
}

// ---------------------------------------------------------------------------------------------
// Brief (knowledgeFor)
// ---------------------------------------------------------------------------------------------

/** Three principles that always travel with the brief. */
const ESSENTIAL_LINES = [
  'Frenagem: pico firme no início e alívio progressivo; frear em reta; ponto de frenagem só vale se a V-mín e a saída não pioram (regra geral).',
  'Trail braking: resto de freio que alivia até o ápice, pouco e em curvas lentas/médias; custa o pneu dianteiro (segundo DG-EDGE).',
  'Saída: a retomada do acelerador e a velocidade de saída valem tempo em toda a reta seguinte; dose o acelerador conforme o volante abre (regra geral).',
  'Consistência: se o ponto de frenagem/V-mín varia entre voltas, corrija a repetição antes de caçar décimos novos (regra geral).',
];

function classBlock(c: CarClassKnowledge, level: number): string {
  const lines = [
    `### Classe ${c.label} — ${c.name} (evidência ${c.evidence === 'media' ? 'média' : 'baixa'})`,
    c.summary,
  ];
  if (level <= 0) {
    lines.push(`Estilo:\n${bullets(c.style, 3)}`);
    lines.push(`Erros comuns:\n${bullets(c.mistakes, 2)}`);
    lines.push(`Assistências:\n${bullets(c.assists, 1)}`);
  } else if (level === 1) {
    lines.push(`Estilo:\n${bullets(c.style, 2)}`);
    lines.push(`Erros comuns:\n${bullets(c.mistakes, 1)}`);
  } else if (level === 2) {
    lines.push(`Estilo:\n${bullets(c.style, 1)}`);
  }
  return lines.join('\n');
}

function diagBlock(d: DiagnosticKnowledge, group: CarGroup | null, level: number): string {
  const head = `- **${d.code}** — ${d.title}`;
  const g = groupText(d, group);
  if (level >= 2) return `${head}: ${d.fix}${g ? ` ${g}` : ''}`;
  if (level === 1) return `${head}. **Ação:** ${d.fix}${g ? `\n  ${g}` : ''}`;
  const parts = [`${head}. ${d.meaning}`];
  parts.push(`  Causas prováveis: ${d.causes.slice(0, 2).join('; ')}.`);
  parts.push(`  **Ação:** ${d.fix}`);
  if (g) parts.push(`  ${g}`);
  parts.push(`  Treino: ${d.drill}`);
  if (d.caveat) parts.push(`  Cuidado: ${d.caveat}`);
  parts.push(`  _(${BASIS_LABELS[d.basis]})_`);
  return parts.join('\n');
}

/** Same as `knowledgeFor` but with the metadata (group, codes used, truncation). */
export function knowledgeBrief(q: KnowledgeQuery = {}): KnowledgeBrief {
  const max = Math.max(KNOWLEDGE_MIN_CHARS, Math.floor(q.maxChars ?? KNOWLEDGE_MAX_CHARS));
  const car = q.carCode !== null && q.carCode !== undefined ? getCar(q.carCode) : undefined;
  const group = parseCarGroup(q.carGroup) ?? car?.group ?? null;
  const carName = car?.name ?? null;
  const cls = classFor(group);

  const known: DiagnosticKnowledge[] = [];
  const unknownCodes: string[] = [];
  const seen = new Set<string>();
  for (const code of q.diagnosticCodes ?? []) {
    if (seen.has(code)) continue;
    seen.add(code);
    const d = diagnosticFor(code);
    if (!d) unknownCodes.push(code);
    else if (known.length < KNOWLEDGE_MAX_DIAGNOSTICS) known.push(d);
  }
  const kind =
    q.cornerKind && Object.hasOwn(CORNER_TYPE_ADVICE, q.cornerKind)
      ? CORNER_TYPE_ADVICE[q.cornerKind as KnowledgeCornerKind]
      : null;

  const carLine = car
    ? `Carro: ${car.name}${group ? ` (${groupLabel(group)})` : ' (grupo não informado pelo catálogo)'}.`
    : group
      ? `Classe do carro: ${groupLabel(group)}.`
      : 'Classe do carro desconhecida: use só os princípios gerais e não suponha a tração.';
  const safety = [
    '**Regras de uso:** cite os números da telemetria; adapte à classe; diga quando algo é "regra geral"; NUNCA invente pontos de frenagem absolutos (o app só conhece os medidos nas voltas do piloto); UMA ação principal por curva.',
    q.trackId
      ? `Pista ${q.trackId}: a base não traz pontos de frenagem nem velocidades por pista; use só os dados medidos.`
      : null,
    unknownCodes.length ? `Códigos sem texto na base: ${unknownCodes.join(', ')}.` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const sourcesFull = `Fontes: ${sourceLine([
    ...new Set([
      ...(cls?.src ?? []),
      ...known.flatMap((d) => [...d.src]),
      'dgedge-5-reasons',
      'dgedge-physics-149',
    ]),
  ])
    .split('; ')
    .slice(0, 6)
    .join('; ')}.`;
  const sourcesShort = 'Fontes: get_knowledge(topic="fonte") lista os links.';

  const build = (level: number): string => {
    const parts: string[] = ['## Base de pilotagem (resumo para este contexto)', carLine];
    if (cls) parts.push(classBlock(cls, level));
    if (known.length) {
      parts.push(
        `### Diagnósticos presentes\n${known.map((d) => diagBlock(d, group, level)).join('\n')}`,
      );
      if (!group) parts.push('(Sem classe conhecida: as variações por classe foram omitidas.)');
    }
    if (kind && level <= 1) parts.push(`### ${kind.title}\n${bullets(kind.tips, 2)}`);
    if (level <= 1) {
      const n = level === 0 ? ESSENTIAL_LINES.length : 2;
      parts.push(
        `### Princípios que valem sempre\n${ESSENTIAL_LINES.slice(0, n)
          .map((l) => `- ${l}`)
          .join('\n')}`,
      );
    }
    parts.push(safety);
    parts.push(level === 0 ? sourcesFull : level === 1 ? sourcesShort : '');
    return parts.filter(Boolean).join('\n\n');
  };

  for (let level = 0; level <= 3; level++) {
    const md = build(level);
    if (md.length <= max) {
      return {
        markdown: md,
        group,
        carName,
        diagnostics: known.map((d) => d.code),
        unknownCodes,
        truncated: level > 0,
      };
    }
  }
  // Last resort: hard cut on a line boundary, keeping the safety lines at the end.
  const tail = `\n\n${safety}`;
  let body = build(3).slice(0, Math.max(0, max - tail.length - 20));
  body = body.slice(0, Math.max(body.lastIndexOf('\n'), 0));
  const md = `${body}\n…(cortado)${tail}`.slice(0, max);
  return {
    markdown: md,
    group,
    carName,
    diagnostics: known.map((d) => d.code),
    unknownCodes,
    truncated: true,
  };
}

/**
 * Compact Markdown (≤ `maxChars`, default 6.000 characters ≈ 1.500 tokens) with only what is
 * relevant: the car's class card, the diagnostics present (with the class variation), a few
 * universal principles and the usage rules. Unknown class → general principles only.
 */
export function knowledgeFor(q: KnowledgeQuery = {}): string {
  return knowledgeBrief(q).markdown;
}

// ---------------------------------------------------------------------------------------------
// Topics (index, full pages, search)
// ---------------------------------------------------------------------------------------------

const groupSlug = (g: CarGroup) => `gr${g.toLowerCase()}`;

const firstSentence = (s: string): string => {
  const i = s.search(/[.!?](\s|$)/);
  return (i > 0 ? s.slice(0, i + 1) : s).slice(0, 180);
};

let indexCache: TopicRef[] | null = null;

/** Every topic of the base (stable order: general, classes, diagnostics, tuning, glossary, sources). */
export function knowledgeIndex(): TopicRef[] {
  if (indexCache) return indexCache;
  const out: TopicRef[] = [];
  for (const t of GENERAL_TOPICS)
    out.push({ id: `geral/${t.id}`, kind: 'geral', title: t.title, summary: t.summary });
  out.push({
    id: 'geral/tipos-de-curva',
    kind: 'geral',
    title: 'Tipos de curva',
    summary:
      'Conselho por tipo de curva detectado pelo app: grampo, lenta, média, rápida, inflexão e chicane.',
  });
  out.push({
    id: 'geral/regras-do-coach',
    kind: 'geral',
    title: 'Regras de uso para o coach',
    summary:
      'Como a IA deve usar a base: números, classe, regra geral × depende, sem pontos absolutos.',
  });
  for (const c of CAR_CLASSES)
    out.push({
      id: `classe/${groupSlug(c.group)}`,
      kind: 'classe',
      title: `${c.label} — ${c.name}`,
      summary: firstSentence(c.summary),
    });
  for (const code of ALL_DIAGNOSTIC_CODES) {
    const d = diagnosticFor(code)!;
    out.push({
      id: `diagnostico/${code}`,
      kind: 'diagnostico',
      title: `${code}: ${d.title}`,
      summary: firstSentence(d.meaning),
    });
  }
  out.push({
    id: 'afinacao',
    kind: 'afinacao',
    title: 'Afinação: sintoma → ajuste',
    summary:
      'Mapa de sintomas de comportamento para a direção típica do ajuste (princípios gerais).',
  });
  out.push({
    id: 'glossario',
    kind: 'glossario',
    title: 'Glossário pt-BR / inglês',
    summary: 'Termos de pilotagem e afinação usados pelo app e pela comunidade.',
  });
  out.push({
    id: 'fonte',
    kind: 'fonte',
    title: 'Fontes e links',
    summary: 'Todas as fontes consultadas, com URL e data de consulta.',
  });
  indexCache = out;
  return out;
}

/** Index as Markdown (for MCP resources and the coach). */
export function knowledgeIndexMarkdown(): string {
  const idx = knowledgeIndex();
  const kinds: [string, string][] = [
    ['geral', 'Princípios gerais'],
    ['classe', 'Classes de carro'],
    ['diagnostico', 'Diagnósticos do app'],
    ['afinacao', 'Afinação'],
    ['glossario', 'Glossário'],
    ['fonte', 'Fontes'],
  ];
  const parts = ['# Base de conhecimento de pilotagem (pt-BR)'];
  for (const [k, title] of kinds) {
    const items = idx.filter((t) => t.kind === k);
    parts.push(`## ${title}\n${items.map((t) => `- \`${t.id}\` — ${t.title}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

/** Resolves loose input ("gr4", "Gr.4", "brakeEarlier", "trail-braking") to a topic id. */
export function resolveTopicId(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const idx = knowledgeIndex();
  const lower = s.toLowerCase();
  const exact = idx.find((t) => t.id.toLowerCase() === lower);
  if (exact) return exact.id;
  const g = parseCarGroup(s);
  if (g) return `classe/${groupSlug(g)}`;
  const byTail = idx.find((t) => t.id.split('/').pop()!.toLowerCase() === lower);
  if (byTail) return byTail.id;
  if (['sources', 'fontes'].includes(lower)) return 'fonte';
  if (['setup', 'afinação', 'afinacao', 'tuning'].includes(lower)) return 'afinacao';
  if (['glossary', 'glossário'].includes(lower)) return 'glossario';
  return null;
}

function diagnosticPage(d: DiagnosticKnowledge, group: CarGroup | null): string {
  const lines = [
    `## ${d.code}: ${d.title}`,
    `**O que o app mediu:** ${d.meaning}`,
    `**Causas prováveis:**\n${d.causes.map((c) => `- ${c}`).join('\n')}`,
    `**Ação principal:** ${d.fix}`,
    `**Exercício:** ${d.drill}`,
  ];
  const entries = (GROUPS as readonly CarGroup[]).filter((g) => d.byGroup[g]);
  if (entries.length) {
    const shown = group ? entries.filter((g) => g === group) : entries;
    if (shown.length)
      lines.push(`**Por classe:**\n${shown.map((g) => `- ${d.byGroup[g]}`).join('\n')}`);
  }
  if (d.caveat) lines.push(`**Cuidado:** ${d.caveat}`);
  lines.push(`_Base: ${BASIS_LABELS[d.basis]}. Fontes: ${sourceLine(d.src) || '—'}._`);
  return lines.join('\n\n');
}

function classPage(c: CarClassKnowledge): string {
  return [
    `## ${c.label} — ${c.name}`,
    `_Evidência: ${c.evidence === 'media' ? 'média' : 'baixa (sem boa fonte; síntese de princípios gerais)'}._`,
    c.summary,
    c.examples.length ? `**Exemplos do catálogo:** ${c.examples.join(', ')}.` : '',
    `**Assistências típicas:**\n${bullets(c.assists)}`,
    `**Estilo de pilotagem:**\n${bullets(c.style)}`,
    `**Erros comuns:**\n${bullets(c.mistakes)}`,
    `**O que muda em relação às outras classes:**\n${bullets(c.whatChanges)}`,
    `_Fontes: ${sourceLine(c.src) || '—'}._`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function setupPage(): string {
  const parts = [
    '## Afinação: sintoma → ajuste',
    `_${SETUP_HEADER}_`,
    `**Regras gerais:**\n${SETUP_RULES.map((r) => `- ${r}`).join('\n')}`,
  ];
  for (const e of SETUP_MAP) {
    parts.push(
      [
        `### ${e.symptom}`,
        `Onde: ${e.phase}. Diagnósticos do app relacionados: ${e.diagnostics.join(', ') || '—'}.`,
        `Causa provável: ${e.likelyCause}`,
        bullets(e.adjustments),
        `**Cuidado:** ${e.caution}`,
      ].join('\n'),
    );
  }
  return parts.join('\n\n');
}

function sourcesPage(): string {
  const rows = KNOWLEDGE_SOURCES.map((s) => {
    const link = s.url ? `[${s.title}](${s.url})` : s.title;
    return `- ${link} — ${s.publisher}${s.author ? `, ${s.author}` : ''}${s.published ? ` (${s.published})` : ''}. Consultada em ${s.consultedAt} (${s.access.replaceAll('-', ' ')}). Usada para: ${s.usedFor}.`;
  });
  return `## Fontes e links\nResumos escritos com palavras próprias; nada foi copiado. Onde o acesso é "so resumo de busca" ou "nao aberto", confirme à mão.\n\n${rows.join('\n')}`;
}

/** Full Markdown of one topic (null when the id is unknown). `group` trims per-class variations. */
export function knowledgeTopic(
  input: string,
  opts: { group?: string | null | undefined } = {},
): string | null {
  const id = resolveTopicId(input);
  if (!id) return null;
  const group = parseCarGroup(opts.group);
  const [kind, rest = ''] = id.split('/') as [string, string | undefined];
  if (kind === 'geral') {
    if (rest === 'tipos-de-curva') {
      return `## Tipos de curva\n\n${(Object.keys(CORNER_TYPE_ADVICE) as KnowledgeCornerKind[])
        .map((k) => `### ${CORNER_TYPE_ADVICE[k].title}\n${bullets(CORNER_TYPE_ADVICE[k].tips)}`)
        .join('\n\n')}`;
    }
    if (rest === 'regras-do-coach')
      return `## Regras de uso para o coach\n\n${COACH_RULES.map((r) => `- ${r}`).join('\n')}`;
    const t = GENERAL_TOPICS.find((x) => x.id === rest);
    if (!t) return null;
    return `## ${t.title}\n\n${t.summary}\n\n${bullets(t.points)}\n\n_Fontes: ${sourceLine([...new Set(t.points.flatMap((p) => p.src ?? []))]) || '—'}._`;
  }
  if (kind === 'classe') {
    const c = CAR_CLASSES.find((x) => groupSlug(x.group) === rest);
    return c ? classPage(c) : null;
  }
  if (kind === 'diagnostico') {
    const d = diagnosticFor(rest);
    return d ? diagnosticPage(d, group) : null;
  }
  if (kind === 'afinacao') return setupPage();
  if (kind === 'glossario')
    return `## Glossário\n\n${GLOSSARY.map((g) => `- **${g.term}**${g.en ? ` (${g.en})` : ''}: ${g.definition}`).join('\n')}`;
  if (kind === 'fonte') return sourcesPage();
  return null;
}

/** Markdown of the whole base (all topics), for exports and size accounting. */
export function knowledgeFullMarkdown(): string {
  return knowledgeIndex()
    .map((t) => knowledgeTopic(t.id))
    .filter((x): x is string => !!x)
    .join('\n\n---\n\n');
}

const searchDocs = new Map<string, string>();

function docFor(ref: TopicRef): string {
  let d = searchDocs.get(ref.id);
  if (d === undefined) {
    d = normalizeSearch(`${ref.title} ${ref.id} ${knowledgeTopic(ref.id) ?? ''}`);
    searchDocs.set(ref.id, d);
  }
  return d;
}

/** Topics matching every word of `query` (accent-free), best matches first. Empty query = all. */
export function searchKnowledge(query: string, opts: { limit?: number } = {}): TopicRef[] {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  const idx = knowledgeIndex();
  if (words.length === 0) return idx.slice(0, opts.limit ?? idx.length);
  const scored: { ref: TopicRef; score: number }[] = [];
  for (const ref of idx) {
    const doc = docFor(ref);
    if (!words.every((w) => doc.includes(w))) continue;
    const title = normalizeSearch(`${ref.title} ${ref.id}`);
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 10;
      score += Math.min(5, doc.split(w).length - 1);
    }
    scored.push({ ref, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit ?? scored.length).map((s) => s.ref);
}

/** Size of the base for reports: topics and characters of the full Markdown. */
export function knowledgeStats(): {
  topics: number;
  chars: number;
  sources: number;
  diagnostics: number;
} {
  return {
    topics: knowledgeIndex().length,
    chars: knowledgeFullMarkdown().length,
    sources: KNOWLEDGE_SOURCES.length,
    diagnostics: ALL_DIAGNOSTIC_CODES.length,
  };
}
