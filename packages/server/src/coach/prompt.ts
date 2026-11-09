/**
 * Coach prompts (pt-BR). The persona and the task texts are the MCP prompts (`debrief_sessao`,
 * `foco_curva`) so the app coach and external MCP clients coach the same way; the app adds rules
 * for the in-app report (Markdown layout, tool budget, ids already resolved).
 */

import type { Gt7Store } from '@gt7/core';
import { COACH_PERSONA, cornerFocusTask, debriefTask } from '@gt7/mcp';
import { carLabel, type Lap, type Session, type Track } from '@gt7/shared';
import { MAX_TOOL_ITERATIONS } from './config.ts';

/** Stable system prompt (cached prefix: never put per-request data here). */
export const COACH_SYSTEM_PROMPT = `${COACH_PERSONA}

Você está dentro do app GT7 Race Engineer, no botão "Debrief com IA": o relatório aparece ao lado \
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
ferramentas quando necessário.`;

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
