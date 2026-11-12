/**
 * #/config — Configurações em seis grupos: Início (resumo de saúde), Console, Engenheiro, Painel e
 * aparelhos, Contas e dados, Sobre. No PC, lista de grupos à esquerda e o grupo aberto à direita;
 * no celular, a lista de grupos é a tela inicial e cada grupo abre como detalhe.
 * A rota `#/config?s=<grupo>` aceita também as âncoras antigas (`conexao`, `captura`, `discord`,
 * `coach`, `mcp`…), mapeadas para o grupo novo (ver `resolveConfigTarget`).
 */

import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { EngineerSettingsPanel } from '../../components/EngineerSettingsPanel.tsx';
import { FullscreenButton } from '../../components/FullscreenButton.tsx';
import { Icon } from '../../components/ui/Icon.tsx';
import { t as uiText } from '../../lib/i18n.ts';
import { ONBOARDING_KEY } from '../../lib/onboarding.ts';
import { type Route, routes } from '../../lib/route.ts';
import { saveString } from '../../lib/storage.ts';
import { useUi } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { AboutGroup } from '../components/config/AboutGroup.tsx';
import { AccountsGroup } from '../components/config/AccountsGroup.tsx';
import { rowDomId } from '../components/config/ConfigRow.tsx';
import { ConsoleGroup } from '../components/config/ConsoleGroup.tsx';
import { HealthSummary, PendingSetupCard } from '../components/config/HealthSummary.tsx';
import { PanelGroup } from '../components/config/PanelGroup.tsx';
import { DiscordSettings } from '../components/DiscordSettings.tsx';
import { ErrorBox, Loading, PageHead, useTitle } from '../components/ui.tsx';
import {
  CONFIG_ENTRIES,
  CONFIG_GROUPS,
  type ConfigEntry,
  type ConfigGroupId,
  resolveConfigTarget,
  searchConfig,
  shouldShowSearch,
} from '../lib/configNav.ts';
import { useFetch } from '../useFetch.ts';

/** Largura em que a casca vira celular (a barra inferior aparece): mesma do `analysis.css`. */
const MOBILE_QUERY = '(max-width: 900px)';

function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(MOBILE_QUERY);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

const GROUP_ICON: Record<ConfigGroupId, Parameters<typeof Icon>[0]['name']> = {
  inicio: 'home',
  console: 'capture',
  engenheiro: 'radio',
  painel: 'remote',
  contas: 'coach',
  sobre: 'info',
};

/** Marca a linha por um instante, para o olho achar o que a busca apontou. */
function flash(el: Element): void {
  el.setAttribute('data-flash', '1');
  window.setTimeout(() => el.removeAttribute('data-flash'), 1800);
}

function GroupList({
  active,
  hasDiscord,
  variant,
}: {
  active: ConfigGroupId | null;
  hasDiscord: boolean;
  variant: 'side' | 'cards';
}) {
  const groups = CONFIG_GROUPS.filter(
    (g) => (!g.desktopOnly || hasDiscord) && !(variant === 'cards' && g.id === 'inicio'),
  );
  return (
    <ul className="ui-list cfg-groups" data-variant={variant}>
      {groups.map((g) => (
        <li key={g.id}>
          <a
            className="ui-list-item"
            href={routes.config(g.id)}
            aria-current={active === g.id ? 'page' : undefined}
          >
            <Icon name={GROUP_ICON[g.id]} size={22} />
            <span className="ui-list-text">
              <span className="ui-list-title">{g.label}</span>
              {variant === 'cards' && <span className="ui-list-desc">{g.description}</span>}
            </span>
            {variant === 'cards' && <Icon name="chevron-right" size={18} className="bn-chev" />}
          </a>
        </li>
      ))}
    </ul>
  );
}

function SearchResults({
  results,
  query,
  onPick,
  onClear,
}: {
  results: ConfigEntry[];
  query: string;
  onPick: (e: ConfigEntry) => void;
  onClear: () => void;
}) {
  if (results.length === 0) {
    return (
      <div className="ui-empty" role="status">
        <strong>{uiText('Nada encontrado')}</strong>
        <p>
          {uiText(
            'Nenhuma configuração tem “{0}”. Tente outra palavra, como voz, delta ou firewall.',
            query,
          )}
        </p>
        <button type="button" className="ui-btn" data-variant="secondary" onClick={onClear}>
          {uiText('Limpar a busca')}
        </button>
      </div>
    );
  }
  const groupLabel = (id: ConfigGroupId) => CONFIG_GROUPS.find((g) => g.id === id)?.label ?? id;
  return (
    <ul className="ui-list cfg-results" aria-label={uiText('Resultados da busca')}>
      {results.map((e) => (
        <li key={e.id}>
          <a
            className="ui-list-item"
            href={routes.config(e.anchor ?? e.group)}
            onClick={() => onPick(e)}
          >
            <span className="ui-list-text">
              <span className="ui-list-title">{e.title}</span>
              <span className="ui-list-desc">{e.description}</span>
            </span>
            <span className="ui-badge">{groupLabel(e.group)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ConfigPage({ route }: { route: Route }) {
  useTitle(uiText('Configurações'));
  const status = useFetch('status', () => api.status(), 10000);
  const target = resolveConfigTarget(route.query.s);
  const group = target.group;
  const hasDiscord = !!window.bonoDiscord;
  const isMobile = useIsMobile();
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<ConfigEntry | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const ready = !!status.data;

  const visibleRows = CONFIG_ENTRIES.filter((e) => !e.desktopOnly || hasDiscord).length;
  const showSearch = shouldShowSearch(visibleRows);
  const results = useMemo(
    () => searchConfig(query, CONFIG_ENTRIES, { desktop: hasDiscord }),
    [query, hasDiscord],
  );
  const searching = query.trim() !== '';

  // Rola até a âncora antiga (ou a linha que a busca escolheu) quando o grupo aparece.
  // biome-ignore lint/correctness/useExhaustiveDependencies: roda ao trocar de grupo/âncora/linha
  useEffect(() => {
    if (searching) return;
    const wanted = focus && focus.group === group ? [rowDomId(focus.id), focus.anchor] : [];
    const ids = [...wanted, target.anchor].filter((x): x is string => !!x);
    // O conteúdo de alguns grupos depende do status: espera por ele antes de procurar.
    const needsStatus = group !== 'inicio' && group !== 'engenheiro' && group !== 'sobre';
    if (needsStatus && !ready) return;
    const timer = window.setTimeout(() => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) {
          const isRow = !!focus && id === rowDomId(focus.id);
          el.scrollIntoView({ block: isRow ? 'center' : 'start', behavior: 'smooth' });
          if (isRow) flash(el);
          return;
        }
      }
      if (ids.length === 0) window.scrollTo({ top: 0 });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [group, target.anchor, focus, ready, searching, isMobile]);

  const openAssistant = () => {
    saveString(ONBOARDING_KEY, '0');
    useUi.setState({ onboarding: 'active' });
  };

  const openAdvanced = !!focus?.advanced && focus.group === group;
  const openMcp = target.anchor === 'mcp' || (openAdvanced && group === 'contas');
  const expandMine =
    target.anchor === 'telas' || ['screens', 'lap-popup', 'lock'].includes(focus?.id ?? '');

  const needsStatus = (render: (s: NonNullable<typeof status.data>) => ReactNode) =>
    status.error && !status.data ? (
      <ErrorBox error={status.error} onRetry={status.reload} />
    ) : !status.data ? (
      <Loading />
    ) : (
      render(status.data)
    );

  let content: ReactNode;
  switch (group) {
    case 'inicio':
      content = (
        <>
          <HealthSummary
            settings={status.data?.settings ?? null}
            firewall={status.data?.firewall.state ?? null}
            onChange={status.reload}
          />
          <PendingSetupCard onOpenAssistant={openAssistant} />
          {isMobile && <GroupList active={null} hasDiscord={hasDiscord} variant="cards" />}
        </>
      );
      break;
    case 'console':
      content = needsStatus((s) => (
        <ConsoleGroup status={s} onChange={status.reload} openAdvanced={openAdvanced} />
      ));
      break;
    case 'engenheiro':
      content = <EngineerSettingsPanel openMore={openAdvanced} />;
      break;
    case 'painel':
      content = needsStatus((s) => (
        <PanelGroup status={s} onChange={status.reload} expandMine={expandMine} />
      ));
      break;
    case 'contas':
      content = status.data ? (
        <AccountsGroup status={status.data} openMcp={openMcp} />
      ) : (
        <>
          {status.error ? <ErrorBox error={status.error} onRetry={status.reload} /> : <Loading />}
          <DiscordSettings />
        </>
      );
      break;
    case 'sobre':
      content = needsStatus((s) => <AboutGroup status={s} />);
      break;
  }

  const groupInfo = CONFIG_GROUPS.find((g) => g.id === group);

  return (
    <div className="cfg-page">
      <PageHead
        title={uiText('Configurações')}
        sub={uiText('Tudo se ajusta aqui: nada de arquivo de configuração.')}
        actions={<FullscreenButton />}
      />

      {showSearch && (
        <search className="cfg-search">
          <Icon name="search" size={18} className="cfg-search-icon" />
          <input
            ref={searchRef}
            className="ui-input"
            type="search"
            value={query}
            placeholder={uiText('Buscar: voz, delta, firewall…')}
            aria-label={uiText('Buscar nas configurações')}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
          />
          {searching && (
            <button
              type="button"
              className="ui-icon-btn cfg-search-clear"
              aria-label={uiText('Limpar a busca')}
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </search>
      )}

      {searching ? (
        <SearchResults
          results={results}
          query={query.trim()}
          onClear={() => setQuery('')}
          onPick={(e) => {
            setFocus(e);
            setQuery('');
          }}
        />
      ) : (
        <div className="cfg-layout" data-mobile={isMobile ? '1' : undefined}>
          {!isMobile && (
            <nav className="cfg-side" aria-label={uiText('Grupos de configurações')}>
              <GroupList active={group} hasDiscord={hasDiscord} variant="side" />
            </nav>
          )}
          <div className="cfg-main" id="cfg-main" data-group={group}>
            {isMobile && group !== 'inicio' && (
              <div className="cfg-detail-head">
                <a className="ui-btn" data-variant="secondary" href={routes.config()}>
                  <Icon name="back" size={16} />
                  {uiText('Configurações')}
                </a>
                <h2 className="cfg-group-title">{groupInfo?.label}</h2>
              </div>
            )}
            {content}
          </div>
        </div>
      )}
    </div>
  );
}
