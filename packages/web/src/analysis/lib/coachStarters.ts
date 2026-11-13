/**
 * Questions the Coach IA page offers as one-click starters (and the MCP guide offers to copy).
 * They are the things a driver asks most: the coach fetches the real data with the MCP tools, so
 * none of them needs a session or a lap picked first.
 */

import { t as uiText } from '../../lib/i18n.ts';

export interface CoachStarter {
  id: string;
  /** Short label of the button. */
  title: string;
  /** The full question sent to the coach (or copied for an MCP agent). */
  question: string;
}

/** Built on demand so the text follows the interface language. */
export function coachStarters(): CoachStarter[] {
  return [
    {
      id: 'strengths',
      title: uiText('Pontos fortes e fracos'),
      question: uiText(
        'Quais são os meus pontos fortes e os meus pontos fracos? Use as minhas últimas corridas.',
      ),
    },
    {
      id: 'improve',
      title: uiText('O que melhorar primeiro'),
      question: uiText(
        'O que eu mais preciso melhorar? Quero as 3 prioridades, com uma ação para cada.',
      ),
    },
    {
      id: 'sessions',
      title: uiText('Tempos das últimas sessões'),
      question: uiText(
        'Quais foram os tempos das minhas últimas sessões? Mostre uma tabela com a melhor volta de cada uma.',
      ),
    },
    {
      id: 'evolution',
      title: uiText('Minha evolução'),
      question: uiText('Como estou evoluindo na pista que mais treinei, nos últimos dias?'),
    },
    {
      id: 'corner',
      title: uiText('Qual curva treinar'),
      question: uiText('Qual curva eu devo treinar hoje e por quê?'),
    },
    {
      id: 'goal',
      title: uiText('Perto da minha meta?'),
      question: uiText('Estou perto da minha meta de tempo? Quanto falta e o que preciso mudar?'),
    },
    {
      id: 'week',
      title: uiText('Resumo da semana'),
      question: uiText(
        'Faça o resumo da minha semana: recordes, metas batidas e uma linha por pista, pronto para compartilhar.',
      ),
    },
    {
      id: 'consistency',
      title: uiText('Regularidade'),
      question: uiText('Estou regular nas minhas voltas? Onde eu mais oscilo?'),
    },
    {
      id: 'records',
      title: uiText('Meus melhores tempos'),
      question: uiText('Qual é o meu melhor tempo em cada pista, e com qual carro?'),
    },
    {
      id: 'tasks',
      title: uiText('Tarefas para o engenheiro'),
      question: uiText(
        'Proponha tarefas para o engenheiro falar na pista, uma por curva onde mais perco tempo. Eu aprovo no app.',
      ),
    },
    {
      id: 'debrief',
      title: uiText('Debrief da última sessão'),
      question: uiText(
        'Faça o debrief da minha última sessão: o que ganhei, o que perdi e o plano para o próximo stint.',
      ),
    },
  ];
}

/** Opening line for an external agent: tells it to use the Bono tools instead of guessing. */
export function mcpAgentQuestion(question: string): string {
  return `${uiText('Use as ferramentas do servidor MCP "bono" (telemetria do Gran Turismo 7) para responder.')} ${question}`;
}
