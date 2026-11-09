# Pesquisa: pontos de frenagem, voltas de referência, recordes e conhecimento de pilotagem

Data da pesquisa: 2026-11-09. Autor: pesquisador técnico (subagente). Escopo: enriquecer o GT7 Race Engineer com dados
externos sobre frenagem, linhas, voltas de referência/recordes e conhecimento de pilotagem por pista e por categoria
de carro (Gr.1, Gr.2, Gr.3, Gr.4, Gr.B, N-classes). Nenhum código do app foi alterado.

## 0. Resumo executivo

1. **Não existe base aberta de pontos de frenagem, velocidades de curva, marchas ou linha ideal do GT7** (nem por pista,
   nem por categoria de carro). Procurei em GitHub (busca por repositórios e tópicos), GTPlanet, DG-EDGE, Coach Dave,
   Hugging Face e Kaggle. O que existe de aberto é **geometria da pista** (bordas, apex de curvas, ids oficiais, nº de
   curvas, extensão), não frenagem.
2. **O melhor ativo aberto achado**: `jbhoorasingh/gt7-datalogger-track-data` (**CC0** para dados, MIT para ferramentas):
   catálogo oficial com ids hexadecimais de pista/layout, nº de curvas, extensão, desnível, maior reta, e geometria de
   32 layouts levantados, com 162 curvas rotuladas (apex x/z, sem frenagem). Na prática serve para **nomear
   pistas automaticamente** e **validar a detecção de curvas**.
3. **Telemetria de pilotos de ponta só existe via replay no jogo.** O PS5 emite o stream UDP também durante o replay,
   e é assim que o app (e `gt7-timetrials`, Coach Dave Delta, `gt7dashboard`, `gt7-toolz`) captura voltas de elite.
   Não há API pública de replay nem download de arquivo de replay fora do jogo (confirmado em parte: ver 2.3).
4. **Tempos de referência** (WR e meta de ouro = WR x 1,03 do Time Trial) estão numa API não oficial sem login
   (`web-api.gt7.game.gran-turismo.com`) e num repositório que já a consome (`gt7-timetrials`), mas **sem licença
   declarada** e com risco de ToS médio. Dá para mostrar como dado opcional, não para embarcar.
5. **Não achei datasets de telemetria GT7 no Hugging Face nem no Kaggle.** Os únicos arquivos de voltas públicos são 3 CSVs
   de referência em `gt7-timetrials` (sem licença) e exemplos pequenos em `GT7Analyzer` (MIT).
6. **Conhecimento de pilotagem em texto**: boas fontes em inglês (DG-EDGE, Coach Dave Academy, guia oficial Polyphony
   "Beyond the Apex", fóruns do GTPlanet). **Em pt-BR não achei nenhuma fonte de qualidade** sobre técnica no GT7
   (só blogs SEO fracos). A base de conhecimento terá de ser **escrita por nós, em pt-BR, resumindo** as fontes em inglês,
   com a ligação para a fonte.
7. **A saída mais viável**: **derivar os pontos de frenagem das voltas que o app já captura** (suas e de replays top) e
   compartilhá-los em "pacotes de pista" JSON versionados (seção 6). É uma lacuna de mercado real: nenhuma ferramenta
   aberta publica isso.

## 1. Tabela de fontes

Legenda: Q = qualidade/utilidade para o app (0 a 5); I = facilidade de integração (0 a 5); Risco = legal/ToS.
"Embarcar" = pode ir no repositório do app (licença permissiva e atribuição); "Linkar" = só referenciar/ler em tempo de
execução ou citar.

| # | Fonte | O que tem | Formato / acesso | Cobertura | Licença | Q | I | Risco | Como integrar | Embarcar? |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | [jbhoorasingh/gt7-datalogger-track-data](https://github.com/jbhoorasingh/gt7-datalogger-track-data) | catálogo oficial de pistas/layouts (ids, curvas, extensão, desnível), geometria de bordas, apex das curvas, assinaturas de reconhecimento | JSON (`catalog/tracks.json`, `index.json`, `signatures.json`, `tracks/<slug>.json` v5), raw do GitHub | catálogo: 42 pistas / 86 layouts; `index.json`: 122 configurações, **32 levantadas**, 162 curvas rotuladas | **CC0 1.0** dados; MIT ferramentas (catálogo é "metadado factual, não afiliado a PD/Sony") | 4 | 5 | baixo | script de geração (`gen-tracks.mjs`) gerando um `.ts` versionado com `ref` do commit, como já feito para carros | **Sim** |
| 2 | [ddm999/gt7info](https://github.com/ddm999/gt7info) | carros, makers, pistas (db), diária, usados, BoP de pista (`track-bop.txt`) | CSV/JSON em `_data/db` | todos os carros e pistas | **MIT-0** | 5 | 5 | baixo | **já usado** para o catálogo de carros (`gen-cars.mjs`). Estender para `courses` | **Sim** (já embarcado para carros) |
| 3 | [zetetos/gt-telemetry](https://github.com/zetetos/gt-telemetry) | 85 voltas de captura de circuito (coordenadas de mundo), inventário de veículos | JSON (`pkg/circuits/inventory`), Go | 85 layouts | **MIT** | 3 | 4 | baixo | usar como semente de linha central por pista (comparar com a nossa); atribuição | **Sim** (com atribuição) |
| 4 | [jbhoorasingh/gt7-datalogger](https://github.com/jbhoorasingh/gt7-datalogger) | app com relatório de curva (ponto de frenagem, pico, zona), volta de lap JSON v2, export CSV MoTeC | Python/React; JSON v2, CSV | 80 assinaturas embutidas | **MIT** | 4 | 3 | baixo | usar como inspiração e **referência de formato**; não traz dados de frenagem | Ideias sim, dados não existem |
| 5 | [gt7-timetrials/gt7-timetrials.github.io](https://github.com/gt7-timetrials/gt7-timetrials.github.io) | histórico de 204 eventos de Time Trial (pista, carro, WR, ouro, spread top-100), análise curva a curva, `docs/api_findings.md` com os endpoints, 3 CSVs de volta WR | `data.json`, `events/<id>.json`, `data/reference_laps/*.csv` | só eventos de TT; 3 voltas WR | **sem licença** (todos os direitos reservados por padrão) | 4 | 2 | médio | só **linkar** e/ou ler `data.json` com cache, opt-in. Não copiar CSVs | **Não** |
| 6 | API não oficial `web-api.gt7.game.gran-turismo.com` | folder de eventos, parâmetros, top-100 de cada ranking | POST JSON sem login para `get_folder`, `get_parameter`, `get_top_list`; `get_list_by_page` exige token PSN | todos os Time Trials desde 03/2023 | não documentada; ToS da Sony não verificado | 4 | 3 | médio/alto | runtime opt-in com cache e rate limit de 1 req/2 s; não gravar nomes PSN | **Não** |
| 7 | [xman1340/Gran-Turismo-7-Ghost-Finder](https://github.com/xman1340/Gran-Turismo-7-Ghost-Finder) | userscript que procura voltas com replay nos rankings oficiais | Tampermonkey, CSV de export | rankings, TT, Daily | **sem licença** | 2 | 1 | médio | só linkar como fonte de ideia | **Não** |
| 8 | [snipem/gt7dashboard](https://github.com/snipem/gt7dashboard) | dashboard ao vivo com delta contra volta de referência, linha com pico/vale de velocidade, pontos de frenagem opcionais (`GT7_ADD_BRAKEPOINTS`), "Save Laps" em JSON | Python/Bokeh | só voltas do usuário | **GPL-3.0** | 3 | 1 | baixo (conceito), alto (copiar código) | só ideias, **não copiar código** | **Não** |
| 9 | [Bornhall/gt7telemetry](https://github.com/Bornhall/gt7telemetry) | logger Python; tem `gt7trackdetect.csv` (detecção de pista) | CSV | pistas do GT7 | **GPL-3.0** | 2 | 1 | alto se copiar | só ideias | **Não** |
| 10 | [nfMalde/gt-toolz](https://github.com/nfMalde/gt-toolz) | coach por regras fixas com textos escritos à mão; mede ponto de frenagem da referência (replay ou 3 voltas) | TS/Electron | por pista aprendida | **GPL-3.0** | 3 | 1 | alto se copiar | referência de **abordagem** (regra fixa + texto) | **Não** |
| 11 | [szilvasolutions/GT7_AI_coach](https://github.com/szilvasolutions/GT7_AI_coach) | coach de IA falado, detecção de erros por física | binário Windows, **fonte proprietária** | 84 pistas "auto-detectadas" | proprietária | 2 | 0 | alto | nenhuma | **Não** |
| 12 | [GeekyDeaks/sim-to-motec](https://github.com/GeekyDeaks/sim-to-motec) | converte UDP do GT7 para MoTeC `.ld`/`.ldx` | Python | n/a | sem licença visível | 2 | 1 | médio | só linkar | **Não** |
| 13 | [andreaskalantonis/gt7-companion](https://github.com/andreaskalantonis/gt7-companion) | 590 carros, 122 layouts, extensão/desnível/curvas, recordes de volta **reais** (Wikipedia) | HTML + pipeline | catálogo | misto: MIT-0 (gt7info), CC BY-SA (Wikipedia), ODbL (OSM) | 2 | 2 | baixo | as "recordes" são de **corrida real**, não do GT7. Não usar como alvo | Não |
| 14 | [Nenkai/PDTools](https://github.com/Nenkai/PDTools) | SimulatorInterface GT6/GTS/GT7, LiveTimingApi, utilidades | C#, **MIT** | n/a | MIT | 3 | 2 | baixo | referência de pacotes UDP já cobertos pelo app | n/a |
| 15 | [GT7Analyzer](https://github.com/RealJean42/GT7Analyzer) | amostras de telemetria em JSON/CSV (`ExampleData`) | JSON/CSV | pequena amostra | **MIT** | 2 | 3 | baixo | só como fixture de teste, se o conteúdo for útil | Sim (fixtures) |
| 16 | [Coach Dave Delta (GT7)](https://coachdaveacademy.com/gran-turismo-7) | voltas de referência semanais de pilotos da GT World Series (Pro, Daily, Time Trial), análise automática | app pago (a partir de £4,99/mês), sem API pública documentada | Daily e TT semanais | proprietária | 4 | 0 | alto se extrair | só linkar. O caso de uso é igual ao nosso | **Não** |
| 17 | [Traces (DG-EDGE)](https://traces.dg-edge.com/) | comparação de voltas, brake/throttle/linha por curva, overlays | app pago (€4,99/mês), sem API | só voltas do usuário | proprietária | 3 | 0 | alto se extrair | só linkar | **Não** |
| 18 | Garage61, Track Titan | não suportam GT7 (Track Titan lista iRacing, ACC, AC, F1, Forza, LMU) | n/a | n/a | n/a | 0 | 0 | n/a | descartar | n/a |
| 19 | [DG-EDGE](https://www.dg-edge.com/database/tracks) (banco de pistas, stats, guias) | extensão, curvas, eventos, estatística de recordes ao longo do tempo (gráfico), guias de técnica | HTML, sem API nem export | todos os layouts (sem texto de curva) | © DG-EDGE | 3 | 1 | médio se raspar | link e resumo próprio dos guias | **Não** |
| 20 | [GTSH-Rank](https://www.gtsh-rank.com/) | rankings DR, Daily, TT, telemetria base | HTML, sem API documentada | 3,1 M jogadores | desconhecida | 2 | 0 | médio | só link | **Não** |
| 21 | Data Logger do jogo (Spec III) | gráficos de linha/velocidade, entradas e G, RPM; carrega suas melhores voltas **ou o replay dos mais rápidos do ranking** | só dentro do jogo; sem export documentado | Time Trial, Centro de Licenças, Circuit Experience | Polyphony | 4 | 0 | n/a | fonte de captura (replay) já coberta pelo fluxo do app | n/a |
| 22 | Hugging Face / Kaggle | nada de telemetria GT7 (só um dataset de 24 legendas de GT4) | n/a | n/a | n/a | 0 | 0 | n/a | n/a | n/a |

## 2. Respostas por tema

### 2.1 Existem dados estruturados de pontos de frenagem, velocidades de curva, marchas e linha ideal?

**Resposta curta: não, não de forma aberta.** O que há de estruturado e aberto é:

- **Geometria e catálogo da pista** (item 1, 2, 3 da tabela). Exemplo real do `catalog/tracks.json`:
  `24 Heures du Mans ... official_id c272b2, turns 38, length_m 13629, elevation_m 37.3, longest_straight_m 1679`.
  O bundle `tracks/suzuka-circuit.json` (1,4 MB) tem `edges`, `finish_crossings`, `corners`, `sections`, `sectors`; cada
  curva é `{n, name, direction, apex:{x,z}, entry, exit, note}` e as de Suzuka estão **sem nome e sem entrada/saída**. Ou
  seja, só o apex. O README deles afirma que os dados são "as bordas da pista, não a linha de corrida".
- **Telemetria própria** exportada por apps (JSON/CSV/MoTeC), que contém frenagem **da volta do usuário**.
- **Guias de pista em texto** (Coach Dave tem guias "turn by turn" com marcos, marchas e linha, mas a amostra que li
  (Nürburgring GP) **não é do GT7**; DG-EDGE tem páginas de pista só com estatísticas e eventos, sem texto de curva).
- No GTPlanet há threads de discussão (por exemplo "Braking Points" e "How do you learn new tracks?"), com conselhos
  genéricos: aprenda marcos fixos (placas 100 m/50 m, zebras), cones de frenagem foram pensados para Gr.3, o alerta
  vermelho "é cedo demais" para quem anda no limite. Isso é texto livre, não dado estruturado. As páginas do GTPlanet
  devolveram 403 para o meu leitor; o que cito do fórum vem dos trechos dos resultados de busca e deve ser conferido à mão.
- Não achei planilha do Google com pontos de frenagem do GT7. A única planilha pública que apareceu é a **descrição não
  oficial do pacote UDP** (comunidade GTPlanet).
- "Super GT" (canal/site) não apareceu como fonte de dados; não consegui identificar a que se refere.

**Pontos de atenção sobre `gt7dashboard`:** o recurso "Time-trial" não existe como modo; o que existe é escolher a "volta de
referência" no dropdown (padrão: melhor volta). Pontos de frenagem são opcionais (`GT7_ADD_BRAKEPOINTS=true`, lento).
Licença GPL-3.0 (via API do GitHub).

### 2.2 Voltas de referência e recordes

- **Ranking oficial**: o site Sport Mode do gran-turismo.com mostra rankings de Time Trial, Daily Race e Campeonatos
  (exige login). A API que o site usa é **não oficial e não documentada**; `gt7-timetrials/docs/api_findings.md`
  (outubro de 2026) descreve:
  - base `https://web-api.gt7.game.gran-turismo.com`, todas as chamadas `POST` com JSON;
  - **sem login**: `/event/get_folder` (`{"region_id":5,"folder_id":249}`), `/event/get_parameter` (`{"event_id":15000}`) e
    `/ranking/get_top_list` (`{"board_id":"p_rt_1015000_001"}`, devolve top 100 e `total`);
  - **com token PSN**: `/ranking/get_list_by_page`;
  - limite de taxa de balanceador AWS: "algumas centenas de requisições seguidas" causam 403 de 3 a 5 minutos; **1 req a
    cada 2 s** funcionou em milhares de chamadas;
  - campos de entrada: `display_rank`, `score` (ms), `ranking_stats.car_code`, `user.np_online_id` (nome PSN), `country_code`,
    `driver_rating`. Não há campo de plataforma.
  - Nota: a requisição do GitHub Actions é bloqueada com 403 (eles rodam via sessão agendada).
- **DG-EDGE** mostra WR por evento e um gráfico de "recordes da pista ao longo do tempo", mas **sem API nem export**. O
  GTPlanet publica um post por Time Trial semanal com WR e meta de ouro; Coach Dave publica estimativas de ouro.
- **Meta de ouro do Time Trial**: WR x 1,03 (Coach Dave e `gt7-timetrials`). Verifiquei: 109 897 ms x 1,03 = 113 193 ms, que é o
  `gold_ms` do evento 15000 em `data.json`.
- **Tabela pública utilizável?** Só o histórico de `gt7-timetrials/data.json` (204 eventos, campos `track`, `car`, `wr_ms`,
  `gold_ms`, `top100_spread_pct`, `wr_holder`). Os eventos misturam carros (estrada, Gr.3, VGT) e **não mapeiam para classes**,
  então não vira "alvo por categoria"; só serve como alvo quando a combinação pista + carro bate com o evento.

Exemplos reais de `data.json` (WR e ouro do evento):

| Pista | Carro | WR | Ouro (WR x 1,03) |
|---|---|---|---|
| Circuit de Barcelona-Catalunya GP sem chicane | Hyundai ELANTRA N TC '24 | 1:49.897 | 1:53.193 |
| SUGO International Racing Course | Xiaomi Vision Gran Turismo | 1:16.458 | 1:18.751 |
| Dragon Trail - Gardens | GReddy Fugu Z | 1:45.285 | 1:48.443 |
| Brands Hatch GP | Toyota GR Corolla MORIZO '22 | 1:39.135 | 1:42.109 |
| Michelin Raceway Road Atlanta | Porsche 963 '24 | 1:08.039 | 1:10.080 |

(Os tempos refletem o dia da consulta; o WR cai durante o evento, e o próprio autor mostra que a maior parte dos WR sai até
o dia 8.)

### 2.3 Telemetria de voltas de pilotos de ponta

**Confirmado: só via replay dentro do jogo.** Evidências:

- O jogo envia o stream UDP (~60 pacotes/s) também durante replays. `gt7-timetrials/docs/telemetry.md` descreve o fluxo:
  baixar o replay do WR do ranking, assistir até o fim da volta com um gravador na mesma rede (`py telemetry.py`), salvar CSV.
- Coach Dave afirma que, se sua volta entra no top 10 global, **o replay é carregado automaticamente** para os outros
  assistirem ou usarem como fantasma. O Data Logger do Spec III permite **carregar o replay dos mais rápidos do ranking**
  para comparação dentro do jogo (não encontrei documentação de export).
- Ghost Finder usa `replay_id` diferente de zero nos rankings para saber que existe fantasma; o usuário "confirma Load Ghost
  no jogo". Ou seja, **não há download de arquivo de replay fora do console**.
- Qualidade: um usuário do GTPlanet relatou que os dados de replay parecem suavizados/menos resolvidos que os ao vivo, e
  que a leitura de combustível não é confiável no replay; o próprio app já diz isso (`README.md`, "dados de replay são
  suavizados", precisão de poucos metros). Marcador de entrada/saída do replay: pacote de carregamento/processamento.
- Como os outros apps fazem: `gt7-timetrials` (CSV por pacote), Coach Dave Delta ("abra o Delta, carregue o GT7, assista ao
  replay" e a telemetria é capturada), `gt7dashboard` (grava replay), `gt-toolz` ("aprende a referência de um replay do GT7").
  **O app já implementa isso** (captura de referência com validação de comprimento ±2%, tempo ±0,3 s, perda de pacotes).

CSV real de referência em `gt7-timetrials` (cabeçalho):
`time_s,packet_id,lap,laps_total,best_lap_ms,last_lap_ms,car_code,x,y,z,speed_kmh,throttle_pct,brake_pct,gear,rpm,steering_rad,yaw_rate,pitch,yaw,roll,wheel_fl_kmh,...,on_track,paused,loading,tcs_active,asm_active`
(CSV de ~1,4 MB por volta). O algoritmo de curvas deles é descrito em `docs/telemetry.md` e é uma boa base de
comparação (curva = ponto ≥10 km/h mais lento que os vizinhos; seção começa 10 m antes da frenagem; medidas por curva:
ponto de frenagem, pico, tempo >90%, trail braking, V-mín, volta ao acelerador 20%/95%, reversões de acelerador).
O app já tem métricas equivalentes (`packages/analysis`).

**Aviso legal/privacidade**: o ranking contém nome PSN; replays são conteúdo dos jogadores/da PD. Para compartilhar dados
derivados, usar **só estatísticas agregadas anônimas** (mediana, MAD), nunca nome nem volta bruta de terceiros.

### 2.4 Datasets de telemetria GT7 compartilhados pela comunidade

| Achado | Conteúdo | Licença | Veredito |
|---|---|---|---|
| `gt7-timetrials/data/reference_laps/` | 3 CSVs de volta WR (um é Fuji) + `drivers.json` | **nenhuma** | não usar; só como ideia |
| `zetetos/gt-telemetry` `data/replays` (`.gtr`/`.gtz`) e `data/circuits` | capturas de circuito (85 voltas, coordenadas de mundo) | MIT | usar para geometria, não há frenagem |
| `RealJean42/GT7Analyzer` `ExampleData` | amostra JSON/CSV | MIT | só fixture de teste |
| Hugging Face (busca `gran turismo`) | `alexmailoff/granturismo_events`: 24 legendas de UI do **GT4** | sem licença | irrelevante |
| Kaggle | nada encontrado (o leitor não renderiza a busca, o resultado de pesquisa web também não trouxe nada) | n/a | lacuna |

Não há arquivos `.gt7rec` da comunidade: `.gt7rec` é o formato de gravação do próprio app. Na comunidade os formatos são
CSV por pacote, JSON v2 (gt7-datalogger), `.gtr/.gtz` (zetetos), JSONL (MoebiusX), `.ld` (sim-to-motec).

### 2.5 Conhecimento de pilotagem em texto (para a base do coach)

**Fontes de qualidade** (todas em inglês; **nenhuma em pt-BR de qualidade**):

| Fonte | Tema | Observação |
|---|---|---|
| [DG-EDGE: 5 Reasons Why You Can't Go Faster](https://www.dg-edge.com/articles/guides/5-reasons-why-you-can-t-go-faster-in-gran-turismo-7/517) (Mihael Matika, 04/2025) | referências fixas, frear a tempo, usar a pista toda, modular freio (~50% em curvas médias), não "sobrefrear" | resumir |
| [DG-EDGE: Physics Update 1.49](https://dg-edge.com/articles/guides/gran-turismo-7-physics-update-1-49-breakdown/424) | carros mais pesados, frear antes e em reta, trail braking aquece pneu, desgaste concentrado no pneu dianteiro quando se vira cedo, queda forte após ~50% de desgaste | resumir |
| [DG-EDGE: Mastering Brake Balance](https://www.dg-edge.com/articles/guides-equipment/mastering-brake-balance-in-gran-turismo-7/360) | balanço -5..+5 por layout (MR 0/-1, FR +2/+3, FF mais para trás, 4WD mais para a frente); mais para trás em pistas rápidas, para a frente em hairpins | resumir |
| [DG-EDGE: Telemetry in GT7](https://www.dg-edge.com/articles/guides/telemetry-in-gran-turismo-7-how-to-use-it-find-more-pace/544) | leitura de traços (não consegui abrir a versão /762 listada no índice, deu 404) | resumir |
| [Coach Dave: Gr.1](https://coachdaveacademy.com/tutorials/best-gr-1-cars-in-gran-turismo-7/) | muito downforce, frenagens pesadas, híbridos aceleram mais na saída, aprender antes em Gr.3/Gr.4 | resumir |
| [Coach Dave: Gr.3](https://coachdaveacademy.com/tutorials/best-gr-3-cars-in-gran-turismo-7/) | 50 carros (18 MR / 32 FR); FR tende a subesterço, MR responde mais e sobrevira; BoP muda o ranking por pista | resumir |
| [Coach Dave: Gr.4](https://coachdaveacademy.com/tutorials/best-gr-4-cars-in-gran-turismo-7/) | 4WD traciona cedo, FR mais previsível; traseira solta com mais facilidade em frenagem forte; frear em reta e suave | resumir |
| [Coach Dave: Gr.B](https://coachdaveacademy.com/tutorials/gr-b-rally-cars-in-gt7-explained) | Gr.B modernos são mais fáceis que os Grupo B originais | só para o resumo de classe |
| "Beyond the Apex" (guia **oficial** da PD, [gran-turismo.com](https://www.gran-turismo.com/us/gt7/apex/for_beginners/03)) | TCS inicial no nível 3, ABS em "Default" para iniciantes; marcos de frenagem (zebra, placas 100 m/50 m); exercícios B-1/B-2 de Starting and Stopping. O site é renderizado por JS e meu leitor não conseguiu abrir o conteúdo; esses pontos vêm dos resultados de busca | confirmar à mão |
| GTPlanet (threads de frenagem/ABS/aprendizado de pista) | opiniões da comunidade; ABS desligado costuma permitir pisar mais forte no início; cones calibrados para Gr.3 | só como "opinião de jogador", sem tratar como regra |
| [Panorama de software de telemetria do GTPlanet](https://www.gtplanet.net/forum/threads/overview-of-gt7-telemetry-software.418011/) | lista de ferramentas e detalhes de replay/pacote | contexto técnico |

**Lacunas**: nenhuma fonte boa sobre **N-classes** (N100 a N1000) nem sobre **Gr.2**; dicas de Gr.B e de pneus (compostos
Sport/Racing) são em geral fracas ou de sites de baixa qualidade (vários resultados eram páginas SEO reescritas, que
descartei). Para gestão de pneus, a melhor evidência é o breakdown da 1.49 acima e a observação (GTPlanet) de que eventos
Gr.3 usam 4x de desgaste e 2x de combustível.

**O que pode ser resumido legitimamente**: fatos e princípios (ex.: "freio em reta", "balanço para trás em pista rápida") com
suas palavras e o link; **não** copiar frases, listas, nem os passos "turn by turn" dos guias pagos ou protegidos.
Cada trecho da base deve guardar `source` (URL, autor, data) e `licenseNote: "resumo próprio"`.

## 3. Estrutura sugerida da base de conhecimento do coach

O app já tem diagnósticos nomeados (`brakeEarlier`, `brakeLater`, `softBraking`, `noTrailBraking`, `lowerMinSpeed`,
`earlyApex`, `lateApex`, `gearChoice`...). A base mais útil é uma **tabela diagnóstico x classe de carro**, mais fichas por
classe e por pista:

```
knowledge/
  index.json                      # versão da base, idioma, lista de arquivos
  general/
    freio.pt-BR.md  trail-braking.pt-BR.md  acelerador.pt-BR.md  linha.pt-BR.md
    abs-tcs-asm.pt-BR.md  pneus.pt-BR.md  combustivel.pt-BR.md  clima.pt-BR.md
  classes/
    gr1.json  gr2.json  gr3.json  gr4.json  grb.json  n-classes.json  x.json
  diagnostics/
    brakeEarlier.json  noTrailBraking.json  ...   # texto do coach por diagnóstico e por classe
  tracks/
    <official_id>.json            # ficha por layout (id do catálogo)
  sources.json                    # fontes, licença, data da leitura
```

Ficha de classe (exemplo; **conteúdo ilustrativo**, resumido das fontes acima, revisar antes de usar):

```json
{
  "id": "gr3", "label": "Gr.3", "locale": "pt-BR", "updated": "2026-11-09",
  "traits": ["BoP muda o ranking por pista", "MR: responde mais e sobrevira", "FR: tende a subesterço"],
  "braking": { "bias_hint": {"MR": "0 a -1", "FR": "+2 a +3", "4WD": "levemente para frente"},
               "advice": "Freie em reta, pico firme e alivie progressivamente; trail leve só em curvas lentas." },
  "assists": { "abs": "ligado/Default para começar; teste desligar quando já frear com consistência", "tcs": "baixo" },
  "tyres": { "note": "queda forte após ~50% de desgaste; pneu dianteiro sofre ao virar cedo" },
  "pitfalls": ["Entrar muito rápido gasta o pneu dianteiro", "Brusquidão no volante sob freio causa sobreviragem"],
  "sources": ["https://coachdaveacademy.com/tutorials/best-gr-3-cars-in-gran-turismo-7/",
              "https://dg-edge.com/articles/guides/gran-turismo-7-physics-update-1-49-breakdown/424"]
}
```

Ficha de diagnóstico por classe (o coach escolhe o texto pelo par `diagnostic` + `carGroup`):

```json
{ "diagnostic": "noTrailBraking",
  "byGroup": {
    "3": "Solte o freio devagar até a entrada. Em Gr.3 o peso na frente fecha a linha, mas com MR cuidado com a traseira.",
    "4": "Em Gr.4 a traseira solta fácil: mantenha só um resto de freio e vire gradualmente.",
    "1": "Em Gr.1 o downforce segura, mas as frenagens são fortes: libere mais cedo e em rampa."
  } }
```

Ficha de pista (`tracks/<official_id>.json`), preenchida por usuários e pelo gerador do app (seção 6):

```json
{ "officialId": "c272b2", "name": "24 Heures du Mans", "turns": 38,
  "corners": [{ "id": "T1", "name": "Dunlop", "note": "Marco: placa de 100 m. Em Gr.3, 2ª marcha.", "sources": ["user"] }] }
```

## 4. Derivação própria de pontos de frenagem por pista e categoria

Essa é a lacuna real do mercado. O app já captura voltas (suas e de replays top) com **distância ao longo da volta** e
métricas por curva. O que falta é **agregar** entre voltas/sessões.

**Algoritmo proposto** (puro, no pacote `analysis`, sem rede):

1. Para cada pista identificada (id oficial quando casar com o catálogo; senão fingerprint do app), carregar todas as
   voltas válidas (flag de validade já existe) e ignorar volta de box/inválida/cortada.
2. **Normalizar distâncias** à extensão oficial do layout (ajuste de escala ±2% para absorver diferença replay x ao vivo) e
   alinhar à linha central da pista.
3. Agrupar por **bucket de carro**: `group` (1, 2, 3, 4, B, N, X) e, se houver ≥ 3 voltas, também por `carCode` e por
   composto de pneu. Frenagem muda muito entre grupos, mas pouco dentro do mesmo carro.
4. Em cada curva do layout, tomar as **N melhores voltas** do bucket (N = 5 a 20, as 10% mais rápidas) e calcular:
   ponto de frenagem (freio > 5%, já usado no app), antecedência em relação à entrada (`entryM - brakeM`), velocidade no
   ponto de frenagem, pico de freio, duração, trail braking, V-mín e onde ocorre, marcha no ápice, retomada de acelerador (10%/95%) e velocidade de saída a +50 m.
5. Estatística **robusta**: mediana, MAD, p25/p75; descartar outliers com |x - mediana| > 3 x MAD; guardar também as
   amostras brutas (um número por volta por métrica) para permitir **mesclar pacotes exatamente**.
6. **Confiança** por curva: alta (n ≥ 8, MAD pequeno), média (n 3 a 7), baixa (n < 3, não mostrar como meta). Voltas de replay
   rebaixam um nível nas métricas de forma (consistente com o app).
7. Recomendação para o coach: apresentar o ponto de frenagem como **faixa** (p25 a p75), com um **marco visual** vindo da nota do
   usuário (`brakeMarkerNote`) ou da distância arredondada, e a velocidade esperada naquele ponto.
8. Para iniciantes, mostrar o p75 (mais cedo) como ponto "seguro" e a mediana como "alvo".

**Armadilhas conhecidas**:

- A mediana mistura estilos; manter por bucket de carro e mostrar `n`.
- Replay é suavizado: precisão de poucos metros; não tratar a diferença < 10 m como erro do piloto.
- Frenagem logo após a linha de chegada (T1 colada na largada) pode ficar fora da volta (já citado no README do app).
- O catálogo `jbhoorasingh` tem apex de 32 layouts, mas não entrada/saída. Servirá para **conferir a contagem de curvas**
  (`turns`) e **rotular** as curvas do app, não para substituí-las.
- Privacidade: pacote **sem nome PSN, sem volta bruta de terceiros**.

## 5. Como importar o catálogo (sem mexer no app agora)

- Script `packages/shared/scripts/gen-tracks.mjs` (análogo ao `gen-cars.mjs`) que baixa `catalog/tracks.json` e
  `index.json` de `jbhoorasingh/gt7-datalogger-track-data` em um **commit fixo**, e gera `tracks/data.ts` com a
  mesma regra de cabeçalho ("GENERATED ... Source ... license CC0-1.0 ... commit ... collectedAt"). Campos: `officialId`,
  `officialTrackId`, `name`, `layout`, `turns`, `lengthM`, `elevationM`, `longestStraightM`, `type`, `reverseOfficialId`.
- Casamento com `Track` existente: `lengthM` ±3% (a mesma tolerância do fingerprint) e depois forma. Quando casar,
  preencher `Track.name/layout` e marcar `source: 'builtin'`; o app já tem esse valor.
- Mostrar `turns` do catálogo ao lado da contagem detectada, como sanity check.

## 6. Formato proposto do "pacote de pista" (`gt7-track-pack` v1)

Objetivos: simples de ler, versionado, **mesclável**, **sem dados pessoais**, com proveniência e licença. Distâncias em
metros ao longo da volta, normalizadas à extensão oficial.

Campos:

| Campo | Tipo | Descrição |
|---|---|---|
| `format` | string | sempre `"gt7-track-pack"` |
| `version` | int | versão do esquema (1) |
| `generatedAt` | ISO 8601 | quando foi gerado |
| `generator` | `{app, version}` | app e versão |
| `license` | string | licença dos **dados agregados** (recomendado `CC0-1.0` ou `CC-BY-4.0`) |
| `track.officialId` | string | id do layout no catálogo (gt7info/jbhoorasingh); `null` se desconhecido |
| `track.name`, `track.layout`, `track.lengthM`, `track.turns` | | metadados do catálogo |
| `track.fingerprintHash` | string | hash da assinatura do app (para pistas sem id) |
| `corners[]` | | `{id, index, name, direction, kind, entryM, apexM, exitM, apexXZ}` |
| `buckets[]` | | um por (grupo/carro/pneu/origem) |
| `buckets[].scope` | | `{carGroup:"3", carCode:null, tyre:null, source:"top-replay"\|"own"\|"community", nLaps, nDrivers}` |
| `buckets[].corners[]` | | por curva: `brake`, `brakeLead`, `vBrake`, `peakBrake`, `trail`, `vMin`, `gear`, `throttleOn`, `vExit` |
| (cada métrica) | | `{median, p25, p75, mad, n, samples?}` |
| `buckets[].confidence` | | `"high"\|"medium"\|"low"` por curva |
| `notes[]` | | `{cornerId, text, locale, author?}` (marcos visuais, ex.: "placa 100 m") |
| `refTimes[]` | | opcional: `{carGroup, carCode, lapMs, kind:"own\|top-replay\|time-trial", date}` sem nome de piloto |
| `provenance` | | `{sources:[], appVersion, sessionCount}` |
| `integrity.sha256` | | hash do conteúdo canônico |

Regras: (1) **identificação por `track.officialId`** quando existir, senão por `fingerprintHash`; (2) **mescla**: para a mesma
chave `(officialId, scope)`, unir `samples` e recalcular mediana/MAD (se não houver `samples`, usar mediana ponderada por `n` e marcar `confidence` mais baixa);
(3) importação **nunca sobrescreve** dados próprios (política já usada pelo `gt7-datalogger`: "merge, não replace"); (4) o importador
valida `format`, `version`, `sha256`, extensão (±3%) e número de curvas; versão desconhecida = recusar com mensagem em pt-BR.

Exemplo (curto, valores ilustrativos):

```json
{
  "format": "gt7-track-pack",
  "version": 1,
  "generatedAt": "2026-11-09T12:00:00Z",
  "generator": { "app": "gt7-race-engineer", "version": "0.4.0" },
  "license": "CC0-1.0",
  "track": { "officialId": "<id do catálogo>", "name": "Suzuka Circuit", "layout": "Full Course",
             "lengthM": 5807, "turns": 18, "fingerprintHash": "sha1:ab12..." },
  "corners": [
    { "id": "T1", "index": 0, "name": "Curva 1", "direction": "R", "kind": "medium",
      "entryM": 410, "apexM": 470, "exitM": 530, "apexXZ": [977.3, 396.1] }
  ],
  "buckets": [
    { "scope": { "carGroup": "3", "carCode": null, "tyre": "RS", "source": "top-replay", "nLaps": 12, "nDrivers": 7 },
      "corners": [
        { "cornerId": "T1",
          "brake":     { "median": 331, "p25": 326, "p75": 336, "mad": 4.5, "n": 12 },
          "brakeLead": { "median": 79,  "p25": 74,  "p75": 84,  "mad": 4.5, "n": 12 },
          "vBrake":    { "median": 268, "p25": 262, "p75": 272, "mad": 3.1, "n": 12 },
          "peakBrake": { "median": 0.92 },
          "vMin":      { "median": 118, "at": 468 },
          "gear":      { "mode": 3 },
          "throttleOn":{ "median": 492 },
          "vExit":     { "median": 171 },
          "confidence": "high" }
      ] }
  ],
  "notes": [ { "cornerId": "T1", "text": "Marco: placa de 100 m; segue-se uma freada firme.", "locale": "pt-BR" } ],
  "refTimes": [ { "carGroup": "3", "lapMs": 109200, "kind": "top-replay", "date": "2026-11-01" } ],
  "provenance": { "sources": ["own-replay-capture"], "appVersion": "0.4.0", "sessionCount": 5 },
  "integrity": { "sha256": "..." }
}
```

Observações do exemplo: os números são fictícios (o objetivo é mostrar o formato); o que o app grava de verdade deve vir
dos dados capturados. `source:"community"` marca buckets importados.

## 7. Compartilhamento e importação entre usuários

- **Exportar/importar arquivo** `.gt7pack.json` (ou `.gt7pack.json.gz`) pela UI e pelo MCP (`export_track_pack`/`import_track_pack`).
- **Repositório comunitário** opcional (GitHub) com um pacote por `officialId` e licença CC0 explícita: a mesma estrutura do
  `jbhoorasingh/gt7-datalogger-track-data` (`tracks/<slug>.json`, `index.json`, `MANIFEST.json`, workflow de mescla), só que com
  buckets de frenagem. O app baixa por URL raw com cache (`ETag`) e mescla; sem servidor próprio.
- **Segurança**: tamanho máximo, validação de esquema, nenhum campo de texto livre executável, notas tratadas como texto puro.
- **Moderação**: `source:"community"` sempre separado de `own` na UI, com `n` visível.

## 8. Riscos legais e de ToS

| Item | Risco | Observação |
|---|---|---|
| Embarcar CC0/MIT/MIT-0 com atribuição (catálogo de pistas, gt7info) | baixo | mantenha cabeçalho de origem + commit, como já feito em `cars/data.ts` |
| Código GPL (`gt7dashboard`, `gt7telemetry`, `gt-toolz`) | alto se copiar | o app não pode embutir; só estudar o conceito e reimplementar |
| Repos sem licença (`gt7-timetrials`, Ghost Finder, sim-to-motec) | médio/alto | "sem licença" = todos os direitos reservados; só link/ideia |
| API não oficial do site da Sony | médio/alto | endpoints não documentados e sem aval da Sony; **não li os termos**. Se usar, só como opt-in explícito do usuário, 1 req/2 s, cache, e **sem armazenar nomes PSN** |
| Voltas WR de terceiros (CSV) | alto | conteúdo do jogador/PD; não redistribuir; agregar e anonimizar |
| Voltas de referência pagas (Coach Dave, Traces) | alto | proprietárias; só linkar |
| Texto de guias | médio | resumir e citar; nunca copiar |

## 9. Recomendação priorizada

**P0 (agora, baixo risco, alto valor)**
1. Embarcar o **catálogo de pistas** (CC0, jbhoorasingh) com script de geração e commit fixo: nome oficial automático,
   `turns` para sanity check das curvas, maior reta, desnível e id oficial para pacotes. Já existe o precedente com os carros.
2. Formalizar o **pacote de pista v1** (seção 6) e o gerador de agregação (seção 4) no pacote `analysis`; exportar/importar
   por arquivo. Mesmo sem comunidade, vale como **memória de longo prazo** e base para o coach ("sua mediana nas 10 melhores").
3. Escrever a **base de conhecimento v1 em pt-BR** (seção 3), ~12 fichas gerais + 6 de classe + diagnóstico x classe,
   com `sources.json`. É conteúdo próprio (resumo) e dá ao coach linguagem específica por categoria.

**P1**
4. Mapear a **linha central/assinatura** do `gt-telemetry` (MIT) e do `signatures.json` (CC0) para melhorar a identificação das
   pistas ainda "desconhecidas" (85 + 32 layouts).
5. **Metas de tempo opcionais**: botão "ver WR/ouro do Time Trial atual" que chama os 3 endpoints sem login, com cache de 24 h e
   rate limit, ou um link para `gt7-timetrials`. Sem embarcar.
6. Catálogo de **recordes por classe** gerado pelo próprio app ao longo do tempo (melhor volta top capturada por pista + grupo),
   guardado em `refTimes`.

**P2**
7. Repositório comunitário de pacotes (CC0) e importação por URL.
8. Playlist guiada de replays: dentro do jogo, o usuário vê o top 10 do Time Trial da semana; o app avisa qual
   pista/carro ainda não tem referência capturada.

**Evitar**: raspar rankings ou tentar baixar replays; copiar CSVs/guias de terceiros; embutir código GPL; inventar "pontos de
frenagem" a partir de texto (guias de outros sims, como Assetto Corsa, aparecem em buscas mas **não valem para o GT7**).

## 10. Lacunas confirmadas e itens não verificados

- **Sem base aberta de frenagem/velocidade de curva/marcha/linha ideal para GT7** (confirmado em GitHub, GTPlanet via busca,
  DG-EDGE, Coach Dave, HF, Kaggle).
- **Sem fonte em pt-BR de qualidade** sobre técnica; não consegui confirmar se o "Beyond the Apex" oficial tem versão em
  português (a página abre por JS).
- **Sem fonte sólida** para N-classes (N100 a N1000) e Gr.2; pouca evidência sobre Gr.B e sobre pneus por composto.
- **Não verificado**: ToS do gran-turismo.com/API; conteúdo do GTPlanet (retornou 403); termos de DG-EDGE e GTSH-Rank; formato
  de export do Data Logger oficial; licença exata de `gt7dashboard` (GPL-3.0 via API do GitHub; a página não a nomeia);
  contagem exata de pistas levantadas do `jbhoorasingh` (o README sugere ~52, o `index.json` atual diz **32**; usei o JSON).
- As buscas do GitHub por API foram limitadas por taxa (HTTP 403 após ~20 consultas), então a lista de repositórios pode estar incompleta.

## 11. Links principais

- Catálogo e geometria CC0: https://github.com/jbhoorasingh/gt7-datalogger-track-data
- gt7info (MIT-0): https://github.com/ddm999/gt7info
- zetetos/gt-telemetry (MIT): https://github.com/zetetos/gt-telemetry
- Time Trial tracker e `api_findings.md`: https://github.com/gt7-timetrials/gt7-timetrials.github.io
- gt7dashboard (GPL-3.0): https://github.com/snipem/gt7dashboard
- gt7-datalogger (MIT): https://github.com/jbhoorasingh/gt7-datalogger
- Coach Dave Delta GT7: https://coachdaveacademy.com/gran-turismo-7
- Traces (DG-EDGE): https://traces.dg-edge.com/
- DG-EDGE guias: https://www.dg-edge.com/articles/guides
- GTPlanet, panorama de telemetria: https://www.gtplanet.net/forum/threads/overview-of-gt7-telemetry-software.418011/
