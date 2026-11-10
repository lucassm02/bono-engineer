# Design system do Bono Engineer

Mapeamento da interface (`packages/web`) e regras da remodelação. Este arquivo é o contrato:
quem mexer em tela, modal ou CSS segue o que está aqui.

## 1. Diagnóstico (estado antes da remodelação)

| Problema | Onde estava |
| --- | --- |
| **Dois temas pela metade**: tela ao vivo em preto puro + âmbar (`#ffb21e`); análise e menu em grafite + ciano. Um override `html[data-area="analysis"], .live-menu` trocava as variáveis. | `styles/index.css` (`:root`) |
| **Cores soltas**: ~210 valores hex/rgba espalhados em 27 arquivos (âmbar em canvas, gráficos, bordas, avisos). | CSS + `widgets/useCanvas.ts`, `GCircle`, `SyncCharts`, `CompareMap`, `ComparePage`, `TrackPage` |
| **Botões e campos duplicados** com visuais diferentes: `.btn`, `.a-btn`, `.cx-btn`, `.ob-btn`, `.segmented`, `.switch`. | `index.css`, `analysis.css`, `connection.css` |
| **Modais feitos à mão**, sem padrão de foco, Esc, fundo ou rodapé: menu ao vivo, seletor de telas, painel do console, editor de layout, assistente inicial, seletor de carro, aviso de volta. | `components/*`, `analysis/components/CarPicker.tsx` |
| **Menu ao vivo = um formulário gigante** (rádio do engenheiro inteiro empilhado). | `LiveMenu.tsx`, `EngineerControls.tsx` |
| **Informação colada**: espaçamentos arbitrários (px soltos), sem hierarquia entre título, rótulo, valor e ajuda. | todas as telas |
| **Ícones** redesenhados em cada componente. | `AnalysisApp.tsx`, `Chrome.tsx`, `LiveMenu.tsx` |

## 2. Princípios

1. **Um tema só — "Pit Wall"**: grafite azulado + ciano de sinal (a marca). Ao vivo e análise usam os mesmos valores; muda só a densidade (ao vivo = números enormes, análise = leitura).
2. **Âmbar saiu da interface.** Amarelo (`--warn`) é só alerta. Verde/vermelho/roxo são códigos de corrida (delta, setores, pneus, shift lights): nunca decoram botão.
3. **Hierarquia em três níveis**: rótulo (caixa alta, pequeno, `--text-3`) → valor (grande, `--text`) → ajuda (`--text-3`, 12–13 px). Nunca dois níveis com o mesmo peso visual.
4. **Espaço antes de linha**: separe grupos com `--sp-4/5`, não com bordas em tudo. Cartão = um assunto.
5. **Um padrão por tarefa**: um botão primário por área; ações destrutivas em `danger`; confirmação em modal `sm`.
6. **Toque primeiro**: alvo mínimo 44 px em `pointer: coarse`; foco visível sempre (`--focus-ring`); contraste AA.
7. **Ao vivo só mostra o que importa na curva**; configuração fica no menu/gaveta, nunca em cima dos números.

## 3. Fundação (já pronta — não recriar)

| Arquivo | Conteúdo |
| --- | --- |
| `src/styles/tokens.css` | **Única** fonte de cor, tipografia, espaço, raio, sombra, z-index e movimento. Os nomes antigos (`--panel`, `--dim`, `--accent`, `--bg`...) continuam como alias, mas **código novo usa só os tokens novos**. |
| `src/styles/ui.css` | Componentes `ui-*`: botão, botão de ícone, campo, select, range, interruptor em linha, segmentado, selo/ponto/chip, cartão, cabeçalho de página, estatística, abas, lista de itens, vazio, tecla, modal/folha, toast. |
| `src/components/ui/Modal.tsx` | **Único** modal do app: centro (vira folha embaixo no celular) ou gaveta lateral; foco preso, Esc, fundo, rodapé de ações. |
| `src/components/ui/Icon.tsx` | **Único** conjunto de ícones (traço 1.8, `currentColor`). Adicione ícones aqui, não em cada tela. |
| `src/lib/theme.ts` | Espelho TS dos tokens para canvas/uPlot. `theme.test.ts` falha se divergir de `tokens.css`. |

**Cores de gráfico** (`--chart-1..5` / `SERIES_COLORS`): volta analisada = ciano, referência = roxo, extras = laranja, azul, rosa. São dado, não interface.

**Regra dura:** nenhum `#hex`/`rgb()` novo em CSS ou TSX. Para translúcido use `color-mix(in srgb, var(--x) 20%, transparent)` no CSS e `withAlpha(THEME.x, a)` no canvas. Exceções: `#000`/`#fff` não existem mais; use `--surface-0`/`--text`.

## 4. Mapa da interface

### 4.1 Painel ao vivo (`#/painel`, tela cheia, tablet em paisagem)

| Peça | Arquivos | CSS |
| --- | --- | --- |
| Casca, carrossel, pontos, setas, cadeado, avisos, selos | `App.tsx`, `components/Chrome.tsx`, `Carousel.tsx` | `index.css` |
| Telas: Corrida, Delta grande, Pneus, Inputs, Motor, Mapa, Tempos, Combustível, Forças G, Treino de curva, Personalizada | `views/*.tsx`, `widgets/*` | `index.css`, `views-extra.css` |
| Canvas | `widgets/useCanvas.ts` (`CANVAS_COLORS`), `TrackMap`, `GCircle`, `ShiftLights`, `DeltaBar` | — |
| Engenheiro ao vivo (fala/legenda na tela) | `LiveEngineer.tsx` | `engineer.css` |
| Aviso de volta, telas de status (sem sinal, pausa), **seletor de telas** | `LapPopup.tsx`, `StatusLayer.tsx`, `ViewPicker.tsx` | `overlays.css` |
| **Editor da tela Personalizada** | `LayoutEditor.tsx` | `layout-editor.css` |
| **Menu ao vivo** (gaveta) + botão | `LiveMenu.tsx`, `EngineerControls.tsx`, `EngineerReference.tsx`, `EngineerTraining.tsx`, `FullscreenButton.tsx` | `live-menu.css`, `engineer.css` |
| **Conexão com o PS5** (chip, painel, assistente inicial) | `ConsoleLink.tsx`, `Onboarding.tsx` | `connection.css` |
| Captura automática, replay, sessão salva, atualização | `CaptureStatus.tsx`, `ReplayNotice.tsx`, `UpdateNotice.tsx` | `capture-status.css`, `update-notice.css` |

### 4.2 Área de análise (`#/inicio`, `#/analise/*`, `#/captura`, `#/config`, `#/coach`, `#/guia`)

| Peça | Arquivos | CSS |
| --- | --- | --- |
| Casca (barra lateral no PC, barra inferior no celular), toasts, erro de página | `analysis/AnalysisApp.tsx` | `analysis.css`, `home.css` |
| Início por pista, Sessões, Sessão, Pista | `pages/HomePage`, `SessionsPage`, `SessionPage`, `TrackPage`; `components/TrackNaming`, `TrackFicha`, `TrackThumb`, `ReferenceList`, `LapActions`, `DrivingEventsPanel`, `FindingsPanel` | `analysis.css`, `home.css`, `tracks.css`, `track-page.css` |
| Carros (logos, filtro, **seletor modal**) | `CarPicker`, `CarSelect`, `CarName`, `BrandLogo` | `cars.css` |
| Comparar voltas | `pages/ComparePage`, `components/SyncCharts`, `CompareMap`, `CornerTable`, `MiniChart` | `compare.css` |
| Captura de referência | `pages/CapturePage` | `capture.css`, `capture-page.css` |
| Configurações | `pages/ConfigPage`, `components/DiscordSettings` | `config.css` |
| Coach IA / Guia | `pages/CoachPage`, `GuidePage`, `components/Markdown`, `EngineerRadioReview` | `coach.css`, `guide.css` |

## 5. Fatias de trabalho (arquivos disjuntos)

| Fatia | Dono de |
| --- | --- |
| **A — Painel ao vivo** | `index.css`, `views-extra.css`, `engineer.css` (só a parte de legenda ao vivo), `App.tsx`, `Chrome.tsx`, `Carousel.tsx`, `views/*`, `widgets/*`, `LiveEngineer.tsx`, `lib/tyreColor.ts` |
| **B — Gavetas, modais e conexão** | `LiveMenu`, `EngineerControls/Reference/Training`, `FullscreenButton`, `ViewPicker`, `LayoutEditor`, `LapPopup`, `StatusLayer`, `ConsoleLink`, `Onboarding`, `CaptureStatus`, `ReplayNotice`, `UpdateNotice` + `live-menu.css`, `overlays.css`, `layout-editor.css`, `connection.css`, `capture-status.css`, `update-notice.css` |
| **C — Casca e histórico** | `AnalysisApp`, `analysis.css`, `home.css`, `tracks.css`, `cars.css`, Home/Sessions/Session/Track pages e seus componentes, `CarPicker` |
| **D — Comparar, captura, ajustes, coach, guia** | `ComparePage` + `compare.css`, `CapturePage` + `capture.css`/`capture-page.css`, `ConfigPage`/`DiscordSettings` + `config.css`, `CoachPage`/`GuidePage`/`Markdown`/`EngineerRadioReview` + `coach.css`/`guide.css`, `SyncCharts`, `CompareMap`, `MiniChart`, `CornerTable` |

Compatibilidade: classes antigas (`.a-btn`, `.a-card`, `.btn`...) continuam existindo, mas passam a ser **reestilizadas com tokens** (ou substituídas pelas `ui-*`). Quem trocar um nome de classe usado fora da sua fatia deve manter um alias.

## 6. Critérios de pronto

- Zero hex/rgb literal fora de `tokens.css` e `theme.ts` (verificar com busca).
- Zero âmbar `#ffb21e`/`#ff7a2f` e variantes.
- Todo modal usa `Modal`; todo botão usa `ui-btn` / `ui-icon-btn`.
- Ao vivo e análise indistinguíveis em paleta (mesmo ciano, mesmas superfícies).
- Funciona em 1360×820, tablet paisagem (1024×768) e celular (375×812).
- `npm run typecheck`, `npm run lint` e `npm test` passam.
