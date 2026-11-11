/** Pure helpers of the "Guia de pilotagem" page (#/guia): filtering of the knowledge topics. */

import {
  type CarGroup,
  knowledgeIndex,
  parseCarGroup,
  searchKnowledge,
  type TopicRef,
} from '@gt7/shared';
import { t as uiText } from '../../lib/i18n.ts';

export type GuideKind = 'todos' | TopicRef['kind'];

export const GUIDE_KINDS: readonly { id: GuideKind; label: string }[] = [
  {
    id: 'todos',
    get label() {
      return uiText('Tudo');
    },
  },
  {
    id: 'geral',
    get label() {
      return uiText('Princípios');
    },
  },
  {
    id: 'classe',
    get label() {
      return uiText('Classes');
    },
  },
  {
    id: 'diagnostico',
    get label() {
      return uiText('Diagnósticos');
    },
  },
  {
    id: 'afinacao',
    get label() {
      return uiText('Afinação');
    },
  },
  {
    id: 'glossario',
    get label() {
      return uiText('Glossário');
    },
  },
  {
    id: 'fonte',
    get label() {
      return uiText('Fontes');
    },
  },
];

export const GUIDE_GROUPS: readonly { id: CarGroup; label: string }[] = [
  { id: '1', label: 'Gr.1' },
  { id: '2', label: 'Gr.2' },
  { id: '3', label: 'Gr.3' },
  { id: '4', label: 'Gr.4' },
  { id: 'B', label: 'Gr.B' },
  {
    id: 'N',
    get label() {
      return uiText('Gr.N (carros de rua)');
    },
  },
  {
    id: 'X',
    get label() {
      return uiText('Gr.X (especiais)');
    },
  },
];

export function parseGuideKind(v: string | undefined): GuideKind {
  return GUIDE_KINDS.some((k) => k.id === v) ? (v as GuideKind) : 'todos';
}

/** Topic id of the class card of a group (`classe/gr4`). */
export function classTopicId(group: CarGroup): string {
  return `classe/gr${group.toLowerCase()}`;
}

/**
 * Topics to show: text search (accent-free, every word), the kind tab and, when a class is chosen,
 * only that class card among the "Classes" topics (the other kinds keep everything; their pages are
 * trimmed to the chosen class by the page).
 */
export function filterGuide(opts: {
  query: string;
  kind: GuideKind;
  group: CarGroup | null;
}): TopicRef[] {
  const base = opts.query.trim() ? searchKnowledge(opts.query) : knowledgeIndex();
  return base.filter((t) => {
    if (opts.kind !== 'todos' && t.kind !== opts.kind) return false;
    if (opts.group && t.kind === 'classe' && t.id !== classTopicId(opts.group)) return false;
    return true;
  });
}

export function parseGuideGroup(v: string | undefined): CarGroup | null {
  return parseCarGroup(v);
}
