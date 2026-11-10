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
import { Icon } from '../../components/ui/Icon.tsx';
import type { Route } from '../../lib/route.ts';
import { Markdown } from '../components/Markdown.tsx';
import { Panel } from '../components/Panel.tsx';
import { PageHead, useTitle } from '../components/ui.tsx';
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

const KIND_TONES: Partial<Record<TopicRef['kind'], string>> = {
  classe: 'info',
  diagnostico: 'accent',
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
        <span className="g-topic-head">
          <span className="g-topic-title">{topic.title}</span>
          <span className="ui-badge" data-tone={KIND_TONES[topic.kind]}>
            {KIND_TAGS[topic.kind]}
          </span>
          {evidenceLow && (
            <span className="ui-badge" data-tone="warn">
              pouca evidência
            </span>
          )}
        </span>
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
  const filtered = query.trim() !== '' || kind !== 'todos' || group !== null;

  return (
    <div className="g-page">
      <PageHead
        title="Guia de pilotagem"
        sub="A base de conhecimento que o coach de IA usa: princípios, classes de carro, o que cada diagnóstico do app significa, mapa de afinação e fontes."
      />

      <section className="ui-card g-controls" aria-label="Busca e filtros">
        <label className="g-search" htmlFor="g-q">
          <span className="ui-label">Buscar no guia</span>
          <span className="g-search-box">
            <Icon name="search" size={20} />
            <input
              id="g-q"
              className="ui-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="trail braking, subesterço, TCS…"
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
            />
          </span>
        </label>
        <div className="g-filters">
          <fieldset className="g-filter">
            <legend className="ui-label">Tipo de conteúdo</legend>
            <div className="g-chips">
              {GUIDE_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className="ui-chip"
                  aria-pressed={kind === k.id}
                  onClick={() => setKind(k.id)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="g-filter">
            <legend className="ui-label">Classe do carro</legend>
            <div className="g-chips">
              <button
                type="button"
                className="ui-chip"
                aria-pressed={group === null}
                onClick={() => setGroup(null)}
              >
                Todas
              </button>
              {GUIDE_GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="ui-chip"
                  aria-pressed={group === g.id}
                  onClick={() => setGroup(group === g.id ? null : g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      {brief && (
        <details className="g-brief">
          <summary>
            O que o coach recebe sobre a classe {groupLabel(group)} ({brief.markdown.length}{' '}
            caracteres)
          </summary>
          <Markdown className="g-md" text={brief.markdown} />
        </details>
      )}

      <div className="g-count-row">
        <p className="g-count" aria-live="polite">
          {topics.length === 0
            ? 'Nenhum tópico encontrado.'
            : `${topics.length} ${topics.length === 1 ? 'tópico' : 'tópicos'}${group ? ` · diagnósticos filtrados para ${groupLabel(group)}` : ''}`}
        </p>
        {filtered && topics.length > 0 && (
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => {
              setQuery('');
              setKind('todos');
              setGroup(null);
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {topics.length === 0 ? (
        <div className="ui-empty">
          <strong>Nada encontrado</strong>
          <p>
            Nada para “{query}”. Tente outra palavra (a busca ignora acentos) ou limpe os filtros.
          </p>
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            onClick={() => {
              setQuery('');
              setKind('todos');
              setGroup(null);
            }}
          >
            Limpar filtros
          </button>
        </div>
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

      <Panel
        className="g-notice"
        title="Como ler este guia"
        description="Regra geral não é lei: serve de ponto de partida, e o que vale são os números das suas voltas."
      >
        <ul>
          <li>
            Cada afirmação diz se é <strong>regra geral</strong>, <strong>depende do carro</strong>,{' '}
            <strong>segundo uma fonte</strong> (com link) ou tem <strong>pouca evidência</strong>.
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
      </Panel>

      <p className="g-foot">
        {stats.topics} tópicos · {stats.diagnostics} diagnósticos · {KNOWLEDGE_SOURCES.length}{' '}
        fontes (consultadas em 2026-11-09). Resumos em palavras próprias; os links levam aos textos
        originais.
      </p>
    </div>
  );
}
