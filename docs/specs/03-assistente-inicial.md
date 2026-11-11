# Spec 03 · Assistente inicial (configuração básica na primeira abertura)

**Status:** proposta · **Substitui/estende:** `components/Onboarding.tsx` · **Depende de:** [02](02-configuracoes-simplificadas.md) ·
**Leva ao:** [04](04-tour-guiado.md) · **Reaproveita:** [07](07-discord-simplificado.md)

## Problema

O assistente de hoje tem três passos e só resolve **uma** coisa: achar o PS5 e (opcional) abrir o
painel em outro aparelho. Não pergunta idioma, voz, como a pessoa vai usar o engenheiro, nem
explica que ele **precisa ser ligado** (nasce desligado a cada abertura). Também só aparece se o
histórico estiver vazio e o console ainda estiver "procurando"; quem já tem sessões nunca o vê.

## Objetivo

Em **no máximo 3 minutos** o Bono fica pronto para a primeira volta: console conectado, idioma e
voz escolhidos, engenheiro ligado com o jeito de ajudar que a pessoa quer, e o painel certo para o
aparelho dela. Tudo com padrões bons: cada passo pode ser pulado e retomado depois.

## Passos

| # | Passo | Pergunta / ação | Padrão | Salva |
|---|---|---|---|---|
| 1 | **Boas-vindas** | Idioma do app e do engenheiro; voz com botão "Ouvir" (3 vozes). | idioma do navegador/sistema; voz padrão do idioma | idioma, `engineer.voice` |
| 2 | **Conectar o PS5** | Fluxo atual: busca em tempo real, checklist após 40 s (PS5 e rede, GT7 aberto, firewall em linguagem simples), IP manual como último recurso. Avança sozinho ao achar. | automático | IP (se manual) |
| 3 | **Como você quer treinar?** | Três cartões: **Aprender uma pista** (engenheiro guia curva a curva), **Ganhar tempo** (já conheço a pista), **Só ver o painel** (engenheiro desligado). | Aprender uma pista | `controls.mode/trainingProfile`, `enabled` |
| 4 | **Engenheiro** | Interruptor "Ligar o engenheiro", volume com som de teste, **onde ele fala**: neste aparelho · Discord (abre o assistente da spec 07, opcional, "Configurar depois"). | ligado, neste aparelho | `enabled` **persistido**, aparelho de áudio |
| 5 | **Seu painel** | Escolher o preset: **Simples** (Corrida + Delta grande), **Completo** (inclui pneus, motor, inputs), **Corrida de endurance** (combustível, tempos). Opcional: QR para abrir no celular/tablet. | Simples no celular, Completo no desktop | `profile.views` |
| 6 | **Pronto** | Resumo do que foi configurado ("PS5 192.168.3.26 · Voz Alex · Aprender pista") e dois botões: **Ver o tour** (spec 04) e **Ir para o ao vivo**. | — | `setup.done` |

Barra de progresso por etapas ("Passo 3 de 6"), botões **Voltar** e **Pular passo** sempre visíveis;
"Fazer isso depois" fecha o assistente sem perder o já feito.

## Regras de exibição

- Mostra quando `setup.version` salvo < versão atual **e** não há sinal de que a pessoa já
  configurou (nem `gt7.onboardingDone` legado). Quem tem sessões e configurou antes vê um
  convite leve ("Novidades: tour guiado e engenheiro mais fácil — Ver"), não o assistente inteiro.
- **Nunca** durante a pilotagem (carro na pista com velocidade > 10 km/h): adia até pausa/menu.
- Não aparece no modo demonstração `?mock=1`, salvo `?onboarding=1`.
- Retomável: passos pendentes viram o cartão "Falta configurar" no topo da Início e do resumo de
  Configurações, com um botão por passo.
- Rever sempre em Configurações → Sobre → "Refazer o assistente" e na Início ("Falta configurar").

## Requisitos

- **RF1.** Estado em `localStorage` por passo (`gt7.setup.v2 = { version, steps:{welcome,console,mode,engineer,panel}, done }`),
  espelhando no servidor só o que já existe lá (perfil do aparelho, aparelho de áudio).
- **RF2.** **Persistir `engineer.enabled`** (hoje `enabled:false` em `state/engineer.ts` não é
  salvo) e restaurar ao abrir; mostrar o estado no menu e na faixa de contexto (spec 05).
- **RF3.** Os passos 3–5 gravam usando as mesmas ações das telas de Configuração (spec 02):
  nenhuma regra de negócio nova no assistente.
- **RF4.** Cada passo tem validação e estado de erro próprio (ex.: busca do PS5 sem resultado →
  checklist, não erro genérico). Sem PS5 à mão: botão **Experimentar com a demonstração**
  (`mock`), que mantém o assistente e deixa o tour rodar.
- **RF5.** Textos curtos (≤ 2 linhas por pergunta), um objetivo por tela, botão primário único.
  Acessível: foco no título do passo, `aria-live` na busca, navegação por teclado, Esc = "fazer
  isso depois".
- **RF6.** Pergunta de **chave do Coach IA** e **Discord** ficam **fora** do caminho obrigatório
  (são opcionais; aparecem no cartão "Falta configurar" depois).

## Critérios de aceite

1. Instalação limpa → primeira volta com o engenheiro ligado, sem abrir Configurações.
2. Fechar o app no passo 4 e reabrir retoma no passo 4 (ou mostra o cartão de pendência).
3. Quem já tem histórico recebe o convite leve, não o assistente completo.
4. O engenheiro continua ligado após reiniciar o app (RF2).
5. Pular todos os passos deixa o app em um estado utilizável (padrões listados na tabela).
6. Testes: `decideSetup` (condições de exibição), persistência por passo, migração do
   `gt7.onboardingDone` legado.

## Riscos

| Risco | Mitigação |
|---|---|
| Passos demais afastam quem só quer dirigir | 3 obrigatórios de fato (1, 2, 4); os demais têm padrão e "Pular". Meta de 3 min medida no teste de usabilidade. |
| Escolher "Só ver o painel" e depois querer o rádio | O estado do engenheiro aparece na faixa de contexto com atalho para ligar. |
