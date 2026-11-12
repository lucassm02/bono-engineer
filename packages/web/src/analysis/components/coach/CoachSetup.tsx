/**
 * First use of the Coach IA: two ways to get answers. Through the driver's own AI agent over MCP
 * (no key; the guide teaches how to connect it) or with an API key (Claude or OpenAI) to chat right
 * here. Shown while no key is set, and reachable later from the chat header.
 */

import type { CoachConfig } from '@gt7/shared';
import { useState } from 'react';
import { Icon } from '../../../components/ui/Icon.tsx';
import { t as uiText } from '../../../lib/i18n.ts';
import '../../../styles/coach-setup.css';
import { Panel } from '../Panel.tsx';
import { KeySetup } from './KeySetup.tsx';
import { McpGuide } from './McpGuide.tsx';

export type SetupMode = 'mcp' | 'key';

export function CoachSetup({
  config,
  onConfig,
  initial = null,
  onClose,
}: {
  config: CoachConfig;
  onConfig: (c: CoachConfig) => void;
  initial?: SetupMode | null;
  /** Shown when the setup was opened from the chat (to go back to it). */
  onClose?: () => void;
}) {
  const [mode, setMode] = useState<SetupMode | null>(initial);

  if (mode) {
    return (
      <Panel
        tone="accent"
        title={
          mode === 'mcp'
            ? uiText('Conectar pelo seu agente de IA (MCP)')
            : uiText('Usar uma chave de API')
        }
        description={
          mode === 'mcp'
            ? uiText('Passo a passo para perguntar ao seu agente, sem chave de API.')
            : uiText('Depois de salvar, o chat do coach aparece aqui no Bono.')
        }
      >
        <div className="cks-back">
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            data-size="sm"
            onClick={() => {
              if (initial && onClose) onClose();
              else setMode(null);
            }}
          >
            <Icon name="back" size={14} />
            {initial && onClose ? uiText('Voltar ao chat') : uiText('Voltar')}
          </button>
        </div>
        {mode === 'mcp' ? <McpGuide /> : <KeySetup config={config} onChange={onConfig} />}
      </Panel>
    );
  }

  return (
    <Panel
      tone="accent"
      title={uiText('Como você quer usar o coach de IA?')}
      description={uiText(
        'O coach lê as suas voltas, sessões e curvas e responde em linguagem natural. Escolha um caminho:',
      )}
    >
      <div className="cks-choices">
        <button type="button" className="cks-choice" onClick={() => setMode('mcp')}>
          <span className="cks-choice-icon" aria-hidden="true">
            <Icon name="coach" size={22} />
          </span>
          <strong>{uiText('Pelo meu agente de IA (MCP)')}</strong>
          <span>
            {uiText(
              'Sem chave. Você conversa no Claude Code ou no Codex, e ele lê os seus dados do Bono. Mostramos o passo a passo.',
            )}
          </span>
          <span className="cks-choice-go">{uiText('Ver o passo a passo')}</span>
        </button>
        <button type="button" className="cks-choice" onClick={() => setMode('key')}>
          <span className="cks-choice-icon" aria-hidden="true">
            <Icon name="radio" size={22} />
          </span>
          <strong>{uiText('Com uma chave de API')}</strong>
          <span>
            {uiText(
              'Pergunte aqui dentro, num chat do Bono. Funciona com Claude (Anthropic) ou OpenAI, e você escolhe o modelo.',
            )}
          </span>
          <span className="cks-choice-go">{uiText('Configurar a chave')}</span>
        </button>
      </div>
    </Panel>
  );
}
