# Bono Engineer

**Seu engenheiro de pista no sim racing.** O Bono acompanha a pilotagem em tempo real e ajuda a escolher o que treinar na próxima volta. A homenagem ao Bono fica no nome e no papel do rádio durante a sessão.

## Sinal de box

O monograma desenha um B com uma curva fechada no topo, um arco mais aberto na base e uma faixa ciano de largada. A área de análise e o menu ao vivo usam grafite (`#0b1118`) e ciano (`#66e4f6`) nos controles. O traçado do símbolo usa marfim (`#f7f5ea`). Os tempos usam algarismos tabulares para facilitar a leitura de relance.

O [símbolo vetorial](../packages/web/public/favicon.svg) é aplicado no web app, no desktop e na bandeja. O arquivo [brand.ts](../packages/shared/src/brand.ts) define o símbolo. Use `npm run brand:icons` para gerar os arquivos web e Windows.

## Integrações de telemetria

Gran Turismo 7 no PlayStation é a integração disponível. A tela de conexão concentra a descoberta do console e as opções de pacote. O modo demonstração é identificado separadamente. O campo `telemetrySource` em `/api/status` distingue a fonte configurada do estado da conexão.

Antes de atualizar, feche o app anterior pela bandeja. Na primeira abertura, o Bono Engineer copia o histórico e as preferências locais para as novas pastas, preservando os arquivos de origem. Se usava a opção de iniciar com o Windows, confira a opção no menu da bandeja após a instalação.

Para integrar o próximo simulador:

1. Isole a leitura bruta por fonte. Cada adaptador é responsável pelo protocolo, pela cadência e pelo estado de conexão. O GT7 segue com UDP, descoberta do PlayStation e gravações `.gt7rec`.
2. Faça o motor receber amostras normalizadas, com unidades explícitas e canais indisponíveis representados como ausentes. Mapa, delta, referência e rádio só devem ativar funções para as quais a fonte fornece os sinais necessários.
3. Registre a origem de sessões, carros, traçados e referências. Trate os registros existentes como GT7 e mantenha a demonstração separada. Inclua a origem nas chaves de catálogo para evitar colisões entre códigos de carros e pistas de jogos diferentes.
4. Exponha a seleção de fonte quando o segundo adaptador estiver funcional. Teste com gravações reais de cada integração antes de habilitar comparações ou referências compartilhadas.
