# Spec do engenheiro de rádio do Bono

**Status:** implementada no app. A calibração de pneus, fases de classificação e janelas de
fala em sessão ao vivo segue pendente de validação com o PS5.

## Objetivo

Dar ao sim racer a instrução que ajuda na próxima ação, no momento em que ele pode usá-la.
Treino orienta e corrige. Classificação protege a concentração. Corrida avisa o que muda uma
decisão. Quando tudo corre bem, o piloto pode passar a volta inteira em silêncio.

Todos os modos, inclusive a análise e o resumo de fim de volta, funcionam **sem agente de IA
conectado**. O motor decide com regras determinísticas sobre telemetria, estado da sessão,
referência e preferências. As falas vêm de frases prontas, com campos calculados pelo Bono,
reproduzidas com clipes neurais pré-gerados e distribuídos com o app. O catálogo e a migração
estão na [spec de vozes neurais](neural-voices-spec.md). O coach conversacional é separado.

## Modos e configurações

| Modo | Antes da curva ou da volta | Durante | Depois |
|---|---|---|---|
| **Treino** | Conforme o perfil abaixo | Conforme o perfil abaixo | Correção, resumo ou silêncio conforme o perfil |
| **Classificação** | Na volta de preparação, avisar sobre pneus frios quando confirmado | Silêncio durante a volta rápida por padrão, salvo alertas críticos | Resultado curto na primeira janela livre, como “Melhorou dois décimos” |
| **Corrida** | Condição do próprio carro quando exigir ação | Pneus, autonomia e estratégia quando mudarem uma decisão | Análise de pilotagem disponível na revisão |

Modo, referência e nível de fala são escolhas separadas. **Essencial** é o padrão.
**Detalhado** libera mais orientação elegível com as mesmas regras de prioridade e janela.
**Mudo** silencia o áudio e mantém o painel. Preservar volume, voz, ritmo e seleção do aparelho
que toca o rádio. Permitir configurar a frequência do resumo e o reforço positivo separadamente.
O piloto seleciona o modo. Quando a fase dentro do modo for desconhecida, usar o comportamento
mais silencioso até haver dados suficientes para distingui-la.

### Perfis de Treino

| Perfil | Comportamento |
|---|---|
| **Aprender pista** | Em curvas selecionadas, antecipar uma instrução de cada vez, como ponto de freada ou marcha. Usar a melhor volta pessoal compatível por padrão e permitir escolher replay ou volta importada. Se faltar uma referência, pedir uma primeira volta válida no painel. |
| **Ganhar tempo** | Para quem já conhece a pista. Escolher uma prioridade por bloco, com opção de focar em até duas curvas. Intervir em erro relevante e ficar em silêncio nas passagens boas. |
| **Consistência** | Definir um ritmo-alvo ou uma execução para repetir. Medir dispersão e aderência à meta nas voltas válidas. Resumir no fim do bloco, sem comentar oscilações a cada passagem. |
| **Livre** | Tocar somente alertas essenciais do carro. Deixar a análise disponível sob demanda. |

#### Aprender pista

- Nas instruções de freada, **Básicas** usa a intensidade qualitativa. **Detalhadas** diz o
  pico do pedal da referência arredondado a dezenas de pontos percentuais, por exemplo
  “Cinquenta por cento de freio em cem metros”. Quando o pico não é confiável ou a frase
  longa não cabe, usa a instrução básica se ainda houver tempo.

- Alinhar a posição atual com a referência. Combinar distância, velocidade atual, duração
  estimada da frase e tempo de reação para programar a chamada.
- Usar “Freio na placa dos 200” somente quando houver um marco cadastrado e validado para aquele
  ponto. Usar distância ou o comando curto quando só houver dados do traçado.
- Descartar a chamada se o ponto já passou ou se a fala acabaria tarde demais. Reduzir a
  frequência nas curvas acertadas de forma repetida. Permitir reativar a ajuda nas curvas escolhidas.

#### Ganhar tempo

- Comparar as passagens alinhadas por distância com tolerância para a velocidade de entrada,
  as condições e a precisão do replay. Uma linha diferente ou mais volante, isoladamente,
  é insuficiente para apontar erro. Exigir efeito observável na saída, no delta, na curva
  seguinte ou na estabilidade.
- **Intervenção imediata:** usar só quando houver confiança alta e tempo para agir. Exemplo:
  “Alivia o acelerador”, se o piloto ainda estiver no gás e a aproximação indicar que precisa aliviar.
- **Correção posterior:** esperar o carro endireitar ou uma reta. Para freio forte ou prolongado,
  excesso de volante ou linha que abre, selecionar a causa mais bem sustentada e uma ação.
  Exemplo: “Na T4 você segurou o freio. Na próxima, comece a soltar quando virar”.
- Priorizar padrões recorrentes para o feedback de treino. Um erro isolado pode justificar uma
  intervenção se for claro, relevante e ainda corrigível. Guardar ocorrências menores para revisão.

#### Resumo e elogios

- Permitir resumo **por volta, por bloco ou sob demanda**. Se habilitado, falar na primeira
  janela livre depois da linha. Adiar ou descartar se a próxima curva já exigir atenção.
- Em volta válida, selecionar um ganho relevante e, se houver, uma próxima ação. Exemplo:
  “Você melhorou da T1 à T3. Na próxima, foque na soltura na T4”. Usar a volta-base do bloco
  para medir melhora e a referência ou meta para medir distância até o objetivo.
- Evitar repetir no resumo a correção já falada naquela volta. Sem mudança relevante, silêncio.
  Elogio genérico é separado, desligado por padrão e com intervalo quando habilitado. “Boa
  volta” pode acompanhar uma melhora ou uma volta dentro da tolerância da meta.

## Eventos de pilotagem

Registrar o trecho de início e fim, curva, duração, evidências, confiança e ação aplicável.
Mostrar no resumo da volta e permitir abrir os traços relevantes. O marcador no gráfico é
opcional. Diagnósticos prováveis ficam na revisão. O rádio usa apenas eventos de confiança
alta, depois que o carro endireitar, com no máximo uma chamada por passagem pela curva.

| Evento | Evidência para a regra | Distinção |
|---|---|---|
| **Saída de frente** | Volante mantido ou aumentado, resposta de guinada menor que a esperada para velocidade e comando, e linha abrindo | Separar de troca de direção, zebra e escolha de uma linha alternativa que funciona |
| **Saída de traseira** | Rotação maior que a esperada para o comando, corroborada por deslocamento lateral ou contravolante | Patinagem longitudinal sozinha é insuficiente. Usar velocidade e orientação quando disponíveis |
| **Travamento dianteiro** | Roda dianteira perde rotação em relação à velocidade do carro durante a freada, por tempo suficiente | Evento separado de sair de frente e de perder tração ao acelerar |
| **Perda de tração na saída** | Escorregamento longitudinal sob aceleração e, quando disponível, intervenção do controle de tração | Reservar “saiu de traseira” para quando houver também evidência de deslizamento lateral |

## Alertas do carro e de corrida

- **Pneus frios:** após sair dos boxes ou iniciar a sessão, usar temperatura por roda e faixa
  validada para a condição disponível. Avisar uma vez se o frio persistir: “Pneus frios.
  Aqueça progressivamente”. “Pneus na faixa” é opcional e depende de estabilização. Reaproveitar
  a escala configurável do painel como ponto de partida. Se a faixa não for confiável, mostrar
  os valores no painel. Usar persistência e histerese para evitar alternância perto do limite.
- **Temperatura alta:** avisar só quando persistir e mudar uma decisão. Variações pequenas
  ficam no painel.
- **Combustível:** reaproveitar consumo por volta, autonomia e distância restante. Com amostra
  confiável, anunciar quando a projeção mudar uma decisão: “Nesse ritmo, falta combustível para
  terminar. Economize nesta volta”. Se a distância restante for desconhecida, limitar-se à
  autonomia quando ela puder ser estimada. Corrida funciona sem volta de referência.
- **Tráfego e incidentes online:** item de pesquisa. O feed atual do Bono não fornece posição
  nem incidentes de adversários. “Carro fora da pista à frente”, bandeiras e tráfego lado a lado
  só entram após validar uma fonte adicional, incluindo posição, latência e comportamento online.

## Política de decisão e entrega

1. **Validar entradas.** Conferir fase, idade das amostras, canais exigidos e compatibilidade da
   referência. Suprimir a regra dependente quando faltar dado. Limpar pendências ao trocar de
   contexto, pausar ou perder o sinal.
2. **Confirmar a condição.** Aplicar tolerância, janela mínima e histerese quando pertinente.
   Calibrar limiares com gravações. Distância e tempo de fala devem acompanhar o ritmo atual.
3. **Selecionar uma fala.** Ordenar candidatos por alerta crítico, decisão de estratégia,
   instrução acionável, feedback e resumo. Aplicar modo, preferências, limite por curva e
   intervalo por tipo. Empates usam uma ordem estável.
4. **Checar a janela.** Falar só se a chamada couber e ainda estiver válida. Uma chamada urgente
   pode substituir uma dica pendente. Usar o aparelho de áudio selecionado. Se não houver
   reprodução local disponível, manter a informação no painel.
5. **Registrar a decisão.** Guardar regra, instante ou distância, evidências, referência, frase
   escolhida e motivo quando a chamada for descartada. Separar a decisão do motor da reprodução
   de áudio. Com os mesmos dados e configuração, o replay produz as mesmas decisões.

## Integração e sequência de entrega

1. Reusar os controles e a reprodução do rádio em `packages/web/src/state/engineer.ts`,
   as chamadas em `packages/web/src/lib/engineerRadio.ts` e os contratos em
   `packages/shared/src/live.ts`. Separar o agendador de fala das regras para testar cada parte.
2. Entregar os modos, nível Essencial, pneus frios e autonomia. Reusar a faixa de pneus em
   `packages/web/src/lib/tyreColor.ts` e as estimativas em `packages/web/src/lib/fuel.ts`.
3. Ligar os perfis e o resumo às marcas de referência em
   `packages/core/src/analysis-service/engineer-marks.ts` e ao treino de curvas existente.
4. Validar eventos em voltas gravadas e exibir na revisão. Habilitar voz depois de calibrar
   confiança e janela de fala. Incidentes online seguem como pesquisa separada.

## Critérios de aceite

- Reprocessar a mesma gravação com a mesma configuração e obter a mesma sequência de decisões,
  com regras, instantes e frases verificáveis. Operar com rede externa indisponível.
- Em Aprender pista, verificar aviso antecipado, redução da frequência após acertos e descarte de
  aviso atrasado. Sem referência compatível, nenhum ponto de freada é anunciado.
- Em Ganhar tempo, comparar uma passagem limpa com um erro recorrente e um erro acionável.
  Confirmar silêncio na limpa, uma ação por vez e ausência de repetição no resumo.
- Em Trial Mountain com o Huracán Gr.4, usar a **T2 da 2:04,856** como caso de possível saída de
  frente, a **T4** como caso de soltura tardia e a **T9** como caso de sinal de travamento.
  Validar saída de traseira com replay confirmado e uma passagem limpa de controle.
- Em Classificação, verificar pneus na preparação, silêncio na volta rápida e resultado após
  a linha em janela livre. Testar a linha de chegada perto de uma curva.
- Em Corrida sem referência, verificar autonomia e pneus, mudança relevante de condição e
  supressão com amostra velha. Testar repetição na faixa de temperatura, falta de duração de
  prova, concorrência de alertas e ausência de dados sobre adversários.
