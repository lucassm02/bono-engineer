/**
 * Step-by-step guide to ask the Coach through the driver's own AI agent over MCP (Claude Code,
 * Claude Desktop, OpenAI Codex), with the commands filled in with this installation's real paths,
 * and the questions worth asking. No API key is needed: the agent reads the same data as the app.
 */

import { useState } from 'react';
import { t as uiText } from '../../../lib/i18n.ts';
import '../../../styles/coach-setup.css';
import { api } from '../../api.ts';
import { coachStarters, mcpAgentQuestion } from '../../lib/coachStarters.ts';
import { codexSnippets } from '../../lib/mcpSnippets.ts';
import { useFetch } from '../../useFetch.ts';
import { CodeBlock, CopyBtn } from '../CopyBlock.tsx';
import { ErrorBox, Loading } from '../ui.tsx';

type Agent = 'claudeCode' | 'claudeDesktop' | 'codex' | 'chatgpt';

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
    { id: 'claudeDesktop', label: uiText('Claude (chat)') },
    { id: 'codex', label: 'OpenAI Codex' },
    { id: 'chatgpt', label: 'ChatGPT' },
  ];

  if (info.error && !info.data)
    return <ErrorBox error={info.error} onRetry={info.reload} compact />;
  if (!info.data) return <Loading />;
  const i = info.data;
  const codex = codexSnippets(i);

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
              <CodeBlock code={i.claudeCode.stdio} label={uiText('Comando')} />
              <p className="cks-muted">
                {uiText(
                  'Para conferir, rode claude mcp list: o bono deve aparecer como conectado. Numa conversa nova, o Claude Code já enxerga as ferramentas.',
                )}
              </p>
            </>
          )}
          {agent === 'claudeDesktop' && (
            <>
              <p className="cks-muted">
                {uiText(
                  'No chat do app do Claude, o MCP vem de um arquivo. Abra Configurações → Desenvolvedor → Editar configuração (ou o arquivo claude_desktop_config.json em %APPDATA%\\Claude) e coloque isto:',
                )}
              </p>
              <CodeBlock
                code={JSON.stringify(i.claudeDesktopConfig, null, 2)}
                label="claude_desktop_config.json"
              />
              <p className="cks-muted">
                {uiText(
                  'Feche o app do Claude por completo e abra de novo. Se já existir um bloco mcpServers, junte só a entrada bono.',
                )}
              </p>
            </>
          )}
          {agent === 'codex' && (
            <>
              <p className="cks-muted">
                {uiText(
                  'O Codex é o agente de código da OpenAI. No terminal, rode este comando (ou, se a sua versão não tiver o comando, ponha o bloco no arquivo ~/.codex/config.toml):',
                )}
              </p>
              <CodeBlock code={codex.command} label={uiText('Comando')} />
              <CodeBlock code={codex.toml} label="~/.codex/config.toml" />
              <p className="cks-muted">
                {uiText(
                  'Reinicie o Codex. Peça "liste as ferramentas do bono" para conferir se conectou.',
                )}
              </p>
            </>
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
              <CodeBlock code={i.http.localUrl} label={uiText('Endereço MCP (HTTP)')} />
            </div>
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
