# @gt7/mcp — servidor MCP do GT7 Race Engineer

Expõe suas sessões, voltas, comparações curva a curva, consistência, microssetores, traces,
histórico de evolução e **gráficos em imagem (PNG)** para qualquer cliente MCP (Claude Desktop,
Claude Code…). A IA recebe métricas de piloto já calculadas (frenagem, V-mín, trail braking,
retomada, roda livre…), nunca os 60 Hz crus.

Dois transportes:

| Transporte | Quando usar | `get_live_state` |
|---|---|---|
| **stdio** (`packages/mcp/src/stdio.ts`) | Claude Desktop/Code iniciam o processo, que lê o mesmo banco SQLite (`data/`) | não (só dados gravados) |
| **Streamable HTTP** (`http://localhost:8770/mcp`) | com o app rodando (`npm start`), montado no servidor | sim |

Os exemplos abaixo usam o repositório em `C:\Users\lucas\Projects\gt7`; troque pelo seu caminho.

## Claude Desktop (stdio)

Edite `%APPDATA%\Claude\claude_desktop_config.json` (Windows) e reinicie o Claude Desktop:

```json
{
  "mcpServers": {
    "gt7": {
      "command": "node",
      "args": [
        "--disable-warning=ExperimentalWarning",
        "--import",
        "file:///C:/Users/lucas/Projects/gt7/node_modules/tsx/dist/loader.mjs",
        "C:\\Users\\lucas\\Projects\\gt7\\packages\\mcp\\src\\stdio.ts",
        "--data",
        "C:\\Users\\lucas\\Projects\\gt7\\data"
      ]
    }
  }
}
```

- O `--import` precisa ser uma **URL `file:///`** absoluta (no Windows, `C:\...` não é aceito
  ali), porque o Claude Desktop inicia o processo em outra pasta.
- `--data` aponta para a pasta de dados do app (`sessions.db` + `traces/`). Alternativa: variável de
  ambiente `GT7_DATA_DIR` (`"env": { "GT7_DATA_DIR": "C:\\...\\data" }`). Sem nenhum dos dois, usa
  `<repo>/data`.
- `node` precisa estar no PATH (Node ≥ 24). Se não estiver, use o caminho completo, ex.
  `"command": "C:\\Program Files\\nodejs\\node.exe"`.

## Claude Code (stdio)

```powershell
claude mcp add gt7 -- node --disable-warning=ExperimentalWarning --import file:///C:/Users/lucas/Projects/gt7/node_modules/tsx/dist/loader.mjs C:\Users\lucas\Projects\gt7\packages\mcp\src\stdio.ts --data C:\Users\lucas\Projects\gt7\data
```

Use `--scope user` para ficar disponível em todos os projetos. Dentro do repositório também
funciona `npm run -s mcp -- --data data` (o `-s` evita que o npm escreva no stdout, que é o canal
do protocolo).

## HTTP (app em execução)

Com o servidor do app rodando (porta padrão 8770), o endpoint é **`http://localhost:8770/mcp`**
(Streamable HTTP, sem estado). É o único modo em que `get_live_state` funciona.

```powershell
claude mcp add --transport http gt7-live http://localhost:8770/mcp
```

No Claude Desktop, use um conector remoto/HTTP apontando para a mesma URL (ou o stdio acima para
os dados gravados). Para o servidor, a integração é:

```ts
import { mountMcpHttp } from '@gt7/mcp';
mountMcpHttp(fastify, { store: runtime.store, analysis: runtime.analysis, runtime });
```

## Ferramentas

| Tool | O que faz |
|---|---|
| `list_tracks` | Pistas conhecidas: comprimento, nº de curvas, sessões, voltas, melhor tempo |
| `get_track` | Curvas (T1…, nome, tipo, entrada/ápice/saída), setores, recordes por carro, referências |
| `list_sessions` | Sessões (filtros: pista, carro, limite) |
| `list_laps` | Voltas de uma sessão ou pista: tempo, setores, válida, flags, referência |
| `list_reference_laps` | Voltas do top capturadas de replay (piloto, carro, tempo do ranking) |
| `get_lap_summary` | Métricas por curva de uma volta + validade |
| `compare_laps` | **Principal**: tabela curva a curva, perdas por fase, diagnósticos ranqueados e UMA ação por curva (`reference`: id, `auto`, `bestReference`, `personalBest`, `sessionBest`) |
| `get_corner_detail` | Uma curva em 1–6 voltas: métricas completas + traces a cada 5 m (passo ≥ 2 m) |
| `get_consistency` | Média/desvio por curva e destaques ("frenagem da T6 varia 15 m") |
| `get_microsectors` | Microssetores, volta teórica (melhores microssetores/setores) |
| `get_trace` | Canais reamostrados por distância (passo ≥ 2 m, ≤ 500 pontos) |
| `get_evolution` | Histórico por dia: melhor volta, gap para o top, tendências por curva |
| `render_comparison_chart` | **Imagem PNG**: velocidade/acelerador/freio/marcha/volante/delta + mapa colorido pelo delta; `corner` dá zoom com os dois traçados e pontos de frenagem |
| `get_live_state` | Estado ao vivo (só via HTTP) |
| `rename_corner` / `rename_track` | Dá nome a curvas/pistas (mantido em nova detecção) |

Recursos: `gt7://tracks` e `gt7://tracks/{trackId}`.

Exemplo de gráfico: [`docs/exemplo-grafico.png`](../../docs/exemplo-grafico.png) (volta inteira) e
[`docs/exemplo-grafico-curva.png`](../../docs/exemplo-grafico-curva.png) (zoom na curva). Gere de novo
com `npm run mcp:sample-chart` (dados sintéticos).

## Prompts prontos

| Prompt | Argumentos | Para quê |
|---|---|---|
| `debrief_sessao` | `session_id?`, `referencia?` | Melhor volta × referência (top de replay, senão melhor pessoal), 3 curvas que mais custam, diagnóstico com números + UMA ação cada, consistência e plano do próximo stint |
| `foco_curva` | `curva`, `voltas?`, `session_id?` | Análise profunda de uma curva entre voltas + exercício de treino |
| `plano_treino` | `track_id?`, `car_code?` | Plano das próximas sessões a partir do histórico de evolução e da consistência |

Os prompts instruem o modelo a usar só os números das ferramentas, dar uma instrução por curva e
considerar a imprecisão de referências capturadas de replay (alguns metros).

## Dicas

- Sem dados ainda? Rode o simulador (`npm run sim`) com o app, ou gere um gráfico de exemplo com
  `npm run mcp:sample-chart`.
- As curvas de uma pista nova são detectadas automaticamente na primeira volta completa. Renomeie
  pelo chat ("chame a T1 de Grampo") — o nome é preservado se a detecção rodar de novo.
- Logs do processo stdio vão para o stderr (no Claude Desktop: `%APPDATA%\Claude\logs\mcp-server-gt7.log`).
