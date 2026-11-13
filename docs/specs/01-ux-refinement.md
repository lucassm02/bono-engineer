# Spec 01 · Revisão de UX e refinamento da interface

**Status:** proposta · **Base:** [design system](../design-system.md) · **Método:** crítica heurística
(uso, hierarquia, consistência, acessibilidade) sobre o app remodelado em 2026-11-10, mais o mapa
de comportamento do código.

## Objetivo

Deixar o Bono **intuitivo, amigável e simples** para quem nunca o viu: cada tela diz o que está
acontecendo, o que fazer a seguir e onde está o que o piloto procura. O visual já é único (tema Pit
Wall); este trabalho é sobre **clareza**, não sobre mais enfeite.

## Achados da revisão

Gravidade: 🔴 impede ou confunde o uso · 🟡 atrapalha · 🟢 polimento.

### Painel ao vivo

| # | Achado | Gr. | Correção | Spec |
|---|---|---|---|---|
| A1 | O painel **nunca diz qual pista nem qual carro** (só "Volta 14"). O piloto não sabe se o Bono o reconheceu. | 🔴 | Faixa de contexto: pista, carro, estado do aprendizado. | 05 |
| A2 | "Rádio pronto" aparece mesmo sem pista reconhecida (fora de Treino + Aprender pista). Promete o que não entrega. | 🔴 | Estados do engenheiro verdadeiros em todos os modos. | 05 |
| A3 | O engenheiro **nasce desligado a cada abertura** (`enabled:false` não é salvo) e o interruptor está dentro do menu. | 🔴 | Persistir a escolha; mostrar o estado na faixa de contexto. | 03, 05 |
| A4 | Gestos (segurar abre telas, toque duplo troca delta, **M** abre o menu) só são lembrados no rodapé em tela de espera. | 🟡 | Tour (04) + botão "?" no menu. | 04 |
| A5 | Pop-up de volta mostra "Sem referência" sem dizer como conseguir uma. | 🟡 | Texto com ação: "Dê mais uma volta" / "Capturar um replay". | 05 |
| A6 | Botões flutuantes (menu, cadeado) são pequenos e sem rótulo para quem chega. | 🟡 | Rótulo curto na primeira semana, tooltip com tecla. | 04 |
| A7 | Menu ao vivo, abas Navegar/Engenheiro/Painel: o rádio é o assunto principal e está na segunda aba. | 🟢 | Abrir na última aba usada; indicar o estado do rádio no título da aba. | — |

### Área de análise

| # | Achado | Gr. | Correção | Spec |
|---|---|---|---|---|
| B1 | Configurações mistura ajustes de uso diário com técnicos (formato de pacote, MCP, firewall em PowerShell). 10 abas, uma delas com um único interruptor. | 🔴 | Reorganizar em 5 grupos, avançado recolhido. | 02 |
| B2 | A mesma opção em três lugares: referência do delta (Config, toque duplo, menu do engenheiro). Idioma/voz fora do rádio. | 🟡 | Um lugar de verdade, os outros só atalhos. | 02 |
| B3 | Rádio do engenheiro e perfil do painel **não existem na Configuração**, só no menu ao vivo. Quem procura "voz" em Ajustes não acha o modo. | 🔴 | Aba Engenheiro em Configurações reutilizando o mesmo componente. | 02 |
| B4 | Nomes técnicos na navegação: "Captura de referência", "Integração com IA (MCP)". | 🟡 | "Gravar volta de replay", "Conectar ao Claude/Codex" (avançado). | 02 |
| B5 | "Nova pista detectada" só aparece na Início; ao vivo e na sessão ninguém pergunta. | 🔴 | Ver spec 05. | 05 |
| B6 | Estados vazios sem ação: sessão sem referência, sem Coach key. | 🟡 | Todo vazio vira convite com botão único. | — |
| B7 | A tabela de aparelhos repete a lista de 11 telas em cada linha. | 🟢 | Linha compacta; detalhes ao expandir. | 02 |

### Transversais

| # | Achado | Gr. | Correção |
|---|---|---|---|
| C1 | Vocabulário oscila: *painel/ao vivo/dashboard*, *referência/top capturado*, *volta de reconhecimento* não existe. | 🟡 | Glossário único (abaixo) e revisão de textos. |
| C2 | Texto auxiliar `--text-3` em fundo `--surface-2`: razão ≈ 4,9:1 (passa AA, no limite). Há rótulos de 11 px. | 🟡 | Mínimo 12 px para qualquer texto de leitura; ajuda em `--text-2` quando for instrução. |
| C3 | Alvos de toque: botões flutuantes e setas abaixo de 44 px em partes do painel. | 🟡 | Revisão com `pointer: coarse`. |
| C4 | Erros técnicos expostos (`Error invoking remote method…`, códigos). | 🟢 | Mensagem humana + ação; detalhe técnico recolhido. |
| C5 | Menu do engenheiro longo (≈12 controles visíveis ao mesmo tempo). | 🟡 | Quatro escolhas na frente (Ligar, Modo, Volume, Aparelho); resto em "Mais opções". |

## Glossário (vira fonte única de rótulos)

| Use | Em vez de |
|---|---|
| **Ao vivo** | painel, dashboard |
| **Engenheiro** | rádio, bono (quando for a função) |
| **Volta de referência** | top capturado, melhor capturada |
| **Reconhecer a pista** | tracking, fingerprint |
| **Gravar volta de replay** | captura de referência |
| **Aparelho** | dispositivo remoto, device |

## Requisitos

- **RF1.** Aplicar as correções A1–A7, B1–B7, C1–C5 conforme as specs indicadas; as sem spec
  (A5–A7, B6, B7, C1–C4) entram aqui como *quick wins* em um único PR de textos e estilos.
- **RF2.** Criar `src/lib/copy.ts` com o glossário e os textos de estado (engenheiro, captura,
  conexão) usados por mais de uma tela. Revisão de ponta a ponta nos textos de erro e vazio, no tom
  do guia de redação: frase em caso de frase, verbo de ação, sem pedir desculpas.
- **RF3.** Regra de acessibilidade: texto de leitura ≥ 12 px; contraste AA nos dois níveis de
  texto secundário; foco visível; alvos ≥ 44 px em toque; `aria-live` nos estados do engenheiro.
- **RF4.** Medição de uso sem telemetria externa: contadores locais (aberturas do menu, uso do
  tour, passos do assistente concluídos) em `localStorage`, exibidos em Configurações → Sobre →
  "Diagnóstico". Nada sai do PC.

## Critérios de aceite

1. Uma pessoa que nunca viu o Bono, sem instrução, consegue em **menos de 2 minutos**: ligar o
   engenheiro, dizer qual pista está, e encontrar a última volta no Início (teste com 3 pessoas).
2. As três perguntas do piloto sempre têm resposta na tela ao vivo: *em que pista estou? o
   engenheiro está me ouvindo? o que falta para ele começar?*
3. Nenhum termo do "Use em vez de" restante na interface (verificação por busca no CI).
4. Auditoria automática de contraste e alvos de toque sem falhas nas telas principais.
