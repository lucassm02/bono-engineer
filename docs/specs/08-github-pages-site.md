# Spec 08 · Site do Bono no GitHub Pages (com SEO)

**Status:** proposta · **Depende de:** [spec 01](01-ux-refinement.md) (a interface precisa estar pronta para ser mostrada) · usa o [design system](../design-system.md)

## Objetivo

Uma página pública que explique o Bono em dez segundos, mostre a interface real e leve ao
download. **Ser encontrada** por quem pesquisa coisas como "telemetria Gran Turismo 7",
"engenheiro de pista GT7", "rádio Discord GT7" ou "analisar voltas GT7". Sem backend, hospedada de
graça em `https://lucassm02.github.io/bono-engineer/` (ou domínio próprio, se existir).

## Público e tarefa principal

Sim racers brasileiros de GT7 no PlayStation (secundário: público em inglês). A tarefa é
**baixar e instalar**; a segunda é entender se o Bono serve para o que a pessoa faz (treinar pista,
comparar voltas, ouvir instruções).

## Direção visual

Mesma identidade do app (grafite + ciano "Pit Wall", números tabulares), mas como **peça de
vitrine**, não como cópia do painel:

- **Herói = o painel ao vivo de verdade**: uma captura em alta (ou um vídeo curto em loop, sem
  áudio, ≤ 1,5 MB) da tela Corrida com delta, marcha e velocidade, e o texto de uma instrução do
  engenheiro aparecendo ("Freio na T4, solta cedo"). É a coisa mais característica do produto.
- Tipografia: a mesma pilha DIN/Bahnschrift para números; um sans de leitura para o texto. Sem
  estilo "SaaS genérico" (cartões idênticos, gradientes de enfeite).
- Capturas reais: Ao vivo, Comparar voltas (gráficos sincronizados), Início por pista, Menu
  do engenheiro. Geradas por script a partir do modo `?mock=1` para ficarem sempre atuais.
- Tema escuro único; respeita `prefers-reduced-motion`; móvel primeiro.

## Estrutura (uma página + três páginas de conteúdo)

| Página | Função | Palavras-chave |
|---|---|---|
| `/` Início | Herói, 4 benefícios, como funciona em 3 passos, download, FAQ | telemetria GT7, engenheiro de pista |
| `/install/` | Instalação e primeira conexão com o PS5 (aproveita o assistente) | instalar telemetria GT7 PS5 |
| `/radio-discord/` | Passo a passo do rádio no Discord (spec 07) | rádio Discord GT7, engenheiro no PS5 |
| `/driving-guide/` | Versão pública do guia (já existe em `docs/driving-guide.md`) | como melhorar volta GT7 |
| `/en/` | Resumo em inglês (hreflang) | GT7 telemetry, race engineer |

Seções do Início, em ordem: herói · "O que ele faz" (4 itens: ao vivo, rádio, comparar, coach) ·
"Como funciona" (conectar → dirigir → analisar) · galeria com legenda · privacidade ("seus dados
ficam no seu PC") · download (versão atual, link para a Release, aviso de que o instalador não é
assinado e como contornar o SmartScreen) · FAQ · rodapé com aviso "projeto pessoal, sem relação com
a Polyphony Digital ou a Sony".

## SEO (requisito de primeira classe)

**Técnico**
- HTML estático semântico (`header/main/section/footer`, um único `h1`, hierarquia `h2/h3`), sem
  framework de cliente: o conteúdo existe no HTML inicial.
- `<title>` e `<meta name="description">` únicos por página (≤ 60 e ≤ 155 caracteres), com a
  palavra-chave principal no começo. Ex.: "Bono Engineer · Telemetria e engenheiro de pista para GT7".
- `<link rel="canonical">`, `lang="pt-BR"` e `hreflang` pt-BR ↔ en.
- Open Graph e Twitter Card com imagem 1200×630 por página (gerada por script).
- `sitemap.xml` e `robots.txt` gerados no build; sitemap enviado ao Google Search Console e ao Bing.
- Dados estruturados JSON-LD: `SoftwareApplication` (nome, categoria *GameApplication*,
  sistema operacional Windows, preço 0, versão, URL de download) e `FAQPage` na seção de perguntas.
- Imagens com `alt` descritivo, `width/height`, `loading="lazy"` abaixo da dobra, AVIF/WebP com
  *fallback*; herói com `fetchpriority="high"`.
- Desempenho: Lighthouse ≥ 95 em Performance, Acessibilidade, Boas práticas e SEO; LCP < 2 s em
  3G rápido; CSS crítico inline, fontes do sistema (nenhuma fonte web bloqueante).
- URLs curtas e em português, sem parâmetros; páginas 404 útil (`404.html`) com links.

**Conteúdo**
- Cada página responde a uma pergunta que a pessoa digitaria na busca; textos próprios, com
  linguagem de piloto, não de ficha técnica.
- Texto de ajuda do guia de pilotagem reaproveitado como conteúdo indexável (ganha cauda longa).
- Links internos entre as páginas e do repositório para o site (e vice-versa).

**Fora do site (descoberta)**
- No repositório: *About* com descrição e site, e **topics**: `gran-turismo-7`, `gt7`, `telemetry`,
  `sim-racing`, `race-engineer`, `playstation`, `discord-bot`, `electron`.
- `README.md` começando por uma frase com as palavras-chave, link para o site e captura do painel.
- Releases com notas legíveis (o texto vira conteúdo indexado e linkado).
- Verificar a propriedade no Google Search Console (meta tag no `index.html`) e acompanhar
  consultas e cliques.

## Implementação

- Pasta `site/` no repositório (HTML + CSS + um `build.mjs` de ~100 linhas que injeta metadados,
  gera sitemap, copia `tokens.css`/`ui.css` e otimiza imagens). Sem dependência de runtime.
- Workflow `.github/workflows/pages.yml`: em *push* na `main` com mudanças em `site/` ou `docs/`,
  roda o build e publica com `actions/deploy-pages`. Pages configurado para "GitHub Actions".
- Script `npm run site:shots` captura as telas com o modo demonstração (`?mock=1`) usando o
  Chromium que já vem com o Electron do projeto, para manter as imagens atualizadas sem
  adicionar uma ferramenta nova.
- Domínio próprio opcional: arquivo `CNAME` + HTTPS forçado.

## Critérios de aceite

1. Página publicada em `github.io` com HTTPS; Lighthouse ≥ 95 nas quatro categorias (relatório
   anexado ao PR).
2. `sitemap.xml`, `robots.txt`, canonical, OG e JSON-LD válidos (Rich Results Test e validador
   de OG sem erros).
3. Buscar o nome "Bono Engineer GT7" retorna o site em até 4 semanas após o envio do sitemap
   (acompanhar no Search Console; fora do controle do código, mas a meta é monitorada).
4. Funciona em 375 px, 1024 px e 1440 px, com teclado e leitor de tela (contraste AA).
5. Todos os textos e imagens refletem a versão atual do app (verificação no CI: versão do site =
   versão do `package.json`).

## Fora de escopo

Blog, comentários, analytics com *cookies* (se quiser métricas, usar contagem sem cookie), loja,
login. Tradução completa para outros idiomas além do resumo em inglês.
