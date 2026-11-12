/**
 * #/ajuda — Central de ajuda. Tópicos em cartões, busca no topo (título e corpo, sem diferenciar
 * acento), artigos curtos com passos numerados, links para a tela certa e botões que reusam as
 * ações do app (tours, assistente inicial).
 *
 *   #/ajuda               tópicos (e os atalhos "Comece por aqui")
 *   #/ajuda?t=<tópico>    os artigos de um tópico
 *   #/ajuda?q=<texto>     resultados da busca
 *   #/ajuda/<artigo>      um artigo
 *
 * O conteúdo vem de `lib/helpContent.ts` (um objeto por idioma).
 */

import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/ui/Icon.tsx';
import {
  type HelpActionId,
  type HelpArticle,
  type HelpContent,
  type HelpTopic,
  helpArticle,
  helpContent,
  helpTopic,
  searchHelp,
} from '../../lib/helpContent.ts';
import { t as uiText, useLanguage } from '../../lib/i18n.ts';
import { type Route, routes } from '../../lib/route.ts';
import { restartSetupAssistant } from '../../state/setup.ts';
import { requestTour } from '../../state/tour.ts';
import { PageHead, useTitle } from '../components/ui.tsx';
import '../../styles/help.css';

const ACTIONS: Record<HelpActionId, { label: () => string; run: () => void }> = {
  tourLive: {
    label: () => uiText('Ver o tour do Ao vivo'),
    run: () => void requestTour('live'),
  },
  tourAnalysis: {
    label: () => uiText('Ver o tour do histórico'),
    run: () => void requestTour('analysis'),
  },
  setup: {
    label: () => uiText('Refazer o assistente inicial'),
    run: restartSetupAssistant,
  },
};

/** Botões de ação (tours e assistente). */
function ActionButtons({ ids, primary }: { ids: readonly HelpActionId[]; primary?: boolean }) {
  return (
    <>
      {ids.map((id, i) => (
        <button
          key={id}
          type="button"
          className="ui-btn"
          data-variant={primary && i === 0 ? undefined : 'secondary'}
          onClick={ACTIONS[id].run}
        >
          {ACTIONS[id].label()}
        </button>
      ))}
    </>
  );
}

function Article({
  article,
  content,
  level,
}: {
  article: HelpArticle;
  content: HelpContent;
  level: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const topic = helpTopic(content, article.topic);
  return (
    <article className="ui-card hp-article" id={`a-${article.id}`}>
      <header className="hp-article-head">
        <Heading className="hp-article-title">
          <a href={routes.help(undefined, article.id)}>{article.title}</a>
        </Heading>
        {topic && level === 2 && (
          <a className="ui-badge" data-tone="accent" href={routes.help(topic.id)}>
            {topic.title}
          </a>
        )}
      </header>
      <p className="hp-summary">{article.summary}</p>
      {article.steps && (
        <ol className="hp-steps">
          {article.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}
      {article.items && (
        <ul className="hp-items">
          {article.items.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      {article.shortcuts && (
        <dl className="hp-keys">
          {article.shortcuts.map((s) => (
            <div key={s.keys.join('+')} className="hp-key-row">
              <dt>
                {s.keys.map((k) => (
                  <kbd key={k} className="ui-kbd">
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd>{s.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {article.note && <p className="hp-note">{article.note}</p>}
      {(article.links?.length || article.actions?.length) && (
        <div className="hp-links">
          {article.actions && <ActionButtons ids={article.actions} />}
          {article.links?.map((l) => (
            <a key={l.href + l.label} className="ui-btn" data-variant="ghost" href={l.href}>
              {l.label}
              <Icon name="chevron-right" size={16} />
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

function TopicCard({ topic, count }: { topic: HelpTopic; count: number }) {
  return (
    <li>
      <a className="hp-topic" href={routes.help(topic.id)}>
        <span className="hp-topic-icon" aria-hidden="true">
          <Icon name={topic.icon} size={22} />
        </span>
        <span className="hp-topic-text">
          <span className="hp-topic-title">{topic.title}</span>
          <span className="hp-topic-desc">{topic.description}</span>
        </span>
        <span className="hp-topic-count num">{count}</span>
      </a>
    </li>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <search className="cfg-search hp-search">
      <Icon name="search" size={18} className="cfg-search-icon" />
      <input
        ref={ref}
        className="ui-input"
        type="search"
        value={value}
        placeholder={uiText('Buscar: voz, firewall, Discord…')}
        aria-label={uiText('Buscar na ajuda')}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('');
        }}
      />
      {value !== '' && (
        <button
          type="button"
          className="ui-icon-btn cfg-search-clear"
          aria-label={uiText('Limpar a busca')}
          onClick={() => {
            onChange('');
            ref.current?.focus();
          }}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </search>
  );
}

function Results({
  results,
  content,
  query,
  onClear,
}: {
  results: HelpArticle[];
  content: HelpContent;
  query: string;
  onClear: () => void;
}) {
  if (results.length === 0) {
    return (
      <div className="ui-empty" role="status">
        <strong>{uiText('Nada encontrado')}</strong>
        <p>
          {uiText(
            'Nenhum artigo tem “{0}”. Tente outra palavra, como voz, firewall ou Discord.',
            query,
          )}
        </p>
        <button type="button" className="ui-btn" data-variant="secondary" onClick={onClear}>
          {uiText('Limpar a busca')}
        </button>
      </div>
    );
  }
  return (
    <section aria-label={uiText('Resultados da busca')}>
      <p className="hp-count" role="status">
        {results.length === 1 ? uiText('1 artigo') : uiText('{0} artigos', String(results.length))}
      </p>
      <ul className="ui-list hp-results">
        {results.map((a) => (
          <li key={a.id}>
            <a className="ui-list-item" href={routes.help(undefined, a.id)}>
              <span className="ui-list-text">
                <span className="ui-list-title">{a.title}</span>
                <span className="ui-list-desc">{a.summary}</span>
              </span>
              <span className="ui-badge">{helpTopic(content, a.topic)?.title}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Home({ content }: { content: HelpContent }) {
  const count = (id: string) => content.articles.filter((a) => a.topic === id).length;
  return (
    <>
      <section className="ui-card hp-start" data-tone="accent" aria-labelledby="hp-start-title">
        <div>
          <h2 id="hp-start-title" className="ui-card-title">
            {uiText('Comece por aqui')}
          </h2>
          <p className="hp-start-sub">
            {uiText('Um passeio pelo app ou a configuração inicial de novo, quando quiser.')}
          </p>
        </div>
        <div className="hp-start-actions">
          <ActionButtons ids={['tourLive', 'tourAnalysis', 'setup']} primary />
        </div>
      </section>
      <section aria-labelledby="hp-topics">
        <h2 id="hp-topics" className="hp-h2">
          {uiText('Tópicos')}
        </h2>
        <ul className="hp-topics">
          {content.topics.map((t) => (
            <TopicCard key={t.id} topic={t} count={count(t.id)} />
          ))}
        </ul>
      </section>
      <p className="hp-foot">
        {uiText('Procurando técnica de pilotagem?')}{' '}
        <a href={routes.guide()}>{uiText('Abra o Guia de pilotagem.')}</a>
      </p>
    </>
  );
}

function TopicView({ topic, content }: { topic: HelpTopic; content: HelpContent }) {
  const articles = content.articles.filter((a) => a.topic === topic.id);
  return (
    <section aria-labelledby="hp-topic-title" className="hp-topic-view">
      <div className="hp-topic-head">
        <span className="hp-topic-icon" aria-hidden="true">
          <Icon name={topic.icon} size={22} />
        </span>
        <div>
          <h2 id="hp-topic-title" className="hp-h2">
            {topic.title}
          </h2>
          <p className="hp-topic-desc">{topic.description}</p>
        </div>
      </div>
      <nav className="hp-toc" aria-label={uiText('Artigos deste tópico')}>
        {articles.map((a) => (
          <a key={a.id} className="ui-chip" href={`#a-${a.id}`} onClick={(e) => jump(e, a.id)}>
            {a.title}
          </a>
        ))}
      </nav>
      <div className="hp-stack">
        {articles.map((a) => (
          <Article key={a.id} article={a} content={content} level={3} />
        ))}
      </div>
    </section>
  );
}

/** Rola até o artigo sem mexer na rota (a âncora `#a-…` não é rota). */
function jump(e: MouseEvent, id: string): void {
  e.preventDefault();
  document.getElementById(`a-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function NotFoundArticle() {
  return (
    <div className="ui-empty" role="status">
      <strong>{uiText('Artigo não encontrado')}</strong>
      <p>{uiText('Esse artigo não existe na ajuda. Veja os tópicos para achar o que procura.')}</p>
      <a className="ui-btn" href={routes.help()}>
        {uiText('Voltar à ajuda')}
      </a>
    </div>
  );
}

export function HelpPage({ route }: { route: Route }) {
  useTitle(uiText('Ajuda'));
  const language = useLanguage();
  const content = useMemo(() => helpContent(language), [language]);
  const [query, setQuery] = useState(route.query.q ?? '');

  // Um link para #/ajuda?q=… (mesma página, hash novo) atualiza o campo.
  const qParam = route.query.q;
  useEffect(() => setQuery(qParam ?? ''), [qParam]);

  const articleId = route.params.id;
  const topic = helpTopic(content, route.query.t);
  const article = articleId ? helpArticle(content, articleId) : undefined;
  const searching = query.trim() !== '';
  const results = useMemo(() => searchHelp(query, content.articles), [query, content]);

  // Um artigo ou tópico novo abre no começo da página.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rola ao trocar de artigo ou tópico
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [articleId, route.query.t]);

  let body: ReactNode;
  let back: { href: string; label: string } | undefined;
  if (searching) {
    body = (
      <Results
        results={results}
        content={content}
        query={query.trim()}
        onClear={() => setQuery('')}
      />
    );
  } else if (articleId) {
    const parent = article && helpTopic(content, article.topic);
    back = parent
      ? { href: routes.help(parent.id), label: parent.title }
      : { href: routes.help(), label: uiText('Ajuda') };
    body = article ? (
      <Article article={article} content={content} level={2} />
    ) : (
      <NotFoundArticle />
    );
  } else if (topic) {
    back = { href: routes.help(), label: uiText('Ajuda') };
    body = <TopicView topic={topic} content={content} />;
  } else {
    body = <Home content={content} />;
  }

  return (
    <div className="hp-page">
      <PageHead
        title={uiText('Central de ajuda')}
        sub={uiText('Tire dúvidas e aprenda a configurar o Bono, passo a passo.')}
        back={searching ? undefined : back}
      />
      <SearchBox value={query} onChange={setQuery} />
      <div className="hp-body">{body}</div>
    </div>
  );
}
