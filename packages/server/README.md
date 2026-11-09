# @gt7/server — servidor do GT7 Race Engineer

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
| GET / POST | `/api/capture`, `/api/capture/start`, `/api/capture/stop` | `ReferenceCaptureStatus` (202) |
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

### Coach com IA (`/api/coach`, "Debrief com IA")

A chave vem de `ANTHROPIC_API_KEY` (tem prioridade) ou é salva pelo `PUT /api/coach/config`. A
chave **nunca** é devolvida: só `hasKey`, `keySource` e os 4 últimos caracteres.

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/coach/config` | `CoachConfig` (modelo, lista de modelos, esforço, limite de ferramentas) |
| PUT | `/api/coach/config` | corpo `CoachConfigPatch { apiKey?, model?, effort? }` (`apiKey: null` remove) → `CoachConfig` |
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
Desktop/Code (`claude mcp add --transport http gt7-live http://localhost:8770/mcp`).

### WebSocket

`/ws` — protocolo em `@gt7/shared/ws.ts` (`hello` → `welcome`, `frame` a 30 Hz, `lapCompleted`,
`status`, `notice`, perfis de dispositivo e controle remoto de telas).
