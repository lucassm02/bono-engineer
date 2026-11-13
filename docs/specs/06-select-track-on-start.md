# Spec 06 · Escolher a pista ao iniciar a sessão (opcional)

**Status:** proposta · **Depende de:** [05](05-live-track.md) (folha "Pista de hoje", bloqueio por velocidade)

## Problema

A sessão abre sozinha quando o carro entra na pista (`LiveEngine.push`), com `trackId: null`. O
Bono só descobre a pista **quando a primeira volta cronometrada fecha**; até lá não há centerline,
curvas nem referência, então o **engenheiro só começa a ajudar a partir da segunda volta**, mesmo
em uma pista que o piloto já treinou. Hoje não existe como informar a pista: nenhuma rota, mensagem
ou tela (a única escolha manual é a captura de referência por replay).

## Objetivo

Se o piloto **já tem pistas salvas**, oferecer, de forma **opcional e rápida**, dizer em que pista
vai treinar **antes da primeira volta**. Com isso o Bono carrega traçado, curvas e referência
imediatamente e o engenheiro fala **desde a primeira volta**. Quem não escolhe nada continua como
hoje (reconhecimento automático).

## Quando perguntar

O momento ideal é **no menu do jogo, antes de entrar na pista**: o stream é zerado (estado `menu`
do `StatusLayer`) e o piloto está com o controle na mão e a tela livre.

| Momento | O que aparece | Condição |
|---|---|---|
| **No menu/garagem** (`menu`) | Cartão "Qual pista hoje?" na tela de espera: pistas recentes (até 4, com miniatura e melhor volta) + "Outra pista…" + "Reconhecer sozinho" (padrão). | há ≥ 1 pista salva; pergunta ativada |
| **Ao abrir a sessão**, se nada foi escolhido | Chip discreto por 8 s na faixa de contexto: "Pista de hoje? Toque para escolher". Some sozinho; não bloqueia. | há ≥ 1 pista salva; carro parado |
| **A qualquer hora** | Toque na faixa de contexto ou **Menu → Pista de hoje**. | bloqueado com o carro em movimento |

Não pergunta quando: não há pista salva, demonstração, replay ou o piloto escolheu "Reconhecer
sozinho" para esta sessão. Ajuste "Perguntar a pista ao começar" (Configurações → Engenheiro,
padrão **ligado**; "Não perguntar mais" no próprio cartão).

## Como escolher

Folha **Pista de hoje** (a mesma da spec 05): lista ordenada por **uso recente**, filtrada pelo
carro quando a sessão já tem carro conhecido (pistas com voltas do mesmo carro primeiro); busca
por nome; cada linha mostra miniatura do traçado, nome, comprimento e melhor volta. Um toque
seleciona. Mostra também a **referência** que será usada ("Melhor pessoal 1:34,958 · Huracán Gr.4") e
um aviso se não houver referência para o carro ("O engenheiro vai orientar só pelo traçado").

## Comportamento

1. A escolha vira uma **dica de pista** (`trackHint`) guardada no servidor, não uma pista forçada
   às cegas: `{ trackId, setAt, source:'user' }`.
2. Ao abrir a sessão, se há `trackHint` válida, o `LiveEngine` carrega a pista (centerline, curvas,
   setores) e a referência (`loadBestReference`) **antes da primeira volta**, define
   `trackConfidence:'probable'` e a sessão já nasce com `trackId`.
3. **Validação**: ao fechar a primeira volta, a impressão digital é comparada com a pista
   escolhida. Se casa, a confiança vira `confirmed` e nada muda. Se **não** casa (outra pista),
   o app avisa quando o carro parar — "Isso não parece *X*. Trocar para *Y* / manter" — e
   reconcilia a sessão sem perder voltas (spec técnica abaixo).
4. A dica vale até: sessão encerrada, 30 min sem sinal, ou o piloto trocar. Não persiste entre
   dias.
5. Primeira volta com dica: o engenheiro entra em `ready` assim que a posição projeta na
   centerline (limites atuais: < 12 m, v ≥ 8 m/s); nenhuma volta de reconhecimento é necessária.

## Mudanças técnicas

| Camada | Mudança |
|---|---|
| **Servidor, rotas** | `GET /api/session/current` (sessão ativa + contexto); `PUT /api/session/track-hint` `{trackId\|null}`; ambos validam que a pista existe. Mensagem WS equivalente `setTrackHint` para o painel. |
| **core/live-engine** | Novo estado `trackHint`; `#openSession` usa a dica; `identifyOrCreateTrack` valida contra a dica ao fechar a primeira volta; conflito gera evento `trackMismatch`. |
| **Reconciliação** | Se a dica estava errada: atualizar `Session.trackId`, `Lap.trackId` das voltas da sessão, records e referências (`runtime.refreshTrack()`) e invalidar análises em cache (`#invalidateTrackResults`). Fazer em uma transação. |
| **shared** | Tipos `TrackHint`, evento `trackMismatch`, campos `trackConfidence`/`trackSource` no status (spec 05). |
| **web** | Cartão no `StatusLayer` (`menu`), chip de abertura, folha "Pista de hoje", opção em Configurações → Engenheiro, `useSafeToPrompt()`. |

## Requisitos

- **RF1.** Rotas e mensagem WS acima, com validação, testes de contrato e limites (dica expira).
- **RF2.** Sessão com dica nasce com `trackId` e engenheiro operante desde a volta 1; sem dica,
  comportamento atual inalterado.
- **RF3.** Reconciliação atômica e idempotente quando a dica falha; nunca perder voltas.
- **RF4.** Cartão do menu com no máximo 4 pistas + atalhos; teclado e toque; some ao detectar
  carro na pista.
- **RF5.** Sem pista salva ou com "Reconhecer sozinho", nenhum prompt aparece.
- **RF6.** Textos e ações no glossário (spec 01); aparece no tour como dica única.

## Critérios de aceite

1. Com uma pista salva e referência do mesmo carro, escolher a pista no menu faz o engenheiro
   falar **na volta 1**, sem volta de reconhecimento.
2. Escolher uma pista errada e fechar a volta dispara o aviso de divergência (com o carro
   parado) e a sessão termina consistente após a troca (voltas, records e referência corretos).
3. Não escolher nada mantém o fluxo atual (reconhecimento após a primeira volta).
4. Nenhum prompt com o carro em movimento; "Não perguntar mais" persiste.
5. Testes: dica aplicada ao abrir sessão; expiração; divergência com reconciliação; rotas.

## Riscos

| Risco | Mitigação |
|---|---|
| Piloto escolhe uma pista parecida (reverso) e recebe instrução errada | Validação ao fechar a volta + aviso; a primeira volta com dica fala apenas de curvas com confiança. |
| A escolha só vale se feita antes de entrar na pista | O chip na abertura da sessão cobre quem esqueceu (carro parado na grelha). |
| Mudança de `trackId` já persistido | Reconciliação transacional, com backup do banco antes de migrações (regra do projeto). |
