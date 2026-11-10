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
- PWA "Bono Engineer": `display: fullscreen`, paisagem, tema preto, ícones gerados (SVG desenhado à mão
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
  existe, 1 = não existe). Regras esperadas "Bono Engineer (TCP <porta>)" e "(UDP 33740)". Se
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


## Onda 6b — histórico por pista e navegação

Objetivo: abrir o app e já ver o histórico organizado por pista, sem criar pastas nem configurar nada.

- **Nova home `#/inicio`** (`HomePage.tsx`): grade de cartões por pista, ordenada pela atividade mais
  recente. Cada cartão: miniatura do traçado (SVG, mesma orientação do mapa: `(−x, z)`, norte em cima),
  nome, km, nº de sessões e voltas, melhor volta (+ quando e carro), tendência, carros usados e
  selo "ref. do top". Busca por texto (sem acento) e filtro por carro. `#/analise` continua sendo a
  lista de "todas as sessões" (agora acessível por um botão na home).
- **Dados da home em uma requisição**: `GET /api/tracks/overview` (`routes/tracks.ts`, lógica pura em
  `server/src/tracks-catalog.ts`, com testes). Só conta voltas **próprias** (sem referências nem
  replays); referências saem à parte (`referenceCount`, `bestReferenceMs`). Miniatura = centerline
  reamostrada em 96 pontos. Os tipos foram **duplicados à mão** em `web/src/analysis/lib/history.ts`
  (não mexi em `packages/shared`).
- **Tendência** = melhor volta da última sessão ao vivo contra a sessão anterior **com o mesmo carro**
  (diferença < 50 ms = "Estável"; sem sessão anterior = não mostra nada).
- **Abertura sem rota** (`lib/boot.ts`, `main.tsx`): URL "pelada" (`/`, PWA) espera até 2,5 s o
  primeiro status do servidor. Corrida em andamento (`onTrack`, `paused`, `replay`) ou demo no
  navegador (`?mock=1`) → painel ao vivo; qualquer outra coisa (menu, console desconectado, servidor
  fora do ar) → `#/inicio`. `#/`, `#/painel`, `#/inicio` explícitos nunca são redirecionados.
  `switchingFormat` **não** conta como corrida (era o estado de um servidor sem console).
  Do painel ao vivo, segurar a tela → "Histórico e ajustes" abre a home (antes "Abrir análise").
- **Demo**: `ApiStatus.simulator` já existia; o overview repete `simulator` e o web põe o selo "Demo"
  em todos os cartões, um aviso e a opção "Esconder demonstração" (guardada no localStorage). Não há
  marca por pista no banco: demo é por servidor (a pasta `demo` é separada da real).
  Estado vazio: duas frases, "Ver demonstração" (`/?mock=1`, painel ao vivo simulado) e o aviso de
  que `npm run demo` enche o histórico de exemplo.
- **Nome de pista sem trabalho**: o motor já cria "Pista desconhecida N" (`source: 'auto'`); isso é o
  gatilho do aviso discreto "Nova pista detectada — qual é?" (home e página da pista; "Agora não"
  guarda o id no localStorage). Candidatos "Parece ser…" por **comprimento da volta com tolerância de
  1,5 %** (`trackSuggest.ts`), sempre com um clique de confirmação; autocomplete (ordem: começa com o
  texto, depois mais próximo em comprimento). Nunca nomeia sozinho. Salva por `PATCH /api/tracks/:id`
  (já existia: aceita `name` e `layout` e marca `source: 'user'`), então não precisou de endpoint
  novo. Nome editável inline no título da pista (clique, Enter salva, Esc cancela).
  No modo demo o aviso não aparece na home (a "pista" é do simulador).
- **Lista de pistas do GT7** (`web/src/data/gt7Tracks.ts`): conferida contra listas da comunidade
  (GTPlanet, dg-edge, theloadout). Comprimento só onde é conhecido com razoável certeza (circuitos
  reais; Red Bull Ring curto 2.336 m e Sardegna A 5.120 m vêm do Giant Bomb); fictícias e layouts
  sem número confiável ficam sem comprimento (nunca são sugeridas por tamanho, só achadas
  digitando). É conveniência, não autoridade: dá para digitar qualquer nome. Limitação: não sei se a
  lista cobre DLCs recentes; pistas novas entram editando o arquivo.
- **Página da pista** (`#/analise/pista/:id?tab=`): abas Melhores voltas (por carro, top 5, com
  ações rápidas), Sessões (agrupadas por dia: "Hoje", "Ontem", "sexta-feira, 06 de novembro"),
  Evolução (+ consistência e volta ideal), Referências do top e Curvas (mapa, nomes, setores).
  A consistência/volta ideal só carrega na aba Evolução.
- **Sessão e voltas**: cabeçalho com dia/hora local pt-BR, carro, resumo (voltas, melhor, duração,
  início); cada volta marca válida/inválida, "melhor da sessão", **volta de saída / de entrada** e
  os demais motivos; ações rápidas "Comparar com minha melhor" (a volta que já é a melhor oferece
  "Comparar com o top"), "Definir como referência" (um clique, piloto "Você"; os detalhes ficam em
  "Mais › Referência com detalhes…") e "Excluir" (confirmação em dois passos). Tudo com endpoints
  que já existiam (`PUT /api/laps/:id/reference`, `DELETE /api/laps/:id`, `DELETE /api/sessions/:id`).
  No celular a tabela de voltas vira lista de cartões.
- **Navegação**: barra lateral enxuta no PC (≥ 900 px) e barra inferior no celular, com Ao vivo,
  Início·Pistas, Comparar, Captura, Coach IA e Ajustes. Os gestos do carrossel ao vivo e o modo
  `?mock=1` não foram tocados (a barra só existe na área de análise).
- **Testes**: `server/src/tracks-overview.test.ts` (lógica pura + HTTP + renomear),
  `web/src/analysis/lib/history.test.ts` (filtro, agrupamento por dia, sugestão por comprimento,
  autocomplete, boot, rotas, formatação).
- **Não verificado**: celular real, gestos do carrossel após a mudança de rota inicial em aparelho
  real, PWA instalada (service worker pode servir a versão antiga até atualizar), servidor com milhares
  de voltas (o overview carrega todas as voltas de cada pista, sem traces, num único request).


## Onda 6a — zero-config e descoberta

Meta: abrir e usar. `npm start` sem argumento nenhum basta; o IP do PS5, o formato do pacote, a porta e a
pasta de dados deixam de ser coisas que o usuário decide.

### Dados na pasta do usuário

- Padrão: Windows `%APPDATA%\Bono Engineer`; macOS `~/Library/Application Support/Bono Engineer`; Linux
  `$XDG_DATA_HOME/bono-engineer` (senão `~/.local/share/bono-engineer`). `--sim` usa a subpasta `demo`.
  Lógica em `core/src/util/data-dir.ts` (`defaultDataDir`, `resolveDataDir`, `migrateLegacyData`), exportada de
  `@gt7/core` para o servidor e o MCP usarem a mesma regra. Override continua: `--data` > `GT7_DATA` >
  `GT7_DATA_DIR`.
- **Migração única e não destrutiva** (`main.ts`): se `<repo>/data/sessions.db` existe e a pasta nova **não existe**,
  copia `<repo>/data` (banco com `-wal`/`-shm`, `traces/`, `recordings/`; a subpasta `demo` fica de fora) para
  `<pasta nova>.migrando` e renomeia para a pasta nova (uma cópia interrompida não deixa pasta pela metade). A pasta
  antiga **não é apagada nem alterada**; o terminal diz "Seus dados foram copiados para …". Não roda com `--data`/
  `GT7_DATA` (o usuário escolheu a pasta). Se a pasta nova já existe (mesmo vazia), nada é copiado: é a regra mais
  simples que nunca sobrescreve nada.
- O banner mostra o caminho (e, na migração, de onde veio). `npm run live` também usa a pasta nova por padrão.
- **Fora do escopo desta onda (outro dono):** o `stdio` do MCP ainda cai em `<repo>/data` quando chamado sem
  `--data`/`GT7_DATA_DIR`; depois da migração esse caminho fica congelado. Deve usar `resolveDataDir()` de
  `@gt7/core`. (A página de Configurações já passa `--data <pasta real>` explicitamente via `/api/mcp/info`.)

### Porta e instância única

- Toda resposta HTTP leva `x-bono-engineer: real|demo` (`identity.ts`, hook `onRequest` registrado antes do guarda
  de origem e do token, então até o 401 leva o cabeçalho). Não precisa de endpoint novo nem de token.
- `pickPort` (`startup.ts`), a partir de 8770: instância nossa **do mesmo modo** respondendo → abre o navegador nela e
  sai com código 0; porta livre → usa; outro programa → tenta a próxima (até 20). `--port`/`GT7_PORT` explícito ocupado
  é erro (o usuário pediu aquela). Demo ao lado de uma instância real **não** a reaproveita (modo diferente): usa
  outra porta. `--dev` não escolhe porta (o proxy do Vite aponta fixo para 8770).
- Verificação da porta livre = tentar escutar; a janela de corrida até o `listen` real é desprezível e o `EADDRINUSE`
  final ainda é tratado.

### Painel compilado sozinho

- `npm start` chama `buildWeb` (`npm run build -w @gt7/web`) quando `packages/web/dist/index.html` não existe **ou** é
  mais antigo que qualquer fonte (`web/src`, `web/public`, `shared/src`, `index.html`, `vite.config.ts`,
  `package-lock.json`). Custa alguns ms quando está em dia (varredura de diretório), ~30 s quando precisa. Falha de
  build não derruba o app: imprime o erro, segue servindo a API. Não roda em `--dev`.

### Descoberta unicast do PS5 (`protocol/src/discovery.ts`)

- O broadcast sozinho não é confiável; o console responde a heartbeat **unicast**. Para cada interface IPv4 **privada**
  (10/8, 172.16/12, 192.168/16; sem loopback, link-local, pública, IPv6) enumera os hosts da sub-rede: máscara mais
  larga que /24 → só o /24 do IP local; mais estreita (/25, /26…) → a rede real; /31 e /32 ignoradas; redes repetidas
  fundidas; placas virtuais (Hyper-V, WSL, VPN, Docker…) por último. Exclui rede, broadcast e o IP do próprio PC.
- Envio em **lotes de 64** com 20 ms entre lotes (253 hosts ≈ 60 ms), pelo **socket do ingestor** (origem 33740), então
  a resposta cai direto no pipeline de decrypt/parse existente. Console = primeiro host cujo pacote decifra com magic
  válido. Falha de envio (ENOBUFS, sem rota) não interrompe a rodada.
- Cadência (`ConsoleDiscovery`): rodada imediata, depois a cada 5 s por 30 s, depois a cada 15 s, **só enquanto não há
  console respondendo** (consulta o estado a cada 1 s; ao voltar a precisar, recomeça a fase rápida). `restart()`
  (botão "buscar de novo") zera contadores e varre já. O broadcast de 1 Hz sem IP continua como antes.
- Dica de ordem (nunca requisito): IP salvo primeiro, depois vizinhos da tabela ARP (`arp -a`, parse de Windows e
  Linux/macOS, cache de 60 s, falha vira lista vazia) cuja OUI é de Sony/PlayStation (lista curta e conhecida,
  `PLAYSTATION_OUIS`) ou cujo nome sugere PlayStation, depois os demais vizinhos ARP (estão vivos), depois o resto.
- **Quem é "o console" (ingestor):** com `discovery` ligado, o 1º respondente válido é adotado quando não há IP; um
  respondente **diferente** só substitui o IP atual se este estiver **morto** — sem pacote válido dele por
  `deadAfterMs` (10 s) desde o último pacote ou desde que o IP foi definido (também vale para IP que nunca respondeu).
  Enquanto o IP está vivo, pacotes de outros hosts são **descartados** (um segundo console/PS4 não embaralha o contador
  de pacotes). Isso cumpre "não sobrescrever IP manual a menos que esteja morto". `discovered` ganhou 2º argumento
  (IP anterior); `setConsoleIp(null)` volta ao automático; novos `rescan()`, `discoveryInfo`, `consoleDead`,
  `lastPacketAt` e evento `scan`.
- **Segurança de rede:** só envia 1 byte (o heartbeat) à porta 33739, só em faixas privadas locais. Nada sai da LAN.
- Verificado com **console real**: no PC do desenvolvedor a varredura achou o PS5 em 192.168.3.26 sem nenhuma
  configuração (banco vazio, fonte "discovered", 253 hosts testados, 60 Hz, 0 perda, formato `~`). Ver "Não
  verificado" abaixo para o que falta.

### Estado de conexão exposto à UI

- **Nome do campo:** o pedido era `ServerStatus.connection`, mas esse nome **já existe** (`ConnectionState`:
  onTrack/menu/paused… e é lido pelo painel). Para manter a compatibilidade ficou **`consoleConnection`**
  (`ConsoleConnection` em `@gt7/shared/ws.ts`), opcional em `ServerStatus` (vai nas mensagens WS `status`) e
  obrigatório em `ApiStatus`.
- `ConsoleConnection = { state: 'idle'|'searching'|'found'|'receiving'|'lost', consoleIp, source: 'manual'|
  'discovered'|'simulator'|null, subnets, hostsProbed, lastScanAt, lastPacketAt, hint }`. `hostsProbed` = hosts testados
  desde que a busca atual começou (zera ao reiniciar a busca). Estados: `idle` = telemetria parada (porta UDP ocupada
  tem dica própria); `searching` = sem IP; `found` = IP conhecido e nenhum pacote nesta execução ("aguardando o jogo",
  **não é erro**); `receiving` = pacote nos últimos `timeoutMs` (3 s); `lost` = já recebeu e parou. `hint` em pt-BR
  (ex.: "Procurando o PlayStation na rede. Abra o Gran Turismo 7 no PS5 e entre numa pista."), `null` quando recebendo.
  Calculado em `Gt7Runtime.getConnection()` e republicado a cada `stats` (1 Hz) e a cada rodada de varredura.
- `source`: IP digitado / `--ps-ip` = `manual`; achado pela varredura = `discovered` (salvo em `consoleIpSource`); IP
  salvo por versão antiga, sem fonte, é tratado como `manual` (conservador). Demo = `simulator` (nunca salvo).
- `ApiSettings` ganhou `consoleIpSource` e `liveFormatAuto`; `ApiSettingsPatch.consoleIp` aceita `null` (e texto vazio)
  = automático; novo `liveFormatAuto`. Novas rotas: `DELETE /api/settings/consoleIp` e `POST /api/discovery/scan`
  (`ApiDiscoveryScanResult { started, consoleConnection }`; `started=false` se a telemetria está parada).

### Formato do pacote automático

- `liveFormatAuto` (padrão `true`, persistido). `--format`/`GT7_FORMAT`/opção `liveFormat`, `PATCH liveFormat` e a
  mensagem WS `setPacketFormat` **fixam** o formato (auto desliga) e o app nunca mais o muda; `PATCH liveFormatAuto:
  true` volta ao automático (vence um `liveFormat` enviado junto) e põe `~`.
- Rodada (`runtime.ts`): começa no formato salvo (`~` na 1ª vez); sem nenhum pacote válido por `autoFormatTimeoutMs`
  (5 s com IP; 12 s sem IP, para caberem 2 varreduras) passa ao próximo de `~ → B → A`, **uma tentativa por formato**,
  e ao esgotar volta a `~` e para (evita ficar trocando de formato eternamente com o jogo fechado). Cada troca usa o
  `setFormat` do ingestor, portanto **mantém a pausa de 15 s** do console. O 1º pacote válido num formato o grava como
  `liveFormat` (e avisa se não for `~`).
- **Auto-cura:** se os pacotes param (sessão acabou) estando num formato de reserva, após `autoFormatHealDelayMs`
  (10 s) volta a `~` e abre outra rodada. Sem isso, abrir o jogo no meio da rodada deixaria o app em `B`/`A` para sempre.
  Custo conhecido: num console que só aceita `B`/`A`, cada fim de sessão custa ~40 s de tentativas (pode atrasar a
  próxima conexão em até ~20 s).
- Limite honesto: com o jogo **fechado** não há como distinguir "formato errado" de "sem jogo"; por isso a rodada é
  única por busca/IP e é rearmada por troca de IP, `POST /api/discovery/scan` e fim de sessão em formato de reserva. A
  captura de referência continua trocando para `captureFormat` por conta própria e desliga a rodada enquanto dura.
- Substitui o antigo fallback único `~ → B` de 10 s (`formatFallbackTimeoutMs` saiu; `formatFallback: null` ainda
  desliga a rodada, por compatibilidade com os testes).

### Terminal e flags

- `--help` ficou curto e em pt-BR, com as flags como "avançadas". Mensagens do terminal curtas em pt-BR: uma linha
  quando o estado do console muda ("Console: recebendo telemetria de …"), avisos `[aviso]`/`[erro]`, porta UDP ocupada,
  painel sendo preparado. O terminal é só um log; o banner mostra "Console: … (encontrado sozinho | IP fixado,
  formato automático)" e a porta, se diferente da padrão.

### Testes

- Unitários (sem rede): `protocol/src/discovery.test.ts` (máscaras, /24 de redes largas, /26, fusão e ordem de
  interfaces, ARP Windows e Linux, ordem dos hosts, lotes de 64, cadência 5 s/15 s com timers falsos, silêncio quando não
  precisa, reinício, envio que lança, sem rede), `core/src/util/data-dir.test.ts`, `core/src/runtime/connection.test.ts`,
  `server/src/{config,status-api}.test.ts`.
- Rede (projeto `network`, sequenciais): `protocol/src/discovery.integration.test.ts` (FakeConsole em `127.0.0.x`:
  acha por varredura, console que sobe depois, **redescobre após mudar de IP**, IP fixado vivo não é sobrescrito e é
  trocado quando morre, `setConsoleIp(null)`), `core/src/runtime/discovery.test.ts` (estados `searching → receiving →
  lost`, avisos, IP salvo e fonte; rodada de formato contra um console que só fala `A`; cura; formato fixado nunca muda),
  `server/src/startup.test.ts` (cabeçalho de identidade com token, `pickPort`, `webNeedsBuild`). Em Windows,
  `127.0.0.2…254` fazem bind normalmente, então o teste usa endereços de loopback diferentes como "IPs de console".
- Os testes que iniciam o runtime com portas de teste passam `ingestor.discovery: false` (o padrão agora é descoberta
  ligada, e eles varreriam a rede real).

### Não verificado / pendências

- **Console real:** só a varredura com o jogo aberto (pausado) foi observada (acima). Não verificado: redescoberta
  após mudança real de IP, rede com várias placas/VPN ativas, a rodada de formato com o console real (só `~` foi
  necessário), comportamento com PS4, e se o PS5 responde a heartbeat em broadcast (não precisa mais).
- OUIs de PlayStation vêm de memória; são só heurística de ordem.
- O painel (outro dono) precisa consumir `consoleConnection`, o botão que chama `POST /api/discovery/scan`, o campo de
  IP vazio = automático, e `liveFormatAuto`; o README já os descreve.
- Redes /16 grandes: só o /24 do IP local é varrido (limite pedido); console em outra faixa do mesmo /16 não é achado
  sem fixar o IP.


## Onda 7a — conexão, onboarding e ajustes

Objetivo: o app 100% gráfico, "só abrir e usar". A web passa a consumir o que a Onda 6a expõe
(`ServerStatus.consoleConnection`, `POST /api/discovery/scan`, `PATCH /api/settings` com `consoleIp`/`liveFormatAuto`).

### Indicador e painel de conexão

- **Lógica pura** em `web/src/lib/consoleLink.ts` (testada): `describeLink(ConsoleConnection | null)` devolve
  `{ tone, title, short, detail, busy }`. Estados → texto/cor: `searching` = âmbar pulsando, "Procurando o PS5 na
  rede…" (+ "N endereços testados"); `found` = âmbar, "Console encontrado (IP) — abra o Gran Turismo 7 e entre numa
  pista"; `receiving` = verde, "Recebendo telemetria"; `lost` = amarelo, "Sinal perdido — reconectando…"; `idle` =
  vermelho, "Telemetria parada" (usa o `hint` do servidor); `null` (servidor sem o campo) = amarelo neutro. O `hint` do
  servidor tem prioridade sobre o texto padrão quando existe. `isValidIpv4` é estrito (4 octetos 0–255, sem zero à
  esquerda, rejeita 0.0.0.0 e 255.255.255.255). `ipSourceLabel`: "encontrado automaticamente" / "fixado por você".
- **Onde aparece:** painel ao vivo = `ConsoleChip` dentro de `.badges` (canto inferior esquerdo, longe do carrossel,
  `data-no-gesture`, então tocar nele não aciona os gestos). Enquanto **recebe telemetria vira só um ponto verde** (alvo
  de toque de ~28 px); nos demais estados mostra o texto curto. Área de análise = o mesmo chip no rodapé da barra
  lateral e no topo no celular (substituiu o "pill" que mostrava só Na pista/No menu). A tela cheia "sem console" do
  painel (`StatusLayer`) agora usa o estado real ("Procurando…", "Sinal perdido…"), com os botões "Procurar de novo" e
  "Detalhes" e sem mandar o usuário "informar o IP no servidor".
- **Painel de detalhes** (`components/ConsoleLink.tsx`, modal aberto por `openConnectionPanel()` no `uiStore`; os gestos
  e as setas do painel ficam travados enquanto ele está aberto): status, IP + origem, redes verificadas, hosts testados
  (só procurando), "último sinal" e "última busca" (relativos), **Procurar de novo** (`POST /api/discovery/scan`; já mostra
  o estado devolvido sem esperar o próximo status), **Usar outro IP** (campo opcional, validação IPv4 com mensagem, texto
  de onde achar o IP no PS5) e **Voltar ao automático** (só aparece com IP `manual`; `PATCH consoleIp: null`). O mesmo
  `ConnectionDetails` é usado inline em Configurações.
- As ações ficam em `net/consoleActions.ts` (usam `analysis/api.ts`, que é minúsculo e não carrega a área de análise).
  Em `?mock=1` elas só avisam que é demonstração.

### Onboarding (primeira abertura)

- **Regras** em `web/src/lib/onboarding.ts` (testadas): `decideOnboarding` mostra só se **não** foi concluído, a fonte é
  um servidor real (não `?mock=1`, não console simulado), **o histórico está vazio** (`GET /api/sessions?limit=1`) e o
  estado do console é `searching`. `found/receiving/lost` = já achou, pula; `idle` = pula (porta ocupada, o assistente não
  resolveria); espera o primeiro status + a contagem de sessões por até 4 s e, sem resposta, pula (erro ao ler o histórico
  também pula: não incomodar). A decisão é tomada **uma vez** (`useOnboardingGate` em `main.tsx`) e fica travada até o
  usuário terminar. `?onboarding=1` força (para ver/testar); Configurações › Sobre › "Rever o assistente" reabre.
- **Persistência:** `localStorage["gt7.onboardingDone"] = "1"` ao terminar **ou pular** (pular também conta como
  concluído: não reaparece). Cada aparelho decide sozinho (o celular tem outro localStorage; ele só mostra o assistente se
  o histórico estiver vazio e o console ainda não tiver sido achado).
- **Passos** (`components/Onboarding.tsx`, carregado sob demanda): (1) "Vamos achar o seu PS5" com radar animado e o
  status ao vivo + hosts testados; muda **sozinho** para (2) quando o console é achado ("PS5 encontrado ✓", IP/origem,
  QR de `/api/lan` + endereço copiável para pilotar no celular, "Continuar"); (3) "Tudo pronto!" com 4 dicas e o botão que
  vai ao painel ao vivo. "Pular" e `Esc` em qualquer passo. Passando de **40 s** sem achar aparece o checklist de ajuda
  (PS5 ligado/mesma rede, jogo numa pista, firewall com a mensagem e os comandos que o servidor já fornece em
  `status.firewall`, nenhum outro programa de telemetria) com "Procurar de novo" e, só como último recurso, "informar o IP".
- Respeita `prefers-reduced-motion`. O texto de status do passo 2 acompanha o estado: "Aguardando o jogo" (`found`),
  "Recebendo telemetria", "Sinal perdido…".

### Configurações (`#/config`)

Seções em linguagem simples, âncoras `conexao`, `celular`, `dispositivos`, `coach`, `dados`, `mcp`, `sobre` (os antigos
`console` e `lan` continuam funcionando como alias). Avançado fica em `<details>`:
- **Conexão com o PS5:** painel de conexão (item acima), "Formato do pacote: automático (recomendado)" ligado a
  `liveFormatAuto` (o interruptor só liga: para fixar um formato abre-se "Avançado", onde o rádio "Automático" volta),
  gravar sessões brutas e referência padrão do delta (mantidos); **Avançado:** fixar formato ao vivo e formato da captura.
  Sumiu o campo permanente "IP do PlayStation" (vive em "Usar outro IP").
- **Celular:** QR + endereços copiáveis + firewall (inalterado). **Aparelhos conectados:** o antigo "Dispositivos".
- **Coach IA:** chave e modelo como antes; esforço e nº de relatórios foram para "Avançado".
- **Seus dados:** caminho real da pasta (de `/api/mcp/info.dataDir`) com botão copiar, aviso de backup e, no modo
  demonstração, a explicação da subpasta `demo`.
- **Integração com IA (MCP):** trechos prontos para copiar; HTTP/Claude Code e Claude Desktop primeiro, o resto em
  "Avançado".
- **Sobre:** versão, porta, token, "Rever o assistente" e o aviso de que não há relação com a Polyphony.
- **Não existe no backend:** tamanho da pasta de dados e "excluir dados de demonstração" (não há endpoint). Por isso essas
  duas coisas **não** foram feitas (nada de botão que não funciona). Pedido ao backend: `GET /api/data/info`
  (`{ dir, bytes, simulator }`) e `DELETE /api/demo-data`.

### Demonstração no navegador (`?mock=1`)

`consoleConnection` simulado: `?mockConn=searching|found|receiving|lost|idle|cycle` (padrão `receiving`; `cycle` percorre
searching → found → receiving → lost a cada 6 s). Fica em `uiStore.mockConnection`, atualizado a 1 Hz por `startMockLink`.
`?mock=1&onboarding=1` mostra o assistente sobre a demonstração.

### MCP stdio

`packages/mcp/src/data-dir.ts` (`dataDirFromArgs`) substitui a função de `stdio.ts`: `--data`/`--data=` > `GT7_DATA` /
`GT7_DATA_DIR` > `resolveDataDir()` de `@gt7/core` (a mesma pasta do app). Foi para um módulo próprio porque `stdio.ts`
abre o banco ao ser importado, o que impossibilita testá-lo. `data-dir.test.ts` cobre a prioridade. README do mcp: `--data`
virou opcional e os exemplos não passam mais `<repo>\data`. O backend ainda gera os trechos de `/api/mcp/info` com
`--data <pasta>` explícito (continua válido, só é redundante).

### Verificado e não verificado

- Verificado no navegador embutido (Vite dev + servidor real com pasta de dados temporária e o **PS5 real** na rede,
  que foi achado sozinho): chip nos estados `searching/found/receiving/lost`, painel (validação do IP, "Procurar de novo"
  real), tela cheia "sinal perdido", Configurações completas, assistente (passo 1 em mock, passo 2 com QR real, checklist
  após 40 s), 375 px sem overflow horizontal no painel ao vivo.
- **Não verificado:** o disparo automático do assistente contra um servidor realmente em `searching` (o PS5 do teste
  respondia na hora; a regra está coberta só por teste unitário); "Voltar ao automático" e "Usar outro IP" contra o
  servidor real (só a validação); celular real/PWA; leitor de tela.
- Limitação conhecida: o chip do painel ao vivo divide a linha com o selo "Demonstração" e, em telas bem estreitas, encosta
  nos pontinhos de paginação.


## Onda 7b — app desktop (Electron)

Meta: depois do `npm start`, um aplicativo que o usuário só abre. Pacote novo `packages/desktop` (`@gt7/desktop`);
o servidor ganhou uma função programática e o `main.ts` virou uma CLI fina em cima dela.

### Electron, não Tauri

O backend é Node (UDP, `node:sqlite`, Fastify, MCP). Tauri exigiria reescrever tudo em Rust ou embutir e supervisionar
um Node à parte (mais peças, mais uma fonte de erro). Com Electron o servidor roda **no próprio processo principal**,
com o mesmo código do `npm start`. O custo é o tamanho (~110 MB por instalador), aceito.

### Viabilidade (verificada, não presumida)

- **Electron 45.2.3** (a estável mais recente em 2026-11) embute **Node 24.22.2** (Chromium 156) e `require('node:sqlite')`
  funciona **sem flag** no processo principal (SQLite 3.53.4, `journal_mode=wal`, UDP `dgram` também). Testado instalando o
  Electron e rodando um script mínimo; depois confirmado de ponta a ponta no app empacotado (o banco abre em
  `%APPDATA%\Bono Engineer` com `-wal`/`-shm`). Por isso **não** foi preciso o plano B (servidor como processo filho
  com outro Node). Se uma versão futura do Electron voltar a embutir um Node sem `node:sqlite`, o plano B é
  `utilityProcess`/`child_process` com o Node do sistema; a API `startServer` já isola o servidor para isso.
- A versão do Electron está **fixa** (`45.2.3`, sem `^`): o electron-builder exige versão exata, e um Electron novo
  pode trocar o Node embutido.
- **Sem `tsx` em produção:** `scripts/build.ts` gera **um bundle CJS** (`dist/main.cjs`, ~5 MB) com esbuild, juntando o
  processo principal, `@gt7/server` e todos os pacotes do workspace (que exportam `.ts`). `import.meta.url` (usado só em
  `config.ts` para achar a raiz do repositório, irrelevante no app) é trocado por um shim. esbuild é JS puro, sem
  compilação nativa. O painel (`packages/web/dist`, compilado se faltar/estiver velho, com a mesma regra do `npm start`)
  é copiado para `dist/web`, e o servidor o serve de dentro do `app.asar` (testado).
- **Dependência nativa única: `@resvg/resvg-js`** (PNG dos gráficos do MCP; binário pré-compilado por plataforma, aqui
  `@resvg/resvg-js-win32-x64-msvc`). Decisões: (1) fica **fora** do bundle e `asarUnpack: **/node_modules/@resvg/**`
  o entrega em `app.asar.unpacked` (um `.node` não carrega de dentro do asar); (2) o import é trocado por
  `src/resvg-lazy.ts`, que só carrega o módulo real no 1º uso — se ele não carregar numa máquina, só o gráfico PNG do
  MCP falha (erro normal da ferramenta), o app abre. Verificado: no `.exe` empacotado (modo `ELECTRON_RUN_AS_NODE`)
  `createRequire(<asar>/dist/main.cjs)('@resvg/resvg-js')` carrega e renderiza um PNG. Limite: o pacote é só
  **win32-x64** (o pacote de plataforma é uma `optionalDependency` instalada só para a máquina atual).

### `startServer` (servidor)

- `packages/server/src/run.ts` (novo): `startServer({ config, prepare?, startRuntime?, runtimeOverrides?, appOverrides? })` faz
  o que o `npm start` fazia sem o terminal: escolhe a porta (`pickPort`) **ou anexa** a uma instância do mesmo modo que
  já responde, cria o app, escuta, sobe o console falso (demo) e o runtime UDP, checa o firewall. Devolve
  `{ attached, config, port, url, portNote, server, demo, warnings, stop() }` (`stop` idempotente). Falhas →
  `StartServerError` (`kind`: `port-busy` | `data` | `listen`) com mensagem em pt-BR. Exportada de `@gt7/server`.
- `main.ts` agora só: lê a config, migra dados antigos, passa `prepare` (compilar o painel, só quando vai subir um
  servidor de verdade), imprime banner/avisos, trata sinais, Vite e navegador. Comportamento do `npm start`/`demo`/`dev`
  mantido (testado à mão: demo sobe, segunda abertura "já está aberto" e sai com 0, porta explícita ocupada sai com 1). Mudanças
  de texto: as mensagens de erro de inicialização saem como `Erro: <mensagem>` (antes havia três redações próprias).
- Teste de rede `server/src/run.test.ts` (portas 49900+): sobe e responde com o cabeçalho de identidade, `stop`
  idempotente, pula porta ocupada e explica, **anexa** a instância existente sem chamar `prepare`, erro amigável com
  porta explícita ocupada.

### O app (`packages/desktop`)

- **Instância única** (`requestSingleInstanceLock`): a 2ª abertura sai e a 1ª só mostra/foca a janela. **Anexar**: se um
  `npm start` (mesmo modo `real`) já ocupa a porta, o app usa esse servidor; "Sair" não o encerra. É o único jeito seguro:
  dois servidores brigariam pela UDP 33740 e pelo mesmo banco. O app **não** é "demo".
- **Dados na pasta do usuário** (`defaultDataDir()` de `@gt7/core`, a mesma do CLI); a pasta `userData` do Electron foi
  movida para `%LOCALAPPDATA%\Bono Engineer` (mac: `… Desktop`, Linux: `~/.config/bono-engineer-desktop`) para que
  nenhum cache do Chromium caia na pasta de dados. Como o servidor usa `parseConfig`, `GT7_DATA`/`GT7_PORT`/`GT7_PS_IP`/
  `GT7_TOKEN`… continuam valendo (útil para testar com dados isolados).
- **Janela:** `BrowserWindow` sem menu (`removeMenu`, atalhos F5/Ctrl+R/F11/zoom tratados à mão), título fixo "GT7 Race
  Engineer" (o `<title>` do painel não o troca), tamanho/posição/maximizado salvos (`desktop-state.json`, regra pura em
  `window-state.ts`: sem posição se o monitor sumiu, tamanho limitado à maior tela). Abre na hora a tela "Iniciando…"
  (HTML local, sem script/rede) e troca pelo painel quando o servidor responde; falha → página de erro em pt-BR
  com **Tentar de novo** / **Fechar o app** (links `bono-app://retry|quit`, interceptados no `will-navigate`, sem preload).
  Endereço aberto: `http://127.0.0.1:<porta>/` (a porta que o servidor escolheu). Efeito colateral: o `localStorage` do
  painel é por origem (inclui a porta); se a porta mudar entre execuções, as preferências visuais locais recomeçam.
- **Bandeja:** fechar a janela só a esconde (aviso único "continua em segundo plano"); menu: *Abrir*, *Copiar endereço do
  celular* (`lan.preferredUrl()`, ou `lanUrls[0]` de `/api/status` quando anexado; atualiza a cada 30 s), *Iniciar com o
  Windows* e *Sair*. "Sair" para o servidor (UDP, banco) com limite de 6 s e termina o processo. **Iniciar com o Windows**:
  desligado por padrão, `setLoginItemSettings` com `--hidden` (abre só na bandeja); no pacote portátil registra o caminho
  real do `.exe` (`PORTABLE_EXECUTABLE_FILE`, não a pasta temporária); desabilitado no modo de desenvolvimento.
- **Segurança:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, **sem preload**; `will-navigate` só
  admite o próprio servidor (loopback + porta exatos, `isInternalUrl`), todo o resto cancela e, se for http(s), abre no
  navegador do sistema (`shell.openExternal`, nunca `file:`/`javascript:`/protocolos exóticos); `window.open` negado
  (idem); `webview` bloqueado; permissões negadas exceto tela cheia e escrita na área de transferência, e só para o
  próprio servidor. O guarda de origem do servidor (mesmo host na `Origin` e no `Host`) continua válido: a janela e o
  servidor usam `127.0.0.1`. Service workers e cache storage são limpos a cada abertura (o painel registra um SW de PWA
  para o celular; no app só arriscaria servir uma versão antiga após atualizar).
- **Ícone:** gerado por `scripts/icons.ts` (SVG de velocímetro nas cores do painel → `@resvg` → `icon.png` 512,
  `tray.png` 32 e `icon.ico` 16…256 com entradas PNG, montado à mão). O `.ico` é embutido no `.exe` (verificado: ícone,
  nome de produto e versão corretos).
- **Log:** `%LOCALAPPDATA%\Bono Engineer\logs\desktop.log` (1 MB, rotaciona para `.old`), pois o app empacotado não
  tem console. Exceções soltas são registradas e ignoradas, como no CLI.

### Empacotamento

- `npm run desktop` (dev: compila e abre o Electron), `npm run desktop:build` (só o bundle), `npm run desktop:dist`
  (electron-builder). O `desktop`/`desktop:dist` baixam o binário do Electron se o `npm install` o pulou (aconteceu aqui:
  `node node_modules/electron/install.js` resolve, e os scripts já fazem isso).
- **Alvos:** NSIS "um clique", **por usuário** (`perMachine: false`, `allowElevation: false`: sem UAC), e `portable`. Sem
  assinatura de código (`CSC_IDENTITY_AUTO_DISCOVERY=false`): o SmartScreen avisa na 1ª vez. O electron-builder 26 empacotou sem
  precisar do `winCodeSign` (que falha sem privilégio de symlink no Windows), ou seja, **funciona sem modo desenvolvedor**.
  `deleteAppDataOnUninstall: false`: desinstalar nunca apaga o histórico.
- Tamanhos medidos (gerados nesta máquina): instalador **~110 MB** (115,2 milhões de bytes), portátil **~100 MB**, `win-unpacked` ~330 MB
  (Electron 238 MB + asar ~6 MB). `electronLanguages` reduzido a pt-BR/en-US.
- O pacote portátil leva ~15–25 s na primeira abertura (extrai ~330 MB para a pasta temporária); o instalador é a
  forma recomendada.

### Testes e verificação

- Vitest (unitários, sem Electron): `desktop/src/{paths,window-state,pages,state-file}.test.ts` (pastas por plataforma,
  endereço, `isInternalUrl` com sósias de domínio/esquemas, ações da página de erro, janela fora da tela, HTML escapado, arquivo de estado
  corrompido) + `server/src/run.test.ts` (rede).
- **Verificado manualmente** (Electron em modo dev **e** o `.exe` empacotado, com `GT7_DATA`/`LOCALAPPDATA`/`APPDATA`
  isolados, controlado por DevTools Protocol em `--remote-debugging-port`): servidor sobe e `/api/status` responde; janela
  abre no painel (captura de tela conferida); `process`/`require` indefinidos na página; título fixo; fechar (WM_CLOSE) esconde e o
  servidor continua; 2ª instância sai e traz a janela; porta ocupada por outro programa → página de erro, **Tentar de
  novo** repete, **Fechar o app** encerra; anexar a instância existente; "Sair" encerra o servidor e o processo; dados caem em
  `%APPDATA%\Bono Engineer`; `@resvg` carrega do `app.asar.unpacked`; `npm run demo`/`npm start` seguem como antes.
- **Não verificado:** o ícone e o menu da **bandeja** (não há como enxergá-la sem controle da tela; o código só foi
  exercitado até a criação do `Tray`), o balão de notificação, *Copiar endereço*, *Iniciar com o Windows* (registro de login),
  a instalação/desinstalação do instalador NSIS (não instalei para não alterar o sistema do usuário), o ícone do atalho
  instalado, a abertura em outras plataformas (mac/Linux: o código evita o que é só-Windows, mas só há alvo Windows), o
  comportamento com o console real (o app só empacota o que já existia), SmartScreen real, antivírus.
- **Pendência/risco:** o servidor roda no processo principal do Electron (que também cuida das janelas); sob carga
  extrema do servidor, mover para `utilityProcess` isolaria a interface (a API `startServer` permite). Atualização
  automática não existe (reinstalar por cima).


## Onda 8a — captura automática

Pedido: o app fica aberto (PC/bandeja) e **ninguém volta ao PC para "iniciar uma sessão"**. O início automático já
existia (o motor abre a sessão quando `carOnTrack && !paused`); esta onda **auditou e endureceu** esse comportamento
para uso sem supervisão e o tornou **visível**. Sem botão de iniciar. Código: `core/src/live/live-engine.ts`,
`core/src/runtime/runtime.ts`, `core/src/store/store.ts`; testes novos em `core/src/live/session-lifecycle.test.ts`,
`core/src/runtime/capture.test.ts` e o bloco "automatic session capture" de `core/src/runtime/runtime.test.ts` (UDP,
FakeConsole).

### Regras de sessão (decididas e testadas)

- **Abre** no 1º pacote com o carro na pista e sem pausa. **Fecha** (motivo no evento `sessionEnded`, 2º argumento
  `{ reason, persisted }`): `silence` (sem pacotes), `offTrack` (fora da pista/pausado/carregando), `carChange`,
  `trackChange`, `mode` (replay ligou/desligou ou o interruptor mudou) ou `manual` (`endSession()`, encerramento do app).
- **Mesma sessão ou nova (item c).** Reiniciar corrida/prova de tempo, voltar aos boxes, ir ao menu, pausar ou perder o
  sinal **por menos de 10 min** (`sessionIdleEndMs`, antes 60 s) mantém **a mesma sessão** se o carro e a pista forem os
  mesmos. Passou de 10 min fora da pista/pausado/sem sinal → fecha, e a próxima vez é sessão nova. Escolhi **10 min** (o
  pedido dava esse número como exemplo) porque cobre um reinício, um menu de ajustes e um "vou pegar uma bebida" sem
  partir a sessão, e ainda fecha sozinha uma sessão esquecida. Um único limite vale para pista, pausa e silêncio. O fim da
  sessão é carimbado no **último instante em que o carro esteve na pista** (ou no último pacote, no silêncio), não na hora
  em que o app percebeu.
- **Troca de carro (d):** sessão nova na hora (já funcionava; o fim agora usa o instante certo).
- **Troca de pista (d) — estava errado e foi corrigido.** Com o mesmo carro e menos de 60 s de intervalo o motor mantinha a
  pista anterior como "confirmada" e **atribuía as voltas da pista nova à antiga** (a identificação só rodava enquanto a
  pista não estava confirmada). Agora, depois de uma **quebra** (fora da pista ≥ 2 s, silêncio ≥ 5 s ou reinício do
  contador de pacotes), a próxima volta tem de provar a pista: (1) na largada de uma volta cronometrada procura a pista pela
  posição/direção da linha (`findTrackByStart`); se achar **outra pista conhecida**, fecha a sessão e abre outra
  (`trackChange`); se a linha não bate com nada conhecido, esquece a pista ativa (nada de delta/setores errados) e deixa a
  identificação para o fim da volta; (2) ao fechar a volta, a identificação pela geometria roda de novo e, se a pista for
  outra que a da sessão, a volta já nasce na **sessão nova** (a anterior é fechada na última volta dela). Limite: com pista
  **nunca vista**, a gravação bruta (`.gt7rec`) da 1ª volta fica na sessão antiga (a nova começa depois dela); as voltas e
  os dados ficam certos.
- **App aberto no meio da volta (b):** a volta em andamento nunca é gravada (só voltas cronometradas desde a linha entram
  no banco), então não contamina melhor volta, médias, combustível nem consistência. Já funcionava; agora, além disso, essa
  volta de entrada **não acumula amostras na memória** (antes enchia o buffer até 30 min de pacotes).
- **Pausa (e):** não fecha a sessão (até o mesmo limite de 10 min). Nova medida **`trackTimeMs`** = tempo de pista
  realmente dirigido (soma dos intervalos entre pacotes "correndo", cada passo limitado a 1 s): pausa, menu, garagem e
  silêncio não contam. Fica em `Session.trackTimeMs` (opcional, aditivo; migração v3 `track_time_ms`) e no status ao vivo.
- **PS5 em repouso / jogo fechado / Wi-Fi (f):** o motor só percebia o silêncio no **próximo pacote** (a sessão podia ficar
  horas "aberta"). Agora `LiveEngine.tick(now)` roda a cada 5 s (timer do runtime, `unref`, parado no `stop()`) e fecha a
  sessão quando o silêncio passa de 10 min, com fim no último pacote; as voltas completas já eram salvas a cada volta.
  Reconexão depois de horas (contador de pacotes recomeça) abre sessão nova sem travar (testado com FakeConsole).
- **Replay (g) — a detecção abaixo foi substituída na Onda 9a (o app agora detecta o replay sozinho):** não cria sessão de piloto **como antes**: durante a captura de referência o motor está em modo replay
  (sessão `replayCapture`, voltas marcadas `replay`, fora dos recordes pessoais). **O app não detecta replay sozinho** (o
  jogo não o sinaliza de forma que eu possa verificar sem console): um replay assistido sem captura continua parecendo uma
  sessão normal. Decisão: não inventar uma heurística que possa jogar fora corridas reais. O estado `replay` do chip só
  aparece durante a captura de referência.
- **Sessão sem volta completa (h):** é **descartada** quando fecha (linha do banco + gravação bruta). Decisão: um histórico
  sem "sessões fantasmas" vale mais que o registro de que você passou 2 min numa pista sem fechar uma volta. O descarte é
  feito pelo runtime depois de fechar a gravação (`afterSessionEnded`), nunca durante a sessão (que aparece como "em
  andamento" até acabar). `whenAnalysisIdle()` agora também espera essa limpeza.
- **Encerramento à força (i):** `Gt7Store.recoverOpenSessions()` (chamado em `Gt7Runtime.start()`, antes de abrir a porta
  UDP) fecha as sessões com `ended_at` nulo na hora da última volta salva e remove as que não têm volta (e a gravação). Não
  toca na sessão que o próprio runtime está gravando. O MCP (que cria um `Gt7Runtime` sem `start()`) não mexe nelas.
- **Memória e disco em sessões longas (j):** (1) voltas de entrada/saída (não cronometradas) não guardam amostras; (2) uma
  volta cronometrada que nunca fecha continua limitada a `maxLapSamples` (30 min); (3) a gravação bruta guarda no máximo
  2 pacotes/s **enquanto pausado** e **para ao passar de 300 MB descompactados** por sessão (`maxRecordingBytes`, ~4 h;
  avisa uma vez; as voltas seguem sendo salvas); (4) os acumuladores da sessão (combustível, melhores setores) são
  limitados. Não medi o uso de memória do processo em horas reais (só os limites acima, em teste).

### Interruptor "Gravar sessões automaticamente"

- Configuração `autoCapture` (settings, **padrão ligado**), `GET/PATCH /api/settings` (`autoCapture` booleano),
  `Gt7Runtime.setAutoCapture()`. Desligar **fecha a sessão aberta** (e a salva, se estava sendo salva) e, daí em diante, o
  motor roda com `EphemeralContext`: leitura vai ao banco (recordes, referência do delta, pistas conhecidas), **escrita
  fica em memória** — nenhuma sessão, volta, trace, gravação, pista nova nem detecção de curvas. O painel ao vivo segue
  igual (delta, setores, nome da pista, voltas). Capturas de referência (ação explícita) **continuam sendo salvas**.
- É independente de "Gravar sessões brutas" (`record`), que só decide se o `.gt7rec` é escrito.

### Visibilidade

- **`ServerStatus.sessionCapture`** (e `/api/status`): o pedido chamava o bloco de `capture`, mas esse nome **já é** a
  captura de referência (replay); ficou `sessionCapture`, como `consoleConnection` na Onda 6a. Campos:
  `state: 'waiting'|'recording'|'paused'|'replay'|'idle'`, `enabled`, `sessionId`, `since`, `lapsDone`, `carCode`, `hint`
  (pt-BR) e, além do pedido, `trackName`, `bestLapMs`, `trackTimeMs` e `detail` (`paused|offTrack|noSignal`, só em
  `paused`). `idle` = telemetria parada ou interruptor desligado. Republicado a cada volta, abertura/fechamento de sessão e
  a cada `stats` (1 Hz).
- **Mensagem WS `sessionSaved`** (`SessionSavedMessage`: sessão, pista, carro, voltas, melhor volta, início/fim) quando uma
  sessão **com voltas** de piloto fecha (não para replays nem sessões descartadas). O hub só a repassa.
- **Web:** `components/CaptureStatus.tsx` + `styles/capture-status.css` + `lib/captureStatus.ts` (lógica pura testada). Chip
  ao lado do chip do PS5: na análise (rodapé da barra lateral e topo no celular) é **link** para a sessão em andamento; no
  painel ao vivo é **só leitura** (decisão: nenhum toque acidental troca de tela enquanto se pilota; tem `data-no-gesture`).
  Ponto verde pulsando só em "gravando" (respeita `prefers-reduced-motion`). Aviso "Sessão salva: Pista X, N voltas, melhor
  1:23,456 — ver" (tempo no formato pt-BR do app, com vírgula) some sozinho em 15 s, tem × e não exige clique; no painel ao
  vivo fica no topo (longe dos gestos), na análise no canto. Em `?mock=1` o chip diz "Demo · não grava". Montagem: poucas
  linhas em `Chrome.tsx` (`SourceBadge`), `AnalysisApp.tsx` (`ConnectionPill` e o aviso) e `net/connection.ts`.
  Configurações ganhou a seção **Captura** (só o interruptor).

### Não verificado

- **Console real:** nada desta onda foi visto com um PS5. Tudo usa o gerador sintético e o FakeConsole (UDP local). Dependem
  do jogo real: quais flags o GT7 manda em menu/garagem/pausa/replay (assumi `carOnTrack` falso no menu e `paused` na
  pausa, como o gerador e a Onda 1), se a pausa mantém os pacotes chegando, e como o `lapCount` se comporta em provas com
  volta de aquecimento.
- Detecção de replay sem captura (ver acima).
- Memória do processo após horas de sessão (só os limites foram testados).
- O aviso "Sessão salva" no celular real e na PWA instalada.


## Onda 8b — catálogo de carros e logos

Objetivo: nunca mais procurar "Carro 1234": lista completa de carros do GT7 por marca, com logo, no histórico.

### Dados do catálogo

- **Fonte:** [ddm999/gt7info](https://github.com/ddm999/gt7info), `_data/db/{cars,maker,country,cargrp}.csv` (dados extraídos do
  jogo pela comunidade). **Licença: MIT-0** (conferi o arquivo `LICENSE` do repositório: permite usar, copiar, modificar e
  distribuir sem atribuição). Coletado em **2026-11-09**, commit `2648c847f1021be69b67430e65e2246098383e66` (branch `web-new`).
  Mesmo assim ficam só **fatos** (id, nome oficial, marca, país, grupo, ano) e a fonte citada no README e em `CARS_SOURCE`.
- **Arquivo:** `packages/shared/src/cars/data.ts` (gerado, tuplas compactas; ~31 KB) + `catalog.ts` (funções puras:
  `getCar`, `carName`, `carLabel`, `describeCar`, `searchCars`/`searchMakers` sem acento, `groupUsageByMaker`…).
  Uma única linha nova em `shared/src/index.ts` (`export * from './cars/index.ts'`). O app não depende de rede.
  Gerador: `packages/shared/scripts/gen-cars.mjs` (fixa o commit; `--ref`/`--from`; recusa dados inconsistentes).
- **Contagem real:** **590 carros** e **82 marcas na fonte, 77 listadas** (5 marcas da fonte não têm nenhum carro e são
  omitidas: Fittipaldi Motors, GT Awards (SEMA), Renault Sport, SRT, Willys).
- **Nome:** o oficial em inglês da fonte, com o sufixo de ano (`A110 '17`). `baseName` tira o sufixo; `year` é derivado do
  sufixo (`'00–'26` = 2000–2026, `'27–'99` = 1927–1999; o carro mais antigo é de 1929). 163 carros não têm ano no nome.
  Citroën é exibido com trema; o resto segue a fonte. Países em pt-BR (tabela de 20 códigos no `catalog.ts`).
- **Grupo:** `1,2,3,4,B,N,X` como na fonte (exibidos `Gr.1`… `Gr.N`, `Gr.X`); **83 carros não têm grupo** na fonte e ficam
  sem badge (não inferi pelo nome). As classes por PP (N100…N1000) **não** estão nesses CSV (só em `stockperf.csv`, não
  usado): ficam fora.
- **Suposição:** o `carCode` da telemetria é o `ID` de `cars.csv` (confere com o demo: 3337 = Alpine A110 '17; e é o uso
  conhecido da comunidade), mas **não foi conferido com um console real**. Observação da fonte: "McLaren F1 GTR Race Car '97"
  está sob a marca BMW (id 6); mantive o dado como veio.
- Carro fora do catálogo: `carLabel` devolve `Carro #1234`; na UI aparece o balde "Fora do catálogo" (marca pseudo `-1`).

### Logos

- `simple-icons@16.37.0` (**devDependency do web**, arquivos CC0-1.0) → `packages/web/scripts/gen-brand-icons.mjs` copia só o
  `path` (24×24) para `packages/web/src/brands/brandIcons.ts`: **sem dependência em runtime**, sem arquivos de imagem, preenchido
  com `currentColor` sobre um ladrilho escuro (legível no tema escuro).
- **36 marcas com logo real, 41 com monograma** (iniciais num círculo; matiz derivado do nome, luminosidade fixa para manter o
  contraste). Sem logo no `simple-icons` (verificado): Alfa Romeo, Alpine, Dodge, Jaguar, Lancia, Lexus, Mercedes-Benz (removido do
  pacote; usei o logo "AMG" só para a marca AMG), Pagani, Genesis, Daihatsu, NISMO, Shelby, TVR… Não desenhei nenhum logo à mão.
- Logos são marcas registradas dos donos, usadas só para identificar o carro (nota no README).

### UI (`packages/web`)

- `CarFilterField` (botão "Carro") + `CarPicker` (folha modal via portal; no celular ocupa 92 % da altura): passo 1 = grade de
  marcas (abas "No meu histórico" em destaque, com contagem de voltas, e "Todas as marcas do jogo"); busca no passo 1 acha
  marcas e carros ao mesmo tempo (até 60); passo 2 = lista de carros da marca (nome, ano, grupo, badge "x voltas", "Só os que
  eu já usei", "Todos os carros da <marca>"). Estado de busca vazio com mensagem e "Limpar a busca". Esc/✕ fecham.
- Filtro = `{ makerId, carCode }` (`lib/carFilter.ts`, puro e testado), guardado em `localStorage["gt7.carFilter"]` (try/catch via
  `lib/storage.ts`, validado ao ler). Aplica em: cartões da Início (que passam a falar só dos carros filtrados: melhor volta,
  voltas, sessões), Todas as sessões (um `?car=` na URL ainda vale), melhores voltas e sessões da página da pista. Chips removíveis
  (alvo de 44 px) + "Limpar filtros". O select de carro da aba Evolução ficou como estava (texto via `carLabel`).
- `CarName` (logo pequeno + nome) substitui "Carro 1234" nos cartões, sessões, voltas, comparação, captura e referências.
  `labels.carLabel` (texto) usa o catálogo, depois o nome informado, depois o código.
- Painel ao vivo: a tela **Motor** mostra a marca e o nome do carro ao lado de "RPM" (só texto, sem logo; vazio se o carro for
  desconhecido). `?mock=1` e os gestos não foram tocados.
- Celular (375 px): grade de 3 colunas (110×112 px por marca), rolagem vertical própria (`overscroll-behavior: contain`), todos os
  botões do seletor ≥ 44 px (medido), sem overflow horizontal.

### Servidor / MCP

- `GET /api/tracks/overview`: `best`, `cars[]` e `trend` ganham `carName` e `makerName` (null se desconhecido); `carCode` continua.
- MCP: `carFields(code)` em `format.ts` acrescenta `car_name`/`car_maker` (só quando conhecidos) ao lado de `car` em voltas,
  sessões, recordes por carro, referências, comparação, evolução e `get_live_state`; o prompt de debrief e o contexto do coach
  trazem o nome do carro com o `carCode`.

### Testes e verificação

- `shared/src/cars/catalog.test.ts` (integridade: ids únicos, marca existente, nomes não vazios, ≥ 400 carros, busca sem acento,
  desconhecidos, agrupamento por marca com voltas), `web/src/brands/brandLogos.test.ts` (toda marca tem logo ou monograma, sem logo
  órfão, iniciais), `web/src/analysis/lib/carFilter.test.ts`, caso novo em `history.test.ts`, `mcp/src/format.test.ts`, caso novo em
  `server/src/tracks-overview.test.ts`.
- **Verificado no navegador embutido** (servidor real em outra porta, pasta temporária semeada com 14 sessões de 12 carros reais + 1
  desconhecido): seletor em duas etapas, abas, busca sem acento ("SÚPRA rz"), estado vazio, escolha de carro, chips, persistência,
  filtros em Início/Sessões/Pista, nome do carro na página da sessão, em 1280 px e 375 px (no 375 px por medições de DOM, pois as
  capturas do viewport emulado vinham cortadas).
- **Não verificado:** a tela Motor com o nome do carro (o `requestAnimationFrame` do painel embutido ficou bloqueado, então o painel
  ao vivo não renderiza lá; só typecheck), toque real/rolagem fluida em celular de verdade, leitor de tela, o `carCode` real do
  console, e a aparência de cada um dos 36 logos em tamanho pequeno (vistos só alguns). Nome em português dos carros não existe
  na fonte (só inglês).


## Onda 9a — replay real

Problema medido no PS5 do usuário (formato `~` e também `B`): **durante um replay** o jogo manda os dados do carro (velocidade,
rpm, marcha, pedais, posição x/y/z coerente com a velocidade, G, pneus) a ~60 Hz em tempo real, **mas** `carOnTrack` é falso (os
flags só trazem `inGear`/`revLimiterAlert`), `currentLapMs` = 0, `lastLapMs`/`bestLapMs` vazios e `lapCount` fica em 0 (parado) ou 1
(rodando) sem avançar; o formato `B` entrega o mesmo. Efeito no app: o motor classificava tudo como `menu` (o painel dizia "No
menu") e a captura de referência **nunca começava** (esperava voltas completas do motor). A Onda 8a tinha decidido "não detectar
replay sozinho"; com o quadro real medido, a decisão mudou. Código: `core/src/live/live-engine.ts`,
`core/src/capture/reference-capture.ts`, `core/src/runtime/runtime.ts`, `protocol/.../synthetic/session.ts`,
`server/src/routes/capture.ts`, arquivos pontuais em `web/`.

### 1. Detecção de replay no motor

- Um pacote é "dado de carro de replay" (`carData`) se: `carOnTrack` falso, não está carregando nem pausado, `carCode != 0` e a
  posição não é (0,0,0). É **replay em reprodução** (`ReplayKind 'playing'`) se, além disso, `speed > 2 m/s` e a posição **muda**
  (menos de 4 pacotes seguidos com a mesma posição). Estado de conexão `replay` (já existia no tipo `ConnectionState`).
- Efeitos: **nenhuma sessão de piloto é aberta**, o tempo de pista não conta, nada é gravado nas voltas do piloto (a volta cronometrada
  em andamento, se houver sessão aberta, é descartada como `leftTrack`; ao voltar à pista começa uma volta nova). Os frames ao vivo
  seguem normalmente (velocidade, pedais, mapa) com `state: 'replay'`.
- **Pausa/rebobinar/avanço do replay** (a posição para ou salta): o replay fica `stalled` por até 3 s (o estado não pisca) e depois
  cai para `menu`; para a captura, ver abaixo. **Menu/garagem** (pacotes zerados, `carCode` 0) continua `menu`; o **quadro congelado
  com `carOnTrack` ligado** (8a) continua sendo pausa. Carro parado antes do replay começar (speed 0, posição constante) é `menu`.
- Novo evento `LiveEngine 'packet'` (`EnginePacketInfo`: pacote, `receivedAt`, `dPk`, `recvGap`, `carData`, `replay`, `samePosition`,
  `msPerPacket`, g) montado só se alguém escuta; é por onde a captura segue o fluxo bruto. `captureInfo.replay` agora é "replay
  detectado ou modo replay legado"; `setReplayMode` continua existindo (testes de ciclo de vida), mas **a captura não o usa mais**.
- `sessionCapture.state === 'replay'` (chip) agora aparece **sozinho** durante qualquer replay, com a dica "Replay detectado — não
  conta como sessão." (e, com captura armada, "…captura de referência em andamento…").

### 2. Captura de referência por geometria (reescrita)

Não depende mais de `lapCount`, `currentLapMs`, `carOnTrack` nem de voltas do motor.
- **Pista:** `trackId` opcional no `POST /api/capture/start` (validado: 400 se não existe) ou descoberta pela posição: para cada
  pista conhecida (com linha central) mede-se a distância do carro à linha central (busca completa, 1 de cada 3 pacotes em
  movimento); trava quando ≥ 90 % das últimas ≥ 30 medidas ficam a ≤ 20 m; se várias, a de **menor distância média**. Sem
  nenhuma após ~60 medidas (≈ 3 s em movimento) ou sem pistas: `waiting: 'unknownTrack'` + dica "Pista desconhecida — dirija essa
  pista ao vivo primeiro…". Longe (> 100 m) da pista travada por 1 s: destrava (ou `track`, se a pista foi escolhida).
- **Linha de largada/chegada:** a origem da linha central (s = 0) é o 1º ponto da volta que criou a pista, ou seja, a linha. O
  progresso do carro é projetado na linha (janela local, desenrolado) e a cada passagem por um múltiplo do comprimento há um
  cruzamento; o instante é **interpolado entre os dois pacotes** (fração do `packetId` e do `receivedAt`). Um replay que começa
  logo depois da linha (≤ 1,5 pacote de percurso, > 36 km/h) também vale (cruzamento estimado por distância/velocidade).
  Observação: o tempo de volta = diferença entre dois cruzamentos **do mesmo ponto**, então um pequeno deslocamento da origem
  (até ~1 pacote) não muda o tempo.
- **Tempo:** `(packetId_fim − packetId_início) × msPerPacket` com pontas fracionárias; `msPerPacket` é o do motor (nominal 16,667,
  calibrado pelas voltas ao vivo). Nunca o relógio do jogo. Medido em testes com jitter de ±4 ms no `receivedAt`: erro ≤ 2 ms na
  geração sintética (o teste exige < 25 ms). No console real o erro esperado é ±1–2 pacotes (≈ ±30 ms) por perda/quantização.
- **Validade:** do cruzamento de largada ao de chegada **sem** pausa (≥ 4 pacotes com a mesma posição ou silêncio > 0,5 s com
  poucos `packetId`), salto (deslocamento > 15 m + 2,5× o alcance pela velocidade), volta atrás ou perda de pacotes enorme (> 1,5 s)
  — essas quebras **descartam a volta em andamento** (`invalid` com `paused`/`discontinuity`) e a captura espera o próximo
  cruzamento. Ao fechar: comprimento ±2 % da pista, perda < 0,5 % e nenhum buraco > 6 pacotes, carro esperado, **velocidade 1×**
  (nova verificação `notRealtime`: velocidade implícita × reportada fora de 0,85–1,15 ou tempo por pacotes × relógio de parede
  com diferença > max(400 ms, 2 %)) e, se digitado, tempo do ranking ±300 ms (`timeMismatch`). Volta inválida **não é gravada**
  (antes ficava como volta de replay comum); a próxima começa no mesmo cruzamento.
- **Tempo do ranking × medido:** o status traz `measuredLapMs`, `rankingTimeMs` e `diffMs` (medido − digitado) mesmo quando
  rejeitada. Se foi digitado e bateu, a volta é salva **com o tempo do ranking** (o oficial, exato) e a coluna de tempo do
  trace é reescalada por `ranking / medido`; `ReferenceMeta.timeSource = 'ranking'`. Sem tempo digitado: aceita e salva o
  medido, `timeSource = 'packets'` ("medido por pacotes"). Em ambos `ReferenceMeta.measuredTimeMs` guarda o medido.
- **Gravação:** sessão própria `replayCapture` (1 volta, `trackTimeMs` 0) + volta `flags: ['replay']`, `isReference` +
  `ReferenceMeta`, com o **mesmo trace** das voltas ao vivo (mesmos canais; `distanceM` alinhado à linha central; forças G do
  estimador do motor; setores por `computeSectorTimes`), então comparação, análise, delta ao vivo ("Top capturado") e MCP
  funcionam. O motor recarrega a referência "melhor da pista" ao fim (`LiveEngine.refreshReference`). Combustível `null`.
- Status (`ReferenceCaptureStatus`, campos novos **opcionais**): `waiting` (`replay | track | unknownTrack | startLine`),
  `replayDetected`, `trackId`, `trackName`, `recordingMs`, `lapFraction`, `measuredLapMs`, `rankingTimeMs`, `diffMs`,
  `timeSource`, `hint` (pt-BR). Códigos de `issues` novos: `notRealtime`, `interrupted` (replay acabou antes de fechar a volta).
  `state` mantém os mesmos valores (`switchingFormat` só aparece com o gancho opcional).

### 3. Sem troca de formato

A captura **não troca mais o formato do pacote** (antes: `B`, espera de ~15 s, restauração). O gancho `enter`/`exit` de
`ReferenceCapture` continua opcional; o runtime só o liga com a opção `switchFormatOnCapture: true` (padrão `false`).
`captureFormat` (configuração/`PATCH /api/settings`) continua existindo mas só vale nesse modo; a UI de Configurações perdeu
o grupo "Formato da captura de replay" (virou uma frase). Também some a dependência do formato `B`, indisponível no Sport Mode
online segundo relatos. Com isso o ciclo automático de formatos já não é pausado durante a captura.

### 4. Interface (pontual)

- Painel ao vivo, estado `replay`: selo **REPLAY** (já existia como "Replay") e um aviso discreto (`ReplayNotice`, acima das
  etiquetas, 2 linhas) com o botão **Capturar esta volta como referência** → `#/captura` (com captura armada mostra a dica
  dela e "Ver a captura"). Os widgets seguem com os dados do replay. (O texto "Volta inválida"/"Volta 1" do cabeçalho do painel
  continua aparecendo no replay: não mexi nos widgets.)
- Chip (`CaptureStatus` + `captureStatus.ts`): "Replay detectado — não conta como sessão" e, com captura armada, "Capturando ·
  aguardando o replay / identificando a pista / pista desconhecida / aguardando linha de largada / gravando volta 0:45 /
  validando" (na análise é link para `#/captura`).
- `#/captura`: três passos curtos (abrir o replay, deixar tocar sem pausar/voltar/avançar a 1×, digitar o tempo do ranking),
  campo opcional **Pista** (lista das pistas conhecidas), progresso (aguardando › linha › gravando 0:45 + barra › validando),
  aviso claro de pista desconhecida e resultado com **medido × digitado × diferença** e a origem do tempo salvo.

### 5. Simulador e testes

- `generateLaps/SyntheticSession` com `replay: true` (e `--sim-replay`) emite agora **como o console real**: `carOnTrack` falso
  (flags só `inGear`/`revLimiterAlert`), `lapCount` fixo em 1, `currentLapMs` 0, `lastLapMs`/`bestLapMs` vazios; com menu, os
  pacotes são zerados (speed 0, posição 0, `carCode` 0, flags 0). `generateLaps` agora corta pelo contador interno da sessão.
- Testes novos/atualizados: `core/src/live/replay-detection.test.ts` (replay × menu × quadro real × parado × congelado × pausa
  × sessão do piloto intacta × evento `packet`), `core/src/capture/reference-capture.test.ts` (reescrito: volta completa com
  erro < 25 ms sem sessão de piloto, tempo digitado aceito/rejeitado + diferença, início no meio da volta, pausa → volta
  descartada e próxima capturada, pausa sem volta limpa depois, rebobinar, não-1×, pista desconhecida, layout diferente,
  `trackId` explícito, replay depois de dirigir), `runtime/capture.test.ts` (runtime: replay detectado + captura sem trocar
  formato), `runtime/runtime.test.ts` (UDP/FakeConsole com gravação de replay: sem `switchingFormat`), `web` (`captureStatus`),
  `server/app.test.ts` (`trackId` inexistente → 400), `analysis/src/test-utils.ts` (as fixtures de replay pegam o número da volta
  de uma sessão gêmea sem replay, pois num replay real o `lapCount` não avança).
- Migração SQLite **v4** (`reference_meta.time_source`, `reference_meta.measured_time_ms`, ambas nulas nas referências
  antigas). Aditiva, mas uma versão **antiga** do app não abre um banco já migrado ("schema mais novo").

### Não verificado com o console real

- Nenhum fluxo foi visto com um PS5: tudo usa o gerador sintético (agora com o formato real dos flags), um quadro real isolado
  (classificado como `replay` em teste) e o FakeConsole local. Não sei: como o replay real **pausa/rebobina/avança** (pacotes
  parados? silêncio? `speed` zerado?) — a detecção cobre posição repetida, silêncio e salto, mas é hipótese; se o replay real
  de Time Trial **começa parado antes da linha** ou **começa exatamente na linha** (o 1º cruzamento pode ser perdido; vale a
  volta seguinte); se `receivedAt` no PC real tem jitter que dispare `notRealtime` (limite 400 ms/2 %); a precisão do tempo por
  pacotes em ~60 Hz reais (±1–2 pacotes esperado); a distância de 20 m na identificação da pista (linha central aprendida de
  uma volta ao vivo vs. a linha do replay do top); se o jogo manda o replay a 60 Hz também em Sport Mode/online.
- A origem da linha central é o 1º pacote de uma volta de piloto; o erro da posição dessa "linha" não afeta o tempo (cruzamentos
  do mesmo ponto), só o início/fim exatos do trecho gravado (≤ ~1,5 m).


## Onda 9c — base de conhecimento de pilotagem

Objetivo: o coach (chat do app e MCP) sugerir ações específicas à **classe do carro** e ao **diagnóstico** medido, com fonte e
honestidade sobre incerteza. Não existe base aberta pronta (confirmado em `docs/pesquisa/frenagem-referencias-e-conhecimento.md`):
tudo foi escrito aqui, resumindo com palavras próprias.

### Estrutura (`packages/shared/src/knowledge/`, TS puro, sem rede, isomórfico)

- `types.ts`, `sources.ts` (16 fontes: URL, editor, data de consulta 2026-11-09, **como foi acessada**), `general.ts` (11 tópicos de
  princípios + conselho por tipo de curva `hairpin/slow/medium/fast/kink/chicane` + regras do coach), `classes.ts` (Gr.1, Gr.2, Gr.3,
  Gr.4, Gr.B, N, X), `diagnostics.ts` (23 códigos), `setup.ts` (regras + 9 sintomas → direção do ajuste), `glossary.ts` (29 termos
  pt-BR/inglês), `index.ts` (`knowledgeFor`, `knowledgeBrief`, `knowledgeIndex`, `knowledgeTopic`, `searchKnowledge`, `knowledgeStats`).
- Tamanho: **46 tópicos**, 131 afirmações com selo de base, 102 textos "por classe" nos diagnósticos; ~84 KB de fonte TS ≈ 70 KB de
  Markdown se tudo fosse impresso. O resumo que vai ao modelo é pequeno: padrão **≤ 6.000 caracteres** (≈ 1.500 tokens), medido em
  3,4 KB no pior caso (23 códigos) e ~2,8 KB só com a classe.
- **Cada afirmação tem um selo** (`basis`): `regra-geral` (princípio de pilotagem/física, não validado no GT7 por este app),
  `depende-do-carro`, `fonte` (resumo de fonte citada) ou `baixa-evidencia`. Contagem das afirmações: 61 regra geral, 28 depende do carro,
  25 de fonte, 17 pouca evidência; nos diagnósticos, 22 de 23 são regra geral e 1 depende do carro (`gearChoice`).
- **Evidência por classe**: Gr.1, Gr.3 e Gr.4 têm um guia público (Coach Dave) + DG-EDGE (física 1.49, balanço de freio): "média".
  **Gr.2 (9 carros), Gr.B (12), N (289) e X (93) não têm fonte de qualidade**: o texto é síntese de princípios gerais e vem marcado
  "pouca evidência" (no guia, na página da classe e no resumo do coach). O catálogo mostra que o grupo "3" também tem GT1/GT500 antigos
  e que "X" mistura Vision GT, clássicos, Super Formula e kart: por isso X não tem receita de classe.
- **Sem pontos de frenagem absolutos**: a base só tem princípios e limiares do próprio app (5 m, 3 km/h, 8 m…). Um teste varre o
  texto todo contra "curva Tn + distância" e "N m antes da curva". O resumo sempre carrega a regra "NUNCA invente pontos de frenagem".
- `knowledgeFor({ carGroup?, carCode?, diagnosticCodes?, trackId?, cornerKind?, maxChars? })`: grupo vem de `carGroup` ou do catálogo
  de carros (`carCode`); grupo desconhecido → só os princípios gerais e aviso. Até 6 diagnósticos (os mais custosos primeiro). Se não
  couber, degrada em 3 níveis (tira causas/treino, depois princípios, depois fontes) e, em último caso, corta numa quebra de linha
  mantendo as regras de uso. `maxChars` tem piso de 1.200. `trackId` só vira um aviso (não há dados por pista).
- Exportação: `@gt7/shared` reexporta só a API (e os tipos) para não poluir o espaço de nomes; os dados ficam no módulo.

### Cobertura de diagnósticos (falha se faltar texto)

- `DIAGNOSTICS` é `Record<CornerFinding['kind'] | LapIssueKind, …>`: **código novo sem entrada = erro de compilação**. Além disso
  `packages/analysis/src/knowledge-coverage.test.ts` lê o código-fonte (`kind: '…'` em `findings.ts` e `validity.ts`) e as uniões de
  tipos de `shared/analysis.ts` e exige texto para cada um. Incluí as 17 findings (inclusive `earlyThrottle`, declarado mas ainda
  **não gerado** pelo app; o texto avisa) e os 6 `LapIssueKind` (dados da volta; sem variação por classe).
- Os diagnósticos de pilotagem têm variação por classe para Gr.1, 2, 3, 4, B e N (teste); X cai no texto geral.

### Coach (servidor)

- **Ferramenta `get_knowledge`** (MCP, logo também do coach: a ponte já expõe toda ferramenta somente leitura). O coach recebe:
  1) no **prompt do sistema** (estático, cabe no prefixo em cache): `COACH_KNOWLEDGE_RULES` = como/quando chamar `get_knowledge` +
  `COACH_RULES` (citar números, adaptar à classe, dizer "regra geral" × "depende do carro", nunca inventar pontos de frenagem
  absolutos, **uma** ação principal por curva e exercício de 5 voltas, avisar se a referência é de outro carro/classe, afinação só como
  hipótese). Nada por requisição no prefixo.
  2) na **mensagem da tarefa** (`debriefTask`/`cornerFocusTask`/`trainingPlanTask`, usados pelo coach e pelos prompts MCP): um resumo
  da classe do carro de ≤ 3.500 caracteres + o passo "get_knowledge(car_code, diagnostics = plan[].code)".
  Decisão: não pré-computar os diagnósticos no servidor para injetá-los no prompt; o modelo já chama `compare_laps` e a resposta passou
  a trazer `plan[].code` (campo novo e aditivo no MCP), então uma chamada `get_knowledge` traz exatamente os diagnósticos presentes.
- `COACH_PERSONA` ganhou as 3 regras (classe, sem pontos absolutos, afinação como hipótese). Rótulo de progresso na UI do coach:
  "Consultando a base de pilotagem".

### MCP

- Ferramenta `get_knowledge` (`topic`, `car_code`, `car_group`, `diagnostics[]`, `corner_kind`, `track_id`, `max_chars` 1.200–8.000):
  sem argumentos usa o carro da sessão mais recente; `topic` ("indice", "gr4", "brakeEarlier", "afinacao", "glossario", "fonte"…)
  devolve a página inteira; tópico desconhecido → erro com o índice.
- Recursos `gt7://knowledge` (índice) e `gt7://knowledge/{+topic}` (template com `+`, porque os ids têm `/`; lista todos os tópicos).
- Prompts `debrief_sessao`, `foco_curva` e `plano_treino` usam a base (passo novo + resumo da classe). README do MCP atualizado.

### UI (`packages/web`)

- Rota `#/guia` (`?q=&classe=&topico=`), página `GuidePage` + `lib/guide.ts` (filtro puro, testado) + `styles/guide.css`. Busca sem
  acento, abas por tipo, filtro de classe (corta as variações dos diagnósticos para a classe e mostra só a ficha dela), bloco "O que o
  coach recebe sobre a classe X" (o mesmo resumo, com o tamanho), fontes com link (`target=_blank`, `noopener`). Aviso fixo sobre
  "regra geral não é lei" e sobre a falta de pontos de frenagem por pista. Reaproveita `Markdown` (sem `innerHTML`).
- Mudança pontual em `AnalysisApp.tsx` (item "Guia" no menu, ícone, `case 'guide'`) e `route.ts`. A barra inferior do celular passou
  de 6 para **7 colunas** (regra em `guide.css`, mais específica que a de `home.css`; itens de 52 px a 375 px, fonte 10,5 px).
  Uma linha em `labels.ts` (rótulo da ferramenta). Verificado no navegador embutido (`?mock=1`, porta 5175; o servidor real não foi
  tocado): 375 px sem rolagem horizontal, filtro por classe, busca, deep-link por hash, links externos. A largura >900 px (barra lateral)
  não foi vista: o painel embutido tinha 658 px.

### Testes

`shared/src/knowledge/knowledge.test.ts` (limite de tamanho no pior caso, classe, grupo desconhecido, índice, busca, fontes e links,
exemplos de carros existem no catálogo e pertencem ao grupo, guarda contra pontos absolutos), `analysis/src/knowledge-coverage.test.ts`,
`mcp/src/knowledge.test.ts` (ferramenta, recursos, `plan[].code`, prompts), `server/src/coach/knowledge.test.ts` (prompt do sistema
estático, tarefa com a base, ponte do coach), `web/src/analysis/lib/guide.test.ts`.

### Não validado / limites

- **Nada disso foi validado em pista nem com o console**: são resumos de guias públicos (lidos pelo pesquisador em 2026-11-09, não
  reabertos agora) e princípios gerais. As fontes `gt-apex` e `gtplanet-forum` só foram vistas por resultado de busca (a primeira é
  renderizada por JS e a outra bloqueou a leitura): marcadas assim em `sources.ts` e a UI manda confirmar à mão.
- Sem fonte para Gr.2, N-classes (o catálogo só tem "N", não N100…N1000), Gr.X e pouca para Gr.B; sem dados de desgaste por composto.
- A direção dos ajustes de afinação vem de Coach Dave/Traxion e do rascunho da pesquisa; não foi testada. O app não lê o setup do carro.
- O modelo pode ignorar a base: nada força a chamada de `get_knowledge` além das instruções (não medi taxa de uso com a API real).
- Caso de teste do usuário (Huracán Gr.4 em Trial Mountain): usado só para conferir a formatação do resumo (Gr.4, `brakeEarlier`,
  `noTrailBraking`…); nenhum dado da sessão real foi embarcado.

## Onda 9b — acervo de pistas

Objetivo: o app reconhecer a pista sozinho (o pacote de telemetria não tem id de pista) e ter os dados oficiais de cada
layout. Base: `docs/pesquisa/pistas-e-corridas-diarias.md` e `docs/pesquisa/frenagem-referencias-e-conhecimento.md`.

### Dados (fontes, licenças, coleta)

- **Coletado em 2026-11-09**, três fontes livres, commits fixos no script `packages/shared/scripts/gen-tracks.mjs`
  (`--from <pasta>` para trabalhar offline; recusa dado inconsistente):
  - `ddm999/gt7info` (**MIT-0**), commit `2648c847f1021be69b67430e65e2246098383e66`: `_data/db/course.csv` e `country.csv`.
    URL conferida: `https://raw.githubusercontent.com/ddm999/gt7info/<commit>/_data/db/course.csv` (o espelho
    `https://ddm999.github.io/gt7info/data/db/course.csv` devolve o mesmo arquivo, 122 linhas). O arquivo mudou pela última vez em
    29/05/2026 (commit `bbc542490ab300518f279efa2786d0e13b28ac97`).
  - `jbhoorasingh/gt7-datalogger-track-data` (**CC0-1.0** nos dados), commit `637aaa379e7b225e53034b9864b6f04f8bf2724e`
    (08/11/2026): `index.json` (122 layouts oficiais, ids hexadecimais, com SUGO) e `signatures.json` (81 linhas a cada 20 m,
    36 gêmeas reversas).
  - `zetetos/gt-telemetry` (**MIT**), commit `96007fc0a1f25ab4bcefe7007e4dca81166667a1` (15/10/2026, jogo 1.72):
    `pkg/circuits/inventory/*.json` (85 circuitos: linha de largada e polilinhas em grade de 16 m).
  - DG EDGE (`sitemaps/tracks.xml`): só as URLs, para **linkar** à página da pista (42 locais). Nenhum conteúdo copiado.
- **Chave do layout = id hexadecimal oficial** (único, 122). O id numérico do gt7info (`courseId`) é campo auxiliar: o
  `course.csv` não tem SUGO (entrou no jogo na 1.72; **id 1340** vem do nome da imagem do DG EDGE, `Track1340.webp`, e é
  marcado no dado com a flag 16), usa ids **fictícios** 2001–2004 para Eiger, Yas Marina e Gilles-Villeneuve (autor no commit:
  "a dummy course id"; flag 8, ignorados por `findTrackLayoutByCourseId`) e uma linha só para *Nürburgring Endurance* e
  *Endurance II* (a segunda fica com `courseId` nulo). As duas linhas "Special Stage Route X 400/1000" do gt7info não são
  layouts da lista oficial e ficaram de fora (122 = lista oficial). Mapeamento csv ↔ oficial por **nome normalizado** e
  conferência de comprimento (0,5 %) e de curvas: sem divergência.
- Campos por layout: id, courseId, local, layout, nome oficial, país (código + nome pt-BR), comprimento oficial, curvas,
  desnível, maior reta, oval, reverso (e de qual layout é o reverso), fictício/real (`type` do index; csv `original` quando
  faltava), ponto de largada. Nada foi inventado: o que faltava ficou `null`.
- **Geometria** (`geometry.ts`): por layout, a linha de corrida **simplificada** (Douglas-Peucker fechado, tolerância de
  1,5 m, subindo até caber em ≤ 200 pontos; mediana de 89 pontos, máximo 298), inteiros em metros com deltas (58 KB). Fonte
  preferida: `signatures.json` (27 de levantamento, 51 de captura); onde não há caminho, a polilinha do gt-telemetry (7).
  **121 de 122** layouts têm linha (os 36 reversos reusam a do normal percorrida ao contrário); *Nürburgring Endurance II* não.
  7 linhas são **capturas truncadas** (medido/oficial < 0,93: Autopolis Short, Barcelona Rallycross, Spa 24h, Fuji Short,
  Nordschleife Tourist, Nürburgring Sprint, Suzuka East) e 9 vêm sinalizadas pela própria fonte (comprimento diverge do
  catálogo): servem de candidato, **nunca** de nome automático. A geometria **não vai para o pacote do navegador** (verificado:
  tree-shaking; só o servidor/core a usam).
- **Não foi embarcado:** nomes de curva (não há fonte aberta), apex das 162 curvas do gt7-datalogger (fica para quando houver
  detecção para comparar), nada do site oficial nem do DG EDGE além de links.

### Verificação do sistema de coordenadas (gravação real)

Sessão real do usuário (`real-session.gt7rec`, cópia só leitura; Trial Mountain, Huracán Gr.4, carro 3253; voltas 1 e 2 completas,
a volta 0 saiu do box). Comparação **direta, sem transformação**:

| Linha de referência | volta 1: ref→dirigida média / p95 / máx | volta 1: dirigida→ref média / p95 / máx | volta 2: ref→dirigida | volta 2: dirigida→ref |
|---|---|---|---|---|
| `signatures.json` (levantamento, 20 m) | 2,45 / 7,0 / 13,4 m | 2,96 / 8,4 / 17,3 m | 2,42 / 6,0 / 11,2 m | 3,54 / 8,9 / 14,9 m |
| gt-telemetry (grade de 16 m) | 8,5 / 18,5 / 30,7 m | 7,2 / 15,4 / 23,0 m | 8,5 / 18,1 / 31,7 m | 7,1 / 15,7 / 23,0 m |

Espelhar x dá erro médio de 86 m, espelhar z 70 m, trocar x/z 305 m: **o sistema é o mesmo** (translação, rotação, espelho e
escala não são necessários). A caixa da gravação (x −962…952, z −397…368) bate com a da assinatura (−976…954, −402…379); o cruzamento
da linha de chegada (145, −16, 303) fica a 17 m do `startLine` do gt-telemetry (128, −14, 304), dentro da grade de 16 m. O gt-telemetry
é mais grosseiro (erro médio 8,5 m contra 2,4 m), por isso o custo é normalizado pela qualidade da fonte (fator 1,8 para "grade").

### Reconhecedor (`packages/shared/src/tracks/match.ts`)

- `matchKnownTrack(volta)`: filtra por comprimento (razão medido/oficial entre 0,93 e 1,03), reamostra a volta a ~8 m e mede, para
  cada candidato, a distância **simétrica** volta→linha e linha(12 m)→volta (média, p95, p99; tolera offset lateral de poucos metros,
  e uma chicane que falta aparece na distância inversa), o **sentido** (avanço líquido da projeção ao longo da linha; separa o
  layout do seu reverso e Tokyo CW/CCW) e a janela de comprimento. Custo = (média + 0,5·p95 + 0,25·p99) ÷ ruído da fonte.
  Confiança *alta* = custo ≤ 15, média ≤ 6,5 m, sentido ≥ 0,8, comprimento na janela, linha completa e não sinalizada.
- **Nome automático só** com confiança alta **e** o segundo candidato com custo ≥ máx(2× o melhor, melhor + 8 m). Empates (custos
  a 10 %) desempatam pela distância à linha de largada. Candidatos abaixo de *alta* só viram sugestão com um clique.
- **Ponto de integração:** `identifyOrCreateTrack` (`core/src/track/fingerprint.ts`), onde nascia "Pista desconhecida N": quando
  reconhecida, a pista nasce com `name` = local, `layout` = rótulo do layout e `source: 'builtin'` (e `IdentifyResult.recognized`).
  Isso já cobre `LiveContext`, `StoreContext` e `EphemeralContext`: **nenhum gancho novo no LiveEngine/captura é necessário** (só rodam
  quando uma pista nova é criada; custo medido 20–60 ms, uma vez). O `needsName` do servidor continua por "auto + Pista desconhecida".
- **Servidor:** `GET /api/tracks/:id/recognition` → `recognizeTrack` (candidatos pelo traçado da linha central guardada; sem linha ou
  sem resultado, pela janela de comprimento). Não renomeia nada.
- **Nome salvo:** o local oficial (`Trial Mountain Circuit`, `Autodromo Nazionale Monza`) e o rótulo do layout em inglês (sem repetir
  "Full Course" quando o local só tem um layout; reverso termina em "(Reverse)"). Pistas salvas pela lista antiga (layout "Completo")
  ainda acham a ficha: `findTrackLayout` cai para o layout do local mais próximo em comprimento.
- **Comprimento (janela assimétrica):** `LENGTH_WINDOW` = −4 % … +1,5 % do oficial (`lengthCompatible`, `suggestLayoutsByLength`),
  ordenado pela distância a −0,95 % (a mediana medida). Dos 81 layouts medidos: ±1,5 % cobria 56, a janela nova 74 (um teste fixa os
  81 números). Reverso tem o mesmo comprimento: `lookAlikes()` lista reverso e layouts do mesmo local a ≤ 1,5 % (Tokyo, Monza, Fuji,
  Nordschleife/Tourist) e a UI avisa para confirmar. Só pelo comprimento vários layouts competem (5361 m → Alsace 5423 m,
  Watkins Glen Long 5423 m, Trial Mountain...), então o traçado é o que resolve.

### UI

- `web/src/data/gt7Tracks.ts` passou a derivar do catálogo (122 layouts); `lib/trackSuggest.ts` usa a janela nova e a busca do catálogo
  (aceita nome oficial, sem acento). `NewTrackPrompt` busca `/recognition` (cai no comprimento se o servidor for antigo); chips "traçado
  confere" / "é essa", dica com desvio médio, comprimento oficial, curvas e parecidas; aviso quando há empate ou só tamanho.
- **Ficha da pista** (`TrackFicha.tsx`, aba Melhores voltas): país, tipo fictícia/real, layout (+ oval/reverso), comprimento oficial ×
  medido (e %), curvas oficiais × detectadas (com nota), desnível, maior reta, links (lista oficial do jogo; DG EDGE do local). CSS em
  `styles/tracks.css`.

### Testes e verificação

- `shared/src/tracks/catalog.test.ts` (122 ids/nomes únicos, números plausíveis, courseId únicos e fictícios sinalizados, reversos,
  SUGO, fontes/licenças, janela nos limites, os 81 comprimentos medidos, `lookAlikes`, busca, `findTrackLayout`, links),
  `match.test.ts` (coordenadas × volta real, reconhecimento da volta real com `fixtures/trial-mountain-real-lap.json` (434 pontos, só
  posição), offset lateral, reverso por sentido, 121 layouts a partir da própria linha, Monza com/sem chicane não nomeia sozinho, pista
  desconhecida, entradas inválidas, `recognizeTrack`), `core/src/track/known-track.test.ts` (nome automático vs "Pista desconhecida"),
  `server/src/tracks-recognition.test.ts` (rota), `web/.../history.test.ts` (sugestões atualizadas).
- **Avaliação do reconhecedor** (script de pesquisa, fora do repositório; consultas = as 114 linhas de 20 m de `signatures.json`,
  78 normais e 36 reversas, com offset lateral senoidal e início sorteado): limpas: 108 certas em 1º lugar, 6 sem candidato (a própria
  linha tem comprimento > 5 % fora do oficial: Lago Maggiore Centre e Centre Reverse, Northern Isle, Spa 24h, Streets of Willow e
  reverso), **105 nomeadas sozinhas, 0 erradas**; offset 4 m: 108 certas, 100 automáticas, 0 erradas, 1 ambígua; offset 8 m + início
  aleatório: 109 certas, 98 automáticas, 0 erradas, 3 ambíguas. Os únicos pares confundíveis (7) são os esperados: Fuji × Fuji Short, Le
  Mans com/sem chicane, Monza com/sem chicane, Barcelona GP com/sem chicane: ficam como sugestão. **Sessão real (Trial Mountain):
  nomeada sozinha**, custo 7,9–8,6, sentido +1,00, comprimento −1,0 %/−1,3 %, nenhum outro candidato. As linhas do gt-telemetry não servem
  de consulta (a grade de 16 m alonga a polilinha em ~20 %).
- **Verificado no navegador embutido** (servidor de demonstração em outra porta, pasta temporária, a linha real como pista sem nome): o
  aviso mostra "Trial Mountain Circuit — traçado confere", um clique salva, a ficha aparece com os números e links; 480 px de largura.
- **Não verificado:** voltas reais de outras pistas (só Trial Mountain tem gravação: as demais linhas valem pela fonte e pelos
  testes sintéticos, e o desvio em pistas largas ou com muito "corte de curva" pode passar de 6,5 m); a linha de um **reverso** com
  console real (reaproveita a do normal ao contrário, como o gt7-datalogger); se o jogo usa o mesmo sistema de coordenadas em todos os
  layouts e modos (supõe-se); a captura de replay (o reconhecimento roda quando a pista nasce de uma volta ao vivo; replay não cria pista);
  pistas novas do jogo (Autumn Ring) até as fontes atualizarem; o `courseId` 1340 de SUGO (DG EDGE) e o tipo fictício/real de
  *Nürburgring Endurance II* (vem do csv). Atualizar a cada versão do jogo: `node packages/shared/scripts/gen-tracks.mjs` e conferir a
  lista oficial (`https://www.gran-turismo.com/gb/gt7/tracklist/`) à mão.

## Rádio do Bono — perfis de treino e revisão de pilotagem

- O motor em `packages/shared/src/radio` recebe o quadro de telemetria e a duração dos clipes.
  A reprodução fica no app web. O registro da sessão do motor guarda a regra, as evidências,
  a referência, a fala e o motivo do descarte. A janela de fala considera também as freagens
  das curvas fora do foco escolhido.
- Em Aprender pista, as chamadas usam a distância ao ponto da referência e perdem frequência
  após acertos consecutivos. Selecionar curvas em **Treino por curvas** mantém a ajuda nelas.
  Ganhar tempo usa as passagens comparáveis para escolher uma correção com efeito observado.
  Em Consistência, a meta pode ser informada em segundos. Com o campo vazio, o motor usa o
  tempo de referência ou, na ausência dele, a melhor volta do bloco.
- O resumo por bloco usa blocos automáticos de cinco voltas válidas. **Pedir resumo** fica no
  painel ao vivo quando a frequência é **Sob demanda**. Se o tempo da última volta ainda
  estiver sendo confirmado, o pedido espera essa confirmação antes de buscar uma janela livre.
- Em Trial Mountain com o Huracán Gr.4, os trechos gravados cobrem a possível saída de frente
  na T2 da 2:04,856 e a soltura tardia na T4. Na T9 dessa mesma volta, a regra classificou a
  perda de aderência como rotação. A T9 da 2:04,918 cobre um travamento dianteiro de confiança
  alta. Eventos prováveis ficam na revisão, e as falas de eventos confirmados esperam o carro
  endireitar.
- Os pacotes locais de Alex, Santa e Bruno incluem os segmentos de treino e dos eventos.
  A duração vem do manifesto gerado com os próprios clipes. A faixa de pneus de 50/70/95/115 °C,
  a identificação da volta de preparação e os limites de janela ainda precisam ser calibrados
  em sessão ao vivo no PS5.
- Em **Aprender pista**, o formato da instrução de freada é independente do nível de fala.
  **Básicas** usa a intensidade qualitativa. **Detalhadas** usa o pico confiável do pedal
  da volta de referência, arredondado em passos de 10 pontos percentuais. O motor mede a
  duração dos clipes de percentual e distância e recorre à frase básica quando ela couber
  e o detalhe não estiver disponível.
