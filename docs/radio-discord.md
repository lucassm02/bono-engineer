# Rádio do Bono no Discord e no PS5

O Bono para Windows inclui o bot do Discord. O app deve estar aberto para transmitir as
instruções. O bot usa os clipes do Bono, entra no canal quando alguém entra nele e sai quando o
canal esvazia. O canal é privado e seu, então "alguém no canal" é você no PS5.

Cada pessoa usa o **próprio bot**: o Bono não traz token embutido (um token dentro do instalador
seria extraído por qualquer um e o Discord o invalidaria).

## Configuração no Windows (assistente de 4 passos)

Abra **Configurações → Rádio no Discord → Configurar o Discord**. Você não copia nenhum ID.

1. **Criar o bot.** O botão abre o [Discord Developer Portal](https://discord.com/developers/applications).
   Clique em **New Application**, dê um nome, abra **Bot** e clique em **Reset Token** para copiar o token.
2. **Colar o token.** O Bono valida o token e mostra "Conectado como …". Se for recusado, gere outro
   em **Bot → Reset Token**.
3. **Convidar o bot.** O Bono monta o convite sozinho (com as permissões **Ver canal**, **Conectar** e
   **Falar**) e o abre no navegador. Escolha seu servidor e confirme. O assistente espera o bot
   aparecer no servidor e avança sozinho.
4. **Escolher o canal.** Os canais de voz aparecem agrupados por servidor. Escolha um canal
   **privado**: quem entrar nele ouve o rádio. Um canal marcado "Sem permissão" explica o que falta
   (dê ao bot Ver canal, Conectar e Falar nele). Clique em **Testar com 10 bipes** e entre no canal pelo
   PS5 (**Game Base → Discord**, depois de vincular o Discord à conta PlayStation; veja o
   [guia da PlayStation](https://www.playstation.com/pt-br/support/games/discord-voice-chat/)).
   Clique em **Concluir** para salvar.

O token é criptografado pelo armazenamento seguro do Windows e nunca volta para a tela (o Bono
mostra só "Token salvo" e os 4 últimos caracteres). Use **Apagar configuração** para remover a
credencial deste PC e **Reconfigurar** para escolher outro canal ou trocar de bot.

O painel aberto em um navegador pela rede pode continuar exibindo a telemetria. Configure a
credencial na janela do próprio aplicativo Bono.

## Calibrar o atraso (opcional)

Sem calibrar, o Bono usa um atraso padrão de **300 ms** para não bloquear ninguém; nesse caso o som
pode chegar um pouco depois da curva. Para sincronizar, calibre uma vez (e de novo se mudar de rede,
região de voz ou headset). A calibragem completa fica em **Configurações → Rádio no Discord → Ajuste fino**,
e também ao fim do passo 4 do assistente (**Calibrar o atraso**).

1. Clique em **Testar com 10 bipes** e entre no canal pelo PS5.
2. Filme com o celular a seção **Rádio no Discord** e deixe o headset próximo do microfone do celular.
   O app atualiza a indicação **BIP** em cada um dos dez envios.
   Use o vídeo e a forma de onda para estimar os milissegundos entre a aparição da linha e o
   começo do som no headset. A resolução do vídeo limita a precisão.
3. Clique em **Encerrar teste**. Em **Atraso medido em ms**, informe as medições separadas
   por vírgula ou uma margem já medida. Com várias amostras, o Bono escolhe o percentil 90.
   O valor medido substitui o padrão de 300 ms.
4. Em **Ajuste fino**, marque **Ligar ao abrir o Bono** se quiser e clique em **Salvar ajuste fino**.

## Ativar a saída pelo Discord

Na janela do Bono para Windows, abra o menu (tecla **M**) → **Engenheiro** e ligue
**Falar pelo Discord**. O interruptor liga o bot e escolhe **Discord · PS5** como aparelho
que toca o rádio; desligar devolve o som a cada aparelho. Ele fica disponível assim que o
token e o canal estão salvos; o atraso medido não é requisito.

Em outro aparelho (um tablet pela rede), escolha **Discord · PS5** em **Aparelho que toca o
rádio**. O Bono para Windows precisa estar aberto com o rádio do Discord ativado.

A saída do Discord inicia em **Treino → Aprender pista**. O percentual de freio pode ser
ativado em **Ajuste fino**.

O agendador projeta a distância no início da fala com a velocidade recente suavizada
e o atraso calibrado. Ele verifica o tempo até o fim do clipe antes de liberar a chamada.
Se a telemetria parar ou o canal cair, as falas pendentes são descartadas.

## Quando algo falha

| Mensagem | O que fazer |
| --- | --- |
| O Discord recusou o token | O token foi trocado ou revogado: gere outro em **Bot → Reset Token** e use **Reconfigurar → Usar outro bot**. |
| O bot está sem permissão no canal | Dê ao bot **Ver canal**, **Conectar** e **Falar** nesse canal. |
| O canal de voz não existe mais | Escolha outro canal em **Reconfigurar**. |
| Aguardando alguém no canal | Entre no canal pelo PS5 (**Game Base → Discord**). O bot entra sozinho. |

## Opções avançadas

- **Só seguir este usuário** (Ajuste fino): em vez de entrar quando qualquer pessoa entra no canal,
  o bot só entra quando a conta com esse ID de usuário está nele. Vazio por padrão.
- Configurações salvas por versões anteriores (com o ID de usuário obrigatório) continuam abrindo;
  esse campo antigo é ignorado.

## Execução a partir do código

O comando `npm run radio:discord` continua disponível para quem roda o servidor sem
Electron. Ele lê `BONO_DISCORD_TOKEN`, `BONO_DISCORD_CHANNEL_ID` e, opcionalmente,
`BONO_DISCORD_DELAY_MS` (padrão 300 ms) e `BONO_DISCORD_FOLLOW_USER_ID` do ambiente do processo.
`BONO_DISCORD_DRIVER_ID` não é mais usada.
