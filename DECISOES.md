# Registro de decisões

## Onda 1 — Fundação (scaffold, contratos, protocolo, simulador)

### Monorepo e ferramentas

- **npm workspaces** (`packages/*`), sem pnpm. Todas as dependências de todos os pacotes já foram
  instaladas nesta onda, para que os agentes das próximas ondas não rodem `npm install` em paralelo.
- **Sem build para os pacotes Node.** Cada pacote exporta o código TS direto
  (`"exports": { ".": "./src/index.ts" }`). O Node roda via `tsx`, e o Vite consome os fontes do workspace
  no `web`.
- **TypeScript 7.0.2** (a versão "native", a mais recente no npm). `module: ESNext` + `moduleResolution: Bundler`,
  que funciona para tsx e Vite. Os imports relativos usam a extensão `.ts` (`allowImportingTsExtensions`
  com `noEmit`). Também ativamos `strict`, `noUncheckedIndexedAccess` e `verbatimModuleSyntax`
  (`import type` obrigatório).
- **Typecheck por pacote**: `npm run typecheck` roda `tsc --noEmit -p` em cada workspace. Usamos isso no lugar
  de `tsc -b`, porque `-b` exige `composite`/emit.
- O `@gt7/shared` é **isomórfico**: `lib: ES2023` e `types: []`, sem APIs do Node nem do DOM. Assim ele roda
  tanto no servidor quanto no navegador.
- O `web` usa `lib DOM` e `types: ["vite/client"]`. Os outros pacotes usam `types: ["node"]`.
- **Biome 2.6** cuida do lint e do formato (2 espaços, aspas simples, ponto e vírgula, largura 100).
  O Markdown (`**/*.md`) fica **fora** do Biome: o Biome 2.6 também formata `.md` e reescreveria
  tabelas e ênfases dos documentos de planejamento.
  **Vitest 5** roda na raiz com `packages/*/src/**/*.test.ts` e `pool: forks`.
- **@types/node fixado em 24**, para acompanhar o runtime Node 24.14, e não na 26 (a mais recente).
- **Versões principais instaladas:** fastify 5, @fastify/websocket 11, @fastify/static 10, qrcode 1.5,
  @anthropic-ai/sdk 1.6, @modelcontextprotocol/sdk 1.32, zod 4, @resvg/resvg-js 2.6 (o binário pré-compilado
  para win32-x64 funcionou: SVG→PNG testado), react 19, vite 8, @vitejs/plugin-react 6, vite-plugin-pwa 2,
  zustand 5, uplot 1.6.
- O `npm audit` aponta 6 vulnerabilidades baixas/moderadas, em `glob`/`minimatch` dentro de `workbox-build`
  (dependência de build do vite-plugin-pwa). Afetam só o build, não o runtime. A correção sugerida faria
  downgrade do plugin, então **não aplicamos**.
- **`node:sqlite`** funciona no Node 24.14 (SQLite 3.51.2), mas imprime
  `ExperimentalWarning: SQLite is an experimental feature`. Para suprimir, use
  `node --disable-warning=ExperimentalWarning` (ou `NODE_OPTIONS`) nos scripts do core/servidor.
- **Não há `qrcode` no web.** O QR será gerado no servidor (SVG), o que evita uma dependência no
  cliente.

### Contratos (`@gt7/shared`)

- Os contratos ficam em arquivos com dono definido, para permitir trabalho paralelo:
  - `telemetry.ts` (protocolo);
  - `live.ts` e `domain.ts` (core);
  - `analysis.ts` (análise);
  - `ws.ts` (servidor);
  - `ui.ts` (web).
- **Unidades:**
  - `TelemetryPacket` fica fiel ao pacote: m/s, pedais 0–255, ms.
  - `LiveFrame` e `LapSample` já vêm convertidos: km/h, pedais 0–1, G em g.
  - Valores indisponíveis no formato atual são `null` no `LiveFrame` e `NaN` nos traces colunares.
- **Sinal do delta:** positivo = mais lento (perdendo tempo) em todo o app (delta ao vivo, `timeDeltaS`,
  `timeLostMs`, `totalDeltaMs`).
- **Convenções de eixo/sinal** (lateral + = esquerda; volante + = esquerda no sintético): o sinal real do
  GT7 ainda não foi verificado e está documentado no TSDoc.
- **Campos estendidos** (B/~/C) são opcionais e planos no `TelemetryPacket`, presentes só quando o formato
  os contém. A marcha sugerida é guardada crua (15 = nenhuma). Os helpers `suggestedGearOf`/`decodeGearByte`
  devolvem `null`.
- **Marcha 0** é tratada como neutro/ré (a codificação não é documentada; validar no console).
- **Estado do ingestor** (`IngestorState`: `stopped | connecting | connected | timeout | switchingFormat`) é
  diferente do estado de alto nível do app (`ConnectionState`, que inclui `menu`, `onTrack`, `paused` e
  `replay`), calculado pelo core.
- **Protocolo WS:** JSON com união discriminada em `type`, `WS_PROTOCOL_VERSION = 1`, endpoint `/ws`
  e porta padrão 8770. Além das mensagens pedidas, entraram:
  - `welcome`, `showView` (controle remoto chegando no dispositivo alvo) e `pong`, do servidor para o cliente;
  - `currentView` e `ping`, do cliente para o servidor.
- **Traces:** `LapTrace` é colunar, um array por canal (`LapSample` é o tipo canônico da linha).
  `ResampledTrace` usa uma grade regular de distância.

### Protocolo (`@gt7/protocol`)

- **Salsa20** com `@noble/ciphers` (`salsa20` de `@noble/ciphers/salsa.js`).
- **Bytes 0x40..0x43:** o `encryptPacket` grava a semente em claro no ciphertext. Isso equivale a pôr
  `semente ^ keystream` no plaintext. Resultado:
  - `decrypt(encrypt(p))` é igual a `p` fora de 0x40..0x43 (onde fica "lixo", como no GT7 real);
  - `encrypt(decrypt(c), seed(c))` reproduz `c` byte a byte.
  Por isso as gravações guardam o pacote **decifrado** e podem ser recifradas de forma fiel.
- **Fallback de XOR:** se o magic não valida com o XOR esperado para o tamanho, o `decryptPacket` tenta os
  outros XORs conhecidos e marca `xorMismatch`. Isso protege contra o XOR do pacote C, que não está
  verificado. O ingestor emite um `warning` uma vez.
- **Ingestor:**
  - um único socket UDP (bind 33740);
  - heartbeat por timer próprio (1 s);
  - watchdog de timeout (3 s);
  - perda por lacunas de `packetId`: lacuna > 600 conta como reset, não como perda; 30 IDs retroativos
    seguidos também viram reset;
  - estatísticas a cada 1 s;
  - nunca lança exceção com pacote inválido.
- **Troca de formato:** pausa os heartbeats por um cooldown (padrão 15 s) e depois envia o novo formato.
- **Descoberta por broadcast:** opcional (`discovery: true`), envia para o broadcast de cada interface IPv4.
- **Gravação `.gt7rec`:** stream gzip com cabeçalho + registros `[u32 tMs][u16 len][bytes]`.
  - O writer faz `Z_SYNC_FLUSH` a cada 1 s.
  - O reader usa `finishFlush: Z_SYNC_FLUSH` e tolera arquivo truncado. Testado matando o processo no
    meio da gravação.
  - Interpretamos "append safe" como "seguro contra crash". Não há reabertura de arquivo para
    continuar gravando.
- **FakeConsole:**
  - trava o formato do primeiro heartbeat e só troca depois de `formatLockMs` (padrão 10 s) sem heartbeat.
    Esse valor fica abaixo do cooldown de 15 s do ingestor, para a troca funcionar com os padrões;
  - para de transmitir após 20 s sem heartbeat;
  - transmite a 60 Hz com compensação de atraso (sem rajadas maiores que 0,5 s);
  - uma gravação em formato maior é **truncada** para o formato pedido (os formatos são aditivos);
  - no loop da gravação, os `packetId` continuam crescendo.

### Gerador sintético

- **Pista "Synthetic Ring"** (4371 m): retas + arcos de raio constante, com fechamento exato resolvendo o
  comprimento de duas retas não paralelas. São 10 curvas (hairpin, média, rápida, chicane dupla, kink,
  lenta etc.), com entrada/ápice/saída conhecidos (gabarito para validar a detecção de curvas). A
  elevação é uma soma de senoides (±13 m).
- **Convenção de heading:** θ = 0 aponta para +Z ("norte"). Direção = (sin θ, cos θ). Curvatura positiva =
  curva à esquerda. A rotação vai para o quaternion (0, sin θ/2, 0) com w = cos θ/2.
- **Modelo do carro:**
  - tipo GR3: 440 kW, 1300 kg, 7 marchas, máxima ~265 km/h na pista;
  - aderência lateral de 1,6 g, com perfil de velocidade limitado pela curvatura;
  - passadas para frente e para trás com círculo de atrito;
  - drag calibrado pela velocidade máxima.
- **Pilotos** (determinísticos pela seed):
  - `pro`: trail braking via círculo de atrito, sem coasting, voltas com variação de ~±0,03 s;
  - `amateur`: 95% da aderência, frenagem a 1,3 g, solta o freio antes de virar, coasting de 4–14 m,
    retomada atrasada, desvio de traçado, correções de volante, TCS, erro em 25% das voltas;
  - resultado: amador 4–6% mais lento que o pro (~91 s × ~95 s).
- **Modo `replay`:** suaviza pedais e volante (~0,25 s) e não consome combustível.
- **Estados de menu/carregamento** no início da sessão: `Paused` e depois `LoadingOrProcessing`, com o carro
  fora da pista. Em seguida vem uma volta de saída de 600 m.

### Pendências / incertezas

- Unidades de sway/heave/surge (pacote B): o sintético emite em g.
- Sinal do volante e da rotação das rodas no jogo real: o sintético usa valores positivos (+ = esquerda);
  consumidores devem usar `Math.abs` na rotação das rodas.
- Validar no console:
  - cadência real do heartbeat;
  - XOR e layout do pacote C;
  - tempo de trava de formato;
  - codificação de ré/neutro.

## Onda 2 — análise (`@gt7/analysis`)

- **Pacote puro e isomórfico:** só TypeScript, sem APIs do Node/DOM, depende só de `@gt7/shared`.
  Roda no servidor, no MCP e no navegador. Os testes importam o gerador sintético de `@gt7/protocol`
  (não declarado no `package.json` para não dessincronizar o lockfile; resolve pelo symlink do workspace).
- **Linha de referência:** construída com as posições x/z de uma volta limpa. Reamostrada por
  comprimento de arco (passo 1 m), suavizada (média móvel de 6 m, 2 passadas), laço fechado, curvatura
  com sinal (+ = esquerda) suavizada em 10 m. O `s = 0` é a primeira amostra da volta (logo após a
  linha de chegada).
- **Projeção:** busca em janela (−30/+80 m) a partir do segmento anterior, com busca global quando o
  ponto está longe (> 25 m) ou na borda da janela. A distância é "desembrulhada" na linha de chegada: a
  volta pode começar levemente negativa e terminar acima de L. Desvio lateral + = esquerda.
- **`PreparedLap`:** toda análise consome a volta já projetada. A tabela tempo × distância é ancorada
  em t(0) = 0 (extrapolando pela velocidade) e, quando o tempo oficial é informado, escalada para que
  t(L) = tempo oficial. Assim o delta final é exatamente a diferença de tempos de volta.
- **Delta por distância:** sujeito − referência (+ = mais lento), em grade de 2 m, com a derivada em
  s/100 m (onde se perde tempo).
- **Detecção de curvas:** trechos com |κ| ≥ 1/400 m⁻¹, estendidos até 50% do pico (cai na fronteira
  real de um arco), descartando giros < 12° (exceto com mínimo de velocidade marcado). A curvatura
  geométrica é misturada com a "dinâmica" (yawRate / velocidade) da volta de referência; o sinal do yaw
  é alinhado automaticamente por correlação (o sinal real do GT7 não foi verificado).
  - Mesma direção com intervalo < 15 m → **uma** curva (duplo ápice).
  - **Chicane = duas curvas separadas** (cada uma com frenagem/ápice/saída), ambas `kind: 'chicane'`.
  - Ápice = centróide da |κ| (ápice geométrico). O ápice medido por volta (local da V-mín) fica em
    `CornerMetrics.apexM`.
  - Tipos: hairpin (≥ 130° e raio < 40 m), kink (< 40° e raio > 150 m), senão pela V-mín:
    slow < 90, medium < 140, fast.
  - Curva cruzando a linha de chegada recebe `entryM` negativo.
  - Resultado no sintético: as 10 curvas com o tipo certo, erro de ápice máx. 1,5 m (média 1,2 m);
    entrada/saída até ~14 m mais abertas (a mistura com o yaw suavizado alarga as bordas).
- **Métricas por curva** calculadas nas amostras cruas (60 Hz) com distância alinhada, não na grade.
  - Frenagem = último episódio de freio (lacunas < 0,4 s unidas) antes da V-mín, depois do ápice da
    curva anterior.
  - Trail braking = freio aplicado com o volante (ou o yaw, sem volante) ≥ 25% do pico da curva.
  - Retomada = início do trecho de acelerador ≥ 10% que segue a V-mín.
  - Roda livre = os dois pedais < 2% (novo `COAST_PEDAL_THRESHOLD`; acelerador de manutenção não conta).
  - Correções de volante = inversões em zigue-zague com histerese de 0,15 rad, menos a inversão
    natural de uma curva limpa.
  - Entrada = velocidade no `entryM`.
- **Zonas de tempo por curva:** [mín(pontos de frenagem) − 10 m, saída + 50 m]. Zonas que se sobrepõem
  (chicane) são cortadas no meio do intervalo. Elas particionam a volta: Σ curvas + retas = delta total.
- **Diagnósticos (pt-BR):** regras com limiares (frenagem 5 m, V-mín 2 km/h, acelerador 8 m, saída
  3 km/h, traçado 1,2 m etc.), cada um com mensagem numérica e **uma** ação.
  - Custo estimado = perda de cada fase (frenagem, meio, saída, reta seguinte) repartida entre os
    diagnósticos daquela fase pela severidade.
  - `keyFindings` = o diagnóstico mais caro de cada curva, ordenado por custo.
  - Confiança: severidade. Contra referência de **replay**, os diagnósticos de forma de pedal/volante
    perdem um nível, e os de distância < 10 m também. Um aviso sobre a precisão de alguns metros é
    adicionado.
- **Consistência:** estatística de todas as métricas por curva, com o `timeDeltaS` medido contra a
  volta mais rápida do conjunto. Os destaques são ordenados por desvio-padrão normalizado (ex.: 5 m na
  frenagem, 3 km/h na V-mín) e trazem frase pronta.
- **Microssetores:** 25 por padrão, mais setores (portais da pista ou 3 iguais). A volta teórica é a
  soma dos melhores microssetores (e dos melhores setores). As cores de mapa usam os tons
  best/gain/neutral/loss (±10 ms neutro).
- **Validade:** fora da pista = |desvio| > 12 m por ≥ 0,3 s. A linha de referência é um traçado de
  corrida, não o centro da pista, então o limite cobre a largura toda. Também detecta lacuna > 0,25 s,
  salto/recuo de distância, cobertura incompleta e tempo oficial × medido.
- **Resumos para IA:** JSON compacto, com unidades nas chaves (`brakePoint_m`, `vmin_kmh`) e pares
  `[você, referência]`. A comparação do sintético tem ~3,3 KB (< 4 KB). Também há relatório Markdown
  pt-BR e séries de gráfico reduzidas (≤ 400 pontos, pedais em %) para o MCP desenhar.
- **`shared/analysis.ts` (aditivo):**
  - novas constantes: `COAST_PEDAL_THRESHOLD`, `FULL_THROTTLE_THRESHOLD`, `FRONT_LOCK_SLIP_THRESHOLD`,
    `DEFAULT_RESAMPLE_STEP_M`, `DEFAULT_MICROSECTOR_COUNT`;
  - campos opcionais em `CornerFinding` (`cornerId`, `message`, `action`, `confidence`, valores) e o
    tipo `softBraking`;
  - `zone` e `phaseLoss` na linha da comparação;
  - `findings`, `keyFindings`, `sectorDeltasMs` e `referenceIsReplay` em `LapComparison`;
  - `range` e `message` nos destaques de consistência;
  - novos tipos: `DistanceDelta`, `MicrosectorReport`, `MicrosectorColor` e `LapValidityReport`.
- **Limitações conhecidas:**
  - Frenagem de uma curva que começa antes da linha de chegada (dados da volta anterior) não é vista.
  - O ápice medido em arcos de raio constante é instável (V-mín plana). Por isso só curvas curtas
    (≤ 80 m) geram diagnóstico de ápice.
  - A suavização do replay atrasa o fim da frenagem e a retomada do acelerador em alguns metros.

## Onda 2 — core (`@gt7/core`)

### Motor ao vivo (`LiveEngine`)

- **Sem IO e determinístico:** tudo entra por `push(packet, receivedAtMs)`. Persistência e busca de pista
  passam por uma interface **síncrona** `LiveEngineContext` (o `node:sqlite` é síncrono). Há duas
  implementações: `MemoryEngineContext` (testes) e `StoreEngineContext` (SQLite).
- **Estado:** `menu` (sem `carOnTrack` ou carregando), `paused`, `onTrack`, `replay` (modo captura). O
  estado do ingestor (`stopped/timeout` → `disconnected`, `connecting`, `switchingFormat`) tem prioridade.
- **Sessão:** começa no primeiro pacote "dirigindo". Termina com troca de `carCode`, 60 s fora da pista
  ou sem pacotes, troca do modo replay, ou `endSession()`. Ao terminar, a pista ativa é esquecida (a
  próxima sessão é identificada de novo).
- **Voltas:** `lapCount` +1 fecha a volta. Diminuir ou pular `lapCount` = reinício → a volta é
  descartada (`lapDiscarded`). A volta 0 (saída) e a volta em que entramos no meio **não** são emitidas
  nem gravadas. Sair da pista no meio da volta descarta a volta.
- **Cronometragem:** conta pacotes pelo delta de `packetId` (pacote perdido conta tempo; pacote pausado
  não). Ao fechar, espera até 60 pacotes pelo `lastLapMs` novo do jogo; se vier, ele é o tempo final e os
  `tMs` do trace são reescalados. Senão, usa a contagem. No formato C usa `currentLapMs` direto.
  A calibração do período do pacote é **cumulativa** (soma dos tempos do jogo / soma de pacotes) e só sai
  de 16,667 ms se o desvio sistemático passar de 0,1% — a calibração volta a volta com ganho piorava o
  erro por causa da quantização de ±1 quadro.
- **Validade:** inválida com `paused`, `incompleteData` (lacuna única > 15 pacotes ou perda > 2%),
  `discontinuity` (teletransporte > 20 m num quadro, salto de distância, troca de carro) ou `offTrack` (4
  rodas fora de T/C por ≥ 30 pacotes, só formato C). `timeMismatch` (contagem × jogo > max(200 ms, 0,3%))
  e `replay` só marcam, não invalidam. Uma pausa sem a flag (recepção parada > 1 s com poucos
  `packetId`) também marca `paused`.
- **Distância:** integra a velocidade e projeta a posição na **linha central da pista** (busca do ponto
  mais próximo numa janela −30/+60 m; busca global para readquirir; descarta projeções > 25 m da linha).
  Ao fechar a volta, o canal `distanceM` do trace é **realinhado** inteiro à linha central (`alignToLine`).
  Assim todas as voltas de uma pista ficam na mesma escala de distância, e o delta não deriva.
- **Delta:** tempo atual − tempo da referência na mesma distância. A taxa é derivada suavizada (τ 0,5 s).
  Prevista = tempo da referência + delta. Referências: `personalBest` (melhor volta própria válida, sem
  replay, da pista+carro, de qualquer sessão), `sessionBest`, `reference` (lapId ou, sem id, a melhor
  referência da pista, preferindo o mesmo carro). Escolher uma referência de uma pista conhecida já
  define a pista como "provável" (delta e setores desde a primeira volta).
- **Setores:** portais da pista (`Track.sectorGates`). Pistas novas nascem com 3 portais de mesmo
  comprimento **gravados explicitamente**. Sem pista conhecida não há setores ao vivo; ao fechar a volta os
  setores são calculados a partir do trace (a última fecha no tempo final, então a soma é exata).
  Status: `overallBest` (≤ melhor de sempre na pista+carro, **incluindo referências/replay**) >
  `personalBest` (voltas próprias) > `sessionBest` > `slower`. Recordes só contam voltas válidas.
- **Derivados:** combustível por volta = média das últimas 3 voltas válidas sem replay; `neededToFinish` =
  voltas restantes × média (total, não o que falta abastecer). Forças G: `sway/surge/heave` quando existem
  (B+), senão derivada da velocidade no referencial do carro (EMA τ 80 ms); o vertical é calculado também
  no formato A. Dica da próxima curva via `CornerHintProvider` plugável; o padrão
  (`TraceCornerHintProvider`) tira ponto de frenagem/V-mín/marcha do trace da referência.
- **Frames:** limitados a 30 Hz pelo `receivedAt` (e sempre que o estado muda); `snapshot()` gera um frame
  sob demanda (para `get_live_state`).

### Identificação de pista

- Impressão digital: largada (posição do 1º pacote da volta) + direção, comprimento 2D (X/Z) da volta
  fechada, bbox e assinatura de forma v1 (direção acumulada em 64 pontos equidistantes). Tolerâncias:
  30 m, 0,5 rad, 3% e RMS 0,3 rad. Na troca de volta tenta um casamento "provável" só pela largada.
- Sem casamento → cria "Pista desconhecida N" e grava a linha central (volta reamostrada a cada 2 m, com
  y) na tabela `track_centerlines` (BLOB float64), não em arquivo (`Track.centerline.file = null`).

### Armazenamento (`Gt7Store`)

- `data/sessions.db` (WAL, foreign keys), migrações por `PRAGMA user_version` dentro de transação.
  `Session.lapCount/bestLapMs` são derivados da tabela `laps` (não gravados).
- Traces em `data/traces/<lapId>.bin.gz`: cabeçalho versionado `GT7T` v1 + canais nomeados (f64 para
  `tMs`, `distanceM`, `packetId`; f32 no resto). Canal ausente carrega como NaN; canal desconhecido é
  ignorado. A gravação é assíncrona (fila); o trace fica legível da memória até ser escrito
  (`flush()` espera).
- Gravação crua da sessão (`RecordingWriter`) em `data/recordings/<sessionId>.gt7rec`, ligada por padrão;
  pacotes recebidos enquanto o arquivo abre ficam em buffer.
- Tipo novo em `shared/domain.ts`: `TrackCenterline`. Campos opcionais novos em `shared/live.ts`:
  `LiveLapTiming.referenceLapMs`, `LiveLapTiming.currentLapValid`, `LapCompletedEvent.trackId`.

### Captura de referência e runtime

- `ReferenceCapture`: a próxima volta completa em modo replay é validada (pausa, descontinuidade,
  lacuna > 6 pacotes ou perda > 0,5%, comprimento ±2% da pista, tempo ±300 ms do ranking, carro
  esperado). Válida → `isReference` + `ReferenceMeta` e volta ao modo ao vivo. Inválida → fica como volta
  de replay comum e a captura continua na volta seguinte. Voltas de replay nunca viram recorde pessoal.
- `Gt7Runtime`: formato ao vivo padrão `~`. **Fallback:** se nenhum pacote chegar em 10 s após `start()`
  pedindo `~`, troca **uma vez** para `B` (aviso `formatFallback`, não persistido). Limitação: se o console
  estiver desligado, o app fica em `B` até o próximo `start()` ou `setPacketFormat`. Captura usa `B` e
  restaura o formato ao vivo no fim.
- Configurações persistidas (`settings`): `consoleIp`, `liveFormat`, `captureFormat`, `recordSessions`,
  `deltaReference`. Sem IP salvo, o ingestor usa descoberta por broadcast e grava o IP encontrado.
- `ServerStatus.lanUrls/devices` vêm do servidor via `statusExtras`.
- `npm run live` usa `node --disable-warning=ExperimentalWarning --import tsx`.

### Pendências / incertezas

- Não sabemos se o `lastLapMs` real atualiza no mesmo pacote da troca de `lapCount`, nem como `lapCount`
  e `lastLapMs` se comportam em replays (a espera de 60 pacotes e o fallback para a contagem cobrem isso).
- Mudar os portais de setor deixa os tempos de setor antigos inconsistentes (não recalculamos).
- Brake point do `TraceCornerHintProvider` não procura antes da linha de chegada (curvas logo após a
  largada).

## Onda 2 — web (`@gt7/web`)

### Arquitetura

- **Telemetria fora do React.** `live/liveStore.ts` guarda o último `LiveFrame` num objeto mutável
  (com `version`) e um histórico rolante sem alocação (`RollingHistory`, "anel duplo" de ~20 s para o
  gráfico). Um único loop `requestAnimationFrame` (`live/raf.ts`) chama os renderizadores registrados com
  `useLiveRender`, que escrevem direto no DOM (`setText`/`setAttr`/`setStyle` só gravam se mudou) ou no
  uPlot. Só mudanças raras (estado da conexão, formato do pacote) vão para o zustand.
- **zustand** (`state/uiStore.ts`) guarda perfil, tela atual, status do WS/servidor, cartão de volta,
  avisos e o modo de tela ligada. Ações em `state/actions.ts`; envio de mensagens via `net/transport.ts`
  (WS ou mock).
- **WS** (`net/wsClient.ts`): `ws(s)://<host>/ws`, `hello` com `deviceId` persistente (localStorage com
  try/catch; fallback em memória; `getRandomValues`, porque `randomUUID` não existe em http na LAN),
  backoff 0,5 s → 10 s com ±20%, `ping` a cada 5 s, socket considerado morto após 15 s sem mensagens.
  Mensagens usadas: recebe `welcome`, `frame`, `lapCompleted`, `sessionChanged`, `status`,
  `deviceProfile`, `showView`, `notice`, `pong`; envia `hello`, `ping`, `currentView`,
  `setDeviceProfile`, `setDeltaReference`.
- **Perfil:** salvo sempre no localStorage e enviado ao servidor; ao receber `deviceProfile`, vence o de
  `updatedAt` maior (se o local for mais novo, ele é reenviado). `DeviceProfile.views` = telas ligadas em
  ordem; as desligadas aparecem depois, na ordem do catálogo.

### Modo demonstração (mock)

- `?mock=1` liga só o mock. Sem o parâmetro, o app tenta o servidor; **em dev** (Vite), após 2 falhas
  sem nunca ter conectado, o mock liga sozinho (selo "Demonstração (sem servidor)") e sai quando o
  servidor aparece. Em produção mostra "Sem conexão com o servidor" com botão "Ver demonstração".
- `live/mock.ts` é puro e determinístico por seed: circuito de ~3,9 km (retas + arcos), perfil de
  velocidade por passadas para frente/para trás (potência, arrasto, frenagem 13 m/s², 1,6 g lateral),
  variação de aderência por setor a cada volta e 15% de voltas com erro (inválidas). Gera delta real
  (tempo por metro contra melhor pessoal / melhor da sessão / "top" 2,5% mais rápido), setores com
  roxo/verde/amarelo, temperaturas por carga, patinagem/travamento, TCS/ASM, zebra (pacote C),
  combustível e `LapCompletedEvent`. `?mockSpeed=N` acelera o tempo (testes).

### Navegação e gestos

- Carrossel com **3 slots montados** (anterior, atual, próxima) num scroller CSS scroll-snap; ao assentar
  num vizinho, a tela atual muda e o scroll é recentralizado antes do paint, o que dá o efeito circular.
  Só a tela visível desenha a cada frame; as vizinhas atualizam a 2 Hz (para não aparecerem velhas ao
  deslizar).
- Reconhecedor de gestos puro (`lib/gestures.ts`, testado): toque (emitido só após a janela de 280 ms do
  toque duplo), toque duplo, pressão longa (600 ms); movimento > 12 px ou `pointercancel` (o navegador
  assumiu o scroll) cancela. Toque = cabeçalho por 3 s; toque duplo = próxima referência do delta;
  pressão longa = seletor de telas. Teclado no PC: ←/→, Enter, D, espaço, L (cadeado), Esc.
- **Cadeado:** toque trava (sem deslizar, toque, toque duplo nem seletor); destrava só segurando o
  cadeado 600 ms. O estado fica no perfil.
- `showView` (controle remoto) só troca se a tela estiver ligada no dispositivo; senão mostra aviso.
  Nenhuma troca automática de tela; o cartão de volta (5 s) é uma sobreposição.
- **Referência do delta:** o contrato WS ainda não informa se existe volta "top" capturada para a pista,
  então o ciclo do toque duplo sempre passa pelas 3; sem referência a tela mostra "sem referência".

### Visual e PWA

- Fundo preto puro (OLED), âmbar de "placa de box" como única cor de interface; verde/vermelho/roxo/
  amarelo reservados para delta, setores, pneus e shift lights. Fonte do sistema estilo DIN
  (Bahnschrift → DIN Alternate → Roboto Condensed), números tabulares, sem fontes externas (funciona
  offline na LAN). Layouts por `@container (orientation)`, tamanhos em `cqw/cqh`.
- Escala de temperatura dos pneus em `src/config.ts` (50 frio / 70–95 ideal / 115 quente), assim como
  limites de patinagem, faixa da suspensão, escala da barra de delta e tempos dos gestos.
- PWA "GT7 Engenheiro": `display: fullscreen`, paisagem, tema preto, ícones gerados (SVG desenhado à mão
  + PNG via `@resvg/resvg-js`, em `public/`). O service worker só faz precache dos estáticos;
  `/ws`, `/api` e `/mcp` ficam fora do fallback de navegação e não há cache em runtime.
- **Tela ligada:** Wake Lock API quando há contexto seguro; senão (http na LAN) um `<video>` mudo,
  inline e em loop tocando um `canvas.captureStream` (variante do NoSleep, sem arquivo de vídeo, pois
  não há ffmpeg aqui), iniciado no primeiro toque. Sempre mostramos a dica de desligar o bloqueio
  automático quando o Wake Lock não está ativo. **Não testado em celular real.**
- Vite: `host: true`, porta 5173 (`strictPort`), proxy de `/ws` e `/api` para `http://localhost:8770`,
  build em `packages/web/dist`.
- `normalizeDeviceProfile` e `DEFAULT_ENABLED_VIEWS` foram adicionados a `shared/ui.ts` (aditivo); o
  servidor pode usar a função para validar `setDeviceProfile`.

### Pendências

- Validar em celular real: scroll-snap + recentralização no iOS Safari, `scrollend` (há fallback por
  debounce), vibração (só Android) e o truque do vídeo para manter a tela ligada.
- Contrato: falta um campo dizendo se há volta de referência "top" para a pista atual (ex.: em
  `ServerStatus` ou `LiveDelta`), para o toque duplo pular a opção quando não existir.
- As telas Mapa, Tempos, Combustível, Forças G, Treino de curva e Personalizada mostram "Em breve".
- O wrapper `rtk` cria `.vitest/json/output.json` na raiz ao rodar o vitest; o `biome check .` reclama
  do arquivo. Sugestão: pôr `.vitest/` no `.gitignore`.

## Onda 3 — AnalysisService (`@gt7/core`)

- **`AnalysisService`** (`core/src/analysis-service/`): fachada com estado sobre `Gt7Store` +
  `@gt7/analysis`, usada pelo MCP agora e pelo REST/coach do app na próxima onda. `@gt7/core` passou a
  depender de `@gt7/analysis` (só adicionado ao `package.json`, sem `npm install`: resolve pelo
  symlink do workspace).
- **Linha da análise** = `centerlineFromPolyline` da linha central gravada (passo 2 m). Fica em cache
  por pista, validada por uma consulta barata (`source_lap_id`, tamanho do BLOB, comprimento).
- **Caches LRU** de promessas (deduplicam chamadas simultâneas): voltas preparadas (48), análises de
  volta e comparações (64 cada). A chave inclui ids das voltas + assinatura da linha + hash das
  curvas (ids, distâncias, **nomes**) + portais de setor. Renomear/editar curvas invalida sozinho;
  erros saem do cache.
- **Curvas:** `ensureTrackCorners` detecta com a melhor volta da pista como referência de
  velocidade/guinada (cai para a volta da linha central). A assinatura (`v` + chave da linha) fica em
  `settings` (`analysis.corners.<trackId>`). Redetecta só se não houver curvas ou se a assinatura
  mudou (linha nova ou `CORNER_DETECTION_VERSION`). Curvas sem assinatura (usuário/embutidas) são
  respeitadas. **Não** redetecta quando aparece uma volta mais rápida (ids/limites estáveis). Ao
  redetectar, nome e nota de marcador passam para a curva nova de mesma direção com ápice a ≤ 40 m.
- **Referências simbólicas:** `personalBest` (própria, válida, sem replay, mesmo carro), `sessionBest`,
  `bestReference` (mesmo carro preferido) e `auto` (top → melhor pessoal → melhor da sessão). Nunca a
  própria volta. Pistas diferentes → erro; carros diferentes → aviso no topo dos `warnings`.
- **Erros** com código (`AnalysisError`: `notFound`, `noTrack`, `noCenterline`, `noTrace`,
  `trackMismatch`, `noReference`, `invalidArgument`) e mensagem pt-BR pronta para o usuário/IA.
- **Consistência:** sessão → voltas válidas (todas, se houver menos de 2 válidas). O array `metrics`
  por volta é omitido do resultado.
- **Evolução:** só voltas próprias (sem replay/referência) de um carro (padrão: o mais usado na
  pista), agrupadas por **dia local**. Base = melhor referência (mesmo carro preferido), senão o
  melhor pessoal. Por dia: melhor volta, média das 3 melhores, desvio-padrão, gap para a base e, por
  curva, tempo perdido e diffs (frenagem, V-mín, saída, acelerador) via `compareLaps`. Tendências =
  primeiro × último dia, ranqueadas por mudança normalizada, com frase pt-BR.
- **Tipos novos** (aditivos, em `shared/analysis.ts`): `ComparisonReferenceKind`, `TrackAnalysis`,
  `LapAnalysis`, `LapComparisonResult`, `MicrosectorAnalysis`, `Evolution*`, `AiSummary`,
  `MapCorner`.
- **`AnalysisCornerHintProvider`**: dica da próxima curva a partir das métricas da análise (mesmas
  definições da página de análise e do coach), calculadas uma vez por (volta de referência, curvas).
  Cai para o `TraceCornerHintProvider` sem linha ou em erro.
- **`Gt7Runtime`** (compatível): ganhou `analysis` (opção `analysis` para compartilhar),
  `cornerHints` padrão = `AnalysisCornerHintProvider`, opção `autoDetectCorners` (padrão true) e
  `whenAnalysisIdle()`. A cada volta fechada, `analysis.onLapCompleted` roda em segundo plano
  (detecta curvas da pista nova e chama `engine.refreshTrack()`); falha vira `notice` `analysisFailed`.
  `close()` espera esses jobs antes de fechar o banco.
- **`seedSyntheticData(runtime, specs)`** (exportado): empurra sessões sintéticas direto no motor
  (sem UDP), incluindo captura de referência de replay. Usado nos testes e no gráfico de exemplo.

## Onda 3 — MCP (`@gt7/mcp`)

- **`createGt7McpServer({ store, analysis?, runtime? })`** com `McpServer.registerTool` +
  schemas zod 4 (SDK 1.32 aceita `zod/v4`). Ferramentas: `list_tracks`, `get_track` (extra: ids das
  curvas para as outras tools), `list_sessions`, `list_laps`, `list_reference_laps`,
  `get_lap_summary`, `compare_laps`, `get_corner_detail`, `get_consistency`, `get_microsectors`,
  `get_trace`, `get_evolution`, `render_comparison_chart`, `get_live_state`, `rename_corner`,
  `rename_track`. Recursos: `gt7://tracks` e `gt7://tracks/{trackId}`.
- **Saídas:** JSON compacto (chaves com unidade, números arredondados, pares `[você, referência]`) +
  Markdown só no `compare_laps`. Limites: passo ≥ 2 m e ≤ 500 pontos no `get_trace`; ≤ 160 pontos
  por série e ≤ 6 voltas no `get_corner_detail`; ≤ 20 voltas nos microssetores; corte explícito em
  24 KB por bloco. `compare_laps` do sintético fica abaixo de 12 KB (JSON + Markdown; limite verificado no teste). Erros viram
  `isError: true` com a mensagem pt-BR.
- **Sessão padrão** (sem `session_id`): a mais recente **ao vivo** com voltas (não a de captura).
- **Gráfico** (`render_comparison_chart`): SVG gerado à mão → PNG com `@resvg/resvg-js` (fontes do
  sistema, 1400 px, ~110–180 KB). Painéis: velocidade, acelerador, freio, marcha, volante e delta
  (área vermelha = perdendo, azul = ganhando). Mapa: linha colorida pela taxa do delta (s/100 m,
  divergente azul↔vermelho com cinza neutro). Com `corner`: zoom com os dois traçados (referência
  tracejada) e pontos de frenagem; o delta do zoom começa em 0 na janela. Cores do tema escuro
  validadas com o validador de paleta (você laranja `#d95926` × referência verde-água `#199e70`, que
  passam em todos os pares). O eixo X do mapa é espelhado (−X) para que curva à esquerda pareça à
  esquerda, seguindo a convenção de heading do sintético (não verificado no GT7 real).
- **Prompts** pt-BR (`debrief_sessao`, `foco_curva`, `plano_treino`): persona de engenheiro de
  pista/instrutor. Dizem quais tools chamar e em que ordem, exigem números das ferramentas, uma ação
  por curva, separar técnica × consistência e a ressalva da precisão de replay. Preenchem ids padrão
  (sessão/pista mais recente) consultando o banco.
- **stdio** (`src/stdio.ts`): `--data <dir>` > `GT7_DATA_DIR` > `<repo>/data`. `console.log/info/debug`
  redirecionados para o stderr; fecha o store no fim do stdin/SIGINT. Script raiz `npm run mcp` (use
  `npm run -s` como comando MCP, para o npm não escrever no stdout). Para o Claude Desktop o
  `--import` do tsx precisa ser URL `file:///` absoluta (testado como processo filho com `cwd`
  diferente).
- **HTTP** (`mountMcpHttp(fastify, deps, { path, allowedHosts?, allowedOrigins? })`): Streamable
  HTTP **sem estado** (um `McpServer` + transporte por POST, `enableJsonResponse`), compartilhando um
  `AnalysisService`; GET/DELETE → 405. Proteção contra DNS rebinding opcional (por padrão desligada,
  porque o app atende a LAN). `fastify` é só import de tipo (resolve pela raiz; não declarado no
  `package.json` do mcp).
- `npm run mcp:sample-chart` gera `docs/exemplo-grafico.png` e `docs/exemplo-grafico-curva.png` com
  dados sintéticos.

### Pendências

- `get_live_state` só via HTTP; a integração do `mountMcpHttp` no servidor fica para a próxima onda.
- Processo stdio e app escrevem no mesmo SQLite (WAL + `busy_timeout`); só escritas pequenas
  (curvas/nomes/assinatura). Os caches leem a pista a cada chamada (as chaves incluem nomes e limites
  das curvas), então renomeações feitas pelo app aparecem na hora no processo stdio.
- Evolução e tendências ainda não consideram mudança de acerto/pneu, nem condições.

## Onda 3 — servidor (`@gt7/server`)

### Execução

- Scripts na raiz (todos com `node --disable-warning=ExperimentalWarning --import tsx`):
  - `npm start` = servidor + painel compilado (`packages/web/dist`) e abre o navegador;
  - `npm run demo` = `--sim`: um `FakeConsole` **no mesmo processo** com voltas sintéticas
    (perfil `amateur` por padrão) nas portas UDP **47739/47740**, para não brigar com um console
    real em 33739/33740. Os dados da demo vão para `data/demo` (o runtime grava o IP do console
    passado por opção, e as voltas sintéticas não devem poluir os recordes reais);
  - `npm run dev` = `--dev`: servidor + Vite (`npm run dev -w @gt7/web`) como processo filho, sem
    dependência extra. O npm é chamado pelo `npm-cli.js` (sem shell) e no Windows o filho é
    encerrado com `taskkill /T` (mata o Vite neto);
  - `npm run build` = build do web.
- Configuração por flags e variáveis de ambiente (a flag vence): `--port/GT7_PORT`, `--host/GT7_HOST`,
  `--data/GT7_DATA`, `--ps-ip/GT7_PS_IP`, `--format/GT7_FORMAT`, `--token/GT7_TOKEN`,
  `--sim/GT7_SIM=1` (+ `--sim-profile`, `--sim-laps`, `--sim-seed`, `--sim-replay`), `--dev`,
  `--no-open/GT7_NO_OPEN=1`, `--no-record`, `--verbose`.
- O banner (pt-BR) mostra a URL local, as URLs da LAN, um QR no terminal (`qrcode`, `small`), o
  console/formato, a pasta de dados e o aviso de firewall.
- Encerramento (SIGINT/SIGTERM/SIGBREAK): fecha os WebSockets, o Fastify, o runtime (sessão, gravação,
  UDP) e o banco; segundo Ctrl+C ou 8 s → saída forçada.

### HTTP e WebSocket

- `createApp()` é a fábrica usada pelo `main.ts` e pelos testes. Ela cria o `Gt7Runtime` (para ligar o
  `statusExtras` com URLs da LAN e dispositivos conectados).
- Handlers de erro/404 são registrados **antes** do plugin `/api`: no Fastify, contextos filhos
  herdam esses handlers no momento do registro. Erros sempre em `{ error: { code, message } }`
  com mensagem pt-BR; JSON malformado → 400 "JSON inválido".
- Painel: `@fastify/static` com fallback de SPA (rotas sem extensão → `index.html`), `assets/` com cache
  imutável, `index.html`/`sw.js` com `no-cache`. Sem `dist`, uma página pt-BR manda rodar
  `npm run build` (a API continua respondendo).
- **Hub WS:** o `frame` é serializado uma vez e enviado a todos. Cliente com `bufferedAmount` > 32 KiB
  **perde frames** (nada fica enfileirado no hub). Outras mensagens sempre vão, mas cliente com mais
  de 2 MiB pendentes é derrubado (memória limitada). Ping de protocolo a cada 30 s derruba conexões
  mortas.
- Nada é enviado antes do `hello`. No `hello`: `welcome`, aviso se a versão do protocolo diferir,
  `deviceProfile`, `status`, `sessionChanged` (sessão ativa ou null) e o último frame.
- Perfil novo é criado com `updatedAt = 1` (o core troca 0 por "agora"), para que uma cópia local
  já editada no navegador vença o `reconcileProfiles` do web. `setDeviceProfile` é normalizado
  (`normalizeDeviceProfile`) e o `deviceId` é sempre o da conexão.
- `setTargetView` → `showView` para **todas** as conexões do dispositivo alvo; alvo offline → `notice`
  `targetOffline` para quem pediu. `currentView`/nomes/último contato alimentam `status.devices`.
- `captureStatus` do runtime vira um `status` imediato (o estado da captura está em `status.capture`);
  os outros `status` são agrupados (no máximo 1 a cada 100 ms).
- Comandos lentos (`setPacketFormat`, início/fim de captura esperam o cooldown de ~15 s do ingestor)
  não bloqueiam: o WS e o REST respondem na hora (REST com 202) e o progresso vai por
  `status`/`notice`.

### REST (`/api`)

- `status` (inclui `firewall`, `settings`, `running`, `httpPort`, `tokenRequired`, `simulator`),
  `settings` GET/PATCH, `firewall` + `firewall/check`, `lan`, `sessions` (lista/detalhe/voltas/
  apagar — 409 para a sessão em andamento), `laps` (por `sessionId` ou `trackId` com filtros; get;
  delete; `PUT/DELETE /laps/:id/reference`), `references`, `tracks` (lista/get/`centerline`/voltas,
  PATCH nome/layout, PATCH curva nome/`brakeMarkerNote`, PUT `sectors` com `{count}` ou `{gates}` →
  `runtime.refreshTrack()`), `devices` (lista/get/put/delete + `POST /devices/:id/show-view`),
  `capture` (status/start/stop), `recordings/:sessionId` (download `.gt7rec`).
- Uma rota por área em `routes/*.ts` com o mesmo `RouteContext` (inclui o `runtime`, logo
  `runtime.analysis`); `createApp({ extraRoutes })` ou `ROUTE_MODULES` recebem o futuro
  `routes/analysis.ts`.
- Portais de setor do usuário: ordenados, portal 0 forçado em 0 m, espaçamento ≥ 50 m, até 20 setores,
  reindexados.
- `captureFormat` não tem setter no runtime: o PATCH grava a configuração e o servidor a passa como
  `format` em cada início de captura.
- Tipos REST adicionados em `shared/ws.ts` (aditivo): `API_PREFIX`, `ApiErrorBody`, `ApiStatus`,
  `ApiSettings(Patch)`, `FirewallStatus`, `LanInfo`, `DeviceInfo`, `SessionDetail`,
  `StartCaptureRequest`; campos opcionais `ServerStatus.firewall` e `devices[].lastSeenAt`.

### LAN, firewall e segurança

- URLs da LAN: IPv4 não internos, sem 169.254; ordem 192.168 > 10 > 172.16–31, com interfaces
  virtuais (vEthernet/WSL/VirtualBox/VMware/Docker/VPN) por último. QR em SVG (data URL) só para a
  URL preferida.
- Firewall do Windows: **só leitura** (`netsh advfirewall firewall show rule name=...`; código 0 =
  existe, 1 = não existe). Regras esperadas "GT7 Race Engineer (TCP <porta>)" e "(UDP 33740)". Se
  faltarem, o banner e o `/api/status` trazem os comandos `New-NetFirewallRule` / `netsh` com
  `-Profile Private` para o usuário rodar como administrador. Uma liberação do `node.exe` feita
  pelo prompt do Windows não é detectada (a mensagem avisa).
- Sem autenticação por padrão (app de LAN). `--token`: exige token em `/api` e `/ws` (`?token=`,
  `x-gt7-token`, `Authorization: Bearer` ou cookie `gt7_token`). Abrir qualquer página com `?token=`
  válido grava o cookie, então o painel funciona sem saber de token; o QR já leva o `?token=`.

### Pendências

- Endpoints de análise (`/api/analysis/*`) e o MCP HTTP (`mountMcpHttp` em `/mcp`) ficam para a
  próxima onda.
- Sem download de trace de volta pela API (virá com a análise).
- O limitador de frames do core (`receivedAt - último ≥ 33,3 ms`) entrega ~21 frames/s com pacotes a
  60 Hz (salta 2 ou 3 pacotes). Um acumulador (`último += intervalo`) daria 30 Hz de verdade.

## Onda 4a — telas extras (`@gt7/web`)

### Telas e dados

- As 6 telas restantes saíram do "Em breve": Mapa, Tempos, Combustível, Forças G, Treino de curva e
  Personalizada. **Padrão continua com as 5 telas F1 ligadas**; as novas aparecem no seletor em
  "Desligadas" (11 telas no carrossel é demais para um celular no suporte). O seletor ganhou o botão
  "Editar a tela Personalizada".
- **Estado derivado ao vivo** (`live/derived.ts`), alimentado por `live.push` em todo frame (O(1),
  independente da tela visível): rastro/picos de G, microssetores, contorno da pista, rastro do carro,
  passagens por curva e disponibilidade da referência. As telas só desenham (rAF, só a visível a
  taxa cheia, como antes).
- **Mapa:** `GET /api/analysis/tracks/:trackId` (`{track, polyline:{x,z,stepM,lengthM?}, corners,
  sectorStartsM}`; ponto i = distância i·stepM). Em 404/erro, o contorno é montado com as posições ao
  vivo (ponto a cada 2 m com a distância da volta; guarda o laço mais bem fechado, gap < 40 m e
  comprimento ±8%); antes do 1º laço mostra o caminho parcial. Nova tentativa do endpoint a cada volta
  fechada (mín. 30 s). No mock, a pista vem do próprio gerador. Plano do mapa: `x` à direita, `−z`
  para cima, norte fixo (a quiralidade real do GT7 não foi verificada).
- **Microssetores ao vivo:** 25 trechos; ao cruzar k→k+1 guarda a variação do delta no trecho
  (±10 ms neutro, verde ganha, vermelho perde). Trechos ainda não percorridos mostram a volta anterior
  esmaecida; trocar de referência zera tudo.
- **Gestos no mapa:** pinça com dois dedos (touch events não passivos) faz zoom; um dedo só arrasta
  com zoom (`touch-action: none` só nesse caso); sem zoom o dedo continua trocando de tela. Roda do
  mouse (vertical ou pinça do trackpad) dá zoom; roda horizontal segue rolando o carrossel. **Com zoom,
  o toque duplo volta à pista inteira** em vez de trocar a referência (`state/gestureOverride.ts`).
  Com zoom o mapa segue o carro; arrastar desliga o "seguir" (botão ◎ religa, ⤢ volta ao todo).
- **Tempos:** voltas por `lapCompleted` (WS e mock) num store zustand (`state/sessionStore.ts`) +
  `GET /api/sessions/:id/laps` (`Lap[]`; alternativa `/api/laps?sessionId=`; aceita também
  `{laps}`) ao trocar de sessão; 404 é tolerado. Setores: cor do evento (roxo/verde/amarelo); linhas
  vindas só da REST pintam verde o melhor setor da sessão; contorno branco = melhor setor da sessão.
  Ideal teórica = soma dos melhores setores de voltas válidas. Consistência = desvio-padrão amostral
  das voltas válidas até 107% da melhor. Tendência = inclinação das 3 últimas válidas (±100 ms/volta =
  estável). Melhor pessoal = tempo da referência quando o delta é contra o melhor pessoal (ou volta
  com `isPersonalBest`).
- **Combustível:** `neededToFinish` segue a semântica do core (total até o fim, não o que falta); o
  mock foi corrigido para o mesmo significado. Falta/sobra, economia por volta e avisos em pt-BR são
  calculados no cliente. `energyRecovery` aparece como barra relativa ao máximo da sessão (unidade
  não verificada). Histórico = `fuelUsedL` das últimas 10 voltas.
- **Forças G:** o ponto é o vetor de aceleração do carro (curva à esquerda → esquerda, acelerar →
  cima, frear → baixo); escala de 2 g que cresce em passos de 0,5 g; picos da volta em roxo; amostras
  > 6 g ignoradas nos picos.
- **Treino de curva:** rastreador no cliente (`lib/cornerPass.ts`): aproximação = curva da dica;
  frenagem = início do último episódio de freio (> 5%, pausa > 0,4 s separa) até 350 m antes da
  entrada (freio já em curso ao abrir a curva é da anterior); V-mín e retomada (acelerador ≥ 10% após
  a V-mín) seguem depois da entrada até acelerar (+25 km/h ou 150 m), começar outra frenagem ou a
  dica mudar de novo. Tolerâncias: frenagem ±5 m, V-mín −2 km/h, retomada +8 m. Frear cedo, V-mín
  baixa e retomada tarde = vermelho; frear tarde é só informativo. Sem referência, compara com a
  passagem anterior (cinza). Contagem regressiva até a frenagem da ref.; depois dela, até a entrada.
  Opção "Fixar esta curva". **Áudio** (Web Speech, pt-BR) desligado por padrão, salvo no
  localStorage, no máximo 1 frase por passagem (e 2,5 s entre frases), só com a tela de Treino
  visível; ligar fala "Áudio do treino ligado" no toque (desbloqueia o iOS).
- **Meta de retomada:** o contrato `NextCornerHint` não tem alvo de retomada; o cliente lê um campo
  opcional `referenceThrottleOnM` (distância da volta) se o core passar a enviá-lo (o mock já envia).
  Proposta para o core: adicioná-lo a `NextCornerHint`.
- **Personalizada:** grade CSS com os 24 `WidgetId` existentes (sem mudar `ui.ts`). Itens em ordem de
  leitura; posições sempre recalculadas por auto-posicionamento esparso (como o CSS grid), então a
  edição é só com botões (antes/depois, largura/altura ±, remover, colunas 2–8, até 16 widgets).
  O layout é sanitizado ao ler (widgets desconhecidos fora, tamanhos limitados) e salvo via
  `setDeviceProfile` (nova ação `setCustomLayout` no redutor do perfil). Cada célula é um container
  (`cqw/cqh`) para o texto escalar com o tamanho.
- **Referência "top" no toque duplo:** inferida dos frames: se o servidor aplicou `reference` e
  respondeu `referenceLapId = null` naquela pista, o ciclo pula a opção; pista nunca testada ainda a
  oferece uma vez.
- **Mock:** o circuito agora fecha (giro total −360°, duas retas resolvidas, 3895 m), tem 9 curvas
  com nomes ("Grampo", "Dupla 1/2"), dicas de próxima curva com metas da referência (frenagem, V-mín,
  marcha, retomada), `lastPassDeltaMs`, recuperação de energia, posição interpolada e retomada
  variável por volta (acelerador < 10% até 22–46% do arco).
- Estilos novos em `styles/views-extra.css` (carregado depois do `index.css`). Corrigido o destaque
  do botão segmentado do seletor (usa `aria-pressed`; o CSS só tratava `aria-checked`).
- `.claude/launch.json` ganhou a configuração `web-dev-5174` (Vite na 5174, para não colidir).

### Pendências

- Validar no console real: quiralidade do mapa, pinça no iOS com o scroll-snap do carrossel, voz
  pt-BR disponível no aparelho e unidade de `energyRecovery`.
- Microssetores de sessão/melhor de sempre (roxo) e cores vindas da análise do servidor ainda não
  entram no mapa ao vivo (só ganho/perda contra a referência atual).

## Onda 4b — backend (servidor, core, MCP, coach)

### Correções no core

- **Limitador de frames por acumulador:** o próximo quadro vence em `próximo += intervalo` (tolerância
  de 1 ms); atrasado mais de um intervalo (lacuna, pausa) ou relógio voltando → ressincroniza. Com
  pacotes a 60 Hz e jitter de ms inteiro entrega 30 fps (teste ±1 fps; medido 30,3 fps no
  `npm run demo`). Mudança de estado continua emitindo quadro na hora, sem mexer no acumulador.
- `Gt7Runtime.setCaptureFormat(fmt)` (persistido; vale para a próxima captura). O servidor deixou
  de passar `format` em cada início de captura; o `format` do corpo de `POST /api/capture/start`
  ficou como sobrescrita pontual.
- Opção `persistConsoleIp` (padrão true): `false` no `--sim` e nos testes; nem a opção, nem a
  descoberta, nem `setConsoleIp` gravam o IP.
- `NextCornerHint.referenceThrottleOnM?` (opcional): ponto de retomada do acelerador da referência
  na curva, preenchido pelo `AnalysisCornerHintProvider` a partir de `throttlePickupM`.
- Migração **v2** do SQLite: tabela `coach_reports` (metadados, Markdown, transcrição, conversa
  crua em JSON, uso de tokens). `Gt7Store.saveCoachReport/getCoachReport/listCoachReports/
  deleteCoachReport`.

### REST de análise

- `routes/analysis.ts` sobre `runtime.analysis`. Contratos em `shared/api.ts` (`ApiTrackAnalysis`,
  `ApiTraces`, `ApiLapTrace`, `ApiRedetectCornersResult`, aliases de canais, colunas do CSV); o
  resto reaproveita os tipos da Onda 3 (`LapAnalysis`, `LapComparisonResult`, `DistanceDelta`…).
- `GET /api/analysis/tracks/:id` devolve `polyline {x, z, stepM, lengthM}` (padrão 1000 pontos,
  ~6 m na pista sintética) + `sectorStartsM`; sem linha → 404 `noCenterline` (o mapa do web cai
  no contorno ao vivo).
- `AnalysisError` → HTTP no handler global: `notFound/noCenterline/noTrace/noReference` 404,
  `invalidArgument/trackMismatch` 400, `noTrack` 409; mensagem pt-BR repassada.
- `traces`: todas as voltas na mesma grade (comprimento da linha da pista), até 6 voltas e 12
  canais, `maxPoints` ≤ 5000, NaN → null. CSV: grade de 1 m pela análise; sem linha, amostras
  cruas pela distância do trace. `chart.png` reutiliza o `buildComparisonChart` do MCP.
- `@gt7/server` passou a declarar `@gt7/mcp` e `@modelcontextprotocol/sdk` (só `package.json`;
  resolvem pelo workspace/hoisting, sem `npm install`).

### MCP por HTTP

- `createApp` monta `mountMcpHttp` em `/mcp` (opção `mcp: false` desliga) com o mesmo store,
  análise e runtime: `get_live_state` funciona. `--token` agora protege também `/mcp`.

### Coach com IA ("Debrief com IA")

- **Uma fonte de verdade para as ferramentas:** cliente MCP em memória (`InMemoryTransport`) ligado
  ao `createGt7McpServer`; a lista de tools vira tools do Claude (JSON Schema do MCP). Só as
  ferramentas somente leitura são expostas (`rename_*` ficam com o usuário; chamada a uma delas
  volta como erro). Imagem do `render_comparison_chart` vai como bloco `image` no `tool_result`.
- **Prompts alinhados ao MCP:** `prompts.ts` do MCP exporta `COACH_PERSONA` e os textos das
  tarefas (`debriefTask`, `cornerFocusTask`, `trainingPlanTask`); o system prompt do app = persona +
  regras do relatório (3 maiores perdas, uma ação por curva, ressalva de replay, plano do próximo
  stint, limite de ferramentas). O system prompt é fixo (prefixo cacheável); ids resolvidos e a
  pergunta vão na primeira mensagem do usuário.
- **API:** `@anthropic-ai/sdk` 1.6, `client.beta.messages.stream` + `finalMessage()` num laço manual.
  Modelo padrão `claude-opus-5-5` (opções `claude-sonnet-5-5` e `claude-haiku-5-5`), pensamento
  adaptativo, `output_config.effort` (padrão `high`, configurável low/medium/high), cache de prompt
  automático (`cache_control` no topo), `eager_input_streaming` nas tools (a validação fica com o
  zod do servidor MCP) e fallback de recusa do servidor (`fallbacks: "default"`, beta
  `server-side-fallback-2026-07-01`) para Opus/Sonnet 5.5.
- **Limites:** 12 rodadas com ferramentas; depois (ou ao passar de 800 mil tokens de entrada /
  64 mil de saída acumulados) a última chamada vai com `tool_choice: none` e um aviso para
  responder com o que já tem. `max_tokens` 32 mil por chamada. Tool input que o SDK não consegue
  parsear → até 2 novas tentativas.
- **Conversa só por acréscimo:** o conteúdo do assistente (inclusive blocos de pensamento) é
  guardado e reenviado sem edição; o follow-up (`/api/coach/chat`) usa o mesmo modelo do relatório.
  Turno interrompido com `tool_use` pendente recebe `tool_result` de erro ("interrompido") para a
  conversa continuar válida. Imagens dos gráficos ficam na conversa salva (relatórios de ~0,5–1 MB).
- **Chave:** `ANTHROPIC_API_KEY` vence a salva em `settings` (`coach.apiKey`); a API só mostra
  `hasKey`, origem e 4 últimos caracteres. Sem chave → 400 pt-BR antes de abrir o SSE.
- **SSE:** `start`, `text`, `tool` (running → done/error), `done` (uso de tokens), `error` com código
  (`invalidKey` 401/403, `rateLimited` 429, `overloaded` 529/503, `refused`, `limitReached`,
  `apiError`, `aborted`). Comentário `: ping` a cada 15 s; fechar a conexão aborta a chamada.
- **Testes:** cliente Claude falso injetado (`createApp({ coach: { clientFactory } })`), sem
  chamadas reais; verificam laço com tools MCP reais, imagem no resultado, teto de rodadas,
  persistência, follow-up e mapeamento de erros.

### Pendências

- O coach não tem orçamento em dinheiro nem fila: dois debriefs simultâneos rodam em paralelo.
- Relatórios guardam as imagens; não há limpeza automática de relatórios antigos.
- O teste UDP do runtime (`runtime.test.ts`, 20× tempo real) pode estourar 30 s quando a suíte
  inteira roda em paralelo na máquina carregada; sozinho passa (~16 s).

## Onda 4c — análise e configurações (`@gt7/web`)

### Estrutura

- **Segunda área do app** ("Análise & Configurações"), pensada para o navegador do PC e responsiva
  até celular em retrato. O carrossel ao vivo continua sendo a experiência do celular.
- **Roteador por hash, sem dependência** (`lib/route.ts`, testado): `#/analise` (sessões),
  `#/analise/sessao/:id`, `#/analise/comparar?lap=&ref=&extra=a,b&corner=`,
  `#/analise/pista/:id?session=`, `#/captura`, `#/config?s=<seção>`,
  `#/coach[/:reportId]?session=&lap=&ref=&corner=`. Hash vazio, `#/` ou `#/painel` = painel ao vivo.
  O hash funciona igual no Vite, no Fastify e no PWA instalado (sem rewrite no servidor nem no
  service worker).
- **Code-split:** `main.tsx` escolhe a área pelo hash e carrega `analysis/AnalysisApp.tsx` com
  `React.lazy` (chunk de ~113 KB de JS + 20 KB de CSS); o bundle do painel ao vivo não mudou. A
  conexão WS continua ligada na área de análise (status da captura, dispositivos, avisos).
- Entrada pelo painel: botão **"Abrir análise"** no seletor de telas (pressão longa / Enter).
- `html[data-area="analysis"]` libera rolagem, seleção de texto e toque normal (o painel trava tudo).
- Mesma linguagem visual: preto puro, âmbar só na interface, fonte DIN do sistema, números tabulares.
  Você = laranja `#ff7a2f`, referência = verde-água `#2fd3b0`, voltas extras azul/violeta tracejadas.
  O til da Bahnschrift parece um traço: custos usam "≈".

### Dados

- Cliente REST próprio (`analysis/api.ts`) + hook `useFetch` (sem biblioteca). Erros viram
  `ApiError` com a mensagem pt-BR do servidor; servidor fora do ar (erro de rede, 502/504 do proxy ou
  HTML no lugar de JSON) mostra "Servidor fora do ar" com link para a demonstração do painel.
- Comparação: `compare?lap&ref&topN=20` e, com o id real da referência, `traces` (um pedido só:
  `speed,throttle,brake,gear,steering,delta,x,z`, passo 2 m, até 2500 pontos, `ref`=id para o delta
  acumulado de cada volta), `analysis/tracks/:id` (contorno + ápices),
  `microsectors?laps=<sua>&ref=<id>` (cores do mapa) e `microsectors` das voltas válidas da sessão
  (volta ideal no cabeçalho).
- Referência: `auto | bestReference | personalBest | sessionBest` ou qualquer volta da pista
  (`/api/laps?trackId=&orderBy=time`). Até 2 voltas extras sobrepostas (`extra=`).
- Downloads: CSV (`/api/laps/:id/export.csv`), trace JSON (`/api/laps/:id/trace?download=1`),
  gravação `.gt7rec` (`/api/recordings/:sessionId`) e PNG (`/api/analysis/chart.png?lap&ref&corner`).
- Contrato conferido com o `shared/api.ts` e o `shared/coach.ts` finais (typecheck) e com o
  servidor rodando; nenhuma divergência encontrada.

### Comparação (página principal)

- **uPlot sincronizado**: um gráfico por canal (velocidade, acelerador, freio, marcha em degrau,
  volante em graus, delta acumulado), cursor compartilhado (`cursor.sync`), zoom arrastando (o hook
  `setScale` propaga o x para os outros; duplo clique volta à volta inteira), eixo Y de largura fixa
  para alinhar, faixas das curvas em todos e rótulos T1… (com nome quando há zoom) no primeiro. A
  leitura dos valores no cabeçalho de cada gráfico é escrita direto no DOM (sem re-render). Painel sem
  dados no formato (ex.: volante no A) fica escondido, com aviso.
- **Mapa em canvas**: contorno da pista, referência, sua linha colorida pelos microssetores
  (ganha/perde; o tom "best" de um par é ganho, então também fica verde), marcadores de frenagem
  (você/ref), rótulos das curvas clicáveis (zoom) e largada. Com zoom, enquadra o trecho. **Hover
  sincronizado** pelo `CursorBus` (fora do React): gráfico → marcador no mapa; mapa (ponto mais
  próximo a ≤ 28 px) → cursor nos gráficos.
- O mapa redesenha de forma **síncrona** quando os dados mudam; só o marcador de hover usa rAF
  (rAF não roda com a aba/painel em segundo plano — o mapa ficava vazio).
- Clicar numa curva (tabela, mapa, "Ver no gráfico") dá zoom em [frenagem mais cedo − 25 m / zona,
  saída + 60 m] nos gráficos e no mapa.
- Tabela por curva: tempo perdido, frenagem, V-mín, retomada, roda livre, saída e trail braking
  (você / ref / diferença colorida pela direção "melhor": frenagem mais tarde, V-mín maior, retomada
  antes, menos roda livre…; zonas mortas 5 m, 2 km/h, 8 m, 0,1 s, 3 km/h, 0,1 s), desvio lateral
  entrada/ápice/saída (amarelo ≥ 1,2 m) e marcha no ápice. Ordenável por perda.
- "O que treinar" = `keyFindings` (ou `findings`) com custo, ação, confiança e a nota de precisão
  de replay. Cabeçalho: tempos, delta total, retas, setores, volta ideal da sessão e `warnings`.

### Outras páginas

- **Sessões**: filtros de pista/carro (no hash) e modo. Na sessão: setores em roxo (melhor válido),
  flags traduzidas (replay/tempo divergente só marcam), seleção de 1–3 voltas (1ª = sua, 2ª =
  referência, 3ª = extra), marcar/desmarcar referência (piloto, tempo do ranking, notas), apagar
  volta/sessão com confirmação em dois cliques (sem `window.confirm`; sessão ativa desabilitada).
- **Pista**: mapa + edição de nome e marco de frenagem por curva (PATCH), renomear pista, setores
  iguais (PUT `{count}`), "Redetectar curvas" (POST), recordes por carro e referências com "Comparar
  meu melhor", consistência da sessão (estatísticas, destaques pt-BR, desvio por curva), volta ideal
  (melhores setores e microssetores) e evolução por dia (melhor volta/top-3/base e uma métrica de
  curva escolhida; eixo x = índice do dia) + tendências.
- **Captura**: formulário (tempo do ranking `m:ss.mmm` validado por `parseLapTime`, salvo no
  localStorage), instruções do PLANO §4, etapas ao vivo pelo `status.capture` do WS (polling REST de
  reserva), problemas traduzidos (`paused`, `discontinuity`, `packetGaps`, `lengthMismatch`,
  `timeMismatch`, `carMismatch`, `enterFailed`), Parar / Cancelar e descartar e, no fim, o link
  "Comparar com o seu melhor" (melhor volta válida própria do mesmo carro na pista). Também mostra a
  última captura salva quando a página é aberta depois.
- **Configurações**: IP do console, formatos ao vivo e da captura com explicações, gravação,
  referência padrão do delta, firewall (estado, regras, comandos PowerShell/netsh com copiar,
  "Verificar de novo"), URLs da LAN + QR, dispositivos com "Mostrar tela" (POST show-view), MCP (URL
  HTTP local/LAN, `claude mcp add --transport http`, JSON do Claude Desktop e comando stdio com a
  pasta do repositório editável — a API não expõe o caminho) e coach (chave só de escrita; mostra
  `keySource` e os 4 últimos caracteres, modelo e esforço). "Copiar" usa `execCommand` como reserva
  (a Clipboard API exige contexto seguro, e na LAN é http).
- **Coach IA**: `fetch` POST + `ReadableStream` + parser SSE próprio (`lib/sse.ts`, testado: CRLF
  partido entre pedaços, comentários, `data:` multilinha, evento final sem linha em branco). `text`
  acumula e re-renderiza por rAF; `tool` vira chip ("Comparando voltas…"); `done` troca a URL para
  `#/coach/:id` sem recarregar; erros JSON antes do stream (`noKey`, `noData`) aparecem na conversa.
  Chat de acompanhamento, histórico (abrir/apagar) e "Parar" (abort). Sem chave: cartão explicando,
  com links para Configurações e para o MCP. Os botões "Debrief com IA" da sessão e da comparação
  abrem o coach já preenchido (sessão, volta, referência, curva em foco).
- **Markdown seguro** (`lib/markdown.ts` → AST → elementos React): títulos, negrito/itálico/código/
  riscado, links só http(s)/mailto/`#/`, listas aninhadas, tabelas com alinhamento, citações e código
  em bloco (uma cerca ainda aberta durante o streaming vira bloco). Nunca usa `innerHTML`; HTML no
  texto aparece literal (testado com `renderToStaticMarkup`).

### Verificação

- 17 testes novos (`analysis/lib/analysis.test.ts`): roteador, `parseLapTime`, SSE, markdown
  (incl. escape), dados dos gráficos, zoom por curva, cores das diferenças e ordenação.
- Conferido no navegador embutido com `npm run demo` + Vite na 5175 (`.claude/launch.json`,
  `web-dev-5175`): sessões, sessão, comparação (gráficos, zoom, mapa, tabela, achados), pista
  (renomear curva salvou), captura completa no simulador (troca de formato → gravando → salva →
  comparação com referência de replay), configurações, coach sem chave e com stream simulado no
  próprio navegador (fetch substituído), celular 375×812 sem rolagem horizontal e servidor desligado.
- Os dados da demo ficaram em `data/demo` (ignorado pelo git), incluindo a curva T1 "Grampo" e uma
  referência "Piloto Teste" criadas no teste.
- `live/mock.ts`: `referenceThrottleOnM` é omitido quando não existe (o tipo é opcional, não `null`).

### Pendências

- Sem fixture de demonstração para a comparação offline (a área de análise precisa do servidor).
- Sem nomes de carro (só `Carro #código`, ou o nome da referência); falta um catálogo de carros.
- A pasta do repositório no snippet MCP stdio é digitada pelo usuário (a API poderia expor
  `repoRoot`/`dataDir`).
- Sem zoom por gesto nos gráficos no celular (o uPlot só arrasta com mouse); a rolagem funciona.
- O coach real (com chave) não foi exercitado de ponta a ponta nesta onda, só com stream simulado.

## Onda 5 — QA e endurecimento

### Dependências e ferramentas

- `package.json` agora declara o que cada pacote importa: `@gt7/analysis` (devDependency
  `@gt7/protocol`, usado só nos testes) e `@gt7/mcp` (devDependency `fastify`, só tipos e testes).
  Um `npm install` sincronizou o `package-lock.json`; `npm ci --dry-run` e `npm ls --all` sem erros.
  (`core → analysis` e `server → mcp/sdk` já estavam certos.)
- **Vitest em dois projetos** (`vitest.config.ts`): `unit` (paralelo) e `network` (UDP/TCP real:
  `runtime.test.ts`, `integration.test.ts`, `app.test.ts`), que roda **depois** do `unit`, um arquivo
  por vez e com timeout de 60 s. O teste do runtime era instável porque o replay a 20× disputava
  CPU com a suíte inteira; agora roda com a máquina ociosa e usa 1 volta (antes 2) com
  `timeout: 60_000`.
- `npm run lint` sai com 0; restam 23 *warnings* de CSS (`!important`, especificidade) em
  `styles/*.css`, sem correção automática segura.
- **PowerShell 5.1 + `npm.ps1` engole o primeiro `--`**: `npm run demo -- --no-open` abre o
  navegador e `npm run -s mcp -- --data X` ignora o `--data`. Funciona com `npm.cmd run … -- …`,
  com `-- --` ou pelas variáveis de ambiente (`GT7_NO_OPEN=1`, `GT7_DATA`/`GT7_DATA_DIR`). O
  `/api/mcp/info` já devolve `npm.cmd` no Windows. Git Bash e cmd não têm o problema.

### Bugs encontrados e corrigidos

- **Bypass do token** (`server/src/auth.ts`): o hook comparava o prefixo `/api` na URL crua, mas o
  roteador decodifica `%61`; `GET /%61pi/status` (e `/%6dcp`, `/%77s`) passava **sem token**.
  Agora o caminho é decodificado como o roteador faz (`requestPath` em `http.ts`) e URL com escape
  inválido nunca passa. Teste em `hardening.test.ts` (falha no código antigo).
- **Requisições entre sites** (`auth.ts: registerOriginGuard`): uma página de outro site podia abrir
  `ws://<pc>:8770/ws` ou disparar um POST sem corpo (`/api/capture/stop`) — nenhum dos dois passa por
  CORS. Requisições que mudam estado e o upgrade do WS com `Origin` de **outro hostname** que o
  `Host` agora recebem 403. Mesma origem, proxy do Vite (mesmo hostname, outra porta), curl e
  clientes MCP (sem `Origin`) não são afetados. Leituras continuam abertas (sem cabeçalhos CORS o
  navegador não deixa a página alheia ler a resposta).
- **Erro 500 vazava a mensagem interna** (caminhos de arquivo, SQL): agora é genérico para o cliente
  e vai inteiro para o terminal (`web.ts`).
- **Gravação**: o caminho vindo do banco também é recusado se for absoluto/vazio (`sessions.ts`).
- **Memória do `LiveEngine`**: uma volta que nunca fecha (carro parado na pista) crescia sem limite
  (~15 KB/s). Novo `maxLapSamples` (108 000 = 30 min): depois disso a volta para de gravar e é
  marcada `incompleteData`. Teste em `live-engine.test.ts`.
- **Hub**: o registro de dispositivos em memória aceitava `deviceId`s inventados sem limite; agora
  guarda no máximo 100 dispositivos offline (`hub.ts`).
- **Relatórios do coach**: um relatório `running` de um processo que morreu ficava preso (o chat
  respondia 409 "busy" para sempre); ao iniciar, são marcados como erro. **Retenção**: guarda os
  últimos N=50 relatórios concluídos (configurável de 5 a 500 em `PUT /api/coach/config`
  `{maxReports}` e na página de configurações; relatório em andamento nunca é podado).
- **SQLite**: `busy_timeout` passou para 5 s e vem antes do `journal_mode=WAL`; `synchronous=NORMAL`
  (seguro em WAL). Testado com o MCP stdio lendo e escrevendo enquanto o app rodava.
- **`main.ts`**: `unhandledRejection`/`uncaughtException` agora só registram (uma rejeição solta não
  derruba o app no meio da corrida); a mensagem falsa "o Vite terminou com código 1" ao encerrar o
  `npm run dev` deixou de aparecer.
- **WebSocket do painel** (`wsClient.ts`): um link TCP morto (celular saiu do Wi-Fi) só disparava
  `onclose` depois de minutos; agora, ao passar de 15 s sem mensagens, o socket é descartado e a
  reconexão começa na hora.
- **Mapa**: o mapa ao vivo/análise (`mapMath.ts`) desenhava com X à direita; o PNG do MCP espelha o
  X. Convenção única agora: **mapa = (−x, −z)**, norte para cima, que com o heading do sintético
  (θ=0 → +Z, curvatura + = esquerda) faz a curva à esquerda parecer à esquerda. O comentário antigo
  do `mapMath.ts` estava errado. **A lateralidade real do GT7 continua sem verificação**: se no
  primeiro teste o mapa aparecer espelhado, inverta `mapX` (`mapMath.ts`) e `vx` (`mcp/src/chart.ts`)
  juntos. Verificado no navegador: Comparação, Pista e PNG têm a mesma orientação.
- **`GT7_DATA` × `GT7_DATA_DIR`**: servidor e MCP stdio aceitam os dois nomes.
- **Docs**: `PLANO-APP.md` dizia `pnpm start`; `server/README.md` dizia `topN=3` (o servidor usa 3
  por padrão, 1–20; o painel pede 20 de propósito).

### Pequenas lacunas fechadas

- `GET /api/mcp/info` (`ApiMcpInfo`): `repoRoot`, `dataDir`, caminho do `node`, linha de comando
  stdio exata (URL `file:///` do loader do tsx, aspas em caminhos com espaço), JSON do Claude
  Desktop, comandos do Claude Code e URLs HTTP. A página de configurações usa isso (sem campo para
  digitar a pasta). Testado com caminho com espaço e dados em pasta com espaço.
- **Zoom por toque** nos gráficos da comparação: pinça com dois dedos (e arrastar com dois dedos) e
  toque duplo para voltar; um dedo continua rolando a página (`SyncCharts.tsx`, matemática pura em
  `analysis/lib/touchZoom.ts`, testada). Não testado em aparelho real.
- `formatGear` (`web/src/lib/format.ts`): ré e neutro aparecem ambos como "N"; ficou um TODO ligado
  ao primeiro teste com o PS5 (codificação não verificada). Sem mudança de comportamento.
- `ReferenceCapture`: conferido, **não há bug**: a tolerância de comprimento é recalculada a cada
  volta contra a pista da volta fechada. Limite conhecido: se o replay for de outra pista, o motor
  cria uma pista nova e o teste de comprimento passa trivialmente (o `carMismatch` e o tempo do
  ranking são as proteções).

### Verificação ponta a ponta

- `npm run demo -- --no-open --data "<pasta com espaço>"` + navegador embutido: painel ao vivo
  (paisagem 640×295: delta, setores, seletor de telas com liga/desliga, Mapa com contorno do
  servidor, delta e próxima curva), análise (sessões → sessão → comparar com gráficos e mapa →
  pista), captura (troca de formato → gravando → `timeMismatch` → cancelar volta ao ao vivo),
  configurações (QR, firewall, MCP com caminhos reais, coach) e coach sem chave (400 `noKey`).
- MCP stdio (`list_tools` = 16, `compare_laps`, `render_comparison_chart` → PNG, de outro `cwd` e
  com o app escrevendo no mesmo SQLite) e HTTP (`initialize`, `tools/list`, `get_live_state` com
  estado real) funcionam.
- Windows: Ctrl+C real (GenerateConsoleCtrlEvent) no `--dev --sim` imprimiu "Encerrando…" e não
  deixou `node`/`vite` órfãos; `npm start` (modo real) e `npm run mcp` via PowerShell/Git Bash OK.

### Pendências conhecidas

- O estático (`/`, `/assets`) não exige o token (não tem dados; o cookie é gravado ao abrir com
  `?token=`); só `/api`, `/ws` e `/mcp`.
- O `/mcp` por HTTP não valida `Origin` em GET (não existe: 405); DNS rebinding continua opcional em
  `mountMcpHttp`. Um inspetor MCP rodando num navegador (com `Origin` de outro host) é barrado.
- Se o IP do console mudar (DHCP) com o IP descoberto por broadcast, é preciso informá-lo em
  Configurações; não há redescoberta automática.
- O mapa ao vivo sem contorno do servidor copia o caminho parcial a cada ponto novo (O(n) por quadro
  na 1ª volta); aceitável (≤ 20 000 pontos).
- Não testado: celular real (scroll-snap/iOS, Wake Lock, vibração, zoom por toque), coach com chave
  real, console real (sinais de volante/mapa, ré × neutro).
