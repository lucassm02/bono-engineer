/**
 * #/guide — "Guia de pilotagem": the coach's driving knowledge base (principles, car classes,
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
import { getLanguage, t as uiText } from '../../lib/i18n.ts';
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
  get general() {
    return uiText('Princípio');
  },
  get class() {
    return uiText('Classe');
  },
  get diagnostics() {
    return uiText('Diagnóstico');
  },
  get setup() {
    return uiText('Afinação');
  },
  get glossary() {
    return uiText('Glossário');
  },
  get sources() {
    return uiText('Fontes');
  },
};

const KIND_TONES: Partial<Record<TopicRef['kind'], string>> = {
  class: 'info',
  diagnostics: 'accent',
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
  const evidenceLow = topic.kind === 'class' && /gr(2|b|n|x)$/.test(topic.id);
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
              {uiText('pouca evidência')}
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
  useTitle(uiText('Guia de pilotagem'));
  const [query, setQuery] = useState(route.query.q ?? '');
  const [kind, setKind] = useState<GuideKind>(parseGuideKind(route.query.topic));
  const [group, setGroup] = useState<CarGroup | null>(parseGuideGroup(route.query.class));

  // A link to #/guide?q=…&class=… (same page, new hash) updates the controls.
  const { q: qParam, class: classParam, topic: topicParam } = route.query;
  useEffect(() => {
    setQuery(qParam ?? '');
    setGroup(parseGuideGroup(classParam));
    setKind(parseGuideKind(topicParam));
  }, [qParam, classParam, topicParam]);

  const topics = useMemo(() => filterGuide({ query, kind, group }), [query, kind, group]);
  const stats = useMemo(() => knowledgeStats(), []);
  const brief = useMemo(
    () => (group ? knowledgeBrief({ carGroup: group, diagnosticCodes: ['brakeEarlier'] }) : null),
    [group],
  );
  // Few results (or an explicit search) open by default; the full list stays collapsed.
  const autoOpen = query.trim() !== '' && topics.length <= 4;
  const filtered = query.trim() !== '' || kind !== 'all' || group !== null;

  return (
    <div className="g-page">
      <PageHead
        title={uiText('Guia de pilotagem')}
        sub={uiText(
          'A base de conhecimento que o coach de IA usa: princípios, classes de carro, o que cada diagnóstico do app significa, mapa de afinação e fontes.',
        )}
      />

      {getLanguage() !== 'pt-BR' && (
        <p className="dim">{uiText('Conteúdo do guia em português do Brasil.')}</p>
      )}
      <section className="ui-card g-controls" aria-label={uiText('Busca e filtros')}>
        <label className="g-search" htmlFor="g-q">
          <span className="ui-label">{uiText('Buscar no guia')}</span>
          <span className="g-search-box">
            <Icon name="search" size={20} />
            <input
              id="g-q"
              className="ui-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={uiText('trail braking, subesterço, TCS…')}
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
            />
          </span>
        </label>
        <div className="g-filters">
          <fieldset className="g-filter">
            <legend className="ui-label">{uiText('Tipo de conteúdo')}</legend>
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
            <legend className="ui-label">{uiText('Classe do carro')}</legend>
            <div className="g-chips">
              <button
                type="button"
                className="ui-chip"
                aria-pressed={group === null}
                onClick={() => setGroup(null)}
              >
                {uiText('Todas')}
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
            {`${uiText('O que o coach recebe sobre a classe')} `}
            {groupLabel(group)} ({brief.markdown.length} {uiText('caracteres)')}
          </summary>
          <Markdown className="g-md" text={brief.markdown} />
        </details>
      )}

      <div className="g-count-row">
        <p className="g-count" aria-live="polite">
          {topics.length === 0
            ? uiText('Nenhum tópico encontrado.')
            : `${topics.length} ${topics.length === 1 ? uiText('tópico') : uiText('tópicos')}${group ? uiText(' · diagnósticos filtrados para {0}', groupLabel(group)) : ''}`}
        </p>
        {filtered && topics.length > 0 && (
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => {
              setQuery('');
              setKind('all');
              setGroup(null);
            }}
          >
            {uiText('Limpar filtros')}
          </button>
        )}
      </div>

      {topics.length === 0 ? (
        <div className="ui-empty">
          <strong>{uiText('Nada encontrado')}</strong>
          <p>
            {uiText('Nada para “')}
            {query}
            {uiText('”. Tente outra palavra (a busca ignora acentos) ou limpe os filtros.')}
          </p>
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            onClick={() => {
              setQuery('');
              setKind('all');
              setGroup(null);
            }}
          >
            {uiText('Limpar filtros')}
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
        title={uiText('Como ler este guia')}
        description={uiText(
          'Regra geral não é lei: serve de ponto de partida, e o que vale são os números das suas voltas.',
        )}
      >
        <ul>
          <li>
            {`${uiText('Cada afirmação diz se é')} `}
            <strong>{uiText('regra geral')}</strong>, <strong>{uiText('depende do carro')}</strong>,{' '}
            <strong>{uiText('segundo uma fonte')}</strong>
            {` ${uiText('(com link) ou tem')} `}
            <strong>{uiText('pouca evidência')}</strong>.
          </li>
          <li>
            <strong>{uiText('O app não tem pontos de frenagem por pista.')}</strong>
            {' ' +
              uiText(
                'Só existem os medidos nas suas voltas e nas referências capturadas; o guia nunca os inventa.',
              )}
          </li>
          <li>
            {uiText(
              'Gr.2, Gr.B, carros de rua (N) e especiais (X) quase não têm fonte publicada: o texto deles é síntese de princípios gerais.',
            )}
          </li>
        </ul>
      </Panel>

      <p className="g-foot">
        {stats.topics}
        {` ${uiText('tópicos ·')} `}
        {stats.diagnostics}
        {` ${uiText('diagnósticos ·')} `}
        {KNOWLEDGE_SOURCES.length}{' '}
        {uiText(
          'fontes (consultadas em 2026-11-09). Resumos em palavras próprias; os links levam aos textos originais.',
        )}
      </p>
    </div>
  );
}
