# Spec 04 · Tour guiado

**Status:** proposta · **Depende de:** [03](03-setup-assistant.md) (dispara o tour) · usa [design system](../design-system.md)

## Problema

Hoje não existe tour, dica contextual nem *coach-marks*; o que há é `title=` nativo, textos de
ajuda e o assistente de conexão. A interface tem **gestos que ninguém descobre sozinho**: segurar
a tela abre o seletor de telas, toque duplo troca a referência do delta, **M** abre o menu,
arrastar muda de tela, segurar o cadeado destrava.

## Objetivo

Um tour curto (≈ 60 s por área) que mostra **onde estão as coisas e o que cada gesto faz**, sem
depender de o piloto estar na pista. Opcional, repetível, nunca bloqueia.

## Tours

### Tour do painel ao vivo (7 passos)

Roda sobre o **modo demonstração** (dados simulados do `mock`, sem tocar nos dados reais nem
exigir o PS5). O app volta ao estado anterior ao terminar.

| # | Âncora | Texto (rascunho) |
|---|---|---|
| 1 | Faixa de contexto (spec 05) | "Aqui o Bono diz em que pista você está e se o engenheiro está pronto." |
| 2 | Delta grande | "Verde: você está mais rápido que a referência. Vermelho: mais lento." |
| 3 | Marcha e velocidade | "O que você precisa ler de relance, sempre no mesmo lugar." |
| 4 | Setores S1/S2/S3 | "Cada setor mostra a diferença para a sua melhor volta." |
| 5 | Pontos de navegação (e gesto de deslizar) | "Deslize para o lado ou use as setas para trocar de tela. Segure a tela para escolher quais mostrar." |
| 6 | Botão do menu (**M**) | "Ligue o engenheiro, troque a voz e vá para o histórico por aqui." |
| 7 | Cadeado | "Trava os gestos durante a volta. Segure para destravar." |

### Tour da análise (5 passos)

| # | Âncora | Texto |
|---|---|---|
| 1 | Barra lateral | "Ao vivo, Início, Comparar, Gravar volta, Coach, Guia e Ajustes." |
| 2 | Cartão de pista no Início | "Cada pista guarda suas sessões, melhor volta e evolução." |
| 3 | Comparar voltas | "Escolha uma volta e uma referência e veja onde está o tempo." |
| 4 | Gravar volta de replay | "Capture a volta de um piloto melhor para usar de referência." |
| 5 | Ajustes → "Refazer o assistente" | "Você pode refazer o tour e o assistente quando quiser." |

## Quando aparece

- Depois do passo 6 do assistente (botão **Ver o tour**) e pelo convite leve para quem já usava.
- Sempre disponível: **Menu → Ajuda → Ver o tour** (ao vivo e análise) e **Ajustes → Sobre**.
- Nunca durante pilotagem; se o carro estiver na pista, o botão avisa "Disponível quando você
  parar" e agenda para a próxima pausa.
- Dicas únicas (balão pequeno, 1 vez): primeira vez que o engenheiro fala ("Quer que ele fale
  menos? Menu → Engenheiro"), primeira volta sem referência, primeira sessão salva.

## Experiência

- **Destaque**: máscara escura (`--overlay`) com recorte no elemento e anel `--accent`; balão com
  título, texto (≤ 160 caracteres), "Passo 3 de 7", **Voltar**, **Próximo**, **Pular tour**.
- Teclado: **→/Enter** avança, **←** volta, **Esc** sai. Foco preso no balão (reusa a lógica do
  `Modal`). Alvos ≥ 44 px. `prefers-reduced-motion`: sem animação do recorte.
- Posicionamento automático (acima/abaixo/lado) com limite na tela; reposiciona ao redimensionar
  ou girar o tablet.
- Passo cuja âncora não existe (tela desligada no perfil) é pulado sem erro.

## Requisitos

- **RF1.** Componente `Tour` próprio (sem biblioteca, ~250 linhas) em `components/ui/Tour.tsx`,
  guiado por uma lista de passos `{ id, selector: '[data-tour="x"]', title, body, route? }`.
- **RF2.** Âncoras com `data-tour="…"` nos elementos reais; contrato testado (cada passo aponta
  para um seletor que existe na tela correspondente).
- **RF3.** Estado: `gt7.tour.v1 = { live: done|skipped, analysis: done|skipped, hints:{…} }`.
- **RF4.** Modo demonstração temporário: `startTourDemo()` troca a fonte para `mock` e restaura a
  anterior ao sair, sem gravar sessão nem mexer em `sessionCapture`.
- **RF5.** Ações do tour **não alteram dados**: nada de salvar configuração, criar pista ou apagar.
- **RF6.** Textos no glossário (spec 01), traduzidos junto com o idioma do app.

## Critérios de aceite

1. Quem conclui o tour sabe responder, sem olhar: como trocar de tela, como abrir o menu e o que
   significa a cor do delta (teste com 3 pessoas).
2. O tour do painel roda sem PS5 e termina restaurando a fonte e a tela anteriores.
3. Navegável só por teclado e anunciado para leitor de tela.
4. Passos sem âncora não quebram o tour; testes cobrem todos os seletores.
5. "Pular" e "Esc" nunca reabrem o tour sozinhos; só o botão de ajuda.

## Riscos

| Risco | Mitigação |
|---|---|
| Tour sobre tela com dados reais assusta ("o que ele fez?") | Roda sobre a demonstração, com faixa "Demonstração" visível. |
| Âncoras quebram em refatorações | Teste de contrato e `data-tour` documentado no design system. |
