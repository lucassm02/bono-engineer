# Spec: integração com a API GridStats

**Status:** proposta em espera. Nada foi implementado nem testado contra a API real (falta token).
**Fonte:** https://gt-gridstats.com/api-docs (v1.2, 20 endpoints), lida em 2026-11-13. Os exemplos da
página são marcados como "ilustrativos"; os nomes de campo e a estrutura valem para a API real.

## Resumo

A API **não substitui** o DG EDGE (não tem medalhas, top 100/1000, tempo do líder, número de jogadores
nem histórico de semanas). Ela acrescenta o que o Bono não tem: **a posição oficial do piloto** nas
Dailies e nos Time Trials, a prévia da próxima semana e o perfil (DR/SR). O obstáculo é o acesso: a
documentação não diz como obter um token.

## A API em números

- Base `https://gt-gridstats.com`, caminhos `/api/...`. Cabeçalhos `Authorization: Bearer <token>` e
  `Accept: application/json`.
- 10 requisições por minuto nos endpoints medidos, cada um desconta de uma cota (cabeçalhos
  `X-Quota-Limit` e `X-Quota-Remaining`). Só `GET /api/assets/regions` é livre de cota (30/min).
- Consultas em lote: até 16 identificadores (PSN ID ou GUID); acima disso, 422. `not_found` lista o que
  não existe, sem falhar a requisição.
- Tempos `m:ss.mmm`; datas `YYYY-MM-DD HH:MM:SS`; código de país em minúscula (exceto `/api/racers`).
- Erros: 401 token ausente ou inválido, 404 nada ao vivo ou não existe, 422 mais de 16, 429 limite ou cota.

| Grupo | Endpoints | Dados |
|---|---|---|
| Racers (2) | `GET /api/racers/{ids}`, `POST /api/racers` | DR, SR, `last_sync`, `stats` (dr_points, total_races, victories, poles, fastest_laps, clean_races, distance_km, play_time_readable...) |
| Time Trials (3) | `GET /api/tt-live`, `GET /api/tt-live/{psn}`, `GET /api/tt-{eventId}/{ids}` | eventos ao vivo com regras; rank, tempo e carro do piloto; comparação entre pilotos. `score_type` é `time` ou `points` (Drift) |
| Dailies (4) | `GET /api/dailies/this-week`, `GET /api/dailies/next-week`, `GET /api/daily-live/{ids}` | regras (`raw_payload`), uso de carros, prévia, rank, tempo e carro por corrida, `not_run` |
| Campeonatos (3) | `GET /api/series-{n}/drivers/{psn}`, `.../guids/{guid}`, `.../league{n}` | classificação e rodadas |
| Assets (8) | `/api/assets/{manufacturers,tracks,cars,regions...}` | pistas, carros (imagem e classe), fabricantes, nomes traduzidos |

Não existe endpoint de ranking geral: só se consulta por PSN ID conhecido.

## O que o Bono ganharia (por prioridade)

1. **Sua posição nas Daily Races.** No cartão das Dailies: "você está em 1.234º, a 1,1 s do ouro".
   Aviso de corrida ainda não feita (`not_run`). Conferência do tempo oficial contra a melhor volta
   gravada. Usa `GET /api/daily-live/{psn}`. Combina com a meta por medalha da 0.7.0.
2. **Cartão de Time Trial** (área nova). Eventos da semana com regras, sua posição e tempo; comparação
   com amigos (até 16 PSN IDs); tempo de um amigo como meta ou referência. Usa `tt-live`,
   `tt-live/{psn}` e `tt-{id}/{ids}`. Sem líder geral.
3. **Prévia da próxima semana.** Pista e regras de `dailies/next-week`, cruzadas com o histórico do
   piloto naquela pista. Verificar se o DG EDGE já expõe isso.
4. **DR/SR no resumo semanal.** Foto semanal de `/api/racers/{psn}` para mostrar a evolução.

## O que não fazer

- Trocar o DG EDGE pela API (faltam medalhas, top 100/1000, líder, jogadores, histórico).
- Assets de pistas e carros: o Bono já tem comprimento, curvas, elevação e reta mais longa offline
  (gt7info, MIT-0). Imagens de carros seriam só enfeite; não está claro se há idioma pt-BR.
- Campeonatos: fora do escopo de telemetria.

## Desenho proposto

- **Opt-in, desligado por padrão**, com a mesma pergunta única das Dailies. Configurações: PSN ID e
  token (o token como a chave do AI Coach: guardado criptografado no app do Windows, nunca no `.bono`).
- Cliente em `packages/server/src/events/` no mesmo molde de `daily-service.ts`: identifica-se com
  `User-Agent`, uma requisição por vez, cache em disco, no máximo uma consulta por hora por tela,
  recuo de 6 h após falha, 429 respeitado, atualização manual a cada 10 min. Testes com `fetchFn`
  injetado e fixtures no formato da documentação.
- Tipos em `packages/shared/src/` (por exemplo `gridstats.ts`), parser tolerante: `race_type` chega
  como `"A"` numa rota e `"Daily Race A"` em outra; `track_photo` é caminho relativo numa rota e URL
  absoluta em outra; país em maiúscula em `/api/racers`.
- O PSN ID fica só no PC do usuário e é enviado ao GridStats a cada consulta; isso deve estar dito na
  pergunta de ativação. Sem nomes de outros jogadores guardados, exceto os amigos que o próprio usuário
  digitar (Time Trial).
- Falha ou ausência do GridStats nunca afeta telemetria, rádio nem as Dailies do DG EDGE.

## Riscos e pendências

- **Token:** sem processo documentado. Token embutido no instalador estouraria a cota compartilhada;
  o caminho realista é um token por usuário. Pedir ao dono (GT-Skino, gtgridstats@gmail.com, Discord
  https://discord.gg/CKSK9Y2MPS): como obter tokens, custo de cada chamada na cota, período da cota.
- **Termos:** a página não traz termos, licença nem atribuição. Pedir autorização por escrito (o Bono
  é PolyForm Noncommercial) e combinar como creditar a fonte.
- **Unidades não documentadas:** `elevation`, `track_length`, `longest_straight`, `total_credits` e os
  campos numéricos de `raw_payload`.
- **Dependência de terceiro:** perfis com mais de 1 h são ressincronizados com a Sony (3 s por perfil;
  16 perfis podem levar cerca de 48 s). O serviço pode ficar lento ou sair do ar.
- **Pós-token:** validar contra a API real os formatos de `daily-live` (objeto por PSN com 2 ou mais
  IDs, lista com 1) e do `rank` nulo.

## Ordem sugerida

1. Contatar o dono (token, termos, cota).
2. Cliente e tipos com fixtures, mais PSN ID e token nas configurações (opt-in).
3. Posição nas Dailies (item 1).
4. Time Trial (item 2), depois a prévia da próxima semana (item 3).
