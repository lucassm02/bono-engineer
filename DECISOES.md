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
