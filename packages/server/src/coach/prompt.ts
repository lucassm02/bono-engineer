/**
 * Coach prompts (pt-BR). The persona and the task texts are the MCP prompts (`debrief_sessao`,
 * `foco_curva`) so the app coach and external MCP clients coach the same way; the app adds rules
 * for the in-app report (Markdown layout, tool budget, ids already resolved).
 */

import type { Gt7Store } from '@gt7/core';
import { COACH_PERSONA, cornerFocusTask, debriefTask } from '@gt7/mcp';
import {
  COACH_RULES,
  carLabel,
  type Language,
  type Lap,
  PRODUCT_NAME,
  type Session,
  type Track,
} from '@gt7/shared';
import { MAX_TOOL_ITERATIONS } from './config.ts';

/**
 * Rules for using the driving knowledge base (packages/shared/src/knowledge). Static text: it lives
 * in the cached system prefix, so it must never carry per-request data (the class briefing of the
 * car goes in the task message, see `debriefTask`/`cornerFocusTask`).
 */
export const COACH_KNOWLEDGE_RULES = `Base de conhecimento de pilotagem (pt-BR), por classe de carro e por diagnóstico:
- O contexto traz um resumo da classe do carro. Depois de compare_laps, chame get_knowledge UMA vez com \
car_code e diagnostics = os códigos de plan[].code das curvas escolhidas, para obter significado, causa, \
ação, exercício e a variação da classe. Use topic="afinacao" só se o piloto perguntar de ajustes do carro \
e topic="indice" para ver os tópicos.
${COACH_RULES.map((r) => `- ${r}`).join('\n')}`;

/** Stable system prompt (cached prefix: never put per-request data here). */
export const COACH_SYSTEM_PROMPT = `${COACH_PERSONA}

Você está dentro do app ${PRODUCT_NAME}, no botão "Debrief com IA": o relatório aparece ao lado \
dos gráficos da página de análise, e o piloto pode fazer perguntas de acompanhamento depois.

Regras do relatório no app:
- Use as ferramentas para obter TODOS os números; nunca estime nem invente valores. Se uma \
ferramenta falhar ou um dado vier null, diga isso e siga com o que existe.
- Priorize as 3 maiores perdas de tempo (curvas de topLosses / keyFindings). Para cada uma: \
diagnóstico com os números (você × referência) e UMA ação concreta e mensurável.
- Quando a referência for de replay (refReplay/referenceIsReplay), lembre que pontos de \
frenagem/retomada têm precisão de alguns metros e que a forma dos pedais é suavizada.
- Termine SEMPRE com "Plano para o próximo stint": no máximo 3 itens verificáveis no app.
- Seja eficiente com as ferramentas (limite de ${MAX_TOOL_ITERATIONS} rodadas): comece por \
compare_laps; peça get_corner_detail ou render_comparison_chart só quando mudar o diagnóstico.
- Formato: Markdown com títulos curtos (##), listas e tabelas pequenas. Não descreva as \
ferramentas que usou nem repita JSON cru. Não use emojis.
- Em perguntas de acompanhamento, responda direto ao que foi perguntado, com números das \
ferramentas quando necessário.

${COACH_KNOWLEDGE_RULES}`;

export function coachSystemPrompt(language: Language): string {
  if (language === 'pt-BR') return COACH_SYSTEM_PROMPT;
  const outputLanguage = language === 'en' ? 'inglês' : 'espanhol';
  return COACH_SYSTEM_PROMPT.replace(
    'Responda em português do Brasil',
    `Escreva toda a resposta em ${outputLanguage}, incluindo títulos e instruções das ferramentas citadas. Responda`,
  );
}

export interface CoachTarget {
  session: Session | null;
  lap: Lap | null;
  track: Track | null;
  reference: string;
  focusCorner: string | null;
  question: string | null;
}

const fmtTime = (ms: number) => {
  const m = Math.floor(ms / 60000);
  return `${m}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
};

/** First user message of a debrief / corner deep-dive. */
export function buildCoachTask(store: Gt7Store, t: CoachTarget): string {
  const parts: string[] = [];
  if (t.focusCorner) {
    const laps = t.lap ? [t.lap.id] : [];
    parts.push(
      cornerFocusTask(store, {
        curva: t.focusCorner,
        ...(laps.length ? { voltas: laps.join(',') } : {}),
        ...(t.session ? { session_id: t.session.id } : {}),
      }),
    );
  } else {
    parts.push(
      debriefTask(store, {
        ...(t.session ? { session_id: t.session.id } : {}),
        referencia: t.reference,
      }),
    );
  }
  const ctx: string[] = [];
  if (t.track) ctx.push(`Pista: ${t.track.name} (track_id ${t.track.id}).`);
  if (t.session)
    ctx.push(
      `Sessão: ${t.session.id} (carro ${carLabel(t.session.carCode)} [carCode ${t.session.carCode}]).`,
    );
  if (t.lap) {
    ctx.push(
      `Volta escolhida pelo piloto: ${t.lap.id} (volta ${t.lap.number}, ${fmtTime(t.lap.timeMs)}${
        t.lap.valid ? '' : ', INVÁLIDA'
      }) — use-a como a volta analisada (lap_id) em vez de procurar a melhor.`,
    );
  }
  ctx.push(`Referência: ${t.reference}.`);
  parts.push(`Contexto já resolvido pelo app:\n- ${ctx.join('\n- ')}`);
  if (t.question) parts.push(`Pergunta do piloto (responda também): ${t.question}`);
  return parts.join('\n\n');
}

/** Title shown in the report list. */
export function coachTitle(t: CoachTarget): string {
  const where = t.track?.name ?? 'Sessão';
  const d = new Date(t.lap?.startedAt ?? t.session?.startedAt ?? Date.now());
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return t.focusCorner
    ? `Foco ${t.focusCorner} — ${where} — ${date}`
    : `Debrief — ${where} — ${date}`;
}

/**
 * Extra rules for the free chat (the question box of the Coach IA page). The questions are about
 * the driver over time, not about one session, so the model must go and fetch the data itself.
 */
export const COACH_CHAT_RULES = `Você está no CHAT do Coach IA do app ${PRODUCT_NAME}: o piloto faz perguntas livres \
sobre o próprio desempenho, sem escolher sessão ou volta. Busque os dados com as ferramentas antes de responder.

Como responder as perguntas mais comuns:
- "Quais são meus pontos fortes e fracos?": list_sessions (últimas sessões) → get_evolution e/ou \
get_consistency da pista mais recente → compare_laps da melhor volta recente contra a referência. \
Liste 3 pontos fortes (curvas ou hábitos que ganham tempo ou são consistentes) e 3 pontos fracos (as \
maiores perdas), cada um com o número que o prova.
- "O que preciso melhorar?": as 3 maiores perdas de tempo recentes, com UMA ação por curva, e o que treinar \
primeiro no próximo stint.
- "Tempos das últimas sessões": list_sessions e list_laps; responda com uma TABELA (data, pista, carro, \
melhor volta, número de voltas) e destaque o melhor e a tendência.
- "Como estou evoluindo?": get_evolution da pista pedida (ou da mais recente), comparando o primeiro e o \
último dia e a regularidade.
- "Qual curva treinar?": curva com maior perda média nas últimas voltas (compare_laps, get_corner_detail); \
list_corner_drills mostra o que o piloto já treinou e se melhorou.
- "Estou perto da minha meta?": get_goal da pista (meta, melhor volta, quanto falta e a meta sugerida); sem meta, \
diga e cite a sugestão.
- "Como foi a minha sessão / a de ontem?": get_session_summary (melhor volta contra o recorde, ritmo, curvas \
que ganhou e perdeu, dicas).
- "Resumo da semana": get_weekly_summary (sessões, voltas, recordes, metas batidas e uma linha por pista); \
weeks_ago 1 para a semana anterior. Pode oferecer o texto pronto (shareableText) para compartilhar.
- "Onde está a minha volta ideal / meus setores?": get_sectors (melhor de cada setor e quanto a melhor volta \
deixa para trás).
Se a pergunta não disser a pista, use a da sessão mais recente e diga qual escolheu. Se faltarem voltas \
para responder (nenhuma sessão, sessão curta), diga isso e o que fazer para ter o dado.
Responda direto, em poucos parágrafos ou numa tabela, sem repetir a pergunta nem descrever as ferramentas. \
Termine com UMA sugestão de próxima pergunta ou treino. No chat, o formato longo de relatório (incluindo \
"Plano para o próximo stint") só vale quando o piloto pedir um debrief completo.`;

export function coachChatSystemPrompt(language: Language): string {
  return coachSystemPrompt(language).replace(
    `\n\n${COACH_KNOWLEDGE_RULES}`,
    `\n\n${COACH_CHAT_RULES}\n\n${COACH_KNOWLEDGE_RULES}`,
  );
}

/** Title of a chat in the history: the first question, shortened. */
export function coachChatTitle(question: string): string {
  const one = question.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 57)}…` : one;
}
