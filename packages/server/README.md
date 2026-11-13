# @gt7/server — servidor do Bono Engineer

Servidor HTTP + WebSocket (Fastify) que liga a telemetria do GT7 (`@gt7/core`) ao painel
(`@gt7/web`), à API REST, ao MCP por HTTP e ao coach com IA. Porta padrão **8770**, escuta em
`0.0.0.0` (celular na mesma rede Wi-Fi).

```powershell
npm start                 # sem argumentos: porta livre, dados na pasta do usuário, console achado sozinho
npm run demo              # idem, com console falso (voltas sintéticas, subpasta demo dos dados)
npm run dev               # servidor + Vite (http://localhost:5173)
npm start -- --help       # opções avançadas (porta, pasta de dados, IP do console, token…)
```

Com `--token <segredo>`, `/api/*`, `/ws` e `/mcp` exigem o token (`?token=`, cabeçalho
`x-gt7-token`, `Authorization: Bearer` ou o cookie criado ao abrir o painel com `?token=`).

Todos os erros JSON têm o formato `{ "error": { "code", "message" } }` com mensagem em português.
Os tipos de requisição/resposta ficam em `@gt7/shared` (`ws.ts`, `api.ts`, `coach.ts`).

## Endpoints

### Estado, configurações e rede

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/status` | `ApiStatus` (conexão, `consoleConnection` com o estado da busca/ligação ao PlayStation, ingestor, captura, dispositivos, firewall, configurações) |
| GET / PATCH | `/api/settings` | `ApiSettings` (IP do console e origem, formato ao vivo e modo automático, formato de captura, gravação, referência do delta). `consoleIp: null` volta à descoberta automática |
| DELETE | `/api/settings/consoleIp` | Esquece o IP fixado e volta à descoberta automática (`ApiSettings`) |
| POST | `/api/discovery/scan` | Recomeça a busca do console (`ApiDiscoveryScanResult`; `started=false` se a telemetria está parada) |
| GET / POST | `/api/firewall`, `/api/firewall/check` | `FirewallStatus` |
| GET | `/api/lan` | `LanInfo` (URLs da LAN + QR em SVG) |

### Dados e backup (`/api/data`)

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/data/summary` | Pasta de dados, tamanhos e contagens (sessões, voltas, pistas) |
| GET | `/api/data/export?laps=&settings=&recordings=` | Baixa um backup `.bono` (zip com `manifest.json`, `data/sessions.db` e os traços). Nunca leva chave, token nem senha |
| POST | `/api/data/import` | Corpo cru (`application/octet-stream`): guarda o envio e responde com o conteúdo do backup |
| POST | `/api/data/import/:id/apply` | `{ mode: 'merge' ou 'replace', settings }`. `replace` faz antes um backup de segurança e é recusado com uma sessão ao vivo aberta |
| DELETE | `/api/data/import/:id` | Descarta o envio |

### Corridas diárias (`/api/events`)

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/events/dailies` | `ApiDailyRaces`: as três corridas da semana, semanas anteriores, `enabled` e `asked`. Só busca no DG EDGE se o usuário ligou (desligado por padrão) |
| POST | `/api/events/dailies/refresh` | Atualização manual (recusada por 10 minutos depois de qualquer tentativa) |
| PUT | `/api/events/dailies/enabled` | `{ enabled: boolean }`: responde à pergunta única e liga ou desliga a busca |

### Tarefas do engenheiro (`/api/tasks`)

Instruções que o engenheiro de rádio fala num ponto da volta. Um agente (MCP) ou o Coach IA só **propõe**;
o piloto aprova pelo app. A frase é montada só com o dicionário (`@gt7/shared` `radio/tasks.ts`).

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/tasks?trackId=&status=` | `ApiTaskList`: as tarefas e quantas propostas esperam o piloto |
| POST | `/api/tasks` | Tarefa do próprio piloto (`ApiTaskCreate`): já nasce ativa. 400 `invalidTask` quando a frase não existe no dicionário (a mensagem lista o que vale) |
| POST | `/api/tasks/preview` | `ApiTaskPreview`: a frase nos três idiomas e as peças, sem criar nada |
| PATCH | `/api/tasks/:id` | `{ status?, where?, say?, carCode?, note? }`: aprovar (`active`), pausar, concluir, editar |
| POST | `/api/tasks/:id/spoken` | O rádio falou a tarefa (conta a vez) |
| DELETE | `/api/tasks/:id` | Apaga |
| GET / DELETE | `/api/tasks/misses` | Pedidos que o dicionário não soube falar (para decidir o que falta) / limpar |
| GET | `/api/tasks/dictionary` | O vocabulário (`TaskDictionaryView`) |
| GET / PUT / DELETE | `/api/tasks/voice?voice=alex` | Voz das tarefas: estado do download (`ApiTaskVoice`), liga o download (`{ enabled, voice }`, opt-in) e remove. O áudio vem do GitHub Release `vozes-tarefas-v<versão>` (ou `GT7_TASK_VOICE_URL`), só da voz em uso, e é conferido por tamanho e SHA-256 contra o manifesto do app |
| POST | `/api/tasks/voice/download` | Baixa (ou continua) a voz; recusado enquanto o piloto não ligou o download |
| GET | `/api/tasks/voice/file/:file` | O áudio baixado (WAV) |

O WebSocket avisa `tasksChanged` (`proposals`: propostas abertas) e o quadro ao vivo traz `tasks` (as ativas da pista
e do carro, com as peças e as distâncias onde cada frase deve terminar).

### Sessões, voltas, pistas, dispositivos, captura

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/sessions`, `/api/sessions/:id`, `/api/sessions/:id/laps` | `Session[]`, `SessionDetail`, `Lap[]` |
| DELETE | `/api/sessions/:id` | `{ ok, id }` (409 para a sessão em andamento) |
| GET | `/api/laps?sessionId=` ou `?trackId=&carCode=&validOnly=&references=&orderBy=&limit=` | `Lap[]` |
| GET / DELETE | `/api/laps/:id` | `Lap` |
| PUT / DELETE | `/api/laps/:id/reference` | `Lap` (marca/desmarca como referência) |
| GET | `/api/laps/:id/trace?channels=a,b&download=1` | `ApiLapTrace` (trace cru, colunar, 60 Hz; NaN → null) |
| GET | `/api/laps/:id/export.csv?stepM=1` | CSV alinhado por distância (`API_LAP_CSV_COLUMNS`) |
| GET | `/api/references?trackId=` | `Lap[]` |
| GET | `/api/tracks`, `/api/tracks/:id`, `/api/tracks/:id/centerline`, `/api/tracks/:id/laps` | `Track[]`, `Track`, `TrackCenterline`, `Lap[]` |
| PATCH | `/api/tracks/:id`, `/api/tracks/:id/corners/:cornerId` | `Track` (nome/layout, nome da curva/nota) |
| PUT | `/api/tracks/:id/sectors` | `Track` (`{ count }` ou `{ gates }`) |
| POST | `/api/tracks/:id/redetect-corners` | `ApiRedetectCornersResult` (força nova detecção; nomes são mantidos por proximidade do ápice) |
| GET / PUT / DELETE | `/api/devices`, `/api/devices/:id`; POST `/api/devices/:id/show-view` | `DeviceInfo[]`, perfis |
| GET / POST | `/api/capture`, `/api/capture/start`, `/api/capture/stop` | `ReferenceCaptureStatus` (202). `start`: `driverName`, opcionais `carName`, `notes`, `rankingTimeMs`, `expectedCarCode`, `trackId` (400 se a pista não existe; sem ele a pista é descoberta pela posição do replay). `format` é aceito mas ignorado: o formato do pacote não é trocado |
| GET | `/api/recordings/:sessionId` | arquivo `.gt7rec` |

### Análise (`/api/analysis`)

`ref` aceita um id de volta ou `personalBest`, `sessionBest`, `bestReference`, `auto` (padrão).
Erros da análise viram 404 (`notFound`, `noCenterline`, `noTrace`, `noReference`), 400
(`invalidArgument`, `trackMismatch`) ou 409 (`noTrack`).

| Rota | Resposta |
|---|---|
| `GET /api/analysis/tracks/:trackId?maxPoints=1000` | `ApiTrackAnalysis`: `track`, `polyline {x, z, stepM, lengthM}`, `corners` (com `apexX/apexZ`), `sectorStartsM`, `sectors`, `records`, `references` (404 `noCenterline` sem linha) |
| `GET /api/analysis/laps/:lapId` | `ApiLapAnalysis` (= `LapAnalysis`: métricas por curva, validade, resumo) |
| `GET /api/analysis/compare?lap=&ref=&topN=` (topN 1–20, padrão 3 no servidor; o painel pede 20) | `ApiComparison` (= `LapComparisonResult`: `comparison.rows/findings/keyFindings/sectorDeltasMs/warnings`, `markdown`) |
| `GET /api/analysis/delta?lap=&ref=&stepM=2` | `ApiDistanceDelta` (delta acumulado + taxa s/100 m) |
| `GET /api/analysis/traces?laps=a,b&channels=speed,throttle,brake,gear,steering&stepM=2&from=&to=&maxPoints=2000&ref=` | `ApiTraces`: todas as voltas na **mesma grade** de distância (até 6 voltas, 12 canais; apelidos em `API_TRACE_CHANNEL_ALIASES` ou nomes `TraceChannel`) |
| `GET /api/analysis/microsectors?laps=a,b,c&ref=&count=` | `ApiMicrosectors` (microssetores, cores, volta teórica) |
| `GET /api/analysis/consistency?sessionId=` ou `?laps=a,b` | `ApiConsistency` |
| `GET /api/analysis/evolution?trackId=&carCode=&maxDays=` | `ApiEvolution` |
| `GET /api/analysis/chart.png?lap=&ref=&corner=&width=` | PNG (mesmo gráfico da ferramenta MCP `render_comparison_chart`; legenda no cabeçalho `x-chart-caption`) |

### Coach com IA (`/api/coach`, chat e "Debrief com IA")

Dois provedores, com as mesmas ferramentas MCP: **Claude** (Anthropic) e **OpenAI**. A chave vem de
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (têm prioridade) ou é salva pelo `PUT /api/coach/config`. A
chave **nunca** é devolvida: só `hasKey`, `keySource` e os 4 últimos caracteres. O provedor ativo é
o escolhido (`provider`) que tenha chave. Um modelo `claude-*` é da Anthropic; o resto, da OpenAI. A
variável `GT7_OPENAI_BASE_URL` aponta o cliente para um endereço compatível com a OpenAI (proxy ou teste).

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/coach/config` | `CoachConfig` (provedor ativo, `providers[]` com chave e modelos de cada um, esforço, limite de ferramentas) |
| PUT | `/api/coach/config` | corpo `CoachConfigPatch { apiKey?, model?, openaiApiKey?, openaiModel?, provider?, effort? }` (`null` remove a chave) → `CoachConfig` |
| POST | `/api/coach/verify` | corpo `{ provider? }` → `CoachVerifyResult { ok, provider, message }` (testa a chave salva com uma chamada barata) |
| POST | `/api/coach/ask` | corpo `CoachAskRequest { message }` → **SSE** (abre uma conversa livre, sem sessão: o coach busca os dados com as ferramentas) |
| POST | `/api/coach/debrief` | corpo `CoachDebriefRequest { sessionId?, lapId?, ref?, focusCorner?, question? }` → **SSE** |
| POST | `/api/coach/chat` | corpo `CoachChatRequest { reportId, message }` → **SSE** (continua a mesma conversa) |
| GET | `/api/coach/reports?trackId=&limit=` | `CoachReportSummary[]` |
| GET / DELETE | `/api/coach/reports/:id` | `CoachReport` (Markdown, metadados, transcrição) / `{ ok, id }` |

Eventos SSE (`text/event-stream`, `event:` + `data:` JSON; tipo `CoachSseEvent`):

- `start` `{ reportId, model }`;
- `text` `{ delta }` — texto da resposta (Markdown) em pedaços;
- `tool` `{ id, name, status: running | done | error, summary? }` — cada ferramenta chamada;
- `done` `{ reportId, usage, stopReason }` — relatório salvo;
- `error` `{ code, message, reportId? }` — `noKey`, `invalidKey`, `rateLimited`, `overloaded`,
  `refused`, `limitReached`, `apiError`, `aborted`, `internal`.

Sem chave, sem voltas ou ids inválidos → resposta JSON 400/404 **antes** de abrir o stream.
Fechar a conexão cancela a chamada ao modelo.

Exemplo (PowerShell 7 / curl):

```powershell
curl -N -X POST http://localhost:8770/api/coach/debrief -H "content-type: application/json" -d '{\"question\":\"Onde perco mais tempo?\"}'
```

Como funciona: o servidor conecta um cliente MCP em memória ao mesmo `createGt7McpServer` usado
pelo `/mcp` e expõe ao Claude as ferramentas **somente leitura** (as de renomear ficam de fora).
Gráficos PNG voltam ao modelo como imagem. Laço com no máximo 12 rodadas de ferramentas e teto de
tokens; depois disso o modelo é obrigado a responder sem ferramentas. Modelo padrão
`claude-opus-5-5` (opções mais baratas: `claude-sonnet-5-5`, `claude-haiku-5-5`), pensamento
adaptativo, cache de prompt e fallback do servidor em recusas.

### MCP por HTTP

`POST /mcp` — Streamable HTTP sem estado (o mesmo servidor MCP do `npm run mcp`, mais o
`get_live_state` com os dados ao vivo). Veja `packages/mcp/README.md` para configurar o Claude
Desktop/Code (`claude mcp add --transport http bono-live http://localhost:8770/mcp`).

### WebSocket

`/ws` — protocolo em `@gt7/shared/ws.ts` (`hello` → `welcome`, `frame` a 30 Hz, `lapCompleted`,
`status`, `notice`, perfis de dispositivo e controle remoto de telas).
