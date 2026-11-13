# @gt7/mcp — servidor MCP do Bono Engineer

Expõe suas sessões, voltas, comparações curva a curva, consistência, microssetores, traces,
histórico de evolução e **gráficos em imagem (PNG)** para qualquer cliente MCP (Codex, Claude Desktop,
Claude Code…). A IA recebe métricas de piloto já calculadas (frenagem, V-mín, trail braking,
retomada, roda livre…), nunca os 60 Hz crus.

Dois transportes:

| Transporte | Quando usar | `get_live_state` |
|---|---|---|
| **stdio** (`packages/mcp/src/stdio.ts`) | Claude Desktop/Code iniciam o processo, que lê o mesmo banco SQLite do app (pasta de dados do usuário) | não (só dados gravados) |
| **Streamable HTTP** (`http://localhost:8770/mcp`) | com o app rodando (`npm start`), montado no servidor | sim |

## App instalado (Bono Engineer.exe)

O jeito mais fácil: abra o app em **Configurações → Contas e dados → Conectar ao Claude ou ao Codex** e copie o trecho, que já vem
com os caminhos desta instalação. O app instalado não tem o repositório nem o `tsx`: o servidor stdio
vai empacotado como `resources\app.asar\dist\mcp-stdio.cjs` e o próprio executável o roda como Node
graças a `ELECTRON_RUN_AS_NODE=1` (sem essa variável o .exe abriria outra janela do app):

```json
{
  "mcpServers": {
    "bono": {
      "command": "C:\\Users\\<você>\\AppData\\Local\\Programs\\@gt7desktop\\Bono Engineer.exe",
      "args": [
        "C:\\Users\\<você>\\AppData\\Local\\Programs\\@gt7desktop\\resources\\app.asar\\dist\\mcp-stdio.cjs",
        "--data",
        "C:\\Users\\<você>\\AppData\\Roaming\\Bono Engineer"
      ],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

No Claude Code: `claude mcp add bono -e ELECTRON_RUN_AS_NODE=1 -- "<exe>" "<...>\mcp-stdio.cjs" --data "<pasta de dados>"`.

## A partir do repositório

Os exemplos abaixo usam o repositório em `C:\Users\lucas\Projects\gt7`; troque pelo seu caminho.

## Claude Desktop (stdio)

Edite `%APPDATA%\Claude\claude_desktop_config.json` (Windows) e reinicie o Claude Desktop:

```json
{
  "mcpServers": {
    "bono": {
      "command": "node",
      "args": [
        "--disable-warning=ExperimentalWarning",
        "--import",
        "file:///C:/Users/lucas/Projects/gt7/node_modules/tsx/dist/loader.mjs",
        "C:\\Users\\lucas\\Projects\\gt7\\packages\\mcp\\src\\stdio.ts"
      ]
    }
  }
}
```

- O `--import` precisa ser uma **URL `file:///`** absoluta (no Windows, `C:\...` não é aceito
  ali), porque o Claude Desktop inicia o processo em outra pasta.
- **`--data` é opcional.** Sem ele, o servidor abre a mesma pasta de dados do app (`%APPDATA%\Bono Engineer` no
  Windows; macOS/Linux em `~/Library/Application Support/Bono Engineer` / `~/.local/share/bono-engineer`).
  Ordem de prioridade: `--data` > variável `GT7_DATA` / `GT7_DATA_DIR` > pasta padrão do app. Use `--data` só
  para apontar para outra pasta (por exemplo `%APPDATA%\Bono Engineer\demo`, os dados da demonstração).
- `node` precisa estar no PATH (Node ≥ 24). Se não estiver, use o caminho completo, ex.
  `"command": "C:\\Program Files\\nodejs\\node.exe"`.

## Claude Code (stdio)

```powershell
claude mcp add bono -- node --disable-warning=ExperimentalWarning --import file:///C:/Users/lucas/Projects/gt7/node_modules/tsx/dist/loader.mjs C:\Users\lucas\Projects\gt7\packages\mcp\src\stdio.ts
```

Use `--scope user` para ficar disponível em todos os projetos. Dentro do repositório também
funciona `npm run -s mcp` (o `-s` evita que o npm escreva no stdout, que é o canal
do protocolo).

## HTTP (app em execução)

Com o servidor do app rodando (porta padrão 8770), o endpoint é **`http://localhost:8770/mcp`**
(Streamable HTTP, sem estado). É o único modo em que `get_live_state` funciona.

```powershell
claude mcp add --transport http bono-live http://localhost:8770/mcp
```

No Claude Desktop, use um conector remoto/HTTP apontando para a mesma URL (ou o stdio acima para
os dados gravados). O servidor do app já monta o endpoint (`createApp` em `@gt7/server`):

```ts
import { mountMcpHttp } from '@gt7/mcp';
mountMcpHttp(fastify, { store: runtime.store, analysis: runtime.analysis, runtime });
```

Se o servidor rodar com `--token <segredo>`, o `/mcp` também exige o token. Com o Claude Code:
`claude mcp add --transport http bono-live http://localhost:8770/mcp --header "Authorization: Bearer <segredo>"`.

O coach do próprio app ("Debrief com IA", `POST /api/coach/debrief`) usa **estas mesmas
ferramentas** (cliente MCP em memória) e os mesmos textos dos prompts (`COACH_PERSONA`,
`debriefTask`, `cornerFocusTask`, `trainingPlanTask`, exportados pelo pacote).

## Codex (Streamable HTTP)

Mantenha o Bono Engineer aberto. Adicione este bloco a `~/.codex/config.toml` e reinicie o Codex.
Em **Configurações › Contas e dados › Conectar ao Claude ou ao Codex**, o app oferece um bloco copiável com a porta desta instalação.

```toml
[mcp_servers.bono]
url = "http://localhost:8770/mcp"
```

Se o app exigir um token, acrescente `bearer_token_env_var = "GT7_TOKEN"` ao bloco e defina
`GT7_TOKEN` no ambiente do Codex com o mesmo token de acesso do app. Use `codex mcp list`
para conferir o cadastro. Em uma conversa no Codex, experimente pedir “Liste minhas últimas
três sessões no GT7 e resuma minha melhor volta”. [Documentação do Codex sobre MCP](https://learn.chatgpt.com/docs/extend/mcp#configure-with-configtoml)

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
| `get_knowledge` | **Base de pilotagem (pt-BR)** por classe de carro (Gr.1, Gr.2, Gr.3, Gr.4, Gr.B, N, X) e por diagnóstico: significado, causa provável, ação, exercício e variação por classe, além de princípios gerais, mapa de afinação, glossário e fontes. Use depois de `compare_laps`, com `car_code` e `diagnostics` = os `plan[].code`. Sem argumentos: resumo do carro da sessão mais recente. `topic` (`indice`, `gr4`, `brakeEarlier`, `afinacao`, `glossario`, `fonte`…) devolve a página inteira; `max_chars` limita o resumo (padrão 6000) |
| `get_goal` | Meta de tempo da pista: meta, melhor volta, quanto falta e a meta sugerida |
| `get_session_summary` | Resumo de uma sessão: melhor volta contra o recorde, ritmo, curvas que ganhou e perdeu |
| `get_sectors` | Melhor tempo de cada setor, a volta ideal e quanto a melhor volta deixa para trás |
| `list_corner_drills` | Treinos de uma curva (passagens, melhor, evolução) |
| `get_weekly_summary` | Resumo da semana (sessões, voltas, recordes, metas batidas, uma linha por pista) |
| `get_task_dictionary` | **Tarefas do engenheiro:** o vocabulário que o engenheiro sabe falar (onde, ação, porquê), com exemplos |
| `propose_engineer_task` | Propõe UMA instrução para o engenheiro falar num ponto da volta. O servidor monta a frase só com o dicionário (e recusa o resto, listando o que vale). É só uma **proposta**: o piloto aprova no app e só então o engenheiro fala. `dry_run` só confere a frase |
| `list_engineer_tasks` / `update_engineer_task` / `withdraw_engineer_task` | Lista as tarefas; edita ou retira uma proposta que o piloto ainda não decidiu (tarefas aprovadas só o piloto muda) |
| `get_live_state` | Estado ao vivo (só via HTTP) |
| `rename_corner` / `rename_track` | Dá nome a curvas/pistas (mantido em nova detecção) |

As tarefas não exigem token: só acrescentam fala e texto na tela do engenheiro, e nada é falado antes
da aprovação do piloto no app (Início → Propostas do agente).

Recursos: `gt7://tracks` e `gt7://tracks/{trackId}`; **base de pilotagem:** `gt7://knowledge` (índice) e
`gt7://knowledge/{topic}` (ex.: `gt7://knowledge/class/gr4`, `gt7://knowledge/diagnostics/brakeEarlier`,
`gt7://knowledge/afinacao`).

### Base de conhecimento de pilotagem

Texto em pt-BR escrito para este app (resumos com palavras próprias, **com a fonte citada**: DG-EDGE, Coach Dave Academy,
guia oficial Beyond the Apex, etc.; lista completa em `gt7://knowledge/fonte`). Cada afirmação traz a base: *regra geral*,
*depende do carro*, *segundo uma fonte* ou *pouca evidência* (Gr.2, Gr.B, N e X quase não têm fonte publicada).
**A base não tem pontos de frenagem por pista** (não existe base aberta): só princípios; os pontos de frenagem são
sempre os medidos nas suas voltas. A mesma base alimenta o coach do app e a página **Guia de pilotagem** (`#/guide`).
O código fica em `packages/shared/src/knowledge/` (`knowledgeFor`, `knowledgeIndex`, `knowledgeTopic`).

Exemplo de gráfico: [`docs/chart-example.png`](../../docs/chart-example.png) (volta inteira) e
[`docs/corner-chart-example.png`](../../docs/corner-chart-example.png) (zoom na curva). Gere de novo
com `npm run mcp:sample-chart` (dados sintéticos).

## Prompts prontos

| Prompt | Argumentos | Para quê |
|---|---|---|
| `debrief_sessao` | `session_id?`, `referencia?` | Melhor volta × referência (top de replay, senão melhor pessoal), 3 curvas que mais custam, diagnóstico com números + UMA ação cada, consistência e plano do próximo stint |
| `foco_curva` | `curva`, `voltas?`, `session_id?` | Análise profunda de uma curva entre voltas + exercício de treino |
| `plano_treino` | `track_id?`, `car_code?` | Plano das próximas sessões a partir do histórico de evolução e da consistência |

Os prompts instruem o modelo a usar só os números das ferramentas, dar uma instrução por curva,
considerar a imprecisão de referências capturadas de replay (alguns metros) e **usar a base de pilotagem**:
cada prompt já traz o resumo da classe do carro e manda chamar `get_knowledge` com os códigos dos diagnósticos,
adaptando a ação à classe e dizendo quando algo é regra geral.

## Dicas

- Sem dados ainda? Rode o simulador (`npm run sim`) com o app, ou gere um gráfico de exemplo com
  `npm run mcp:sample-chart`.
- As curvas de uma pista nova são detectadas automaticamente na primeira volta completa. Renomeie
  pelo chat ("chame a T1 de Grampo") — o nome é preservado se a detecção rodar de novo.
- Logs do processo stdio vão para o stderr (no Claude Desktop: `%APPDATA%\Claude\logs\mcp-server-gt7.log`).
