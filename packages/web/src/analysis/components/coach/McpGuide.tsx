/**
 * Step-by-step guide to ask the Coach through the driver's own AI agent over MCP. The main way is
 * the web (HTTP) address of the running Bono: one line, no paths of the PC. Agents that only take a
 * local command get it as a collapsed alternative. No API key is needed: the agent reads the same
 * data as the app.
 */

import { useState } from 'react';
import { t as uiText } from '../../../lib/i18n.ts';
import '../../../styles/coach-setup.css';
import { api } from '../../api.ts';
import { coachStarters, mcpAgentQuestion } from '../../lib/coachStarters.ts';
import {
  CODEX_TOKEN_VAR,
  claudeCodeWeb,
  codexSnippets,
  codexWebToml,
  mcpWebUrl,
} from '../../lib/mcpSnippets.ts';
import { useFetch } from '../../useFetch.ts';
import { CodeBlock, CopyBtn } from '../CopyBlock.tsx';
import { ErrorBox, Loading } from '../ui.tsx';

type Agent = 'claudeCode' | 'codex' | 'claudeDesktop' | 'chatgpt';

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="cks-step">
      <span className="cks-n">{n}</span>
      <div className="cks-grow">
        <strong>{title}</strong>
        {children}
      </div>
    </li>
  );
}

export function McpGuide() {
  const info = useFetch('mcpinfo', () => api.mcpInfo());
  const [agent, setAgent] = useState<Agent>('claudeCode');
  const agents: { id: Agent; label: string }[] = [
    { id: 'claudeCode', label: 'Claude Code' },
    { id: 'codex', label: 'OpenAI Codex' },
    { id: 'claudeDesktop', label: uiText('Claude (chat)') },
    { id: 'chatgpt', label: 'ChatGPT' },
  ];

  if (info.error && !info.data)
    return <ErrorBox error={info.error} onRetry={info.reload} compact />;
  if (!info.data) return <Loading />;
  const i = info.data;
  const codex = codexSnippets(i);
  const token = i.http.tokenRequired;

  return (
    <div className="cks">
      <p className="cks-lead">
        {uiText(
          'O Bono tem um servidor MCP: o seu agente de IA lê as suas voltas, sessões e curvas por ele e responde no chat que você já usa. Não precisa de chave de API.',
        )}
      </p>

      <ol className="cks-steps">
        <Step n={1} title={uiText('Escolha o seu agente')}>
          <div className="cks-tabs" role="tablist" aria-label={uiText('Agente de IA')}>
            {agents.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={agent === a.id}
                className="ui-chip"
                data-on={agent === a.id ? '1' : '0'}
                onClick={() => setAgent(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title={uiText('Conecte o Bono uma única vez')}>
          {agent === 'claudeCode' && (
            <>
              <p className="cks-muted">
                {uiText(
                  'Abra o Claude Code: a aba Code do app do Claude, ou digite claude num terminal. Depois cole este comando e aperte Enter:',
                )}
              </p>
              <CodeBlock code={claudeCodeWeb(i)} label={uiText('Comando')} />
              <p className="cks-muted">
                {uiText(
                  'É o endereço web do Bono, sem caminhos do seu PC. O Bono precisa estar aberto. Para conferir, rode claude mcp list: o bono deve aparecer como conectado.',
                )}
              </p>
            </>
          )}
          {agent === 'codex' && (
            <>
              <p className="cks-muted">
                {uiText(
                  'O Codex é o agente de código da OpenAI. Ponha este bloco no arquivo ~/.codex/config.toml e reinicie o Codex:',
                )}
              </p>
              <CodeBlock code={codexWebToml(i)} label="~/.codex/config.toml" />
              {token && (
                <p className="cks-muted">
                  {uiText(
                    'O acesso está protegido por token: defina a variável {0} com o token.',
                    CODEX_TOKEN_VAR,
                  )}
                </p>
              )}
              <p className="cks-muted">
                {uiText(
                  'O Bono precisa estar aberto. Peça "liste as ferramentas do bono" para conferir se conectou. Se a sua versão do Codex não aceitar o endereço (url), use a alternativa abaixo.',
                )}
              </p>
            </>
          )}
          {agent === 'claudeDesktop' && (
            <div className="cks-note">
              <p>
                {uiText(
                  'O chat do app do Claude só conecta por um endereço HTTPS público, que o endereço local do Bono não é.',
                )}
              </p>
              <p>
                {uiText(
                  'O caminho mais simples é o Claude Code (aba Code do mesmo app), que aceita o endereço do Bono. Para o chat, existe a alternativa abaixo, com um comando local.',
                )}
              </p>
            </div>
          )}
          {agent === 'chatgpt' && (
            <div className="cks-note">
              <p>
                {uiText(
                  'O ChatGPT (site e app) só conecta servidores MCP que tenham um endereço HTTPS público. O endereço do Bono é local, então ele não alcança o seu PC.',
                )}
              </p>
              <p>
                {uiText(
                  'O caminho mais simples com a OpenAI é o Codex (aba ao lado) ou usar uma chave de API da OpenAI aqui no Bono.',
                )}
              </p>
              <p className="cks-muted">
                {uiText(
                  'Quem expõe o Bono por um túnel HTTPS por conta própria usa este endereço (com o token, se o acesso estiver protegido):',
                )}
              </p>
              <CodeBlock code={mcpWebUrl(i)} label={uiText('Endereço MCP (web)')} />
            </div>
          )}

          {agent !== 'chatgpt' && (
            <details className="cks-alt">
              <summary>
                {uiText('Alternativa: comando local (funciona com o Bono fechado)')}
              </summary>
              <p className="cks-muted">
                {uiText(
                  'Este modo roda o servidor do Bono no seu PC e por isso leva caminhos da sua instalação, montados automaticamente.',
                )}
              </p>
              {agent === 'claudeCode' && (
                <CodeBlock code={i.claudeCode.stdio} label={uiText('Comando')} />
              )}
              {agent === 'codex' && (
                <>
                  <CodeBlock code={codex.command} label={uiText('Comando')} />
                  <CodeBlock code={codex.toml} label="~/.codex/config.toml" />
                </>
              )}
              {agent === 'claudeDesktop' && (
                <>
                  <p className="cks-muted">
                    {uiText(
                      'Abra Configurações → Desenvolvedor → Editar configuração (ou o arquivo claude_desktop_config.json em %APPDATA%\\Claude) e coloque isto. Depois feche o app do Claude por completo e abra de novo. Se já existir um bloco mcpServers, junte só a entrada bono:',
                    )}
                  </p>
                  <CodeBlock
                    code={JSON.stringify(i.claudeDesktopConfig, null, 2)}
                    label="claude_desktop_config.json"
                  />
                </>
              )}
            </details>
          )}
        </Step>

        <Step n={3} title={uiText('Pergunte em linguagem natural')}>
          <p className="cks-muted">
            {uiText(
              'Peça o que quiser sobre o seu desempenho. O agente busca os números no Bono e responde. Copie uma pergunta e cole no chat dele:',
            )}
          </p>
          <ul className="cks-questions">
            {coachStarters().map((s) => (
              <li key={s.id}>
                <span>{s.question}</span>
                <CopyBtn text={mcpAgentQuestion(s.question)} />
              </li>
            ))}
          </ul>
          <p className="cks-muted">
            {uiText(
              'Também existem os prompts prontos debrief_sessao e foco_curva, que o agente oferece no menu de comandos.',
            )}
          </p>
        </Step>
      </ol>
    </div>
  );
}
