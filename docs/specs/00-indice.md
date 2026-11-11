# Specs · Bono Engineer (rodada de 2026-11-11)

Resultado do pedido de revisão da interface, simplificação do Bono e novos fluxos. Cada spec é
independente o bastante para virar um PR; as dependências estão na tabela.

| # | Spec | O que resolve | Depende de | Tamanho |
|---|---|---|---|---|
| 01 | [Revisão de UX e refinamento](01-refinamento-de-ux.md) | Auditoria completa (19 achados, glossário, regras de acessibilidade) e *quick wins* | — | M |
| 02 | [Configurações simplificadas](02-configuracoes-simplificadas.md) | 10 abas → 5 grupos + resumo de saúde, uma opção em um lugar | 01 | M |
| 03 | [Assistente inicial](03-assistente-inicial.md) | Configuração básica na primeira abertura (idioma, voz, PS5, modo, engenheiro, painel) | 02 | M |
| 04 | [Tour guiado](04-tour-guiado.md) | Tour do ao vivo e da análise, dicas únicas, gestos descobertos | 03 | M |
| 05 | [Pista no ao vivo](05-pista-ao-vivo.md) | Faixa de contexto, estados do engenheiro, guia da volta de reconhecimento, "Qual pista é?" | 01 | G |
| 06 | [Escolher a pista ao iniciar](06-escolher-pista-ao-iniciar.md) | Engenheiro desde a volta 1 com pista salva (opcional) | 05 | G |
| 07 | [Discord simplificado](07-discord-simplificado.md) | Sem ID de usuário, convite automático, canal em lista, sem token embutido | — | M |
| 08 | [Site no GitHub Pages com SEO](08-site-github-pages.md) | Vitrine pública encontrável, com download | 01 (visual pronto), 07 (página do Discord) | M |

P = ≤ 2 dias · M = 3–5 dias · G = 1–2 semanas (estimativa de uma pessoa).

## Ordem sugerida

1. **01** (quick wins) e **07** em paralelo: não dependem de nada e removem atrito imediato.
2. **05** → **06**: o maior ganho de produto (engenheiro desde a primeira volta).
3. **02** → **03** → **04**: configuração, assistente e tour, nessa ordem.
4. **08** por último, com a interface e os textos já estáveis (as capturas do site saem delas).

## Decisões já tomadas

- **Confirmadas pelo dono em 2026-11-11:** seguir a simplificação do Discord, **remover o ID de
  usuário**, **manter a calibragem do atraso**, implementar as melhorias de interface e o site.
- **Token do bot do Discord não vai no código nem no instalador.** Cada pessoa usa o próprio bot;
  o Bono cria o convite e lista os canais. (spec 07, D1)
- **ID de usuário do piloto sai.** O bot entra quando há alguém no canal. (spec 07, D2)
- **Gravação de pacotes brutos passa a vir desligada** em instalações novas. (spec 02, RF5)
- **O engenheiro lembra se estava ligado.** Hoje nasce desligado a cada abertura. (spec 03, RF2)
- **O tour roda sobre a demonstração**, sem depender do PS5. (spec 04, RF4)

## Perguntas em aberto

| # | Pergunta | Impacto | Sugestão |
|---|---|---|---|
| 1 | O site usa o domínio `lucassm02.github.io/bono-engineer` ou um domínio próprio? | URL, canonical, sitemap | Começar no `github.io`; trocar depois é um `CNAME`. |
| 2 | Idiomas do site: só pt-BR + resumo em inglês basta? | Esforço de conteúdo | Sim; ampliar conforme o tráfego. |
| 3 | O instalador continua sem assinatura de código? | Aviso do SmartScreen no site | Manter e explicar no site; assinar quando houver certificado. |
| 4 | Mesclar "Pista desconhecida N" (endpoint novo) entra neste ciclo? | Limpeza do histórico | Fica para depois; a spec 05 só lembra. |
