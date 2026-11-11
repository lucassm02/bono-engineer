# Spec 05 · Pista no ao vivo: reconhecer, perguntar e guiar a volta de reconhecimento

**Status:** proposta · **Depende de:** [01](01-refinamento-de-ux.md) · **Complementa:** [06](06-escolher-pista-ao-iniciar.md)

## Problema (como funciona hoje, segundo o código)

- O pacote do GT7 **não traz o ID da pista**. O Bono só a identifica pela geometria **quando uma
  volta cronometrada fecha** (`live-engine.ts:1431-1455`): impressão digital da volta contra pistas
  salvas e contra 122 layouts embutidos. Antes disso há só um palpite pela linha de largada, e só
  contra pistas já salvas.
- Numa pista nova são necessárias **duas voltas** para o engenheiro falar: a primeira (cronometrada
  e limpa, depois da volta de saída) cria a pista e o traçado; as curvas são detectadas em segundo
  plano; **delta e instruções só valem a partir da volta seguinte**. Volta suja (com
  descontinuidade) não cria pista.
- O painel ao vivo **nunca mostra o nome da pista**. O cartão "Nova pista detectada — qual é?" só
  existe na Início e na página da pista. O texto "Reconhecendo o traçado" só aparece em Treino +
  Aprender pista; nos outros casos o HUD diz "Rádio pronto" mesmo sem pista.
- Nada explica ao piloto que a primeira volta é de reconhecimento.

Resultado: o piloto não sabe se o Bono o entendeu, nem o que fazer para o engenheiro começar.

## Objetivo

O piloto vê **sempre** em que pista o Bono acha que está, **por que o engenheiro ainda não fala**
e **o que fazer a seguir**, sem ser interrompido na pilotagem. Quando a pista é nova, o app guia
a volta de reconhecimento e depois pergunta qual pista é, de forma opcional.

## 1. Faixa de contexto (sempre visível)

Linha fina no topo do painel (e no cabeçalho do menu), `data-no-gesture`:

`[● Trial Mountain Circuit] [Huracán Gr.4] [Engenheiro: pronto]`

| Parte | Estados |
|---|---|
| **Pista** | nome confirmado · "Reconhecendo a pista…" · "Pista nova" (com ponto âmbar → ver aviso abaixo, usa `--warn`) · "Escolher pista" (toque) |
| **Carro** | nome do catálogo (já existe `carLabel`) |
| **Engenheiro** | Desligado · Aprendendo a pista · Aguardando referência · Pronto · Sem sinal |

Toque na faixa abre a folha "Pista de hoje" (spec 06 e item 3 abaixo).

## 2. Estados do engenheiro, verdadeiros em qualquer modo

Mapear `LiveEngineerFrame.status` para texto e ação em **todos** os modos (hoje só em Aprender
pista):

| Status | Texto | Ação |
|---|---|---|
| `waitingTrack` (pista nova) | "Dê uma volta completa para eu aprender o traçado" | guia (item 4) |
| `waitingTrack` (pista salva, ainda sem laço) | "Reconhecendo a pista… vou confirmar quando você cruzar a linha" | — |
| `waitingReference` | "Preciso de uma volta de referência. Complete uma volta limpa ou grave um replay" | botão "Gravar volta de replay" |
| `incompatible` | "A referência é de outro carro ou traçado" + motivo | "Escolher outra referência" |
| `noCues` | "A referência não tem pontos de orientação confiáveis" | — |
| `ready` | "Engenheiro pronto" | — |
| engenheiro desligado | "Engenheiro desligado" | interruptor |

Remove-se o "Rádio pronto" enganoso (achado A2).

## 3. Guia da volta de reconhecimento (pista nova)

Faixa em três etapas, não bloqueante (`status-banner`):

`① Volta de saída (não conta)  →  ② Volta de reconhecimento  →  ③ Pronto: a próxima volta já tem engenheiro`

- Etapa 1 enquanto a primeira volta cronometrada não começou. Texto: "Faça uma volta de saída."
- Etapa 2 durante a primeira volta cronometrada: "Dê a volta completa, sem sair da pista nem
  reiniciar. É assim que eu aprendo o traçado." Se houver **descontinuidade** (reset, pausa longa,
  saída do carro), mostra no fim: "Essa volta não serviu (você reiniciou). Faça mais uma."
- Etapa 3 ao fechar a volta: o pop-up de volta mostra "Aprendi a pista ✓ — analisando as curvas…"
  e, quando a detecção assíncrona termina, "Curvas prontas. A partir da próxima volta eu te ajudo."
- Se o engenheiro estiver desligado ou for modo Corrida/Classificação, a faixa fica reduzida a
  "Pista aprendida" sem as instruções.

## 4. Pergunta "Qual pista é?" (opcional, sem interromper)

Depois que a pista é criada como **desconhecida** (`source:'auto'`, `confidence` não confirmada):

- Aparece o chip na faixa de contexto: **"Pista nova · Dar nome"** (ponto `--warn`).
- Toque abre a folha **Pista de hoje** (`Modal` side/sheet), com: até 3 sugestões de um clique
  (traçado confere / é essa), busca no catálogo de 122 layouts, "Outra pista…", campo de nome e
  "Agora não". Reutiliza a lógica de `TrackNaming` e `/api/tracks/:id/recognition`.
- **Só pode ser aberta com o carro parado** (velocidade < 10 km/h), em pausa ou no menu. Se o
  piloto tocar andando: "Disponível quando você parar". O chip vira lembrete no resumo da sessão
  e na Início, como hoje.
- Confirmar grava `PATCH /api/tracks/:id` (`source:'user'`) e dispara `refreshTrack`; a faixa
  passa a mostrar o nome e o carro.

## 5. Palpite antecipado pelo catálogo

Hoje `findTrackByStart` só compara com pistas **já salvas**. Estender para o **catálogo
embutido**: ao cruzar a linha de largada pela primeira vez, tentar casar posição + direção com o
`start` dos 122 layouts. Se casar forte e sem ambiguidade, a faixa mostra o nome provável
("Provavelmente *Trial Mountain Circuit* — confirmo ao fechar a volta") e a pergunta do item 4
fica pré-respondida. Falsos positivos não gravam nada; só aparecem como "provável".

## Requisitos

- **RF1.** Componente `LiveContextBar` no painel e no cabeçalho do menu, alimentado por
  `status.sessionCapture` (já traz `trackName` e `carCode`) e `liveEngineer.status`.
- **RF2.** O servidor passa a expor no frame ou no `status` o nome da pista atual, `trackConfidence`
  (`unknown|probable|confirmed`) e `trackSource`; o web deixa de depender de `track.id` só.
- **RF3.** `LiveEngineer`/HUD usam a tabela do item 2 para todos os modos; testes por status.
- **RF4.** `LearningGuide` (item 3) deriva etapa de `lapCount`, `discontinuity` e `curvesReady`;
  novo campo `corners: 'pending'|'ready'` publicado quando `ensureTrackCorners` termina.
- **RF5.** Folha "Pista de hoje" compartilhada com a spec 06; bloqueio por velocidade
  centralizado em um *hook* `useSafeToPrompt()` (parado, pausa, menu).
- **RF6.** Palpite pelo catálogo (item 5) em `core/track` reutilizando `match.ts`; limiares já
  existentes; resultado marcado como `probable` e nunca persistido sem volta fechada.
- **RF7.** Nada disso aparece no modo demonstração e no tour (a menos que o tour o use como passo
  com dados simulados).

## Critérios de aceite

1. Em pista nova, a primeira volta mostra as três etapas e a mensagem correta em cada uma; uma
   volta com reset exibe o motivo e pede outra.
2. Em pista salva, o nome aparece no máximo ao fim da primeira volta (ou ao cruzar a largada, se
   houver palpite) e o engenheiro diz o que falta, em **qualquer** modo.
3. "Rádio pronto" só aparece quando o status é `ready`.
4. A folha "Pista de hoje" nunca abre com o carro andando; nenhum prompt bloqueia a pilotagem.
5. Escolher o nome persiste a pista (`source:'user'`) e a faixa e a Início refletem na hora.
6. Testes: tabela de estados, etapas do guia, palpite pelo catálogo (casa/ambíguo/sem match),
   bloqueio por velocidade.

## Riscos

| Risco | Mitigação |
|---|---|
| Layouts parecidos (reverso, com/sem chicane) levam a palpite errado | Palpite só "provável"; nome só é gravado após a volta fechada e confirmação do usuário (nota de cautela existente). |
| Faixa tira espaço dos números grandes | Altura ≤ 28 px; some em telas pequenas na orientação de corrida; leitura de relance continua intacta. |
| "Pista desconhecida N" se acumulam se ninguém confirma | Lembrete na Início e no resumo; mesclar pistas fica como melhoria futura (não há endpoint hoje). |
