# Pesquisa: pistas, layouts, curvas e corridas diárias do GT7

Data da pesquisa: 9 de novembro de 2026 (GT7 na versão 1.72, "Spec IV Parte 1", lançada em 15/10/2026).
Escopo: enriquecer o app com dados externos de pistas/layouts/curvas e do calendário de Sport Mode (Corridas Diárias A/B/C, Time Trials, World Series).
Método: arquivos e APIs foram lidos de verdade (GitHub API, `raw.githubusercontent.com`, páginas do DG EDGE, bundle do site oficial). Cada afirmação tem URL. O que não foi verificado está marcado como "não verificado".

---

## 0. Resumo executivo

1. **Lista de pistas/layouts com números: está resolvida e é embarcável.** O `course.csv` do `ddm999/gt7info` (licença MIT-0, domínio público na prática) traz 122 layouts com ID numérico do jogo, comprimento, nº de curvas, desnível, altitude, reta mais longa, país, categoria, se é reverso/oval e perda de tempo no pit. Foi atualizado em 29/05/2026, então **falta Sportsland SUGO** (entrou no jogo na 1.72, em 15/10/2026) e Autumn Ring chega em dezembro.
2. **Traçado georreferenciado casável com o x/z do jogo EXISTE**, ao contrário do que se esperava. Duas fontes gratuitas, ambas com licença permissiva: `zetetos/gt-telemetry` (MIT, 86 circuitos com polilinha em coordenadas do jogo, linha de largada e comprimento, atualizado em 15/10/2026 para a 1.72) e `jbhoorasingh/gt7-datalogger-track-data` (CC0 nos dados, 32 pistas com bordas levantadas, coordenadas de apex de 162 curvas e `signatures.json` para reconhecer a pista por uma volta).
3. **Nomes de curvas: praticamente não existe fonte aberta.** Há número da curva e posição do apex (162 curvas em 14 pistas), mas os nomes ficam vazios (`"name": ""`). Os nomes tradicionais (Eau Rouge, Corkscrew) só vêm de fontes de pista real (Wikipedia/OSM, com licenças próprias) e nas pistas originais da Polyphony só existem nomes de fã, em fóruns (GTPlanet).
4. **Corridas Diárias: não existe API, JSON, RSS nem calendário oficial.** O `gt7info` desistiu do `dailyrace` ("no longer provided due to an inability to keep it up to date") e o último CSV semanal do repositório é de 31/10/2022. A fonte mais completa e estável é o **DG EDGE** (páginas HTML por evento, sitemap com `lastmod`), mas os termos reservam direitos autorais e de banco de dados e exigem permissão escrita para uso comercial. Não há cláusula sobre automação.
5. **Divergência de comprimento:** medindo as assinaturas publicadas (81 layouts) contra o comprimento oficial, a mediana da razão medido/oficial é **0,9905 (-0,95 %)**, p10 = 0,972, p90 = 1,000. O -1,3 % do app em Trial Mountain é típico. A tolerância atual do app (`LENGTH_TOLERANCE = 1.5%` simétrica, em `packages/web/src/analysis/lib/trackSuggest.ts`) é apertada demais. Recomendação: janela assimétrica de -4 % a +1,5 % mais desempate por posição da linha de largada e sentido da volta (seção 5).

---

## 1. Tabela de fontes

Notas: qualidade 0 a 5 (cobertura, correção, atualidade). Integração 0 a 5 (5 = trivial). Risco = legal/ToS (baixo/médio/alto).

| # | Fonte | URL exata | Formato | Licença / ToS | Tamanho | Atualização (verificada) | Qual. | Integ. | Risco | Dá para embarcar? |
|---|---|---|---|---|---|---|---|---|---|---|
| A | **gt7info `course.csv`** (layouts, IDs numéricos) | https://raw.githubusercontent.com/ddm999/gt7info/web-new/_data/db/course.csv (espelho com CORS: https://ddm999.github.io/gt7info/data/db/course.csv) | CSV, 122 linhas, 20 colunas | MIT-0 (https://github.com/ddm999/gt7info/blob/web-new/LICENSE) | 12 KB | Último commit do arquivo: 29/05/2026; repo ativo (push em 09/11/2026, pelas listas diárias de carros) | 4 | 5 | baixo | **Sim.** Copiar versionado |
| B | gt7info `crsbase.csv` + `country.csv` (local base e país, nome do logo) | mesma pasta `_data/db/` | CSV, 41 bases / 19 países | MIT-0 | 1,2 KB / 0,3 KB | idem (29/05/2026) | 4 | 5 | baixo | **Sim** |
| C | **zetetos/gt-telemetry** `pkg/circuits/inventory/*.json` (polilinha x/y/z do jogo, linha de largada, comprimento medido) | https://github.com/zetetos/gt-telemetry/tree/main/pkg/circuits/inventory (86 arquivos). Mirror de atualização ao vivo: https://static.zetetos.com/gt7/data/version.json | JSON por circuito (`id`, `name`, `variation`, `country`, `length`, `startLine`, `coordinates[]`) | MIT (código e dados do repo) | ~20 KB por circuito, 86 circuitos, cerca de 1,7 MB | commit "202610 circuit update (GT7 v1.720)" em 15/10/2026; `version.json` também de 15/10/2026 | 4 | 4 | baixo | **Sim** (preservar o aviso MIT) |
| D | **jbhoorasingh/gt7-datalogger-track-data** `signatures.json` + `index.json` | https://raw.githubusercontent.com/jbhoorasingh/gt7-datalogger-track-data/HEAD/signatures.json e `.../index.json` | JSON; assinatura = comprimento, caixa, linha de corrida a cada 20 m em ordem de percurso, gêmea reversa | **CC0** nos dados (`tracks/`, `index.json`); ferramentas MIT; `vendor/` vem do gt-telemetry (MIT) | signatures 400 KB; index ~100 KB | push em 08/11/2026; 122 configs, 81 com assinatura | 4 | 4 | baixo | **Sim** (CC0/MIT) |
| E | gt7-datalogger-track-data `tracks/<slug>.json` (bordas levantadas, apex de curvas, cruzamentos da linha de chegada) | https://github.com/jbhoorasingh/gt7-datalogger-track-data/tree/main/tracks | JSON "track bundle v5" | CC0 | 0,2 a 2 MB por pista (32 pistas, ~25 MB) | 05/11/2026 (SUGO) | 3 | 3 | baixo | Sim, mas só as pistas que o app usar (pesado) |
| F | gt7-datalogger `catalog/tracks.json` (42 pistas, 86 layouts, flags real/original, chuva, Sophy, piso, página da wiki) | https://raw.githubusercontent.com/jbhoorasingh/gt7-datalogger-track-data/HEAD/catalog/tracks.json | JSON, 50 KB | CC0 declarado, mas o próprio README diz que é metadado factual do GT7 "só para identificação"; deriva do site oficial + Fandom (CC BY-SA) | 50 KB | gerado em 20/10/2026 | 4 | 4 | médio | Só os fatos numéricos; não copiar texto da wiki |
| G | **Site oficial: Gran Turismo 7 Tracks List** (122 configs, 42 locais, com SUGO) | https://www.gran-turismo.com/gb/gt7/tracklist/ (SPA React; dados em chunks JS `.../common/dist/gt7/tracklist/assets/tracks.<locale>-<hash>.js`, locale `bp` = português do Brasil, `gb` em milhas) | JS com objeto `{id hex, baseId, cornerCount, length, straight, elevationGap, nameLong, countryName}` | © Sony/Polyphony; sem licença de dados; não há endpoint documentado | ~30 KB por idioma | reflete a 1.72 (tem SUGO) | 5 | 2 | médio-alto | **Só linkar/conferir manualmente.** Fonte da verdade para validar a tabela embarcada |
| H | **DG EDGE database de pistas** | https://www.dg-edge.com/database/tracks/trial-mountain-circuit/313 ; lista em https://www.dg-edge.com/sitemaps/tracks.xml (42 pistas) | HTML | Termos: conteúdo, incluindo compilações de dados, protegido por direitos autorais e de banco de dados; uso comercial exige permissão escrita (https://www.dg-edge.com/p/terms-and-conditions) | ~100 KB/página | em dia (tem SUGO) | 5 | 2 | médio | **Só linkar** |
| I | **DG EDGE Corridas Diárias / Time Trials / World Series** | https://www.dg-edge.com/events/dailies ; evento: `/events/dailies/week-46-2026-race-b-trial-mountain-circuit/695` ; https://www.dg-edge.com/sitemaps/events.xml | HTML (sem JSON-LD de evento, sem RSS, sem API) | idem H; `robots.txt` permite `/events` (só bloqueia `/search/`, `/players?`...) | página /events/dailies ~1 MB; página de evento bem menor | atualizada na semana corrente (Semana 46/2026 já publicada) | 5 | 2 | médio | **Só linkar; ou ler com cache e baixa frequência após pedir permissão** (seção 3) |
| J | gtsh-rank.com/daily | https://gtsh-rank.com/daily/ | HTML | termos em /terms/ (não lidos) | n/d | semana 46 já publicada | 3 | 1 | médio | Só linkar |
| K | GTPlanet (artigos semanais "Daily Races") | https://www.gtplanet.net/tag/daily-races/ | HTML atrás de Cloudflare ("Just a moment..."; feeds `/feed/` bloqueados) | © GTPlanet | n/d | semanal | 4 | 0 | alto | Só linkar |
| L | racinggames.gg (artigos de Daily Races) | https://racinggames.gg/ (a rota `/feed` devolve a SPA, não RSS) | HTML | © do site | n/d | semanal | 3 | 1 | médio | Só linkar |
| M | Fandom wiki (Track List, Daily Races) | https://gran-turismo.fandom.com/wiki/Sport_Mode_(GT7)/Daily_Races | HTML (retornou HTTP 402 para o fetch automatizado) | CC BY-SA (declarado pelo Fandom; não confirmado nesta sessão) | n/d | não verificado | 3 | 1 | médio | Linkar |
| N | Wikidata (pistas reais e fictícias) | https://www.wikidata.org/wiki/Special:EntityData/Q174170.json (Suzuka); Trial Mountain = Q124247884 | JSON | CC0 | pequeno | contínua | 3 | 4 | baixo | **Sim**, para país/coordenada/comprimento de pistas reais |
| O | OpenStreetMap (traçado de pistas reais) | tag `highway=raceway` (https://wiki.openstreetmap.org/wiki/Tag:highway=raceway); Overpass API | GeoJSON/OSM XML | **ODbL** (atribuição + share-alike da base derivada) | variável | contínua | 3 | 2 | médio | Só em tempo de execução ou como script de geração; não misturar ao banco do app sem avaliar a ODbL |
| P | vthinsel/GT7Tracks | https://github.com/vthinsel/GT7Tracks | CSV de posições por ID de pista (`dumps/<courseId>.csv`) + `trackdict.json` + modelo Keras | MIT | 17 MB | último push 07/05/2026 | 2 | 2 | baixo | Só como inspiração (cobre ~22 IDs) |
| Q | MacManley/gt7-track-visualizer, Silentwarior112/GT-Trackmaps | https://github.com/MacManley/gt7-track-visualizer ; https://github.com/Silentwarior112/GT-Trackmaps | CSV/PNG | licença não verificada (sem `spdx_id` na API do segundo) | 2 MB / 93 MB | abril/2024 e julho/2024 (defasadas) | 1 | 1 | médio | Não |
| R | snipem/gt7dashboard | https://github.com/snipem/gt7dashboard | Python, GPL-3.0 | **GPL-3.0** | n/d | 06/03/2026 | 2 | 1 | médio (copyleft) | Não copiar código. Não traz dados de pista |
| S | Nenkai/PDTools | https://github.com/Nenkai/PDTools | C# | MIT | 1,6 MB | 19/10/2026 | 3 | 1 | baixo | Referência do protocolo e dos IDs do jogo, não de pistas |

Observações:
- SimHub, Garage61 e Kudos Prime: o plugin de GT7 do SimHub expõe só parte dos campos de UDP (https://github.com/SHWotever/SimHub/issues/2254). Garage61 e Kudos Prime **não foram verificados** (a busca não retornou nada sobre eles).
- DG EDGE tem seu próprio app de telemetria ("Traces", https://traces.dg-edge.com/) e um app de coach ("Delta"), ou seja, é concorrente direto do tema do app. Mais um motivo para pedir permissão antes de ler o site sistematicamente.

---

## 2. Pistas e layouts (itens 1 e 2 do pedido)

### 2.1 gt7info (a base recomendada)

Colunas do `course.csv`: `ID, Name, Base, Country, Category, Length, LongestStraight, ElevationDiff, Altitude, MinTime*, MaxTime*, LayoutNumber, IsReverse, PitLaneDelta, IsOval, NumCorners, NoRain`.

Trechos reais (linhas 1024 e 1034 e as 4 linhas de SUGO que faltam):

```csv
ID,Name,Base,Country,Category,Length,LongestStraight,ElevationDiff,...,LayoutNumber,IsReverse,PitLaneDelta,IsOval,NumCorners,NoRain
1024,Trial Mountain Circuit,31,3,original,5434,1340,58.0,...,1,0,...,0,15,0
1034,Trial Mountain Circuit - Reverse,31,3,original,5434,1340,58.0,...,2,1,...,0,15,0
```

Outros fatos úteis do arquivo: 122 layouts em 41 bases (locais); categorias `circuit | original | city | snow_dirt`; `Country` é um ID que se resolve em `country.csv` (2=Japão, 3=EUA, 4=Reino Unido, 5=Alemanha, ...). `crsbase.csv` dá o nome do local e o `LogoName` usado no site. Frequência de atualização: o doc do autor (https://ddm999.github.io/gt7info/json-dev-notes) diz que `cargrp/course/crsbase/lotterycars/stockperf` "dependem de dados do jogo + esforço manual significativo e portanto atualizam bem mais devagar".

**Limitações confirmadas:**
- O próprio autor escreve no commit de 29/05/2026: "added the newer tracks but i used ?? for stuff that i couldn't just find & a dummy course id". Os IDs `2001` a `2004` (Eiger Nordwand, Yas Marina, Circuit Gilles-Villeneuve) são **fictícios**; o ID real de Eiger, Yas e GV não está no arquivo. Portanto o ID do `course.csv` **não é confiável para as pistas novas**.
- **SUGO ausente.** O DG EDGE usa `Track1340.webp` para SUGO (ver 2.3), ou seja, o ID real é 1340.
- `course-bop` do mesmo site (https://ddm999.github.io/gt7info/course-bop) é uma lista de pistas por classe de BoP (Alta/Média/Baixa velocidade) e avisa que provavelmente não será mais atualizada.
- Comprimentos de layouts mais novos vêm como `5423.0` (decimal) e com mais casas (`560.5272`): normalizar na leitura.

### 2.2 Três espaços de ID que não batem entre si

| Espaço | Exemplo (Trial Mountain / reverso) | Onde aparece |
|---|---|---|
| ID numérico "course" do jogo | 1024 / 1034 | gt7info `course.csv`; DG EDGE usa o mesmo número no nome da imagem (`Track1024`, `Track1034`) |
| ID hexadecimal do site oficial | `802508` / `26514b` | página Tracks List oficial; `index.json` do gt7-datalogger |
| ID interno do DG EDGE (banco) | 313 / 314 | URL `/database/tracks/.../313` |

O mapeamento mais seguro entre a lista oficial (hex) e o `course.csv` (numérico) é por **nome normalizado + comprimento** (mesmo valor nas duas, pois ambas vêm do jogo: 5434 m).

### 2.3 Fonte oficial e DG EDGE (referência para validar)

- Site oficial: o bundle `tracks.bp-*.js` (português do Brasil) traz 122 itens com `cornerCount`, `length_v` (metros), `straight_v`, `elevationGap_v` e `nameLong` traduzido (por exemplo "Trial Mountain Circuit - Direção Invertida"). Isso confirma que o jogo/site oficial têm 122 configurações incluindo SUGO (`4bf61b`, 3586 m, 13 curvas). É código de página © Sony; usar só para conferência manual, não redistribuir.
- DG EDGE, página de SUGO: 3,59 km, 69 m de desnível, reta de 705 m, 13 curvas, "Real", asfalto, imagem `Track1340.webp`. Página de Trial Mountain: "Fictional", 5,43 km, 58 m, reta 1340 m, 15 curvas, reversível, Sophy: sim, noite: sim, chuva: não, imagens `Track1024` e `Track1034`.

### 2.4 Traçados georreferenciados no sistema x/z do jogo (resposta ao item 2)

**Existe.** Os dois repositórios abaixo derivam de telemetria real do jogo, portanto estão no **mesmo sistema de coordenadas** do pacote UDP (x, y, z em metros do mundo do jogo).

1. `zetetos/gt-telemetry` (MIT). Exemplo real, Trial Mountain (`TrialMountainCircuit.json`, 20,8 KB):
   ```json
   { "id": "TrialMountainCircuit", "name": "Trial Mountain Circuit", "country": "us",
     "length": 5332, "startLine": { "x": 128, "y": -14, "z": 304 },
     "lastModified": "2025-09-23T13:50:58Z",
     "coordinates": [ {"x":128,"y":-14,"z":304}, {"x":144,"y":-14,"z":304}, ... ] }   // 503 pontos
   ```
   Características: pontos numa grade de 16 m (quantizados, o comprimento da polilinha dá 6234 m, **não serve para medir comprimento**; use o campo `length`), tem `startLine` (útil para casar por posição) e cobre 86 configurações incluindo SUGO, Yas Marina, GV, Eiger, todos os Tokyo, Nürburgring (Endurance, Sprint, 24h, Tourist...), Fuji Short, Spa 24h. A atualização de 15/10/2026 (GT7 1.72) já inclui SUGO. Não há nomes de curva.
   O README mostra que a biblioteca faz "matching a circuit based on a given coordinate" (casar circuito por coordenada) e tem atualização ao vivo em `https://static.zetetos.com/gt7/data` (`version.json` → `circuits.lastModified: 2026-10-15T06:58:13Z`).

2. `jbhoorasingh/gt7-datalogger-track-data` (CC0 nos dados). Exemplo real de `signatures.json` (linha de Trial Mountain):
   ```json
   { "official_id": "802508", "official_name": "Trial Mountain Circuit", "length_m": 5332,
     "min_x": -976.5, "max_x": 954, "min_z": -402.2, "max_z": 379.4,
     "provenance": "survey", "path": [ ...261 pontos a cada 20 m, na ordem em que foram dirigidos... ],
     "reverse": { "official_id": "26514b", "official_name": "Trial Mountain Circuit (Reverse)" },
     "ambiguous_with": [], "flags": [] }
   ```
   81 layouts com assinatura (30 de levantamento, 51 de captura), 36 com gêmea reversa, 15 marcados como ambíguos. O README descreve um problema que o app provavelmente também tem: comprimento + caixa não distinguem um layout do seu reverso (mesmo comprimento e mesma caixa), e a solução foi **comparar a linha em ordem de percurso**. Eles relatam que, sem isso, 10 voltas de Deep Forest Reverse foram classificadas como Deep Forest normal em 896 voltas reais.
   Os `tracks/<slug>.json` (bordas, apex) existem para 32 configurações. Exemplo de curva: `{"n":1,"name":"","direction":null,"apex":{"x":977.3,"z":396.1},"entry":null,"exit":null,"note":""}` (Suzuka).
   **Atenção:** o sistema de coordenadas dos dois repositórios usa a mesma origem do jogo? Os valores de Trial Mountain batem na ordem de grandeza (caixa de -976 a 954 em x), mas a conferência de que x/z do app coincidem com esses arquivos **não foi feita aqui**: fazer um teste com uma volta gravada do app e medir a distância média até a polilinha antes de confiar.

### 2.5 Nomes e números de curvas

| O que | Existe? | Onde / observação |
|---|---|---|
| Número da curva (oficial) | Sim | `NumCorners` no `course.csv`; `cornerCount` no site oficial (Trial Mountain = 15) |
| Posição (apex) de cada curva no x/z do jogo | Parcial: 162 curvas rotuladas em 14 pistas | `corners[]` nos bundles do gt7-datalogger (Suzuka, Spa, Monza, Mount Panorama, Daytona Road, Daytona Tri-Oval, Lago Maggiore Full e Centre, Sardegna A, SUGO, Suzuka East, Tsukuba...). Trial Mountain: `corners: []` (0). Os nomes (`name`) estão **vazios** |
| Nomes tradicionais (Eau Rouge, Corkscrew, Degner...) | Não em formato aberto | Na Wikipedia (CC BY-SA, texto) e no OSM. O OSM ainda **não tem convenção** para nomear curvas: o fórum da comunidade discute `ref=` ou `ref:turn=` (https://community.openstreetmap.org/t/motorsports-racetrack-tagging-conventions/145537) |
| Nomes de curvas das pistas originais da Polyphony (Trial Mountain, Deep Forest...) | Só nomes de fã | Fórum do GTPlanet (https://www.gtplanet.net/forum/threads/corner-and-straight-names-for-pd-created-circuits-circuit-maps-added-in-post-5-details-in-op.314650/), com direitos dos autores; não foi verificado se tem Trial Mountain |
| Centerline de pista real (OSM) | Sim para pistas reais, mas no sistema lat/lon | A pista do jogo é uma recriação; o traçado do OSM só serviria como referência visual, com transformação afim manual. **Não há** tabela de correspondência lat/lon ↔ x/z do jogo |
| Wikidata | Sim, ponto único | Suzuka (Q174170): coordenada `34.8417, 136.5389`, comprimento 5807 m (P2043), site; Trial Mountain Circuit tem item (Q124247884, "fictional race track from the Gran Turismo series"). Sem traçado |

Conclusão prática: o app já calcula as próprias curvas a partir da telemetria. O que se ganha de fonte externa é (a) o **número oficial de curvas** para validar a detecção, (b) as **posições de apex** como "gabarito" em 14 pistas e (c) nomes só se o app permitir o usuário nomear e guardar localmente (o gt7-datalogger faz isso e seu catálogo ainda está vazio de nomes).

---

## 3. Corridas Diárias, Sport Mode e eventos (item 3)

### 3.1 O que NÃO existe (verificado)

| Procurado | Resultado |
|---|---|
| API/endpoint JSON oficial em gran-turismo.com | **Não encontrado.** O site `/us/gt7/` é institucional; a Tracks List é uma SPA que não chama API de eventos. A notícia oficial só diz que "Daily Races will be updated at irregular intervals" (https://www.gran-turismo.com/gb/gt7/news/00_1703853.html, de 2022). O calendário só existe dentro do jogo |
| `dailyrace` no gt7info | **Descontinuado.** Na documentação do JSON: "All data in 'dailyrace' is placeholder as it is no longer provided due to an inability to keep it up to date. Do not use it." O repositório tem 33 CSVs semanais, o último de 31/10/2022 (`_data/dailyrace/22-10-31.csv`) |
| RSS/Atom | DG EDGE: `/rss` e `/feed.xml` retornam 404. GTPlanet: `/feed/` bloqueado pelo Cloudflare. racinggames.gg: `/feed` devolve a SPA, `/rss.xml` retorna JSON de erro "Feed not found" |
| JSON-LD de evento | A página `/events/dailies` do DG EDGE só tem JSON-LD de `WebSite` e `BreadcrumbList` |
| Repositório no GitHub com calendário JSON de Daily Races | Não encontrado (busca ampla não mostrou nenhum; os resultados eram só ferramentas de telemetria) |
| Bots de Discord com API pública | Não encontrados nesta pesquisa |

### 3.2 A fonte prática: DG EDGE (HTML estruturado e previsível)

- Página única da semana: https://www.dg-edge.com/events/dailies (a semana corrente, 3 corridas, arquivo paginado em `/events/dailies/page-N`).
- Página por evento: `/events/dailies/week-{N}-{ano}-race-{a|b|c}-{slug-da-pista}/{id}`; os IDs são sequenciais (Semana 46/2026 = 694, 695, 696; Semana 45 = 689, 690, 691).
- Sitemaps: https://www.dg-edge.com/sitemap.xml aponta para `sitemaps/events.xml`, `articles.xml`, `tracks.xml` com `lastmod`. Dá para saber "saiu semana nova?" lendo 1 sitemap por semana.
- Cada evento lista: pista e layout, classe ou carro, voltas, pneus (RM, RS, CS, SH...) e obrigatoriedade de pneus ("Required: RM, RS"), multiplicadores de combustível e desgaste (`×1 ×1`; o artigo semanal os rotula "×3 fuel, ×6 tyre wear"), tipo de largada (grid/rolling), dano, afinação (liberada/travada), vácuo (simulation/custom), BoP, frequência (a cada 20 ou 30 min), horário de relógio **dentro do jogo** (ex. 17:40), datas da semana, recorde, tempos para top 1000 e top 10000 e medalhas.
- **Não publicado:** clima (ausente), penalidades, fuso do horário de largada. O "Start time 17:40" é a hora do dia **no jogo**, não horário de saída da corrida; os minutos reais de largada aparecem em eventos como `:10, :30, :50` (corrida B).

#### Exemplo real: Semana 46/2026 (9 a 16 de novembro de 2026)

| | Race A | Race B | Race C |
|---|---|---|---|
| Pista | Suzuka Circuit, East Course | Trial Mountain Circuit | Michelin Raceway Road Atlanta |
| Carro/classe | Honda Integra Type R (DC2) '95 | Gr.4 | Gr.3 |
| Voltas | 7 | 6 | 14 |
| Pneus | CS | RM | RM + RS (ambos obrigatórios) |
| Combustível / desgaste | ×1 / ×1 | ×1 / ×1 | ×2 / ×5 |
| Hora do dia no jogo | 15:39 | 17:40 | 16:02 |
| Largada | grid | rolling | rolling |
| Afinação | proibida | liberada | liberada |
| Vácuo | simulation | custom | custom |
| Dano | não listado | médio | médio |
| BoP | sim | sim | sim |
| Frequência | a cada 20 min | a cada 20 min | a cada 30 min |
| Líder (recorde) | n/d | 1:59.089 (Lamborghini Huracán Gr.4) | n/d |

Fontes: https://www.dg-edge.com/events/dailies , https://www.dg-edge.com/events/dailies/week-46-2026-race-b-trial-mountain-circuit/695 e https://gtsh-rank.com/daily/ (confere pista, carro e largada). Semana 45/2026 (2 a 9/11): A = Dragon Trail Gardens, B = Grand Valley Highway 1, C = Watkins Glen Long Course, Gr.4, 11 voltas, RH + RM obrigatórios, 08:45 no jogo.

Outros calendários na mesma fonte (todos HTML, mesmo padrão):
- Time Trials: https://www.dg-edge.com/events/time-trials (ex.: Fuji Gr.3 de 5 a 19/11, pneu RH, 14:00, "BoP, Start attack, No tuning").
- World Series/Copas de Fabricantes e Nações: https://www.dg-edge.com/events/world-series (ex.: "Exhibition 3 Manufacturers Cup" Rd 3 em Monza, Gr.3, 13 voltas, 8 a 15/11; Rd 4 em Suzuka, 20 voltas, 15 a 22/11).

### 3.3 Como extrair de forma legítima

O que os termos do DG EDGE dizem (https://www.dg-edge.com/p/terms-and-conditions, resumo): o conteúdo, incluindo compilações de dados, é protegido por direitos autorais e "database rights"; ver em tela para uso pessoal não comercial é permitido; qualquer outra reprodução, cópia ou uso comercial exige permissão por escrito (contato digit@dg-edge.com). **Não há cláusula sobre scraping, bots ou API** (nem a permitindo nem proibindo). O `robots.txt` não bloqueia `/events`. O FAQ diz que o próprio site consulta dados de ranking do jogo até 5000 vezes em intervalos curtos e faz uma coleta completa por volta da meia-noite CET.

Opções, da mais segura para a mais arriscada (não é aconselhamento jurídico):

1. **Deriva da própria sessão do usuário (recomendada para o MVP).** O app já sabe a pista, o carro e as condições quando o usuário entra numa corrida. Marcar a sessão como "Corrida Diária" e guardar localmente. Zero risco.
2. **Cadastro manual leve:** botão "Corridas desta semana" que abre o DG EDGE no navegador e um formulário de 3 linhas (pista, carro/classe, voltas, pneus) salvo no `sessions.db`. Zero risco, custo de 1 minuto por semana.
3. **Pedir permissão** a digit@dg-edge.com para uma leitura por semana (3 páginas de evento, ~100 KB) por usuário, com cache local e link de volta. Como o DG EDGE vende produtos concorrentes (Traces, Delta), uma resposta negativa é plausível.
4. **Leitura automatizada sem permissão:** sitemap uma vez por semana (segunda-feira), baixar só as 3 páginas novas, `User-Agent` identificado, cache de 7 dias, nunca redistribuir. Risco médio (direito de banco de dados da UE se a extração for substancial; 3 registros por semana é muito pouco, mas os termos reservam tudo). Não recomendado como padrão do produto.

Não recomendado: GTPlanet (Cloudflare bloqueia, e é conteúdo editorial © do site) e a Fandom (402 ao acessar de forma automatizada).

---

## 4. Classificação e como integrar

| Fonte | Qualidade | Integração | Risco | Estratégia |
|---|---|---|---|---|
| gt7info `course.csv`+`crsbase.csv`+`country.csv` (MIT-0) | 4 | 5 | baixo | **Arquivo estático versionado** `packages/shared/src/data/gt7-courses.json` gerado por script (`scripts/build-courses.mjs`) a partir dos CSVs; revisar a cada versão do jogo |
| gt-telemetry `inventory/*.json` (MIT) | 4 | 4 | baixo | **Script de geração:** extrair `startLine`, `length` e uma polilinha decimada (a cada 20 a 50 m) para um `gt7-tracks-geometry.json` pequeno. Manter o aviso MIT em `THIRD_PARTY_NOTICES.md` |
| gt7-datalogger `signatures.json`/`index.json` (CC0) | 4 | 4 | baixo | **Arquivo estático** (400 KB) + comparador de linha em ordem de percurso para resolver reverso; ou usar só como conjunto de testes do reconhecedor do app |
| gt7-datalogger `tracks/*.json` (CC0) | 3 | 3 | baixo | Opcional: importar só `corners[].apex` (162 curvas) como gabarito |
| Site oficial Tracks List | 5 | 2 | médio-alto | **Linkar/validar manualmente** (conferir a tabela embarcada quando sair update) |
| DG EDGE (pistas e eventos) | 5 | 2 | médio | **Linkar.** Corridas Diárias via opções 1 e 2 da seção 3.3; opção 3 só com permissão |
| Wikidata | 3 | 4 | baixo | Script de geração opcional: Q-ID, país e coordenada de pistas reais |
| OSM | 3 | 2 | médio (ODbL) | Só para um futuro mapa de contexto de pista real, em tempo de execução, com atribuição |
| GTPlanet, racinggames.gg, Fandom, gtsh-rank | 3 a 4 | 0 a 1 | médio-alto | **Só linkar** |

Pode embarcar (MIT-0, MIT, CC0, CC-BY): gt7info (MIT-0), gt-telemetry (MIT), gt7-datalogger-track-data (CC0 + MIT), Wikidata (CC0).
Só linkar (direitos reservados ou cláusula copyleft): site oficial gran-turismo.com, DG EDGE, GTPlanet, racinggames.gg, gtsh-rank, Fandom (CC BY-SA exigiria atribuição e compartilhamento igual, melhor não misturar), `snipem/gt7dashboard` (GPL-3.0, não copiar código).

---

## 5. Problemas encontrados e estratégia de casamento por comprimento

### 5.1 Problemas

1. **SUGO e Autumn Ring.** SUGO (ID real 1340 pelo DG EDGE, oficial `4bf61b`, 3586 m, 13 curvas) entrou na 1.72 (15/10/2026) e não está no gt7info. Autumn Ring (layout original e ampliado) chega com a Parte 2 em dezembro (https://www.thedrive.com/news/gt7-revives-autumn-ring-adds-12-new-cars-in-huge-spec-iv-update). O gt-telemetry já tem SUGO (atualização de 15/10), o gt7info não. **Plano:** atualizar a tabela do app a cada patch do jogo com um script que compare o `index.json` do gt7-datalogger com a Tracks List oficial.
2. **IDs fictícios** no `course.csv` para Eiger, Yas Marina e GV (2001 a 2004). Não usar o ID numérico como chave estável das pistas novas; usar chave própria do app (slug) e guardar os IDs externos como campos auxiliares.
3. **Tabela atual do app** (`packages/web/src/data/gt7Tracks.ts`): 77 entradas sem ID, vários layouts sem `lengthM` ("Monza sem chicane", entre outros) e nenhuma entrada de SUGO com comprimento. O `course.csv` dá comprimento e curvas para os 122 layouts.
4. **Reverso tem o mesmo comprimento** do normal em todas as pistas. Um mesmo local também tem layouts com comprimento quase igual, que o casamento só por comprimento não separa:
   - Tokyo Central CW 4405 m x CCW 4369 m (diferença 0,8 %)
   - Monza completo 5793 m x sem chicane 5755 m (0,7 %)
   - Nordschleife 20832 m x Tourist 20832 m (idênticos; só o `PitLaneDelta` difere)
   - Fuji 4563 m x Short 4526 m (0,8 %)
5. **Pistas "reais" com nome diferente** entre fontes (gt7info "Watkins Glen Long Course"; DG EDGE "Watkins Glen International, Long Course"; oficial "Watkins Glen International Long Course"). Normalizar com remoção de acentos, pontuação e de palavras como `International`, `Circuit`, `Raceway`.
6. **Capturas truncadas** nos repositórios: o gt7-datalogger registra `dropped_captures` com `closes_at_m` (ex.: Nordschleife Tourist fecha a 2155 m do começo; Fuji Short, Suzuka East, Autopolis Short, Nürburgring Sprint, Red Bull Ring Short têm gaps de 240 a 307 m). Não usar `length` do gt-telemetry nesses casos como comprimento oficial.
7. **Fandom e GTPlanet** bloqueiam leitura automatizada (402 e Cloudflare); sem alternativa aberta de calendário.

### 5.2 Medição: comprimento medido x oficial

Cálculo feito aqui com `signatures.json` (comprimento medido por captura/levantamento) contra `index.json` (comprimento oficial), 81 layouts:

| Estatística | Razão medido/oficial |
|---|---|
| Mínimo | 0,875 (Spa 24h, captura incompleta) |
| p10 | 0,972 |
| **Mediana** | **0,9905** |
| p90 | 1,0003 |
| Máximo | 1,156 (Lago Maggiore Centre; outlier de levantamento) |
| Só levantamentos (30) / só capturas (51) | mediana 0,9908 / 0,9902 |

Exemplos: Trial Mountain 5332/5434 = 0,981 (o app mede 5361, ou 0,987), Laguna Seca 0,988, Suzuka 0,989, Spa 0,991, Mount Panorama 0,992, Monza 0,994, Suzuka East 1,000, Tsukuba 1,012.
Leitura: o comprimento oficial costuma ser ~1 % maior que a linha dirigida (a oficial mede pelo eixo da pista; a volta real corta as curvas). Variação de -1 % a -2 % é normal; -3 % ou pior é raro (10 % dos casos, quase todos layouts curtos ou capturas incompletas).

### 5.3 Estratégia sugerida

1. **Janela assimétrica:** candidatos com `-4 % <= (medido - oficial)/oficial <= +1,5 %`. A janela atual do app (`±1,5 %`, `LENGTH_TOLERANCE`) deixaria de fora a captura de referência do gt-telemetry em Trial Mountain (-1,9 %) e 22 dos 81 layouts da amostra (27 %) por ficarem abaixo de -1,5 %. A janela -4 %/+1,5 % cobre 74 dos 81 (91 %); os 7 restantes são capturas incompletas ou outliers de levantamento (Spa 24h, Willow Streets, Lago Maggiore East End e Centre, Barcelona National, Northern Isle, BB Raceway).
2. **Ordenar candidatos pelo desvio em relação a -1 %** (o esperado), não a 0 %.
3. **Desempatar com a linha de largada:** distância do primeiro cruzamento da linha de chegada até `startLine` do gt-telemetry (tolerância sugerida 25 a 40 m, a grade deles é de 16 m).
4. **Desempatar o sentido** comparando os primeiros 200 a 400 m de volta com `path` do `signatures.json` em ordem de percurso (como faz o gt7-datalogger). Isso separa Deep Forest de Deep Forest Reverse.
5. **Nunca nomear sozinho:** manter a regra atual do app (o usuário confirma com um clique). Mostrar também `NumCorners` do candidato vs. curvas detectadas como sinal extra.
6. **Só usar o comprimento do app como atributo secundário** e **gravar o comprimento medido** por pista na primeira volta limpa, para recalibrar a tolerância local.
7. **Plano para pistas novas ainda sem dados** (Autumn Ring, dezembro): cair no modo "Pista desconhecida" já existente e mostrar o candidato por nome digitado (`resolveTyped`).

---

## 6. Recomendação priorizada

1. **(Imediato, esforço baixo) Substituir/estender `gt7Tracks.ts` pelo `course.csv` do gt7info** via script de geração (MIT-0). Ganha: 122 layouts, comprimento, nº de curvas, desnível, país, categoria, reverso, `IsOval`, `PitLaneDelta`. Adicionar manualmente SUGO (3586 m, 13 curvas, ID 1340 do DG EDGE) até o gt7info atualizar. Colocar um aviso em `THIRD_PARTY_NOTICES`.
2. **(Imediato) Ajustar a tolerância do casamento por comprimento** para a janela assimétrica da seção 5.3 e adicionar teste com os 81 casos medidos desta pesquisa.
3. **(Curto prazo) Importar `startLine` e `length` do gt-telemetry** e as assinaturas do gt7-datalogger (MIT/CC0) para casar por posição e sentido, reduzindo a ambiguidade de layouts parecidos (Tokyo CW/CCW, Monza, Nordschleife/Tourist). Validar antes que o x/z do app é o mesmo sistema de coordenadas desses arquivos.
4. **(Curto prazo) Corridas Diárias como "evento marcado na sessão"**: um campo/etiqueta "Corrida Diária A/B/C, Semana N" preenchido a partir da sessão ou à mão (seção 3.3, opções 1 e 2), com link para https://www.dg-edge.com/events/dailies. Sem scraping.
5. **(Médio prazo) Gabarito de apex** das 162 curvas do gt7-datalogger (CC0) como verificação da detecção de curvas do app em 14 pistas.
6. **(Opcional) Escrever a digit@dg-edge.com** pedindo autorização para uma leitura semanal por usuário com cache. Se aprovado, implementar chamada em tempo de execução com cache de 7 dias lendo o sitemap `events.xml`.
7. **(Não fazer)** copiar texto do site oficial, DG EDGE, GTPlanet ou Fandom para dentro do repositório; copiar código do `gt7dashboard` (GPL-3.0).

---

## 7. Lacunas confirmadas e itens não verificados

- **Confirmado que não existe:** API/JSON/RSS oficial ou aberta de Corridas Diárias; nomes de curva em formato aberto para as pistas originais; tabela de correspondência lat/lon do OSM ↔ x/z do jogo.
- **Não verificado:** licença exata dos dados do Fandom; termos do gtsh-rank (`/terms/`); se GTPlanet/Fandom têm lista de curvas de Trial Mountain; suporte de Garage61 e Kudos Prime ao GT7; consulta ao Overpass (o servidor público respondeu 502 por excesso de carga, então não foram feitas consultas de OSM nesta sessão); confirmação de que o sistema de coordenadas do app é idêntico ao dos arquivos do gt-telemetry e do gt7-datalogger.
- **Risco de dependência única:** o `course.csv` depende de um mantenedor (o autor já avisou que o calendário foi abandonado). Mitigar com a cópia versionada no repositório.

## 8. Links principais

- gt7info: https://github.com/ddm999/gt7info (licença MIT-0), notas do JSON: https://ddm999.github.io/gt7info/json-dev-notes
- gt-telemetry: https://github.com/zetetos/gt-telemetry (MIT)
- gt7-datalogger-track-data: https://github.com/jbhoorasingh/gt7-datalogger-track-data (CC0 + MIT); app: https://github.com/jbhoorasingh/gt7-datalogger
- Site oficial, Tracks List: https://www.gran-turismo.com/gb/gt7/tracklist/
- DG EDGE: https://www.dg-edge.com/events/dailies , https://www.dg-edge.com/database/tracks/trial-mountain-circuit/313 , termos https://www.dg-edge.com/p/terms-and-conditions
- Notícias da 1.72 e Spec IV: https://www.gtplanet.net/?p=146615 , https://www.thedrive.com/news/gt7-revives-autumn-ring-adds-12-new-cars-in-huge-spec-iv-update
- OSM raceway: https://wiki.openstreetmap.org/wiki/Tag:highway=raceway ; Wikidata Suzuka: https://www.wikidata.org/wiki/Q174170
