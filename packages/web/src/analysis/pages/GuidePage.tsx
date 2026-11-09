/**
 * #/guia — "Guia de pilotagem": the coach's driving knowledge base (principles, car classes,
 * diagnostics of the app, tuning map, glossary, sources) as a searchable page. Same data and text as
 * the AI coach and the MCP `get_knowledge` tool (`@gt7/shared` knowledge module): no network.
 */

import {
  type CarGroup,
  groupLabel,
  KNOWLEDGE_SOURCES,
  knowledgeBrief,
  knowledgeStats,
  knowledgeTopic,
  type TopicRef,
} from '@gt7/shared';
import { useEffect, useMemo, useState } from 'react';
import type { Route } from '../../lib/route.ts';
import { Markdown } from '../components/Markdown.tsx';
import { Card, Empty, PageHead, Tag, useTitle } from '../components/ui.tsx';
import {
  filterGuide,
  GUIDE_GROUPS,
  GUIDE_KINDS,
  type GuideKind,
  parseGuideGroup,
  parseGuideKind,
} from '../lib/guide.ts';
import '../../styles/guide.css';

const KIND_TAGS: Record<TopicRef['kind'], string> = {
  geral: 'Princípio',
  classe: 'Classe',
  diagnostico: 'Diagnóstico',
  afinacao: 'Afinação',
  glossario: 'Glossário',
  fonte: 'Fontes',
};

/** Page body without its first "## Title" line (the card header already shows it). */
function bodyOf(id: string, group: CarGroup | null): string {
  const md = knowledgeTopic(id, { group }) ?? '';
  return md.replace(/^## .*\n+/, '');
}

function Topic({
  topic,
  group,
  defaultOpen,
}: {
  topic: TopicRef;
  group: CarGroup | null;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const evidenceLow = topic.kind === 'classe' && /gr(2|b|n|x)$/.test(topic.id);
  return (
    <details
      className="g-topic"
      id={`t-${topic.id.replace('/', '-')}`}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="g-topic-title">{topic.title}</span>
        <Tag tone={topic.kind === 'diagnostico' ? 'info' : undefined}>{KIND_TAGS[topic.kind]}</Tag>
        {evidenceLow && <Tag tone="warn">pouca evidência</Tag>}
        <span className="g-topic-sum">{topic.summary}</span>
      </summary>
      {open && <Markdown className="g-md" text={bodyOf(topic.id, group)} />}
    </details>
  );
}

export function GuidePage({ route }: { route: Route }) {
  useTitle('Guia de pilotagem');
  const [query, setQuery] = useState(route.query.q ?? '');
  const [kind, setKind] = useState<GuideKind>(parseGuideKind(route.query.topico));
  const [group, setGroup] = useState<CarGroup | null>(parseGuideGroup(route.query.classe));

  // A link to #/guia?q=…&classe=… (same page, new hash) updates the controls.
  const { q: qParam, classe: classeParam, topico: topicoParam } = route.query;
  useEffect(() => {
    setQuery(qParam ?? '');
    setGroup(parseGuideGroup(classeParam));
    setKind(parseGuideKind(topicoParam));
  }, [qParam, classeParam, topicoParam]);

  const topics = useMemo(() => filterGuide({ query, kind, group }), [query, kind, group]);
  const stats = useMemo(() => knowledgeStats(), []);
  const brief = useMemo(
    () => (group ? knowledgeBrief({ carGroup: group, diagnosticCodes: ['brakeEarlier'] }) : null),
    [group],
  );
  // Few results (or an explicit search) open by default; the full list stays collapsed.
  const autoOpen = query.trim() !== '' && topics.length <= 4;

  return (
    <>
      <PageHead
        title="Guia de pilotagem"
        sub="A base de conhecimento que o coach de IA usa: princípios, classes de carro, o que cada diagnóstico do app significa, mapa de afinação e fontes."
      />

      <Card className="g-notice" title="Como ler este guia">
        <ul>
          <li>
            Cada afirmação diz se é <strong>regra geral</strong>, <strong>depende do carro</strong>,{' '}
            <strong>segundo uma fonte</strong> (com link) ou tem <strong>pouca evidência</strong>.
            Regra geral não é lei: serve de ponto de partida, e o que vale são os números das suas
            voltas.
          </li>
          <li>
            <strong>O app não tem pontos de frenagem por pista.</strong> Só existem os medidos nas
            suas voltas e nas referências capturadas; o guia nunca os inventa.
          </li>
          <li>
            Gr.2, Gr.B, carros de rua (N) e especiais (X) quase não têm fonte publicada: o texto
            deles é síntese de princípios gerais.
          </li>
        </ul>
      </Card>

      <div className="g-controls">
        <label className="g-search">
          <span>Buscar</span>
          <input
            className="a-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="trail braking, subesterço, TCS…"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="g-class">
          <span>Classe do carro</span>
          <select
            value={group ?? ''}
            onChange={(e) => setGroup(parseGuideGroup(e.target.value))}
            aria-label="Filtrar por classe do carro"
          >
            <option value="">Todas as classes</option>
            {GUIDE_GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="g-kinds">
        <legend className="g-sr">Tipo de conteúdo</legend>
        {GUIDE_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            aria-pressed={kind === k.id}
            onClick={() => setKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </fieldset>

      {brief && (
        <details className="g-brief">
          <summary>
            O que o coach recebe sobre a classe {groupLabel(group)} ({brief.markdown.length}{' '}
            caracteres)
          </summary>
          <Markdown className="g-md" text={brief.markdown} />
        </details>
      )}

      <p className="g-count" aria-live="polite">
        {topics.length === 0
          ? 'Nenhum tópico encontrado.'
          : `${topics.length} ${topics.length === 1 ? 'tópico' : 'tópicos'}${group ? ` · diagnósticos filtrados para ${groupLabel(group)}` : ''}`}
      </p>

      {topics.length === 0 ? (
        <Empty>
          <p>
            Nada para “{query}”. Tente outra palavra (a busca ignora acentos) ou limpe os filtros.
          </p>
          <button
            type="button"
            className="a-btn a-btn-ghost"
            onClick={() => {
              setQuery('');
              setKind('todos');
              setGroup(null);
            }}
          >
            Limpar filtros
          </button>
        </Empty>
      ) : (
        <div className="g-list">
          {topics.map((t) => (
            <Topic
              key={`${t.id}|${group ?? ''}|${autoOpen}`}
              topic={t}
              group={group}
              defaultOpen={autoOpen}
            />
          ))}
        </div>
      )}

      <p className="g-foot dim">
        {stats.topics} tópicos · {stats.diagnostics} diagnósticos · {KNOWLEDGE_SOURCES.length}{' '}
        fontes (consultadas em 2026-11-09). Resumos em palavras próprias; os links levam aos textos
        originais.
      </p>
    </>
  );
}
