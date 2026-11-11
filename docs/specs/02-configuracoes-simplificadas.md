# Spec 02 · Configurações simplificadas

**Status:** proposta · **Depende de:** [01](01-refinamento-de-ux.md) (glossário) · **Alimenta:** [03](03-assistente-inicial.md)

## Problema

A tela tem dez abas (Idioma, Conexão, Captura, Dispositivo remoto, Aparelhos, Rádio no Discord,
Coach IA, Dados, Integração com IA, Sobre) e mistura o que o piloto usa todo dia com detalhes de
rede e de protocolo. As opções do engenheiro (modo, perfil, volume, aparelho de áudio) e do painel
(telas, pop-ups, trava) **nem estão lá**: só no menu ao vivo. A referência do delta existe em três
lugares. Hoje só três itens são essenciais (idioma/voz, IP se a busca falhar, gravação automática).

## Princípios

1. **Tudo certo à primeira vista.** O topo mostra um resumo de saúde, não um formulário.
2. **Essencial na frente, o resto recolhido.** Padrão bom, ajuste opcional.
3. **Uma opção, um lugar.** Atalhos apontam para o mesmo valor, nunca duplicam.
4. **Linguagem de piloto.** Sem IP/porta/formato a menos que algo falhe.
5. **Nada de ação perigosa no meio.** Apagar e remover pedem confirmação em modal.

## Nova organização (5 grupos + Sobre)

| Grupo | Conteúdo | Nível |
|---|---|---|
| **Início** (resumo) | Estado: PS5 conectado · Engenheiro ligado/desligado · Gravação · Discord (se houver) · Aparelhos online. Cada linha com ação ("Procurar de novo", "Ligar"). Cartão "Falta configurar" com os passos do assistente ainda pendentes. | essencial |
| **Console** | Status do PS5 e botão "Procurar de novo". Gravar sessões automaticamente (liga/desliga). *Recolhido:* usar outro IP, formato do pacote (automático), gravar pacotes brutos, formato de replay. | essencial + avançado |
| **Engenheiro** | Ligar, voz (com "Testar"), modo/perfil (Aprender pista, Ganhar tempo, Consistência, Livre), volume, aparelho que toca (este aparelho · Discord · outro). *Mais opções:* nível de fala, ritmo, antecipação, resumo, reforço positivo, referência do delta. Reaproveita o componente `EngineerControls` do menu ao vivo. | essencial + comum |
| **Painel e aparelhos** | Telas do painel por aparelho (presets Simples/Completo/Corrida), pop-up de volta, trava; abrir no celular/tablet (QR + status do firewall em linguagem simples com botão "Corrigir"); lista de aparelhos conectados, compacta. | comum |
| **Contas e dados** | Rádio no Discord (spec 07), Coach IA (chave + modelo), pasta dos dados e cópia, idioma do app. *Avançado:* conectar ao Claude/Codex (MCP). | opcional |
| **Sobre** | Versão, atualizações, "Refazer o assistente", "Refazer o tour", licenças, aviso de projeto pessoal. | — |

Navegação: lista lateral no desktop, lista de grupos → detalhe no celular. Rota `#/config?s=<grupo>`
mantém as âncoras atuais por compatibilidade (`conexao`, `captura`, `discord`, `coach`…, mapeadas
para o novo grupo).

## Padrão de cada linha

`[título 15 px] [descrição 13 px, uma linha] ………… [controle]`. Controle: interruptor, segmentado
(2–3 opções), select (>3) ou botão. Estado de erro substitui a descrição ("Sem sinal há 5 min ·
Procurar de novo").

## Requisitos

- **RF1.** Novo `ConfigPage` com os grupos acima; seções antigas reaproveitadas como componentes,
  sem reescrever a lógica (descoberta do console, firewall, coach, discord).
- **RF2.** Extrair `EngineerControls` e o seletor de telas do menu ao vivo em componentes
  independentes de modal para uso na Config (o menu continua com a versão curta).
- **RF3.** Referência do delta: fonte única em `profile.deltaReference`; Config e menu escrevem
  nele; remover a duplicata do bloco Conexão.
- **RF4.** Resumo de saúde (`HealthSummary`): consome `serverStatus`, `useEngineer`, captura e
  Discord; cada item é um estado + ação.
- **RF5.** Padrão de gravação de pacotes brutos: **desligado em instalações novas** (a própria
  descrição já pede "deixe desligado"; o levantamento indica `record:true` como padrão em
  `runtime.ts`, a corrigir). Instalações existentes mantêm o valor atual.
- **RF6.** Firewall: o painel mostra "Liberado ✓" ou "Bloqueado — Corrigir" (abre o assistente
  de comandos já existente), sem exibir `netsh` por padrão.
- **RF7.** Textos de ajuda movidos para o glossário (spec 01) e revisados; nenhum rótulo com
  IP/UDP/protocolo fora de "Avançado".
- **RF8.** Busca em Configurações (campo no topo, filtra títulos e descrições) quando houver mais
  de 12 linhas visíveis no total.

## Critérios de aceite

1. As três configurações essenciais (voz, PS5, gravação) ficam visíveis **sem rolar** em 1280×720.
2. Cada opção existe em um só lugar; busca por "delta" encontra uma linha.
3. Nenhuma configuração existente deixa de ser alcançável (checklist de 100% dos campos antigos).
4. Âncoras antigas (`#/config?s=discord` etc.) continuam abrindo o grupo certo.
5. Em 375 px a navegação lista → detalhe funciona com uma mão; alvos ≥ 44 px.
6. Testes: mapeamento de âncoras; padrão de `record` em instalação nova; `HealthSummary` por estado.

## Fora de escopo

Mudar protocolo ou armazenamento das configurações; perfis de configuração nomeados; sincronizar
configurações entre PCs.
