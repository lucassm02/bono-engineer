/**
 * Grupo "Contas e dados": rádio no Discord (só no app para Windows), Coach IA, pasta dos dados,
 * idioma do app e, recolhido em Avançado, a conexão com o Claude/Codex (MCP). As seções são as de
 * antes, reaproveitadas sem mudar a lógica.
 */

import {
  type ApiStatus,
  type CoachConfig,
  type CoachEffort,
  isLanguage,
  LANGUAGES,
} from '@gt7/shared';
import { useState } from 'react';
import { LANGUAGE_NAMES, setLanguage, t as uiText, useLanguage } from '../../../lib/i18n.ts';
import { api } from '../../api.ts';
import { useFetch } from '../../useFetch.ts';
import { ConfirmModal } from '../ConfirmModal.tsx';
import { CodeBlock, CopyBtn } from '../CopyBlock.tsx';
import { DiscordSettings } from '../DiscordSettings.tsx';
import { Panel } from '../Panel.tsx';
import { ErrorBox, Loading } from '../ui.tsx';
import { Advanced, CfgRow, rowDomId, useSave } from './ConfigRow.tsx';
import { DataSection } from './DataManager.tsx';

const EFFORT_LABELS: Record<CoachEffort, string> = {
  get low() {
    return uiText('Baixo (rápido e barato)');
  },
  get medium() {
    return uiText('Médio');
  },
  get high() {
    return uiText('Alto (análise mais profunda)');
  },
};

const DESKTOP_CONFIG_PATH = '%APPDATA%\\Claude\\claude_desktop_config.json';
export function McpSection({ status, forceOpen }: { status: ApiStatus; forceOpen?: boolean }) {
  const info = useFetch('mcpinfo', () => api.mcpInfo());
  const i = info.data;
  const lanUrl = i?.http.lanUrls[0] ?? null;
  const localUrl = i?.http.localUrl ?? `http://localhost:${status.httpPort}/mcp`;
  const tokenRequired = i?.http.tokenRequired ?? status.tokenRequired;
  const codexConfig = [
    '[mcp_servers.bono]',
    `url = ${JSON.stringify(localUrl)}`,
    ...(tokenRequired ? ['bearer_token_env_var = "GT7_TOKEN"'] : []),
  ].join('\n');
  return (
    <Advanced
      id="mcp"
      summary={uiText('Avançado: conectar ao Claude ou ao Codex (MCP)')}
      forceOpen={forceOpen}
    >
      <div className="cfg-stack" id={rowDomId('mcp')}>
        <p className="cfg-hint">
          {uiText(
            'Opcional. Permite que o Codex ou o Claude consultem suas voltas e análises. Copie o trecho para o seu cliente; os endereços e caminhos correspondem a esta instalação.',
          )}
        </p>
        <section className="cfg-client">
          <h3 className="cfg-h3">{uiText('Codex (com o app aberto — inclui o estado ao vivo)')}</h3>
          <CodeBlock
            label={uiText('Adicione ao ~/.codex/config.toml e reinicie o Codex')}
            code={codexConfig}
          />
          {tokenRequired && (
            <p className="cfg-hint">
              {`${uiText('Defina')} `}
              <code>GT7_TOKEN</code>
              {` ${uiText('no ambiente do Codex com o mesmo token de acesso do app.')}`}
            </p>
          )}
        </section>
        <section className="cfg-client">
          <h3 className="cfg-h3">
            {uiText('Claude Code (com o app aberto — inclui o estado ao vivo)')}
          </h3>
          {i && <CodeBlock label={uiText('Cole no terminal')} code={i.claudeCode.http} />}
          <ul className="cfg-urls">
            <li>
              <span className="num">{localUrl}</span>
              <span className="cfg-muted">{uiText('endereço neste PC')}</span>
              <CopyBtn text={localUrl} />
            </li>
            {lanUrl && (
              <li>
                <span className="num">{lanUrl}</span>
                <span className="cfg-muted">{uiText('de outro PC da rede')}</span>
                <CopyBtn text={lanUrl} />
              </li>
            )}
          </ul>
        </section>
        <section className="cfg-client">
          <h3 className="cfg-h3">
            {uiText('Claude Desktop (lê os dados salvos, mesmo com o app fechado)')}
          </h3>
          {info.error && !i && <ErrorBox error={info.error} compact onRetry={info.reload} />}
          {!i && !info.error && <Loading />}
          {i && (
            <CodeBlock
              label={uiText('Cole em {0} e reinicie o Claude Desktop', DESKTOP_CONFIG_PATH)}
              code={JSON.stringify(i.claudeDesktopConfig, null, 2)}
            />
          )}
        </section>
        {i && (
          <details className="cfg-adv">
            <summary>{uiText('Avançado: outras formas de conectar')}</summary>
            <div className="cfg-adv-body">
              {i.repoRoot && (
                <p className="cfg-hint">
                  {`${uiText('Pasta do repositório:')} `}
                  <span className="num">{i.repoRoot}</span>
                </p>
              )}
              <CodeBlock
                label={uiText('Claude Code (lê os dados salvos)')}
                code={i.claudeCode.stdio}
              />
              <CodeBlock label={uiText('Linha de comando')} code={i.stdio.commandLine} />
              {i.stdio.npmCommandLine && (
                <CodeBlock
                  label={uiText('Dentro da pasta do repositório')}
                  code={i.stdio.npmCommandLine}
                />
              )}
              <p className="cfg-hint">
                {i.repoRoot ? (
                  <>
                    O <code>--import</code>
                    {` ${uiText('precisa ser uma URL')} `}
                    <code>file:///</code>
                    {` ${uiText('absoluta.')}`}
                  </>
                ) : (
                  <>
                    {uiText('O executável do app roda o servidor MCP como Node graças a')}{' '}
                    <code>ELECTRON_RUN_AS_NODE=1</code>
                    {uiText('; não precisa instalar nada.')}
                  </>
                )}{' '}
                {`${uiText('Detalhes em')} `}
                <code>packages/mcp/README.md</code>.
              </p>
            </div>
          </details>
        )}
      </div>
    </Advanced>
  );
}

export function CoachSection() {
  const cfg = useFetch('coachcfg', () => api.coachConfig());
  const [key, setKey] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { busy, run } = useSave();
  const apply = async (p: Parameters<typeof api.putCoachConfig>[0], ok: string) => {
    const r = await run(() => api.putCoachConfig(p), ok);
    if (r) cfg.setData(r as CoachConfig);
    return r;
  };
  if (cfg.error && !cfg.data) {
    return (
      <Panel title={uiText('Coach IA (Claude)')} id="coach">
        <ErrorBox
          error={
            cfg.error.status === 404
              ? uiText(
                  'Este servidor ainda não tem o coach de IA (endpoint /api/coach/config ausente).',
                )
              : cfg.error
          }
          compact
          onRetry={cfg.reload}
        />
      </Panel>
    );
  }
  const c = cfg.data;
  return (
    <Panel
      title={uiText('Coach IA (Claude)')}
      description={uiText('O debrief em linguagem natural usa a API da Anthropic com a sua chave.')}
      id="coach"
    >
      {!c ? (
        <Loading />
      ) : (
        <div className="cfg-stack">
          <div className="cfg-keystate">
            <span className="ui-label">{uiText('Chave da API')}</span>
            {c.hasKey ? (
              <span className="cfg-keyline">
                <span className="ui-badge" data-tone="gain">
                  {uiText('configurada')}
                </span>
                <span className="num">…{c.keyLast4}</span>
                <span className="cfg-muted">
                  {c.keySource === 'env'
                    ? uiText('variável ANTHROPIC_API_KEY — tem prioridade')
                    : uiText('salva no app')}
                </span>
              </span>
            ) : (
              <span className="ui-badge" data-tone="loss">
                {uiText('sem chave')}
              </span>
            )}
          </div>
          <form
            className="cfg-keyform"
            autoComplete="off"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!key.trim()) return;
              if (await apply({ apiKey: key.trim() }, uiText('Chave salva.'))) setKey('');
            }}
          >
            <div className="ui-field">
              <label className="ui-label" htmlFor="coach-key">
                {uiText('Chave da API da Anthropic')}
              </label>
              <div className="cfg-inputrow">
                <input
                  id="coach-key"
                  className="ui-input"
                  type="password"
                  value={key}
                  placeholder={c.hasKey ? uiText('Digite para trocar a chave') : 'sk-ant-…'}
                  autoComplete="new-password"
                  spellCheck={false}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button type="submit" className="ui-btn" disabled={busy || !key.trim()}>
                  {uiText('Salvar chave')}
                </button>
                {c.keySource === 'settings' && (
                  <button
                    type="button"
                    className="ui-btn"
                    data-variant="danger"
                    disabled={busy}
                    onClick={() => setConfirmRemove(true)}
                  >
                    {uiText('Remover chave')}
                  </button>
                )}
              </div>
              <span className="ui-help">
                {uiText(
                  'A chave fica só no PC (banco local) e nunca volta para o navegador — aqui aparecem só os 4 últimos caracteres. Crie uma em console.anthropic.com.',
                )}
              </span>
            </div>
          </form>
          <label className="ui-field">
            <span className="ui-label">{uiText('Modelo')}</span>
            <select
              className="ui-select"
              value={c.model}
              disabled={busy}
              onChange={(e) => apply({ model: e.target.value }, uiText('Modelo salvo.'))}
            >
              {c.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.id === c.defaultModel ? uiText(' (padrão)') : ''}
                </option>
              ))}
            </select>
            <span className="ui-help">{c.models.find((m) => m.id === c.model)?.description}</span>
          </label>
          <details className="cfg-adv">
            <summary>{uiText('Avançado: esforço e relatórios guardados')}</summary>
            <div className="cfg-adv-body cfg-two">
              <label className="ui-field">
                <span className="ui-label">{uiText('Esforço')}</span>
                <select
                  className="ui-select"
                  value={c.effort}
                  disabled={busy}
                  onChange={(e) =>
                    apply({ effort: e.target.value as CoachEffort }, uiText('Esforço salvo.'))
                  }
                >
                  {(Object.keys(EFFORT_LABELS) as CoachEffort[]).map((k) => (
                    <option key={k} value={k}>
                      {EFFORT_LABELS[k]}
                    </option>
                  ))}
                </select>
                <span className="ui-help">
                  {`${uiText('Até')} `}
                  {c.maxToolIterations}
                  {` ${uiText('rodadas de ferramentas por pedido.')}`}
                </span>
              </label>
              <label className="ui-field">
                <span className="ui-label">{uiText('Relatórios guardados')}</span>
                <select
                  className="ui-select"
                  value={c.maxReports}
                  disabled={busy}
                  onChange={(e) =>
                    apply(
                      { maxReports: Number(e.target.value) },
                      uiText('Limite de relatórios salvo.'),
                    )
                  }
                >
                  {[...new Set([10, 25, 50, 100, 200, c.maxReports])]
                    .sort((x, y) => x - y)
                    .map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                </select>
                <span className="ui-help">
                  {uiText(
                    'Os mais antigos são apagados ao terminar um novo (cada um guarda os gráficos).',
                  )}
                </span>
              </label>
            </div>
          </details>
          <ConfirmModal
            open={confirmRemove}
            title={uiText('Remover a chave da API?')}
            message={
              <>
                <p>
                  {uiText(
                    'A chave salva neste PC será apagada e o coach de IA deixa de funcionar aqui.',
                  )}
                </p>
                <p>{uiText('Você pode informar uma chave de novo quando quiser.')}</p>
              </>
            }
            confirmLabel={uiText('Remover chave')}
            busy={busy}
            onClose={() => setConfirmRemove(false)}
            onConfirm={async () => {
              await apply({ apiKey: null }, uiText('Chave removida.'));
              setConfirmRemove(false);
            }}
          />
        </div>
      )}
    </Panel>
  );
}

/** Idioma do app: troca a tela e a voz do engenheiro (a voz em si fica em Engenheiro). */
export function LanguageSection() {
  const language = useLanguage();
  return (
    <Panel
      id="idioma"
      title={uiText('Idioma')}
      description={uiText('Vale para o app inteiro e para a voz do engenheiro.')}
    >
      <div className="cfg-list">
        <CfgRow
          id="language"
          title={uiText('Idioma do app')}
          description={uiText('Português, inglês ou espanhol, na tela e na voz.')}
          wide
        >
          <select
            className="ui-select cfg-select"
            aria-label={uiText('Idioma do app')}
            value={language}
            onChange={({ currentTarget }) => {
              if (isLanguage(currentTarget.value)) setLanguage(currentTarget.value);
            }}
          >
            {LANGUAGES.map((option) => (
              <option key={option} value={option} lang={option}>
                {LANGUAGE_NAMES[option]}
              </option>
            ))}
          </select>
        </CfgRow>
      </div>
    </Panel>
  );
}

export function AccountsGroup({ status, openMcp }: { status: ApiStatus; openMcp?: boolean }) {
  return (
    <>
      <DiscordSettings />
      <CoachSection />
      <DataSection status={status} />
      <LanguageSection />
      <McpSection status={status} forceOpen={openMcp} />
    </>
  );
}
