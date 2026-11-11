# Spec 07 · Rádio no Discord sem fricção

**Status:** proposta · **Depende de:** nenhuma · **Relacionada:** [spec 03](03-assistente-inicial.md) (o assistente reaproveita este fluxo)

## Problema

Para ouvir o engenheiro no PS5 via Discord hoje o usuário precisa: criar uma aplicação no
Developer Portal, gerar o token, ativar o modo desenvolvedor, copiar **três IDs** (canal, usuário,
e montar o convite do bot à mão), vincular o Discord ao PlayStation, rodar um teste de 10 bipes e
informar o atraso medido. São onze passos fora do Bono. Isso é o maior obstáculo de adoção da
função.

## Decisões (tomadas em 2026-11-11)

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Não embutir um token de bot no app nem no repositório.** Cada pessoa usa o próprio bot. | O app é distribuído (instalador Electron, `app.asar` extraível em segundos) e o repositório é público. Quem extrair o token controla o bot em todos os servidores onde ele estiver: ler canais, mandar mensagens, expulsar membros. O Discord também varre o GitHub e **invalida** tokens vazados, o que quebraria o rádio de todos de uma vez. Sem backend não há como o bot ficar hospedado com o segredo fora do app, e um bot único também bateria no limite de 100 servidores de bots não verificados. |
| D2 | **Remover o ID de usuário do piloto** dos campos obrigatórios. | Só serve para o bot entrar quando o piloto entra e sair quando sai (`discord-radio/main.ts`, `syncVoice`). Troca: o bot entra quando **houver alguém no canal** e sai quando o canal esvazia. O canal é privado e do próprio piloto, então "alguém no canal" equivale a "o piloto". |
| D3 | **Manter o ID do canal, mas escolhido em lista**, não digitado. | O canal precisa existir no servidor do usuário. Depois que o bot está no servidor, o app lista os canais de voz e o usuário clica. |
| D4 | **Criar o convite do bot automaticamente** a partir do token. | O Application ID é o primeiro trecho do token (base64 do ID do bot). O app monta a URL de convite com as permissões certas (Ver canal, Conectar, Falar = `3146752`, escopo `bot`) e abre no navegador. |

Resultado: o usuário só **cria o bot, cola o token e clica em "Convidar"**. Nada de modo
desenvolvedor, nada de copiar IDs.

## Fluxo proposto (assistente em 4 passos, tela cheia no Modal `lg`)

1. **Criar o bot.** Botão "Abrir o Discord Developer Portal" (abre
   `discord.com/developers/applications`). Texto curto com 3 itens: *New Application → Bot →
   Reset Token*. Imagem ou GIF de cada clique (assets em `docs/` e no site).
2. **Colar o token.** Um campo. O app valida o formato, tenta logar e mostra o nome do bot
   ("Conectado como *Bono Rádio*"). Erros por causa: token inválido, bot sem a intent de voz.
3. **Convidar o bot.** Botão "Convidar para o meu servidor" abre a URL gerada (D4). O app espera
   (polling a cada 3 s) até o bot aparecer em algum servidor e avança sozinho.
4. **Escolher o canal.** Lista dos canais de voz dos servidores em que o bot está, com o servidor
   como grupo. Se o bot não tiver permissão no canal, a linha mostra "sem permissão" e o motivo.
   Depois: botão **Testar** (um bip no canal) e o PS5 entra no canal pelo Game Base → Discord.

Calibragem do atraso: **continua existindo, com todas as opções de hoje** (teste de 10 bipes,
medições em ms separadas por vírgula e percentil 90). Só sai do caminho obrigatório: o assistente
usa um padrão seguro (300 ms) para ninguém ficar travado e oferece **"Calibrar o atraso"** ao fim
do passo 4. A calibragem completa fica sempre em Configurações → Rádio no Discord → Ajuste fino,
e o valor medido substitui o padrão.

## Requisitos funcionais

- **RF1.** Remover `driverId` de `DesktopDiscordSettings`, do formulário, de `discordConfig` e das
  variáveis `BONO_DISCORD_DRIVER_ID`. Aceitar o campo em arquivos antigos (migração silenciosa) e
  ignorá-lo.
- **RF2.** `syncVoice` passa a: entrar quando `channel.members` (não bots) > 0; sair quando = 0.
  Em `VoiceStateUpdate`, reagir a qualquer usuário no canal configurado.
- **RF3.** Novo método do *bridge*: `inspectToken(token)` → `{ botName, applicationId, inviteUrl }`
  e `listVoiceChannels()` → `[{ guildName, channelId, channelName, canSpeak }]`.
- **RF4.** O token continua cifrado com `safeStorage` (já é assim) e **nunca** volta para o
  renderer: o campo mostra só "token salvo" e os 4 últimos caracteres.
- **RF5.** Atraso padrão de 300 ms quando não calibrado; o Bono avisa "som pode chegar um pouco
  depois" em vez de bloquear a transmissão (`discordConfig` hoje lança erro sem atraso). **A
  calibragem manual permanece** (campo "Atraso medido em ms", teste de 10 bipes, percentil 90) e,
  quando preenchida, vence o padrão.
- **RF6.** O interruptor "Falar pelo Discord" (já existente no menu ao vivo) fica disponível assim
  que o passo 4 conclui.
- **RF7.** Estados de erro acionáveis: bot sem permissão, canal apagado, token revogado (pede
  novo token), PS5 fora do canal ("Entre no canal pelo PS5").

## Fora de escopo

- Hospedar um bot único para todos (exige backend, rejeitado).
- Usar conta de usuário/self-bot (viola os termos do Discord).
- Calibragem **automática** do atraso (possível no futuro medindo eco; não agora). A manual fica.

## Critérios de aceite

1. Do zero ao primeiro bip no canal em **menos de 3 minutos**, sem digitar nenhum ID.
2. Nenhum token no repositório, no instalador ou nos logs (teste automatizado que procura o
   padrão de token em `dist/` e em `git grep`).
3. Com duas pessoas no canal o bot entra uma vez; com o canal vazio ele sai em até 5 s.
4. Arquivos de configuração antigos (com `driverId`) continuam abrindo sem erro.
5. Testes: `discord-radio.test.ts` cobre `inspectToken` (ID derivado, convite com `permissions=3146752`)
   e a regra de entrada/saída por membros.

## Riscos

| Risco | Mitigação |
|---|---|
| Alguém mais entra no canal e escuta o rádio | Canal privado é pré-requisito, dito no passo 4. Opção avançada "só seguir este usuário" reativa o `driverId` para quem quiser. |
| Discord muda o fluxo do Developer Portal | Passos em texto + imagem versionada no site; link para a doc oficial como reserva. |
| Bot precisa da intent `GuildVoiceStates` | Já é usada; está ativa por padrão (não é intent privilegiada). Mensagem de erro dedicada se faltar. |
