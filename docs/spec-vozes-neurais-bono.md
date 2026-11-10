# Spec das vozes neurais do Bono

**Status:** proposta para implementação.

## Catálogo

- Oferecer exclusivamente vozes neurais masculinas em português do Brasil para o engenheiro
  de rádio. Os perfis devem soar distintos e manter dicção clara para números, marchas,
  nomes de curvas e alertas curtos.
- Manter **Alex** como voz padrão proposta e acrescentar **pelo menos duas vozes** no primeiro
  lote. Escolher as novas vozes por amostras da mesma frase e validar a licença de distribuição
  antes de empacotar. Provedor, nomes e timbres finais ficam para a seleção de áudio.
- Retirar **Dora**, os demais perfis femininos e todas as vozes do sistema, navegador ou
  dispositivo do seletor e do caminho de reprodução do engenheiro. Remover a inscrição no
  catálogo de vozes do navegador e o fallback para síntese do dispositivo.
- Manter a escolha de **qual aparelho toca o rádio**. Essa escolha roteia a reprodução do
  áudio e é independente da voz. Preservar prévia, volume, ritmo e mudo.

## Áudio ao vivo e cobertura

As vozes neurais entram como **clipes pré-gerados distribuídos com o Bono**. O engenheiro
continua decidindo com regras e telemetria. Selecionar e reproduzir falas ao vivo deve
funcionar sem acesso a serviço externo, síntese online ou agente de IA.

- Reaproveitar o carregamento de pacotes em `packages/web/src/lib/engineerClips.ts`, a
  reprodução em `packages/web/src/state/engineer.ts` e o seletor em
  `packages/web/src/components/EngineerControls.tsx`. Cada voz tem ID estável, nome,
  prévia, manifesto com duração dos clipes e créditos.
- Dar a todas as vozes a mesma cobertura de chamadas de Treino, Classificação e Corrida.
  Para frases com números, usar variantes gravadas ou segmentos pré-gerados com montagem
  determinística. Se um valor exato não tiver cobertura, preferir uma frase gravada que
  preserve o sentido e mostrar o valor no painel.
- Equalizar volume, cortes e pausas entre vozes. Medir a duração dos clipes efetivos
  para o agendador decidir se uma instrução ainda cabe antes da curva.
- Se a voz escolhida falhar, usar o pacote padrão somente se ele contiver a fala. Se nenhum
  pacote puder reproduzir o aviso, manter a informação no painel e indicar indisponibilidade
  do áudio. Não recorrer à síntese do dispositivo.

## Migração

- Manter a preferência quando o ID salvo estiver no novo catálogo. Se estiver vazio,
  apontar para Dora, uma voz do dispositivo ou um ID antigo, migrar para a voz neural
  padrão. Preservar ritmo, volume, mudo e aparelho selecionado.
- Atualizar manifesto e créditos. Excluir pacotes removidos da distribuição após confirmar
  que nenhuma configuração ou chamada depende deles.

## Critérios de aceite

- O seletor exibe Alex e as novas vozes neurais masculinas em pt-BR. Cada voz permite ouvir a
  mesma prévia, com nomes distintos. Nenhuma voz feminina ou do dispositivo fica disponível.
- Preferências antigas migram sem impedir a reprodução. Preferências compatíveis e demais
  controles de áudio são preservados.
- Com acesso externo indisponível, reproduzir alertas de pneus, instruções de curva e resultados
  com os pacotes distribuídos. Conferir pelo menos uma frase com número em cada voz.
- Com pacote ou clipe indisponível, confirmar o fallback neural ou a indicação no painel.
  Conferir que o agendador usa a duração do áudio que será tocado.

Os modos e os gatilhos de fala estão na [spec do engenheiro de rádio](spec-engenheiro-de-radio.md).
