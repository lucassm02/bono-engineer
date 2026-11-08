# Guia de pilotagem: lendo as métricas do app

Este guia explica **o que o app calcula** em cada curva, **o que isso significa** na pista e **como treinar**.
Os nomes e limiares são os do código (`packages/shared/src/analysis.ts` e `packages/analysis/src/findings.ts`), então
o que você lê aqui é o que aparece na tabela de curvas, em "O que treinar", no Treino de curva e no coach.

## Antes de tudo: como ler o que o app mostra

- **Você × referência.** Toda métrica é comparada com uma volta de referência: a de um piloto do top (capturada
  do replay), a sua melhor volta ou a melhor da sessão. Quando você não escolhe, a referência é automática
  (top → melhor pessoal → melhor da sessão).
- **Sinal do tempo:** **positivo = você mais lento** (perdeu tempo), negativo = ganhou. Vale para o delta ao vivo,
  a coluna **Tempo** da tabela e os setores.
- **Zona da curva:** o tempo de uma curva é medido da zona de frenagem até a saída (+50 m), e as zonas não se
  sobrepõem. A soma das curvas e das retas dá exatamente o delta total da volta.
- **Custo "≈ 0,17 s":** estimativa de quanto aquele diagnóstico custa. A perda de cada fase (frenagem, meio da
  curva, saída, reta seguinte) é repartida entre os diagnósticos daquela fase conforme a gravidade. Não é uma
  medida exata: serve para **ordenar** o que atacar primeiro.
- **Confiança (alta/média/baixa):** vem da gravidade (diferença ÷ limiar). Diferença pequena ou custo menor que
  15 ms nunca passa de média. Contra referência de **replay**, diagnósticos de *forma* de pedal/volante perdem um
  nível e os de distância menor que 10 m também, porque o replay é suavizado e a precisão é de poucos metros.
- **Uma ação por diagnóstico.** O app só mostra o diagnóstico mais caro de cada curva em "O que treinar".
- **Métrica vazia ("–") não é zero:** ela não pôde ser calculada (por exemplo, volante no formato A, ou curva sem
  freada).
- **Distâncias** são em metros ao longo da volta, medidas na linha da pista, comparáveis entre voltas.

Siga **uma coisa de cada vez**: as métricas se influenciam (frear mais tarde muda a V-mín, que muda a saída).
Veja a rotina sugerida no fim.

---

## Frenagem

### Ponto de frenagem

- **O que o app mostra:** coluna **Frenagem** (m): a distância da volta em que o freio passa de **5%**. A
  diferença é positiva se você freia **mais tarde** que a referência (zona morta: 5 m). Diagnóstico `brakeEarlier`
  ("Você freia 18 m antes da referência na T1") quando você freia **≥ 5 m** antes, junto de um **marco** (distância
  arredondada de 5 em 5 m antes da entrada da curva). O contrário, `brakeLater`, só aparece se você freia ≥ 5 m
  depois **e** chega ao ápice ≥ 2 km/h mais lento, perdendo tempo.
- **O que significa:** freando cedo demais você gasta metros de reta em velocidade baixa; freando tarde demais
  não consegue girar o carro e perde na V-mín e na saída. O ponto "certo" é o mais tarde em que ainda dá para
  chegar ao ápice na velocidade da referência.
- **Como treinar:** use o **marco** em termos visuais (placa de 100 m, início da zebra, um poste) e anote-o na
  página da pista (campo de **marco de frenagem** da curva). Antecipe a frenagem em **5 m por volta** até
  achar o limite; na tela **Treino de curva** a meta de frenagem aparece com uma contagem regressiva em metros.

### Pico e liberação do freio

- **O que o app mostra:** `peakBrake` (pico de pressão), tempo até o pico, ponto de **liberação** do freio e
  duração da frenagem (no detalhe da curva, MCP e coach). Diagnóstico `softBraking` quando a referência crava
  ≥ 50% e você fica **12 pontos percentuais** abaixo (20 pp se a referência é replay): "Pico de freio de 70%, contra 95%".
- **O que significa:** frear forte e cedo (o pico logo no início) usa toda a aderência para reduzir a
  velocidade; subir o freio devagar desperdiça distância. A **liberação** progressiva é o que prepara a entrada.
- **Como treinar:** pise **firme e rápido** no começo (sem travar) e vá **aliviando** conforme a velocidade cai.
  Em carros com ABS, o limite é o pedal onde a roda não trava (veja travamento abaixo).

### Trail braking

- **O que o app mostra:** coluna **Trail** (s): tempo em que o freio ainda está aplicado **enquanto o volante
  já gira** (volante, ou a guinada se não houver volante, ≥ 25% do pico da curva). Diagnóstico `noTrailBraking`
  quando a referência faz ≥ 0,25 s e você faz **menos de 40%** disso ("Solta o freio antes de virar na T3").
- **O que significa:** soltar todo o freio antes de virar deixa o carro sem peso na dianteira (subesterço na
  entrada) e a frenagem acaba antes do necessário. Um resto de freio na entrada coloca peso na frente e ajuda a
  fechar a trajetória.
- **Como treinar:** em 3 ou 4 curvas lentas/médias, mantenha um pouco de freio **até perto do ápice** e vá
  aliviando à medida que aumenta o volante. Cuidado: se a traseira começar a sair, você está soltando tarde
  demais ou com freio demais.

## Meio da curva

### V-mín (velocidade mínima) e ápice

- **O que o app mostra:** coluna **V-mín** (km/h) e o local onde ela ocorre. Diagnósticos: `lowerMinSpeed`
  (**≥ 2 km/h** abaixo), `higherMinSpeed` (≥ 3 km/h acima, mas a saída é ≥ 3 km/h mais lenta) e, só em curvas
  curtas (**≤ 80 m**), `earlyApex`/`lateApex` quando seu ápice (local da V-mín) está **≥ 15 m** antes ou depois
  do da referência. O app também mostra a **marcha no ápice** (`gearChoice` quando difere).
- **O que significa:** V-mín baixa costuma ser **freio demais** ou soltar o freio cedo demais. Ápice cedo
  ("tangenciar cedo") obriga a esperar para acelerar; ápice tarde permite acelerar mais cedo, até o limite em
  que você abre demais na saída.
- **Como treinar:**
  - V-mín baixa: alivie o freio **mais cedo** no fim da frenagem e carregue velocidade até o ápice.
  - Ápice cedo: vire **um pouco mais tarde** para mirar um ápice mais adiante.
  - V-mín alta mas saída lenta (`higherMinSpeed`): entre **um pouco mais devagar** para endireitar o carro e
    acelerar mais cedo. Rápido no ápice não é rápido se atrasa a saída.
  - Marcha: se a referência usa uma marcha acima/abaixo, experimente a mesma e veja a saída.

## Saída

### Retomada do acelerador

- **O que o app mostra:** coluna **Retomada** (m): onde o acelerador passa de **10%** depois da V-mín. Diferença
  negativa = você acelera **antes** (zona morta: 8 m). Diagnóstico `lateThrottle` quando você acelera
  **≥ 8 m** depois ("Acelera 25 m depois da referência na T5").
- **O que significa:** cada metro de atraso é tempo sem aceleração. Quem retoma cedo e progressivo ganha na
  reta seguinte (veja velocidade de saída).
- **Como treinar:** volte ao acelerador **logo após o ápice**, de forma progressiva, mesmo que seja 10–20%
  ("acelerador de manutenção"). Na tela **Treino de curva**, a meta de retomada aparece em vermelho se você
  retoma mais de **8 m** depois.

### Roda livre (coasting)

- **O que o app mostra:** coluna **Roda livre** (s): tempo com **freio e acelerador abaixo de 2%** dentro da
  curva (zona morta: 0,1 s). Acelerador de manutenção não conta. Diagnóstico `coasting` quando você passa de
  **0,25 s** e tem **0,15 s a mais** que a referência.
- **O que significa:** o carro não está nem freando nem acelerando: é tempo "jogado fora" entre o fim da
  frenagem e a retomada.
- **Como treinar:** **emende** os pedais: libere o freio ao mesmo tempo em que começa a dar um pouco de
  acelerador. Se você solta o freio e "espera" o carro girar, você está em roda livre.

### Velocidade de saída

- **O que o app mostra:** coluna **Saída** (km/h): velocidade **50 m depois** da saída da curva (zona morta:
  3 km/h). Diagnóstico `slowerExit` quando fica **≥ 3 km/h** abaixo: "custa tempo em toda a reta seguinte".
  O tempo da reta seguinte aparece como **retas** no cabeçalho da comparação.
- **O que significa:** a saída é a métrica mais valiosa para curvas que levam a uma reta longa; um km/h a
  mais na saída rende em toda a reta.
- **Como treinar:** priorize a saída: **ápice um pouco mais tarde** e acelerador mais cedo. Se a V-mín for
  menor, mas a saída melhorar, o trade-off vale.

## Traçado e estabilidade

### Traçado (desvio lateral)

- **O que o app mostra:** coluna **Traçado** (m): desvio lateral do seu traçado em relação à linha da
  referência na **entrada / ápice / saída**, com **+ = à esquerda**. Fica destacado a partir de **1,2 m**.
  Diagnóstico `lineOffset` quando: na **entrada** você está ≥ 1,2 m mais **para dentro**; no **ápice** ≥ 1,2 m
  mais **por fora**; na **saída** ≥ 1,2 m para dentro ou ≥ 2,5 m mais **aberta**.
- **O que significa:** entrar "para dentro" encurta a curva mas força um ápice cedo; ápice por fora é uma
  curva mais longa e lenta. O traçado é uma ferramenta para acelerar mais cedo na saída, não um fim.
- **Como treinar:** **abra** mais na entrada (perto da borda externa antes de virar), **feche** no ápice rente à
  zebra interna e **use toda a pista** na saída. Veja o **mapa** da comparação (suas linhas × referência) e dê
  zoom na curva.

### Patinagem na saída e travamento

- **O que o app mostra:** `rearSlipPeak` (patinagem traseira), tempo de **TCS** ativo e `frontLock` (travamento
  da dianteira). Diagnósticos: `exitSlip` quando o TCS atua **≥ 0,15 s** a mais que a referência, ou a patinagem
  sobe **5 pontos percentuais** (e passa de 10%); `frontLock` quando as rodas da frente ficam **≥ 0,08 s** com
  escorregamento abaixo de **−12%** (e 0,05 s mais que a referência). Na tela **Pneus**, o aviso ao vivo
  acende a partir de 8% (alerta 18%).
- **O que significa:** patinagem na saída = acelerador demais, cedo demais ou com volante ainda muito virado;
  travamento da frente = frenagem passou do limite de aderência (e o carro não gira).
- **Como treinar:** **dose** o acelerador, abrindo progressivamente enquanto o volante desfaz; e **module** o pico
  de freio quando sentir a roda travar (alivie um pouco o pico, mantenha o freio por mais tempo).

### Correções de volante

- **O que o app mostra:** `steeringCorrections` (apenas formatos B, `~` e C, que trazem o volante): inversões em
  zigue-zague de **mais de 0,15 rad**, menos a inversão natural de uma curva limpa. Diagnóstico quando há **≥ 4**
  e **3 a mais** que a referência.
- **O que significa:** o carro está pedindo correções: a traseira escapa ou a entrada foi agressiva demais.
- **Como treinar:** **uma entrada só e constante** no volante; se a traseira escapa, entre mais devagar ou
  trabalhe o freio/acelerador (trail braking exagerado, acelerador abrupto) antes de mexer no volante.

## Consistência

- **O que o app mostra:** na página da pista (**Consistência e evolução**) e no `get_consistency` do MCP:
  média e desvio por curva. Os **destaques** ordenam o que mais varia, com um limiar de "1 unidade de
  inconsistência" para cada métrica: ponto de frenagem **5 m**, V-mín **3 km/h**, retomada **8 m**, saída **3 km/h**,
  roda livre **0,2 s**, tempo na curva **0,08 s**, local do ápice **12 m**, pico de freio **0,1**. Exemplo: "Ponto
  de frenagem na T6 varia 15 m entre as voltas". Só voltas válidas entram (se houver menos de 2, usa todas).
- **O que significa:** o tempo que você perde por **variar** é diferente do que perde por **técnica**. Se o
  seu ponto de frenagem varia 15 m, não adianta mudar a técnica; falta uma **referência visual**. Já uma diferença
  fixa e repetida (sempre 10 m cedo) é técnica.
- **Como treinar:** primeiro **repita** (mesmo marco, mesma marcha, mesmo ponto de saída) por 5 a 10 voltas;
  depois mude a técnica. Use a evolução por dia para ver se o desvio está caindo.

---

## Como usar o que o app mostra

### Treino de curva (painel ao vivo)

Ligue a tela **Treino de curva** (segure a tela › ligue na lista de "Desligadas"). Ela mostra a **próxima curva**,
a distância até a frenagem da referência, as **metas** (frenagem, V-mín, retomada) e, depois de passar, a
**última passagem** com cada item em vermelho/neutro:

- **Frenagem:** tolerância de **±5 m**. Freio **cedo** = vermelho; freio tarde é só informativo.
- **V-mín:** tolerância de **−2 km/h** (V-mín baixa = vermelho).
- **Retomada:** tolerância de **+8 m** (retomada tarde = vermelho).

Sem referência, compara com a sua **passagem anterior** (cinza). **Fixar esta curva** prende a tela numa curva
só; **Áudio** (voz em português, desligado por padrão) diz no máximo uma frase por passagem. Como não há tempo
para ler no meio da curva, use a tela em **retas e depois da curva** ou ligue o áudio.

### Comparação (pós-sessão)

Abra `#/analise` › sessão › marque a sua volta e a referência › **Comparar**.

1. Veja o **delta total** e os **setores**: em qual terço da volta você perde.
2. No gráfico de **delta acumulado**, procure as inclinações (descidas = ganhando, subidas = perdendo).
3. Em **O que treinar**, leia os 3 primeiros itens (custo ≈ s, ação e confiança). Clique em **Ver no gráfico**
   para o zoom da curva: compare velocidade, freio e acelerador **sobrepostos**.
4. Use a **tabela de curvas** ordenada por **Mais tempo perdido**: cada célula tem *você · referência ·
   diferença* (verde = a seu favor, vermelho = custa tempo).
5. **Volta ideal**: a soma dos melhores microssetores/setores das suas voltas mostra quanto tempo existe em
   juntar o que você já fez bem.

### Coach (IA)

**Debrief com IA** (ou o MCP) lê as mesmas métricas: 3 maiores perdas, números e **uma ação por curva**, mais o
plano do próximo stint. Peça sempre para **focar numa curva** ("foco na T3, por que perco na saída?") ou use o
prompt `plano_treino`. Se a referência for de replay, o coach avisa que a precisão é de poucos metros.

---

## Rotina de treino sugerida

**Regra: uma mudança por stint.** Um stint = 8 a 10 voltas seguidas na mesma pista e carro. Mudar duas coisas ao
mesmo tempo impede de saber o que funcionou.

1. **Preparação (uma vez por pista/carro):** capture uma referência do top (fluxo (b) do README) ou use a sua
   melhor volta; faça 5 voltas de **aquecimento** só para o app reconhecer a pista e detectar as curvas. Dê nomes
   às 3 curvas mais importantes e anote o marco de frenagem de cada uma.
2. **Stint 1 (diagnóstico):** pilote natural, 8–10 voltas. No fim, abra a **comparação** e o **debrief**. Escolha
   **uma** curva (a mais cara em "O que treinar") e **uma** métrica (ex.: ponto de frenagem da T1).
3. **Stint 2 (uma mudança):** deixe a tela **Treino de curva** com **Fixar esta curva** nessa curva (ou o
   delta grande). Só mude aquela métrica (por exemplo, freie 5 m mais tarde por volta). Anote como o carro
   reagiu.
4. **Revisão (5 min):** compare a melhor volta do stint com a referência; a métrica melhorou? O tempo da curva
   caiu? Se o custo da curva diminuiu e a consistência não piorou, **fixe** o novo padrão (nova nota de marco).
   Se piorou, volte atrás.
5. **Stint 3 (consistência):** repita sem mudar nada, 8–10 voltas. Veja em **Consistência** se o ponto de frenagem
   e a V-mín têm desvio abaixo dos limiares (5 m / 3 km/h). Só então vá à próxima curva da lista.
6. **Acompanhe a evolução por dia** (página da pista): a melhor volta, a média das 3 melhores e o desvio-padrão
   devem cair com o tempo; o gap para o top também.

Dicas para o dia a dia:

- Mantenha **carro, acerto e pneus** fixos durante o treino; a referência só serve com o mesmo carro (o app avisa).
- Comece pelas **curvas que levam a retas longas** (saída vale mais) e pelas de **maior custo**.
- Voltas inválidas (pausa, saída de pista, dados perdidos) ficam fora dos recordes e da consistência.
- Quando a diferença é de poucos metros contra uma referência de **replay**, trate como "tendência", não como
  fato. Confie nas grandes diferenças (frear 20 m cedo, 8 km/h a menos no ápice).
