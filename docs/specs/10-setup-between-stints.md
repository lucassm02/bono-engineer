# Spec 10 · Ciclo de setup entre stints

**Status:** futura (não implementar agora) · **Depende de:** [spec 09](09-stints.md) · **Base:** [relatório](../stints-setup-pit-wall-report.md), seção 5

## Objetivo

Ajudar o piloto a melhorar o carro **uma mudança por vez**: registrar o setup, receber uma sugestão no box, aplicar,
rodar o stint seguinte e ver se funcionou. O Bono **não lê o setup** do jogo (o pacote de telemetria não o traz), então
o piloto informa e o Bono guarda, compara e mede o efeito.

## Entrega em duas etapas

### Etapa A: ficha de setup + comparação (valor imediato, baixo risco)

- **Ficha por stint** com as categorias do GT7: aerodinâmica, altura, molas, amortecedores, estabilizadoras, cambagem e
  convergência, diferencial, balanço de freio, marchas, pneus, lastro, restritor de potência. O piloto preenche só o que
  mudou; o resto herda do stint anterior.
- **BoP:** pergunta "BoP ligado ou desligado?" (o Bono não consegue detectar). Com BoP ligado a ficha continua
  disponível, mas sem sugestões.
- **Comparar stints com o setup ao lado:** ritmo, consistência e curvas que mudaram, mostrando o que foi alterado entre
  um stint e o outro.
- **Histórico de setups** por carro e pista, no backup `.bono`.

### Etapa B: sugestões (depois de calibrar com sessões reais)

1. **Motor de sintomas determinístico:** por fase da curva (entrada, meio, saída), classifica subesterço, sobresterço,
   travada e patinada, reaproveitando `frontLock`, `exitSlip` e `steeringCorrections` e acrescentando a relação entre
   volante, taxa de guinada e G lateral.
2. **Tabela sintoma → alavanca → direção → passo** na base de conhecimento (começar com 3 sintomas e 6 alavancas).
3. **Uma sugestão por vez**, com a evidência (curvas e números) e "sugestão para testar", sempre reversível.
4. **Validação:** no stint seguinte, mede a mesma métrica nas mesmas curvas e diz "melhorou / piorou / inconclusivo"
   (mínimo de 3 voltas limpas por stint, aviso de pneu gasto, combustível e clima).
5. O engenheiro só fala de setup **no box**, nunca durante a volta.

## Critérios de aceite

- **A:** registrar um setup, trocar um valor no stint seguinte e ver a comparação com a mudança destacada; backup leva os
  setups.
- **B:** com 2 ou 3 carros testados, o sintoma detectado confere com o que o piloto sentiu; a validação do efeito não dá
  falso "melhorou" em stints com pneu muito diferente.

## Riscos

Conselho errado (cada carro reage diferente), trabalho de digitação e efeito mascarado por pneu, combustível ou clima.
Mitigações: poucas alavancas bem conhecidas, herdar valores, dizer "inconclusivo" quando não der para concluir.
