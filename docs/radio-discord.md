# Rádio do Bono no Discord e no PS5

O Bono para Windows inclui o bot do Discord. O app deve estar aberto para transmitir as
instruções. O bot usa os clipes do Bono, entra no canal quando o piloto entra e sai quando
o piloto sai.

## Configuração no Windows

1. Crie uma aplicação com bot no [Discord Developer Portal](https://discord.com/developers/applications).
   Instale o bot em um servidor seu e crie um canal de voz privado. Dê ao bot acesso ao canal e
   as permissões **Ver canal**, **Conectar** e **Falar**.
2. Vincule o Discord à conta PlayStation. No PS5, entre no canal pelo **Game Base → Discord**.
   Veja o [guia da PlayStation](https://www.playstation.com/pt-br/support/games/discord-voice-chat/).
3. No Developer Portal, abra **Bot → Reset Token** e copie o token. Com o modo desenvolvedor
   do Discord ativado, copie também os IDs do canal e da sua conta.
4. No aplicativo instalado, abra **Configurações → Rádio no Discord**, preencha os três
   campos e clique em **Salvar**. O token é criptografado pelo armazenamento seguro do
   Windows. Deixe o campo do token em branco ao alterar as outras opções para manter o
   token salvo. Use **Apagar configuração** para remover a credencial deste PC.

O painel aberto em um navegador pela rede pode continuar exibindo a telemetria. Configure a
credencial na janela do próprio aplicativo Bono.

## Calibrar no box

1. Após salvar as credenciais, clique em **Testar com 10 bipes** e entre no canal pelo PS5.
2. Filme com o celular a seção **Rádio no Discord** e deixe o headset próximo do microfone do celular.
   O app atualiza a indicação **BIP** em cada um dos dez envios.
   Use o vídeo e a forma de onda para estimar os milissegundos entre a aparição da linha e o
   começo do som no headset. A resolução do vídeo limita a precisão.
3. Clique em **Encerrar teste**. Em **Atraso medido em ms**, informe as medições separadas
   por vírgula ou uma margem já medida. Com várias amostras, o Bono escolhe o percentil 90.
4. Marque **Ativar o rádio do Discord ao abrir o Bono** e salve.

## Ativar a saída pelo Discord

Na janela do Bono para Windows, abra o menu (tecla **M**) → **Engenheiro** e ligue
**Falar pelo Discord**. O interruptor liga o bot e escolhe **Discord · PS5** como aparelho
que toca o rádio; desligar devolve o som a cada aparelho. Ele só fica disponível depois que
o token, os IDs e o atraso medido estiverem salvos.

Em outro aparelho (um tablet pela rede), escolha **Discord · PS5** em **Aparelho que toca o
rádio**. O Bono para Windows precisa estar aberto com o rádio do Discord ativado.

A saída do Discord inicia em **Treino → Aprender pista**. O percentual de freio pode ser
ativado na seção **Rádio no Discord**.

O agendador projeta a distância no início da fala com a velocidade recente suavizada
e o atraso calibrado. Ele verifica o tempo até o fim do clipe antes de liberar a chamada.
Se a telemetria parar ou o canal cair, as falas pendentes são descartadas. Vale recalibrar
se mudar de rede, região de voz ou headset.

## Execução a partir do código

O comando `npm run radio:discord` continua disponível para quem roda o servidor sem
Electron. Ele lê `BONO_DISCORD_TOKEN`, `BONO_DISCORD_CHANNEL_ID`,
`BONO_DISCORD_DRIVER_ID` e `BONO_DISCORD_DELAY_MS` do ambiente do processo.
