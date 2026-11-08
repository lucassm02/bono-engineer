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
