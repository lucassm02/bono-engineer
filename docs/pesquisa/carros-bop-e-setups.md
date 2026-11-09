# Pesquisa: carros, categorias, BoP, setups e afinação (GT7)

Data da pesquisa: 09/11/2026 (jogo na versão 1.72, lançada em 15/10/2026 segundo a GT-Engine).
Escopo: enriquecer o GT7 Race Engineer com dados externos sobre **carros, categorias (Gr.1/2/3/4/B, N), BoP, setups e afinação**, pneus/combustível e APIs gratuitas.

> Método e limites: li de fato as páginas e os arquivos citados (via leitura de URL e da API pública do GitHub). Alguns sites bloquearam a leitura automatizada (GTPlanet devolve 403; Fandom devolve 402; `gran-turismo.com/.../carlist` e o manual online são renderizados por JavaScript e vieram vazios). Onde não consegui confirmar, está marcado como **não verificado**. Nada aqui é aconselhamento jurídico: a coluna de risco é uma leitura prática dos termos que consegui ler.

---

## 1. Resumo executivo

1. **A melhor (e praticamente única) base aberta é a `ddm999/gt7info`** (MIT-0, atualizada hoje). O app já usa `cars.csv` + `maker.csv` + `country.csv` + `cargrp.csv`. Ela tem **mais coisas úteis que ainda não usamos**: `stockperf.csv` (PP de cada carro de rua em cada pneu), `course.csv` (comprimento, altitude, nº de curvas, pit lane delta, categoria da pista), `engineswaps.csv`, `lotterycars.csv`, `brandcentral/*.csv` (preços da Brand Central) e `data.json` (lojas Used/Legend do dia, ~19 KB). **Ela NÃO tem potência, torque, peso, tração, aspiração nem preço de catálogo** por carro.
2. **Specs completas (potência, peso, tração, aspiração, PP, preço) existem só em sites com direitos reservados**: lista oficial da Polyphony (`gran-turismo.com/.../carlist`), DG EDGE e GT-Engine. Nenhum oferece download, API ou licença aberta. São **só linkáveis**, a não ser que se obtenha permissão por escrito.
3. **BoP**: existe tabela publicada e atualizada a cada patch (DG EDGE e GT-Engine, com potência/peso por carro nas três faixas de pista Alta/Média/Baixa velocidade), mas **sem licença de reuso e sem API**. A única parte aberta é a classificação das pistas em H/M/L (`track-bop.txt` e `course-bop.html` do gt7info, parada/desatualizada).
4. **Setups: NÃO existe base aberta, nem API gratuita, de setups do GT7.** O jogo não tem compartilhamento oficial de ajustes. O que existe são fóruns (GTPlanet), Patreon/pagos, calculadoras comerciais e um app MIT novo (`setup-lab`) que é heurística, não banco de dados. Proposta realista na seção 5.
5. **APIs gratuitas**: só a **GT-Gridstats** (não oficial, token, 10 req/min) cobre Daily Races/DR/carros (`/api/assets/cars`). A API do site oficial da Polyphony exige login PSN e não é pública para o GT7. A `gt7sp-api` é do **GT Sport** (encerrado), não do GT7.

---

## 2. Tabela de fontes

Notas: Qualidade e Facilidade de 0 a 5. "Embarcável" = licença permite copiar para o repositório/app. Risco legal = leitura dos termos que consegui ver.

| # | Fonte | O que tem | Formato / URL | Licença / ToS | Qualidade | Facilidade | Risco | Embarcável? |
|---|---|---|---|---|---|---|---|---|
| A | **ddm999/gt7info** (`_data/db/`) | id, nome, marca, país, grupo, ano; PP stock por pneu; pistas; engine swaps; loteria | CSV, `https://raw.githubusercontent.com/ddm999/gt7info/web-new/_data/db/*.csv` (espelho atualizado: `https://ddm999.github.io/gt7info/data/db/*.csv`) | **MIT-0** (sem atribuição; vale citar). Dados extraídos do jogo | 5 | 5 | baixo | **Sim** |
| B | gt7info `data.json` (Used/Legend do dia) | lojas Used e Legend com preço, região, flags de reward/swap/loteria | JSON ~19 KB, `https://ddm999.github.io/gt7info/data.json` (atualiza diariamente 00:00 UTC) | MIT-0 | 4 | 5 | baixo | Sim (mas é dado diário: melhor runtime com cache) |
| C | gt7info `brandcentral/v111.csv, v112.csv` | `id,cr` (preço) dos carros da Brand Central | CSV pequeno (~3,5 KB cada) | MIT-0 | 3 (cobre só parte dos carros, estimado pelo tamanho do arquivo, e fica velho) | 5 | baixo | Sim |
| D | Lista oficial de carros (Polyphony) | imagens, tração, potência, peso (e filtros); 530 carros em jul/2025, ~580 em out/2026 | `https://www.gran-turismo.com/us/gt7/carlist/` (JS, sem export) | Conteúdo da Sony/PD; robots.txt só bloqueia rankings GT5 | 5 | 1 (precisa scraping) | **alto** | **Não** (só link) |
| E | **DG EDGE Database** | carros (PP, tração, potência, peso, aspiração, preço Cr.), pistas, engine swaps, **BoP** | HTML, `https://www.dg-edge.com/database/cars`, `/database/bop`, `/database/bop/GR.3/1.72` | "All rights reserved"; termos permitem só uso pessoal não comercial e proíbem copiar conteúdo protegido sem permissão (inclui direitos de banco de dados). Contato para permissão: digit@dg-edge.com. robots.txt libera as rotas `/database` | 5 | 2 | **médio-alto** | **Não** (só link; pedir permissão) |
| F | **GT-Engine** (`gt-engine.com/gt7`) | specs e **BoP H/M/L antigo vs novo + delta por carro** de Gr.1, 2, 3, 4, B; arquivo de versões anteriores; ensaios de reta; correlação DR x volta | HTML (tabelas grandes), `https://gt-engine.com/gt7/cars/gr3/gr3-01-specs.html`, arquivos `gr3-02-archives.html` | Nenhum termo/licença visível nas páginas lidas; sem robots.txt (404); autoria individual | 5 (é a fonte da seção BoP do DG EDGE) | 2 | médio (sem termos = sem permissão) | **Não** sem contato com o autor |
| G | GT-Gridstats API | pilotos (DR/SR), Time Trials, Daily Races (`dailies/this-week`), **assets de carros/marcas/pistas** com locale | REST JSON, `https://gt-gridstats.com/api-docs`; Bearer token pessoal; 10 req/min (assets/regions 30/min) e cota; 429 se exceder | Termos de uso não encontrados no doc (e-mail de contato no rodapé); não afiliado a PD/Sony | 3 (não validei respostas; precisa de token) | 3 | médio | Não; só runtime opcional, com token do usuário |
| H | Nenkai SpecDB / gt-modding-hub | descreve as tabelas internas (`GENERIC_CAR`, `ENGINE`, `CHASSIS`...) | `https://nenkai.github.io/gt-modding-hub/concepts/specdb/` | Doc comunitária (© Nenkai); dados do jogo são da PD | 4 (para entender) | 1 | alto se extrair do jogo | Não. Só referência |
| I | Nenkai/PDTools | libs C# (telemetria, live timing, SpecDB GT4/5) | `https://github.com/Nenkai/PDTools` | MIT (código) | 4 | 2 | baixo (código) | Código sim; não traz specs do GT7 prontas |
| J | GTPlanet (fóruns: Master Car List, Datamined car list, BoP tables, Tuning Garage) | listas, planilhas de BoP (GT Sport/antigas) | HTML/Google Sheets | Posts são dos autores; leitura automatizada bloqueada (403) | 3 (muito desatualizado para GT7) | 1 | médio | Não |
| K | Traxion.gg / GTPlanet (guias semanais de Daily Races) | por corrida: carros, pista, multiplicador de pneu/combustível, pneus obrigatórios | HTML | Direitos dos veículos de imprensa | 4 (como fonte de consulta) | 1 | médio | Não; só link |
| L | `abibonny95/setup-lab` | gerador heurístico de setup inicial (PWA, MIT) | `https://github.com/abibonny95/setup-lab` | MIT | 2 (v0.0.0, tudo em um `index.html`, sem banco) | 3 | baixo | Código sim; vale como referência de UX |
| M | Wikidata / Wikipedia / Fandom | Wikidata **não tem propriedade** de ID do GT7 (busca "Gran Turismo" em propriedades devolveu vazio); não achei "List of Gran Turismo 7 cars" na Wikipedia; Fandom bloqueou (402), **não verificado** | n/d | Wikidata CC0; Fandom CC BY-SA (padrão do Fandom) | 1 | 1 | baixo | Wikidata só serviria com mapeamento manual por nome |
| N | `alexpersian/gtsport-api` (a "gt7sp-api") | endpoints do **GT Sport** | `https://github.com/alexpersian/gtsport-api` (MIT) | Descontinuado; serviços do GTS saíram do ar em 31/01/2024 | 0 para GT7 | 0 | n/a | Não |

---

## 3. Carros e categorias

### 3.1 O que o gt7info realmente tem (verificado em 09/11/2026)

Repositório `ddm999/gt7info`, branch padrão `web-new`, licença MIT-0, último push em 09/11/2026 00:12 UTC, ~15 MB (inclui imagens e o histórico).

| Arquivo (`_data/db/`) | Tamanho | Colunas | Observação |
|---|---|---|---|
| `cars.csv` | ~16 KB (~560 linhas) | `ID,ShortName,Maker` | O **ano está no nome** (`180SX Type X '96`); sem specs |
| `maker.csv` | 1,2 KB | `ID,Name,Country` | |
| `country.csv` | 0,3 KB | (id, país) | |
| `cargrp.csv` | 3,5 KB | `ID,Group` | Grupos 1, 2, 3, 4, B, N, X |
| `stockperf.csv` | ~70 KB (~2000 linhas) | `ID,PP,Tyre` | PP do carro **stock** em cada pneu. **Ainda não usado pelo app** |
| `course.csv` | 12 KB | `ID,Name,Base,Country,Category,Length,LongestStraight,ElevationDiff,Altitude,MinTime*,MaxTime*,LayoutNumber,IsReverse,PitLaneDelta,IsOval,NumCorners,NoRain` | **Útil para o app** (altitude, nº de curvas, pit lane delta, oval). Ainda não usado |
| `crsbase.csv` | 1,2 KB | pistas-base | |
| `engineswaps.csv` | 5 KB | `NewCar,OriginalCar,EngineName` | Qual carro recebe qual motor |
| `lotterycars.csv` | 3 KB | carros do sorteio | |
| `trophy.csv` | 0,1 KB | | |

Cadência de atualização (informada pelo próprio autor em `json-dev-notes.html`): `cars/country/maker/engineswaps` "o mais rápido possível" depois de cada update; `cargrp/course/crsbase/lotterycars/stockperf` bem mais devagar (exigem trabalho manual). O campo `updatetimestamp` do JSON é manual e serve só para saber se ficou velho.

Trechos (curtos, fatos):

```csv
# cars.csv
ID,ShortName,Maker
24,180SX Type X '96,28
2159,Mustang Gr.3,13

# cargrp.csv  (grupos: 1,2,3,4,B,N,X)
ID,Group
3187,1

# stockperf.csv  (CH CM CS = Comfort H/M/S, SH SM SS = Sports, RH RM RS = Racing, IM, W ...)
ID,PP,Tyre
2108,1195.32,CH
2108,1343.01,SS

# course.csv
10,Suzuka Circuit,29,2,circuit,5807,1200,40.0,29.0,4,20,0,19,40,0,1,0,20.5,0,20,0
```

Os códigos de pneu `CH/CM/CS/SH/SM/SS/RH/RM/RS/IM/W/D/S` não têm legenda no repositório; a interpretação (Comfort/Sports/Racing x Hard/Medium/Soft, Intermediate, Wet, Dirt, Snow) é **inferência**, confirmada só para `SS` (Sports Soft) na página `stock-perf.html`.

Pontos importantes que o gt7info revela:
- `stock-perf.html` informa que **só carros Gr.N e Gr.X estão na tabela**, porque os grupos 1/2/3/4/B "usam 100%/100% de potência/peso para a BoP". Ou seja: o PP de um carro de corrida muda conforme a BoP do evento; o de rua não.
- Grupo **X** = carros especiais (corrida, elétricos, VGT, kart); **N** = carros de rua normais.
- A parte `dailyrace` do `data.json` virou **placeholder** ("no longer updated"); existem CSVs semanais só de 03/2022 a 10/2022. **Não dá para tirar as Daily Races atuais do gt7info.**

### 3.2 Specs completas (potência, torque, peso, tração, aspiração, preço)

Não existe CSV/JSON aberto. As três fontes boas são só páginas:

- **Lista oficial da PD** (`gran-turismo.com/us/gt7/carlist/`): lançada em 08/08/2025; cada carro tem imagens, tração, potência e peso, com ordenação. 530 carros em jul/2025 (anúncio oficial `.../news/00_1917470.html`). Sem export, JS pesado. Usar só como **link "ver ficha oficial"**.
- **DG EDGE** (`/database/cars`): para cada carro mostra miniatura, PP, marca, tração, potência, peso, aspiração e preço (ex.: Dodge SRT Tomahawk X VGT, 1381,58 PP, 4WD, 2586 HP, 749 kg, 1.000.000 Cr.). Mais de 550 carros, unidades métricas/imperiais. Sem export.
- **GT-Engine** (`gt-engine.com/gt7/cars/gr{1,2,3,4,b}/gr?-01-specs.html`): só Gr.1 a Gr.B, tabelas com potência máx., torque, peso, relação peso/potência, balanço F:R, 0-400 m, 0-1000 m, 100-150 km/h, estabilidade (baixa/alta velocidade), Rot.G a 60/120/240 km/h, tudo em "antigo / novo / delta".

**SpecDB (dados internos da PD)** guarda tudo isso (`GENERIC_CAR` com preço/fabricante/ano; `ENGINE` com potência e torque; `CHASSIS` com massa). Documentação em Nenkai gt-modding-hub. Mas extrair exige os arquivos do jogo; num PS5 isso não é caminho viável para um app de usuário final e os dados são propriedade da PD. **Descartado.** O gt7info obteve seus CSVs por esse tipo de extração e os publicou em MIT-0; é o único repasse permissivo que existe.

**O que dá para obter sem nenhuma dessas fontes, direto da telemetria** (campos já descritos em `ESTUDO-TELEMETRIA-GT7.md`):
- `carCode` (0x124) e, no pacote C, **categoria do carro** (0x16C, 4 chars) e **entre-eixos** (0x168).
- **Relações de marcha 1ª a 7ª/8ª** (0x104) e **velocidade máxima da transmissão** (0x100): isto é o setup de câmbio **real** da sessão.
- **Altura da suspensão por roda** (0xC4), **raio dos pneus** (0xB4), RPM de alerta, combustível atual e capacidade, turbo boost.
- Potência/torque/peso **não** vêm no pacote. Dá para **estimar potência de pico a partir de uma aceleração em reta** (massa desconhecida impede precisão), mas isso é pesquisa própria.

### 3.3 Fotos e ícones

- **Fotos dos carros**: só nos sites acima (D, E) com direitos reservados. O gt7info tem uma pasta `img/` com "GT7 web images" copiadas do site da PD (marca registrada/direitos da Sony). **Não embarcar fotos.**
- **Logos de marca**: o app já usa `simple-icons` (CC0) para 36 marcas. Continua sendo a abordagem certa.

### 3.4 IDs

- `carCode` do pacote = `ID` do `cars.csv` (confirmado pela lógica do próprio projeto). O gt7info é mantido atual com IDs novos "o mais rápido possível". Uma thread do GTPlanet de 2026 (não consegui abrir; li só o trecho do buscador) cita que alguns sites ficam para trás em atualizações, então vale manter o fallback "Carro #1234" que o app já tem.
- Outros projetos que fazem mapeamento (`snipem/gt7dashboard`, GPL-3.0, baixa um `db/cars.csv` por script) usam a mesma ideia; não há vantagem em trocar.
- Wikidata: sem propriedade de ID do GT7. Descartar.

---

## 4. BoP (Balance of Performance)

### 4.1 Como funciona (resumo, com fontes)

- Desde o patch **1.19 (jul/2022)** a BoP do GT7 é dividida em **três variantes por tipo de pista: Alta (H), Média (M) e Baixa velocidade (L)** (relatado por GTPlanet e Traxion; reduzir a dominância dos 4WD em Gr.3/Gr.4). Cada variante tem **limite de potência e peso mínimo** por carro; os demais ajustes ficam travados exceto balanço de freio e mapa de combustível (dito num post de fórum, **não verificado** no manual oficial).
- A classificação de cada pista em H/M/L está no gt7info (`track-bop.txt`: 63 pistas com "BoP High/Mid/Low"; `course-bop.html`: 29 H, 46 M, 15 L). O próprio autor avisa que a página provavelmente **não receberá mais updates** e pode faltar pista nova. Exemplos: Tsukuba = Low, Laguna Seca = Low, Suzuka e Nordschleife = Mid, Daytona Road Course e Watkins Glen Long = High.
- Em **corridas com BoP** os valores de potência/peso são do evento; o PP muda a cada atualização.
- Updates recentes de BoP: 1.55 (30/01/2025), 1.59, 1.60, 1.61, 1.62, 1.65, 1.66, 1.67 (29/01/2026), 1.70 (11/06/2026, com a data trocada na tabela do DG EDGE), 1.71 (20/08/2026), 1.72 (15/10/2026). Ou seja, **a cada 1 a 3 meses**, normalmente junto de patch do jogo (o DG EDGE lista datas fora de ordem; usei as da GT-Engine como referência).

### 4.2 Onde está a tabela publicada

| Fonte | Conteúdo | Observação |
|---|---|---|
| **GT-Engine** `.../gr3/gr3-01-specs.html` | Para cada carro e para H/M/L: potência máx (PS/HP/kW), peso, kg/PS, PS/t, balanço F:R, aceleração, estabilidade etc., com "antigo, novo, delta". Exemplo: Alfa Romeo 4C Gr.3 na 1.72: 461 PS e 1.220 kg (H), 1.230 kg (M e L). Notas de atualização, como "novo carro: Mazda RX-VISION GT3 EVO" e "Car Settings updated (Suspension and Differential Gear)" | Arquivo de versões antigas em `gr3-02-archives.html`. Sem termos visíveis |
| **DG EDGE** `/database/bop` e `/database/bop/GR.3/1.72` | Tabela por classe e por versão: PP, potência (HP), torque (Nm), peso (kg), HP/t, kg/HP, balanço F:R, 0-400 m, 0-1000 m, 100-150 km/h, estabilidade, Rot.G; seletor de velocidade da pista (High/Low/Mid) e comparação com a versão anterior. Exemplo (High, 1.72): Aston Martin V12 Vantage GT3 '12 = 485 HP, 1.250 kg; Toyota GR Supra Racing Concept '18 = 468 HP, 1.243 kg | Produzida em parceria com a GT-Engine. Termos proíbem copiar; **os valores Low/Mid não vieram no HTML que li** (provavelmente carregados no cliente) |
| GTPlanet (fórum "Gr.1, Gr.2, Gr.3, Gr.4, Gr.B – BoP Tables", "BoP Spreadsheet") | Planilhas comunitárias | São de **GT Sport/v1.38**; não servem para o GT7 |
| Notícias GTPlanet/Traxion sobre cada update de BoP | Resumo qualitativo (ex.: em mar/2025 os Gr.3 perderam ~40 hp em média nas três faixas) | Texto jornalístico, só consulta |

### 4.3 Como obter de forma legítima

1. **Melhor caminho:** escrever ao autor da GT-Engine e/ou ao DG EDGE (`digit@dg-edge.com`) pedindo **permissão por escrito** para (a) ler/mostrar a BoP no app com crédito e link, ou (b) receber um JSON/CSV. O DG EDGE já colabora com a GT-Engine, então um único pedido tende a resolver. Sem permissão, **não embarcar, não fazer scraping automatizado**.
2. **Sem permissão:** o app mostra "BoP do evento" **preenchida pelo usuário** (potência/peso lidos na tela de BoP do jogo, que o app não consegue ver) e **link direto** para `dg-edge.com/database/bop` e para a página da GT-Engine da classe. Sem copiar números.
3. **Dado derivado da telemetria**: o `carCode` + categoria do carro (pacote C) permite saber se o carro é Gr.3/Gr.4 etc. e mostrar o link certo; a potência efetiva em corrida não vem no pacote.
4. **Só a classificação de pistas em H/M/L** (`track-bop.txt`) é MIT-0 e pode ser embarcada, com a ressalva de que está parada e falta pista nova. Dá para completar à mão (63 pistas) e marcar "estimado".

### 4.4 Gr.1/2 em Sport Mode e Daily Race

Mesma BoP H/M/L; nas páginas GT-Engine e DG EDGE aparecem Gr.1, Gr.2, Gr.3, Gr.4 e Gr.B com tabelas próprias. Não encontrei tabela **por pista ou por evento**: a granularidade é **por carro e por faixa de velocidade (H/M/L)**, e cada evento escolhe a faixa conforme a pista (ver 4.1).

---

## 5. Setups e afinação

### 5.1 Conclusão honesta

**Não existe base aberta, nem API gratuita, de setups do GT7.** O que verifiquei:

- O jogo **não tem compartilhamento oficial de setups** (um tópico do GTPlanet cita a justificativa dos desenvolvedores: o estado do carro difere entre jogadores por peças instaladas). Isso explica a falta de qualquer endpoint.
- **GTPlanet Tuning Database**: existiu para o GT6 (lançada em 2014). Nada indica versão GT7 (não verifiquei o estado atual do site; GTPlanet bloqueou minha leitura).
- Calculadoras: **GT7 Tuning Calculator** (planilha/app comercial, com versões Lite/Expert, gt7tuningcalculator.co.uk, sem código aberto, com relatos de valores fora da faixa e de ARB "fictício"); **V14PRO GT7 Engineering Lab** (ferramenta web de um piloto, sem dados abertos); **`abibonny95/setup-lab`** (MIT, PWA, "ponto de partida heurístico, não simulação", sem banco de dados).
- Tunes prontos: Patreon (Praiano, GT7Tunes) e fóruns. **Pagos ou com direitos do autor; sem API.**
- GitHub: busca por `topic:gt7` (30 repositórios) e por "gt7 setup/tune" não retornou **nenhum repositório com JSON de setups**. Os resultados são telemetria, dashboards, automação e coaches de IA.
- Kudos Prime: não encontrei API nem exportação de setups para o GT7 (um post de 2022 diz que o site do GT7 não tinha nem dados de upgrade).
- Garage61 é iRacing/ACC/LMU; não cobre GT7. Fanatec/SimHub: perfis de volante e dash, não setups do carro.

Resumo de cobertura: **zero fontes abertas** com setups por carro/pista. Qualquer uso de tunes de terceiros é "só linkar" ou, se o autor autorizar, importar.

### 5.2 Parâmetros de setup do GT7 (para modelar no app)

Nomes de campo sugeridos (pt-BR) e o que o telemetria **já informa** versus o que o jogador precisa digitar:

| Grupo | Parâmetro | Vem da telemetria? |
|---|---|---|
| Pneus | composto (Conforto/Esportivo/Corrida; Duro/Médio/Macio; Chuva) | Não (só temperatura de superfície por pneu) |
| Suspensão | altura (F/T), molas / frequência natural (F/T), amortecedores compressão e extensão (F/T), barra estabilizadora (F/T), camber (F/T), toe (F/T) | **Altura da suspensão ao vivo** (0xC4) sim; o restante não |
| Diferencial | LSD: torque inicial, sensibilidade de aceleração, sensibilidade de frenagem; distribuição de torque (4WD) | Não |
| Aerodinâmica | downforce F/T | Não |
| Câmbio | relação final, relações 1ª a 8ª, velocidade máx. | **Sim** (relações e velocidade máx. no pacote) |
| Assistências | TCS, ABS, balanço de freio | Parcial (o acelerador "pós-TCS" vs "cru" indica TCS atuando no pacote "~") |
| Peso | lastro e posição; restritor de potência; ECU | Não |

Limitação importante: **a telemetria do GT7 dá uma única temperatura de superfície por pneu**, não interna/central/externa. Portanto **não dá para inferir camber pela diferença de temperatura através do pneu**, como se faz em simuladores com sensor de 3 zonas. Dá só para comparar **esquerda x direita e frente x trás** (balanço, desgaste relativo) e avaliar o efeito de mudanças entre voltas.

### 5.3 Princípios de afinação em pt-BR para o coach (síntese própria)

Fontes lidas: Coach Dave Academy (Alexandre Tonini), Traxion (guia FWD), discussões do GTPlanet. Resumi com minhas palavras; não copiar os textos. **Muitos sites de "guias de GT7" que apareceram nas buscas são conteúdo gerado/spam e foram descartados.**

- **Ordem de trabalho**: pneus e downforce definem a rigidez; fazer lastro/peso antes da suspensão; só depois câmbio e diferencial.
- **Altura e rake**: o mais baixo permitido costuma dar o maior ganho (Traxion mediu ~0,8 s no Honda Civic Type R em Brands Hatch Indy); traseira mais baixa ajuda a velocidade final, rake positivo ajuda a virada.
- **Frequência natural**: traseira ligeiramente maior que a dianteira; extremos entre eixos tornam o carro intratável (exemplo medido: 3,20 Hz F e 1,46 Hz T = inconduzível; 2,05 Hz nos dois eixos = bom).
- **Amortecedores**: extensão (rebound) maior que compressão em carro de corrida; valores no meio da faixa (exemplo: 20% e 35%) dão sensação progressiva.
- **Barras**: ajustar sensibilidade ao sintoma: subesterço na entrada, endurecer a traseira ou amolecer a frente; sobresterço na saída, o inverso.
- **Camber**: mais negativo ajuda em curva, mas em tração dianteira o excesso (-5° a -6°) prejudica consistência; checar desgaste.
- **Toe**: toe-out frontal ajuda a virada inicial e custa velocidade em curva longa; toe-in traseiro dá estabilidade (principalmente RWD); desvio grande aumenta atrito e desgaste.
- **LSD**: valores altos = travado, baixos = aberto. Sensibilidade de aceleração define a rotação previsível na saída; **frenagem baixa** reduz subesterço na entrada; torque inicial controla a rapidez de travar.
- **Aero**: começar com frontal alta para virada e ajustar a traseira para estabilidade em alta; reduzir os dois lados se o arrasto prejudicar a máxima.
- **Câmbio**: curva de potência "pontuda" pede marchas mais próximas; ajustar para a velocidade máxima da pista; longa 1ª, curta última, intervalos que diminuem.
- **Balanço de freio**: mais à frente = estabilidade; mais atrás ajuda frenagem com curva e gestão de pneus.
- **ECU x restritor**: o ECU corta potência e torque proporcionalmente; o restritor corta o pico em alta rotação. Restritor para atingir potência-alvo; ECU para reduzir PP com menos perda.
- **Regra geral**: valores extremos raramente funcionam; consistência vale mais que uma volta única; o ideal depende de carro e pista.

Como integrar: um arquivo de conhecimento `docs/` ou um prompt do coach com esses princípios, e um mapa **sintoma -> ajuste** (subesterço na entrada/meio/saída, sobresterço, instabilidade em frenagem, patinagem) alimentado por métricas que o app já calcula (curva a curva).

### 5.4 Alternativas propostas (em ordem de valor)

1. **Setup do usuário no app** (entrada manual): formulário por carro e pista com os campos de 5.2 (o app já grava sessões por carro/pista). Armazenar em SQLite local. Permite comparar **tempo de volta e métricas curva a curva** antes e depois do ajuste. É o que mais ajuda e não tem risco legal.
2. **Importar/exportar CSV ou JSON** de setups do próprio usuário (e de amigos que compartilharem). Definir um esquema simples e versionado, com `carCode`, `courseId`, parâmetros e notas.
3. **Parâmetros inferidos da telemetria** gravados automaticamente por sessão: relações de marcha, velocidade máx. da transmissão, altura de suspensão média por roda (diferença F/T = rake aproximado), capacidade do tanque, categoria do carro. Mostrar "o que mudou desde a última sessão" (útil para o coach detectar que o usuário mudou o câmbio).
4. **Coach com princípios + diagnóstico**: o coach de IA recebe o setup atual (se informado), os sintomas medidos e o guia de 5.3; devolve sugestões de **uma mudança por vez**, em passos pequenos.
5. **Heurísticas calculadas** (frequência natural alvo, razão de ARB, faixa de relações de marcha para a velocidade máxima da pista, a partir do `course.csv`): estilo `setup-lab`, mas com a fonte dos números explícita. Há fórmulas físicas públicas (amortecimento crítico = 2·sqrt(K·M), frequência = 1/(2π)·sqrt(K/M)) citadas em fórum, mas o jogo usa valores de interface sem unidade física direta; a própria calculadora comercial admite que ARB é um número "fictício". **Tratar como ponto de partida, não verdade.**
6. **Pedir permissão** a autores de tunes (GTPlanet, criadores) para um catálogo opcional com créditos. Só vale se houver interesse da comunidade; não é prioridade.

---

## 6. Pneus, combustível, consumo e altitude

- **Compostos disponíveis**: Conforto, Esportivo, Corrida (Duro/Médio/Macio), Intermediário, Chuva pesada, e variantes de terra/neve (siglas do gt7info). O gt7info traz o **PP stock de cada carro em cada pneu** (`stockperf.csv`), útil para mostrar "quanto PP você ganha/perde trocando o composto".
- **Desgaste**: **não há tabela publicada** de taxa de desgaste por composto/classe. `tyre-wear.md` do gt7info são anotações de lap time (ex.: um 800 PP X2019 em Blue Moon Bay a 50x: tempo subindo de ~45,1 s para ~48,7 s nas primeiras ~30 voltas e estabilizando), útil como curiosidade, não como modelo. Mantê-lo como dado a ser **medido pelo próprio app** (queda de pace por volta e temperatura de pneu).
- **Multiplicadores por evento**: cada Daily Race define multiplicadores de combustível e de desgaste (de 1x a 10x observados; ex.: Gr.4 em Kyoto com 4x pneu e 3x combustível; Gr.3 em Road Atlanta 4x pneu e 2x combustível; Gr.4 em Trial Mountain 8x e 3x; set/2026 no Red Bull Ring 2x/5x), além de pneus obrigatórios. Fonte: guias semanais da GTPlanet/Traxion. O gt7info tinha esse CSV semanal só até out/2022. O app pode **pedir ao usuário** os multiplicadores do evento e projetar voltas de pneu/combustível.
- **Combustível**: `fuel` atual e `capacity` vêm no pacote; o consumo por volta é calculável (já está no estudo do protocolo). Sem tabela externa necessária. Cuidado: capacidade 0 = "não consome" e EV usa percentual de bateria.
- **Altitude x potência**: `course.csv` tem `Altitude` (em metros, ex.: Deep Forest 1500 m, Laguna Seca 232 m). Não encontrei documentação de que o GT7 modele perda de potência por altitude; **não verificado**. Se o app mostrar altitude, apresentar como contexto, sem afirmar efeito de potência.
- **Pit lane**: `PitLaneDelta` (s) do `course.csv` entra na estratégia de parada.

---

## 7. APIs gratuitas e endpoints públicos

| API | Autenticação | Limites | Cobertura | Observação |
|---|---|---|---|---|
| **GT-Gridstats** `https://gt-gridstats.com` (doc: `/api-docs`) | `Authorization: Bearer <token pessoal>` | 10 req/min nos endpoints "metered" (+cota; cabeçalhos `X-Quota-*`; 429 ao exceder); 30 req/min em `/api/assets/regions`; lote até 16 pilotos | `GET /api/racers/{psn,...}`, `/api/tt-live`, `/api/dailies/this-week`, `/api/dailies/next-week`, `/api/daily-live/{psn}`, `/api/series-{n}/...`, `/api/assets/manufacturers`, `/api/assets/tracks`, `/api/assets/cars` (paginado, `locale`) | Não oficial, "not affiliated with PD/SIE". Não achei termos de uso/licença do dado. Não testei (exige token). Útil para **Daily Race da semana** e DR |
| Site oficial `gran-turismo.com/us/gt7/...` | Login PSN | n/d | Estatísticas do jogador (DR, etc.) | Segundo discussões do GTPlanet, ao contrário do GT Sport, o acesso exige conectar o perfil PSN e a PD restringiu dados; **sem JSON público documentado**. Não fazer scraping autenticado |
| gt7info `data.json` | nenhuma | arquivo estático, atualizado diariamente | Used, Legend (e rewards, engineswaps via CSVs) | MIT-0. O trecho `dailyrace` é placeholder |
| `alexpersian/gtsport-api` | n/a | n/a | **GT Sport** | Descontinuado; não serve ao GT7 |
| Telemetria UDP do PS5 | cifra Salsa20 (já implementada) | 60 Hz | ao vivo | já em uso |
| Live timing API da PD (via PDTools `LiveTimingApi`) | exige acesso/TinyWeb com mods | n/d | tempos ao vivo de evento | fora de escopo (modificação do console/jogo) |

Não encontrei API pública de "GT World Series" do GT7, de Daily Race rankings do site oficial, nem de Kudos Prime.

---

## 8. Concorrentes/projetos abertos úteis como referência (não como dados)

Busca por `topic:gt7` e termos relacionados, em 09/11/2026: `snipem/gt7dashboard` (GPL-3.0, 329 estrelas), `Bornhall/gt7telemetry` (GPL-3.0), `MacManley/gt7-udp` (MIT), `jbhoorasingh/gt7-datalogger` (MIT, análise de curva, combustível, overlay OBS), `szilvasolutions/GT7_AI_coach`, `aleon80/gran-turismo` (MIT, dashboard + coach), `GreenRiceCake/GTMate` (MIT), `qshiqshi/gt7-companion-by-qshi` (GPL-3.0), `those-who-run/those-who-run` (GPL-3.0), `eoalvar/gt7-career-tracker`. Nenhum publica banco de specs ou de setups; copiar código GPL contaminaria o app, só consultar ideias.

---

## 9. Recomendação priorizada

1. **(Agora, baixo esforço, risco baixo)** Estender `packages/shared/scripts/gen-cars.mjs` para trazer também, do gt7info (MIT-0, mesmo commit fixado):
   - `stockperf.csv` -> PP stock por pneu (comparador de composto, e estimativa de PP de um carro Gr.N/X);
   - `course.csv` -> comprimento, altitude, nº de curvas, maior reta, pit lane delta, categoria, oval, "NoRain" (enriquecer a tela de pistas e a estratégia);
   - `engineswaps.csv` e `lotterycars.csv` (marcadores de carro no catálogo);
   - classificação H/M/L de `track-bop.txt` (com aviso de dados parados), cruzando por nome de pista.
   Arquivo gerado e versionado, **sem download em runtime**, como já é a decisão atual.
2. **(Agora)** Ler no pacote de telemetria e **gravar por sessão**: categoria do carro (0x16C), entre-eixos, relações de marcha, velocidade máx. da transmissão, altura média de suspensão por eixo, capacidade do tanque. Isso vira o "setup observado" sem depender de nenhuma base externa.
3. **(Curto prazo)** Setup manual do usuário + importar/exportar JSON/CSV (seção 5.4) e o guia de princípios de afinação em pt-BR para o prompt do coach (5.3).
4. **(Curto prazo, só link)** No cartão do carro e na tela da sessão, botões "Ficha oficial" (lista da PD), "BoP atual" (DG EDGE e GT-Engine) abrindo o navegador. **Zero cópia de dados.**
5. **(Médio prazo, depende de resposta)** Escrever ao autor da GT-Engine e ao DG EDGE pedindo permissão para consumir/mostrar a BoP (potência/peso H/M/L por carro) com crédito. Se concederem, importar como JSON versionado por versão do jogo (1.72, 1.73...), com campo `bopVersion` e data.
6. **(Opcional)** Integração com GT-Gridstats em runtime com cache e token do usuário, só para "Daily Race desta semana" e DR; marcar como opcional e fora do caminho crítico. Confirmar termos antes.
7. **Descartar**: scraping do site oficial/DG EDGE/GT-Engine, extração de SpecDB, tunes de Patreon, Fandom e Wikidata (sem mapeamento), `gt7sp-api`.

### Quadro MIT/CC0/CC-BY (embarcável) x só linkável

| Embarcável | Só linkável |
|---|---|
| gt7info (MIT-0): carros, marcas, países, grupos, PP stock, pistas, engine swaps, loteria, Brand Central, used/legend | Lista oficial da PD, DG EDGE (cars e BoP), GT-Engine (specs/BoP), GTPlanet (fóruns e guias), Traxion, Coach Dave Academy (© 2026), Patreon/tunes, GT7 Tuning Calculator |
| `simple-icons` (CC0): logos (já em uso) | Fotos dos carros e logos oficiais do jogo |
| Código MIT (PDTools, MacManley/gt7-udp, setup-lab) como referência/ports | Código GPL (gt7dashboard, gt7telemetry, etc.) |
| Princípios de afinação **reescritos por nós** (conhecimento geral, sem copiar texto) | Texto dos guias de terceiros |

---

## 10. Exemplos de dados para o esquema (propostas)

```jsonc
// setup do usuário (proposta)
{
  "carCode": 3411, "courseId": 10, "createdAt": "2026-11-09T12:00:00Z",
  "tyre": "RM", "ballastKg": 0, "powerRestrictorPct": 100,
  "susp": { "rideHeightMm": [85, 95], "freqHz": [2.05, 2.15], "arb": [6, 5],
            "camberDeg": [-3.0, -2.0], "toeDeg": [0.14, -0.10],
            "damperComp": [20, 20], "damperExt": [35, 35] },
  "lsd": { "initial": 10, "accel": 40, "brake": 20 },
  "aero": [450, 600], "gears": { "final": 3.6, "ratios": [3.1, 2.2, 1.7, 1.4, 1.2, 1.0] },
  "assists": { "tcs": 1, "abs": 1 }, "brakeBias": -1, "notes": "..."
}

// bop de evento (proposta; preenchido pelo usuário ou importado com permissão)
{ "carCode": 2159, "group": "3", "gameVersion": "1.72", "speed": "H",
  "powerPs": 461, "weightKg": 1220, "source": "gt-engine|user" }
```

---

## 11. Lacunas confirmadas

- Não há base aberta de **setups** do GT7 (nem API); só soluções pagas, fóruns ou heurísticas.
- Não há fonte aberta de **potência, torque, peso, tração, aspiração e preço de catálogo** por carro.
- Não há tabela aberta de **BoP** por carro; só páginas protegidas (GT-Engine, DG EDGE).
- Não há dados publicados de **taxa de desgaste de pneu por composto/classe**.
- **Daily Races atuais** não estão em nenhuma fonte aberta (o gt7info parou em out/2022 para esse item); só guias de imprensa e a GT-Gridstats (token).
- Não verificado: Fandom wiki (bloqueio), termos de uso da GT-Engine e da GT-Gridstats, conteúdo dos Low/Mid no HTML do DG EDGE, modelagem de altitude no jogo.

## 12. Links

- gt7info: https://github.com/ddm999/gt7info , dados: https://github.com/ddm999/gt7info/tree/web-new/_data , site: https://ddm999.github.io/gt7info/ , notas JSON: https://github.com/ddm999/gt7info/blob/web-new/json-dev-notes.html
- Lista oficial PD: https://www.gran-turismo.com/us/gt7/carlist/ , anúncio: https://www.gran-turismo.com/us/gt7/news/00_1917470.html
- DG EDGE: https://www.dg-edge.com/database , BoP: https://www.dg-edge.com/database/bop , artigo de lançamento: https://www.dg-edge.com/articles/news/dg-edge-new-gran-turismo-7-database/589
- GT-Engine: https://gt-engine.com/gt7/gt7.html , Gr.3: https://gt-engine.com/gt7/cars/gr3/gr3-01-specs.html
- SpecDB (Nenkai): https://nenkai.github.io/gt-modding-hub/concepts/specdb/ , PDTools: https://github.com/Nenkai/PDTools
- GT-Gridstats: https://gt-gridstats.com/api-docs
- Setup Lab: https://github.com/abibonny95/setup-lab
- Coach Dave Academy (afinação): https://coachdaveacademy.com/tutorials/gran-turismo-7-tuning-explained
- Traxion (guia FWD): https://traxion.gg/gran-turismo-7-front-wheel-drive-setup-guide-2/
- GTPlanet (BoP Gr.3, mar/2025): https://www.gtplanet.net/gran-turismo-7-bop-change-20250327/ (bloqueou leitura; usado só pelo resumo do buscador)
- GT Sport API (descontinuada): https://github.com/alexpersian/gtsport-api
