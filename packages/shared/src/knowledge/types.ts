/**
 * Driving knowledge base (pt-BR) for the AI coach, the MCP server and the "Guia de pilotagem" page.
 *
 * Pure data + pure functions (isomorphic, no network). Everything here is a summary written in our
 * own words from the sources listed in ./sources.ts. There is NO open dataset of GT7 braking points,
 * corner speeds or ideal lines: the base holds principles, never absolute track numbers.
 */

import type { CarGroup } from '../cars/catalog.ts';

/**
 * How solid a statement is:
 * - `general-rule`: universal driving/vehicle-dynamics principle, not validated in GT7 by this app;
 * - `car-dependent`: true for some cars/drivetrains only, check the car before applying;
 * - `fonte`: summarised from a cited source (see `src`);
 * - `limited-evidence`: our best synthesis with little or no external support (N-classes, Gr.2…).
 */
export type Basis = 'general-rule' | 'car-dependent' | 'sources' | 'limited-evidence';

export const BASIS_LABELS: Record<Basis, string> = {
  'general-rule': 'regra geral',
  'car-dependent': 'depende do carro',
  sources: 'segundo fonte',
  'limited-evidence': 'pouca evidência',
};

/** One statement of the base. */
export interface Tip {
  text: string;
  basis: Basis;
  /** Source ids (./sources.ts). */
  src?: readonly string[];
}

export type SourceAccess =
  /** Read by the research task (docs/pesquisa) and summarised; not reopened when this base was written. */
  | 'lido-na-pesquisa'
  /** Only seen through search-result snippets: confirm by hand. */
  | 'so-resumo-de-busca'
  /** Could not be opened (JS-rendered / blocked). */
  | 'nao-aberto'
  /** No external source (general physics, own synthesis). */
  | 'sem-fonte-externa';

export interface KnowledgeSource {
  id: string;
  title: string;
  author?: string;
  publisher: string;
  /** Publication date as shown by the source (free text) when known. */
  published?: string;
  /** https URL; null only for `sem-fonte-externa`. */
  url: string | null;
  /** Date the page was consulted (ISO). */
  consultedAt: string;
  access: SourceAccess;
  /** What this base took from it. */
  usedFor: string;
}

/** Corner types the app detects (mirror of CornerKind). */
export type KnowledgeCornerKind = 'hairpin' | 'slow' | 'medium' | 'fast' | 'kink' | 'chicane';

export interface GeneralTopic {
  id: string;
  title: string;
  summary: string;
  points: readonly Tip[];
}

export interface CarClassKnowledge {
  group: CarGroup;
  label: string;
  /** Short name ("GT3 de fábrica"). */
  name: string;
  /** How much support the statements have. */
  evidence: 'media' | 'baixa';
  summary: string;
  /** Example cars of the catalogue (names as in the game). */
  examples: readonly string[];
  assists: readonly Tip[];
  style: readonly Tip[];
  mistakes: readonly Tip[];
  /** What changes compared to the other classes. */
  whatChanges: readonly Tip[];
  src: readonly string[];
}

export type DiagnosticArea =
  | 'braking'
  | 'mid-corner'
  | 'exit'
  | 'racing-line'
  | 'technique'
  | 'data';

export interface DiagnosticKnowledge {
  code: string;
  area: DiagnosticArea;
  title: string;
  /** What the app measured, in plain words. */
  meaning: string;
  causes: readonly string[];
  /** The ONE main action to suggest. */
  fix: string;
  /** Practice drill (5 laps, measurable in the app). */
  drill: string;
  /** Class variations (Gr.1 … N). `X` falls back to the general text. */
  byGroup: Partial<Record<CarGroup, string>>;
  /** Limits of the diagnosis (replay smoothing, different cars…). */
  caveat?: string;
  basis: Basis;
  src: readonly string[];
}

export interface SetupEntry {
  id: string;
  /** What the driver feels / the telemetry shows. */
  symptom: string;
  /** Where in the corner. */
  phase: 'entry' | 'mid-corner' | 'exit' | 'braking' | 'straight' | 'general';
  /** App diagnostics that point to this symptom. */
  diagnostics: readonly string[];
  likelyCause: string;
  /** Direction of the change, one at a time. */
  adjustments: readonly Tip[];
  caution: string;
}

export interface GlossaryTerm {
  id: string;
  /** pt-BR term. */
  term: string;
  /** English term(s) used by the community and the game. */
  en?: string;
  definition: string;
}

export type TopicKind = 'general' | 'class' | 'diagnostics' | 'setup' | 'glossary' | 'sources';

export interface TopicRef {
  /** Unique id used by `get_knowledge(topic)`: `general/<id>`, `class/<grupo>`, `diagnostics/<code>`… */
  id: string;
  kind: TopicKind;
  title: string;
  summary: string;
}
