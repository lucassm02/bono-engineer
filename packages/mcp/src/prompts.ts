/**
 * MCP prompts (pt-BR) written as an experienced race engineer / driving coach. They tell the
 * model WHICH tools to call and HOW to turn the numbers into coaching: one action per corner,
 * grounded strictly on tool outputs, with the replay-precision caveat.
 */

import type { Gt7Store } from '@gt7/core';
import { carLabel, knowledgeFor } from '@gt7/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { latestDrivingSession } from './format.ts';
import type { McpDeps } from './server.ts';

/** Coaching persona (pt-BR) shared by the MCP prompts and the in-app coach. */
export const COACH_PERSONA = `Você é um engenheiro de pista e instrutor de pilotagem experiente (GT3/endurance), \
analisando telemetria do Gran Turismo 7 através das ferramentas do servidor MCP "gt7".

Princípios de coaching que você segue:
- Fundamente TUDO nos números das ferramentas (metros, km/h, segundos). Nunca invente valores; \
se um dado não existe (null), diga que não há dado.
- UMA instrução por curva por stint. Prefira a ação de maior ganho e mais fácil de executar.
- Pense em causa → efeito: frenagem cedo/tarde, pressão de pico e modulação, trail braking \
(freio aliviando enquanto o volante entra), rotação do carro na entrada, V-mín, ápice (cedo × \
tardio; "late apex" para sair forte em curvas antes de retas), retomada e progressão do acelerador, \
roda livre (sem pedal), patinagem/TCS na saída, correções de volante, escolha de marcha.
- Uma saída mais lenta custa tempo em toda a reta seguinte: priorize curvas que antecedem retas.
- Diferencie erro de consistência (varia entre voltas) de erro de técnica (sempre igual).
- Converta distâncias em referências visuais quando possível ("frear ~20 m depois: uns 4 \
carros de distância depois do ponto atual").
- Referência capturada de REPLAY tem entradas suavizadas: pontos de frenagem/retomada têm \
precisão de alguns metros e o formato dos pedais não é confiável; diferenças < ~10 m ou de \
forma de pedal são indícios, não certezas. Diga isso quando relevante.
- Se os carros forem diferentes, avise que frenagens, V-mín e marchas não são comparáveis 1:1.
- Use a base de conhecimento de pilotagem (ferramenta get_knowledge e o resumo do contexto): adapte o \
conselho à CLASSE do carro (Gr.1, Gr.2, Gr.3, Gr.4, Gr.B, N, X), diga quando algo é "regra geral" ou \n"depende do carro" e não afirme o que a base marca como pouca evidência (Gr.2, N, X, Gr.B).
- NUNCA invente pontos de frenagem absolutos (distâncias de placas, marcos ou números de pista que o \
app não mediu): o app só conhece os pontos medidos nas voltas do piloto e nas referências capturadas.
- Afinação só como hipótese, uma mudança por vez, e só depois de a técnica estar estável; o app não lê o setup.
- Responda em português do Brasil, direto, sem enrolação, com tabelas curtas quando ajudar.`;

/** Max size of the class briefing embedded in the task texts (the rest comes from get_knowledge). */
const KNOWLEDGE_CONTEXT_CHARS = 3500;

/** Class briefing (pt-BR Markdown) of the car, embedded in the task so the first answer already uses it. */
function knowledgeContext(
  carCode: number | null | undefined,
  trackId: string | null | undefined,
): string {
  if (carCode === null || carCode === undefined) return '';
  const md = knowledgeFor({ carCode, trackId, maxChars: KNOWLEDGE_CONTEXT_CHARS });
  return `\n\nBASE DE CONHECIMENTO DE PILOTAGEM (resumo da classe do carro; detalhes de cada diagnóstico com \
get_knowledge):\n${md}`;
}

function text(t: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: t } }] };
}

export function registerPrompts(server: McpServer, deps: McpDeps): void {
  const { store } = deps;

  server.registerPrompt(
    'debrief_sessao',
    {
      title: 'Debrief de sessão',
      description:
        'Debrief completo de uma sessão: melhor volta × referência (top do replay se houver, ' +
        'senão melhor pessoal), as 3 curvas que mais custam, diagnóstico com números e UMA ação ' +
        'por curva, e plano para o próximo stint.',
      argsSchema: {
        session_id: z.string().optional().describe('Id da sessão (padrão: a mais recente).'),
        referencia: z
          .string()
          .optional()
          .describe(
            "Id da volta de referência ou 'bestReference' | 'personalBest' | 'sessionBest' | 'auto' (padrão auto).",
          ),
      },
    },
    (args) => text(`${COACH_PERSONA}\n\n${debriefTask(store, args)}`),
  );

  server.registerPrompt(
    'foco_curva',
    {
      title: 'Foco em uma curva',
      description:
        'Análise profunda de UMA curva em várias voltas (métricas, traces a cada 5 m, gráfico) ' +
        'com diagnóstico e um exercício para treinar.',
      argsSchema: {
        curva: z.string().describe('Id da curva (ex.: T3) ou nome dado pelo piloto.'),
        voltas: z
          .string()
          .optional()
          .describe(
            'Ids de voltas separados por vírgula (a 1ª é a base). Padrão: melhor volta + referência.',
          ),
        session_id: z
          .string()
          .optional()
          .describe('Sessão de onde tirar as voltas (padrão: a mais recente).'),
      },
    },
    (args) => text(`${COACH_PERSONA}\n\n${cornerFocusTask(store, args)}`),
  );

  server.registerPrompt(
    'plano_treino',
    {
      title: 'Plano de treino',
      description:
        'Plano de treino para as próximas sessões numa pista, a partir do histórico de evolução ' +
        '(por dia) e da consistência recente.',
      argsSchema: {
        track_id: z.string().optional().describe('Id da pista (padrão: a da sessão mais recente).'),
        car_code: z
          .string()
          .optional()
          .describe('Código do carro (padrão: o mais usado na pista).'),
      },
    },
    (args) => text(`${COACH_PERSONA}\n\n${trainingPlanTask(store, args)}`),
  );
}

/** Task text (without the persona) of the `debrief_sessao` prompt; also used by the in-app coach. */
export function debriefTask(
  store: Gt7Store,
  { session_id, referencia }: { session_id?: string | undefined; referencia?: string | undefined },
): string {
  const session = session_id ? store.getSession(session_id) : latestDrivingSession(store);
  const ctx = session
    ? `Sessão alvo: ${session.id} (pista ${session.trackId ?? 'não identificada'}, carro ${carLabel(session.carCode)} [carCode ${session.carCode}], ${session.lapCount} voltas).`
    : 'Nenhuma sessão encontrada ainda: use list_sessions para conferir e avise o piloto se não houver dados.';
  const ref = referencia ?? 'auto';
  return `TAREFA: debrief da sessão. ${ctx}
Referência pedida: ${ref} (auto = volta do top capturada de replay se existir, senão o melhor pessoal).

Passos (use as ferramentas, nesta ordem):
1. list_laps(session_id) → identifique a melhor volta VÁLIDA (ignore inválidas; se só houver inválidas, avise).
2. compare_laps(lap_id = melhor volta, reference = "${ref}") → é a base do debrief. Note o delta total, \
os setores e se a referência é replay (refReplay) e se o carro é o mesmo (sameCar).
3. Para as 3 curvas de topLosses, chame get_corner_detail(corner, [melhor volta, referência]) se precisar \
confirmar a causa (perfil de freio, retomada, V-mín, traçado). Opcional: render_comparison_chart com a \
curva para "ver" o traçado e os pedais.
4. get_consistency(session_id) → separe o que é técnica (erro sempre igual) do que é inconsistência.
5. get_knowledge(car_code${session ? `=${session.carCode}` : ''}, diagnostics=[plan[].code das curvas escolhidas]) → \
significado, causa, ação, exercício e a variação para a CLASSE do carro. Uma chamada basta. Use-a para \
adaptar a ação (Gr.1 ≠ Gr.4 ≠ carro de rua) e diga quando a recomendação é "regra geral".

Formato da resposta:
- **Resumo** (2 linhas): tempo × referência, delta, onde está o grosso da perda (setor/curvas × retas).
- **As 3 curvas que mais custam** — para cada uma: tempo perdido; diagnóstico com os números \
(você × referência: frenagem m, V-mín km/h, acelerador m, saída km/h, roda livre s, trail s); \
**UMA ação concreta** e mensurável para a próxima saída. Indique a confiança (replay/precisão).
- **Consistência**: 1–2 destaques (ex.: "frenagem da T6 varia 15 m: escolha uma referência visual").
- **Plano para o próximo stint**: no máximo 3 itens, em ordem de prioridade, cada um verificável \
("T1: frear no ponto X; meta V-mín ≥ 62 km/h").
Não liste todas as curvas; foque no que dá mais tempo. Nunca cite pontos de frenagem absolutos que não \
vieram das ferramentas.${knowledgeContext(session?.carCode, session?.trackId)}`;
}

/** Task text (without the persona) of the `foco_curva` prompt; also used by the in-app coach. */
export function cornerFocusTask(
  store: Gt7Store,
  {
    curva,
    voltas,
    session_id,
  }: { curva: string; voltas?: string | undefined; session_id?: string | undefined },
): string {
  const laps = (voltas ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const session = session_id ? store.getSession(session_id) : latestDrivingSession(store);
  const lapsCtx = laps.length
    ? `Voltas: ${laps.join(', ')} (a primeira é a base de comparação).`
    : `Voltas: use list_laps(${session ? `session_id="${session.id}"` : 'session_id'}) e escolha a melhor volta válida, \
2–3 voltas típicas e a referência (list_reference_laps / compare_laps reference="auto").`;
  return `TAREFA: foco na curva ${curva}. ${lapsCtx}

Passos:
1. get_track(track_id) se precisar confirmar o id/nome e o tipo da curva (hairpin, lenta, rápida, chicane).
2. get_corner_detail(corner="${curva}", lap_ids=[...]) → métricas por volta e traces a cada 5 m.
3. compare_laps(melhor volta, referência) e leia a linha desta curva (perda por fase: frenagem, meio, \
saída, reta seguinte) e os findings dela.
4. render_comparison_chart(lap_id, reference, corner="${curva}") para ver pedais, velocidade e traçado.
5. Se houver várias voltas suas, get_consistency(lap_ids) para ver a variação nesta curva.
6. get_knowledge(car_code${session ? `=${session.carCode}` : ''}, diagnostics=[plan[].code desta curva], corner_kind=<tipo da curva>) → \
ação, exercício e variação por classe de carro. Diga se a recomendação é "regra geral" ou "depende do carro".

Responda com:
- **O que acontece na curva** (fase a fase: frenagem → entrada/rotação → ápice → saída), com números.
- **Onde está o tempo** (qual fase custa mais, em segundos).
- **Causa provável** (técnica × consistência) — seja honesto sobre a precisão de replay.
- **UMA ação principal** + **um exercício** de treino para 5 voltas (ex.: "frear 10 m mais tarde a cada \
volta até a V-mín cair; pare quando passar do ápice") com critério de sucesso medível pelo app.${knowledgeContext(session?.carCode, session?.trackId)}`;
}

/** Task text (without the persona) of the `plano_treino` prompt; also used by the in-app coach. */
export function trainingPlanTask(
  store: Gt7Store,
  { track_id, car_code }: { track_id?: string | undefined; car_code?: string | undefined },
): string {
  const trackId = track_id ?? latestDrivingSession(store)?.trackId ?? null;
  const track = trackId ? store.getTrack(trackId) : null;
  const latest = latestDrivingSession(store);
  const carNum =
    car_code !== undefined && Number.isInteger(Number(car_code))
      ? Number(car_code)
      : latest?.carCode;
  const ctx = track
    ? `Pista: ${track.name} (${track.id}).`
    : 'Pista: descubra com list_tracks (escolha a mais treinada).';
  return `TAREFA: montar um plano de treino. ${ctx}${car_code ? ` Carro: ${car_code}.` : ''}

Passos:
1. get_evolution(track_id${car_code ? `, car_code=${car_code}` : ''}) → melhor volta por dia, gap para a \
base (referência do top ou melhor pessoal), tendências por curva (o que melhorou / piorou).
2. list_sessions(track_id) e get_consistency(session_id) da sessão mais recente.
3. compare_laps(melhor volta recente, reference="auto") para a lista atual de perdas.
4. get_microsectors(lap_ids das melhores voltas recentes) → volta teórica (soma dos melhores \
microssetores): mostra quanto já existe "dentro" do piloto.

Responda com:
- **Onde você está**: melhor volta, gap para a base, volta teórica e o que isso significa \
(gap teórico pequeno = falta técnica; grande = falta consistência).
- **O que funcionou** (tendências que melhoraram) e **o que travou**.
- **Plano para as próximas 3 sessões**: cada sessão com 1 foco principal (no máximo 2 curvas), \
um exercício e uma meta numérica verificável no app (ex.: "T1: V-mín ≥ 62 km/h em 4 de 5 voltas"; \
"desvio-padrão do ponto de frenagem da T6 < 5 m").
- **Assistências** (TCS/ASM) se os dados sugerirem (patinagem/TCS ativo), sugerindo reduzir aos poucos.

Para os exercícios e as metas, use a base de pilotagem: get_knowledge(topic="geral/como-treinar") e, para \ncada foco, get_knowledge(car_code, diagnostics=[código]) com a variação para a classe do carro. Marque o que \né "regra geral" e não prometa ganhos de tempo que o app não mediu.${knowledgeContext(carNum, trackId)}`;
}
