# GT7 Engenheiro (GT7 Race Engineer)

App de telemetria para **Gran Turismo 7** pensado para uma coisa: **você pilotar melhor**. Ele recebe os
dados do PS4/PS5 pela rede local, mostra um painel ao vivo no PC e no celular, e depois da sessão diz
**onde você perde tempo, por quê e o que fazer diferente**, curva a curva. Também consegue capturar a volta de
um piloto do topo do ranking (pelo replay do Time Trial) para você comparar e usar como alvo.

> Projeto pessoal, sem relação com a Polyphony Digital. O protocolo de telemetria do GT7 não tem
> documentação oficial; tudo vem de engenharia reversa da comunidade (veja o [estudo](ESTUDO-TELEMETRIA-GT7.md)).
> **Status:** tudo foi desenvolvido e testado com dados sintéticos. A primeira sessão com um console real
> ainda não aconteceu: use o roteiro [docs/primeiro-teste-com-ps5.md](docs/primeiro-teste-com-ps5.md).

## O que o app faz

- **Painel ao vivo** (PC e celular, ao mesmo tempo): delta contra a referência, tempos, setores, pneus,
  inputs, motor, mapa, combustível, forças G e mais. **11 telas** trocadas por gestos, em tela cheia, pensadas
  para serem lidas de relance.
- **Análise curva a curva**: sobreposição de gráficos (velocidade, acelerador, freio, marcha, volante e delta
  acumulado) por distância, mapa colorido por ganho/perda, tabela de curvas e uma lista do que treinar
  ("O que treinar") com **uma ação concreta por curva**.
- **Voltas de referência do top**: você assiste ao replay de um piloto do ranking e o app grava a volta dele
  como referência (delta ao vivo contra o top, comparação e coach).
- **Coach com IA**: "Debrief com IA" dentro do app (usa a sua chave da API da Anthropic) e um **servidor MCP**
  para Claude Desktop / Claude Code consultarem seus dados, inclusive com gráficos em imagem.
- **Treino de curva**: tela que mostra as metas da próxima curva (frenagem, V-mín, retomada) e o resultado da
  última passagem, com aviso por voz opcional.

Exemplo do gráfico que a IA (e a página de comparação) usam, gerado com dados sintéticos:

![Exemplo de gráfico de comparação](docs/exemplo-grafico.png)

### Arquitetura

Um único processo no PC recebe o UDP do console e redistribui para quantos navegadores você quiser (o GT7 só
transmite para um destino, então o PC faz o papel de "hub").

```mermaid
flowchart LR
    PS["PS4 / PS5<br/>GT7"] -- "UDP :33740 ~60 Hz<br/>(Salsa20)" --> ING
    ING -- "heartbeat 1 s → :33739" --> PS

    subgraph PC ["Servidor no PC (Node.js)  -  porta 8770"]
        ING["Ingestor<br/>UDP + decifra + parse"] --> ENG["Motor ao vivo<br/>voltas, setores, delta"]
        ENG --> DB[("data/<br/>SQLite + traces + .gt7rec")]
        DB --> ANA["Análise<br/>curvas, métricas, comparação"]
        ENG --> WS["HTTP + WebSocket + REST"]
        ANA --> WS
        ANA --> MCP["MCP (/mcp e stdio)"]
        ANA --> COACH["Coach IA<br/>(API da Anthropic)"]
    end

    WS --> BR["Navegador do PC"]
    WS --> CEL["Celular (PWA)"]
    MCP --> CLAUDE["Claude Desktop /<br/>Claude Code"]
```

## Requisitos

- **Windows** (testado no Windows 11; o verificador de firewall só funciona no Windows).
- **Node.js 24 ou superior** (o app usa o `node:sqlite` nativo). Confira com `node --version`.
- **PS4 ou PS5 com Gran Turismo 7**, na **mesma rede** (mesma sub-rede) que o PC.
- Para o celular: estar no mesmo Wi-Fi do PC.
- Opcional, para o coach com IA dentro do app: uma chave da API da Anthropic.

## Instalação

Na pasta do projeto (`C:\Users\lucas\Projects\gt7`), no PowerShell:

```powershell
npm install        # instala tudo (workspaces)
npm run build      # compila o painel web (packages/web/dist)
```

Os pacotes Node não têm etapa de build: o TypeScript roda direto via `tsx`.

## Primeira execução

```powershell
npm start
```

O servidor abre o navegador no PC e imprime no terminal: a URL local, a **URL para o celular**, um **QR code**,
o IP/formato do console, a pasta de dados e o estado do **firewall**. `Ctrl+C` encerra (fecha UDP, WebSocket e
banco com segurança; um segundo `Ctrl+C` força a saída).

Se o painel mostrar "Servidor ok, console não conectado", siga a próxima seção.

### Modo demonstração (sem console)

Para conhecer o app sem ligar o PS5:

```powershell
npm run demo
```

Sobe um "console falso" dentro do mesmo processo, com voltas sintéticas de um piloto amador numa pista
inventada ("Synthetic Ring", ~4,4 km). Usa portas UDP alternativas (47739/47740), então **não atrapalha** um
console real, e grava em `data/demo` (separado dos seus dados reais). Opções úteis:
`npm run demo -- --sim-profile pro`, `--sim-seed 3`, `--sim-replay`, `--sim-laps 5`.

Dica: depois de duas ou três voltas sintéticas, abra `#/analise` e compare duas voltas para ver a análise.

### Modo desenvolvimento

```powershell
npm run dev        # servidor + Vite em http://localhost:5173 (recarrega ao editar o painel)
npm run typecheck  # TypeScript em todos os pacotes
npm test           # testes (Vitest)
npm run lint       # Biome
```

No `dev` o painel fica na porta 5173 e a API/WebSocket na 8770 (o Vite faz proxy). Sem servidor, o painel em
dev liga sozinho um modo "Demonstração (sem servidor)". Também dá para abrir `http://localhost:5173/?mock=1`.

## Configurar o console

### 1. Achar o IP do PS5

No PS5: **Configurações › Rede › Status da conexão › Ver status da conexão** e anote o **Endereço IPv4**
(algo como `192.168.0.20`). Dica: reserve esse IP fixo no roteador para não mudar.

### 2. Informar o IP ao app

Duas opções (o IP fica salvo no banco, então só precisa fazer uma vez):

- **No app:** abra `http://localhost:8770/#/config` (ou no painel: segurar a tela › **Abrir análise** ›
  **Configurações**), seção **Console e formatos** › campo **IP do PlayStation**.
- **Na linha de comando:** `npm start -- --ps-ip 192.168.0.20`.

Sem IP, o app tenta **descobrir o console por broadcast** e grava o que encontrar. Isso depende do roteador e
não é garantido: prefira informar o IP.

### 3. Abrir o jogo

O console só transmite telemetria **enquanto você está dirigindo** (na pista). Em menus o painel mostra "No
menu". Entre numa pista (Time Trial, Treino livre etc.).

### Formatos de pacote

O GT7 tem vários formatos de telemetria. O primeiro "heartbeat" da sessão trava o formato; trocar exige o
console ficar ~15 s sem receber pedidos, por isso o app avisa que "a troca leva até ~15 s".

| Formato | Para que serve | Observação |
|---|---|---|
| `~` | **Ao vivo (padrão).** Mais completo: acelerador/freio "crus", volante, forças G, energia | Relatado como indisponível em replay |
| `B` | **Replay / captura de referência.** Volante e forças G | O app troca sozinho para `B` na captura e volta depois |
| `A` | Básico, o mais compatível | Sem volante: alguns diagnósticos ficam indisponíveis |
| `C` | Experimental: acrescenta tipo de superfície (asfalto/zebra/grama) e tempo da volta atual | Layout e criptografia ainda não verificados |

Fallback automático: se nada chegar em **10 s** pedindo `~`, o app tenta `B` uma vez e avisa. (Se o console
estiver desligado nessa hora, ele fica em `B` até você reiniciar ou trocar o formato em Configurações.)

### Firewall do Windows

O app **só verifica** o firewall; ele nunca o altera. Se faltar regra, o terminal e a tela de Configurações
mostram os comandos exatos. Abra o **PowerShell como Administrador** e rode:

```powershell
New-NetFirewallRule -DisplayName "GT7 Race Engineer (TCP 8770)" -Direction Inbound -Protocol TCP -LocalPort 8770 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "GT7 Race Engineer (UDP 33740)" -Direction Inbound -Protocol UDP -LocalPort 33740 -Action Allow -Profile Private
```

Alternativa em prompt de administrador:

```bat
netsh advfirewall firewall add rule name="GT7 Race Engineer (TCP 8770)" dir=in action=allow protocol=TCP localport=8770 profile=private
netsh advfirewall firewall add rule name="GT7 Race Engineer (UDP 33740)" dir=in action=allow protocol=UDP localport=33740 profile=private
```

- TCP 8770 = painel no celular. UDP 33740 = telemetria do console. Se você mudar a porta com `--port`, o
  número da regra TCP muda junto.
- As regras valem para a rede **Privada**. Confira que o Wi-Fi do PC está marcado como "Privada".
- Se você já liberou o `node.exe` quando o Windows perguntou, o app não consegue detectar isso e pode ainda
  avisar que faltam regras; pode ignorar.
- Em **Configurações › Celular e firewall** há o botão "Verificar de novo".

### Rede

- PC, PS5 e celular na **mesma sub-rede** (ex.: todos em `192.168.0.x`).
- Desligue o **isolamento de clientes / AP isolation** e evite a rede "convidado" ou VLANs de mesh Wi-Fi.
- Se possível, ligue o **PS5 por cabo** e use Wi-Fi 5 GHz no celular: perda de pacotes UDP prejudica a análise
  (o app marca a volta como "dados incompletos" quando perde demais).
- Só **um app** deve falar com o console por vez (o console transmite para quem mandou o último heartbeat).
  Feche SimHub, GT7 Dashboard etc. antes. Outro programa usando a porta UDP 33740 impede o app de receber.

## Usar no celular

1. Com o app rodando, abra no celular a **URL da rede** impressa no terminal (ex.:
   `http://192.168.0.10:8770`) ou aponte a câmera para o **QR code**. Também aparece em
   **Configurações › Celular e firewall**.
2. **Adicionar à tela inicial** para abrir em tela cheia:
   - **Android (Chrome):** menu ⋮ › *Adicionar à tela inicial* (ou *Instalar app*).
   - **iPhone (Safari):** botão Compartilhar › *Adicionar à Tela de Início*.
   O painel é desenhado para **paisagem**. No iPhone gire manualmente (o iOS ignora a orientação do app).
3. **Tela sempre ligada.** O app tenta a API Wake Lock (só funciona em HTTPS) e, em `http` na rede local, um
   truque de vídeo invisível iniciado no primeiro toque. Nenhum dos dois é garantido: **desligue também o
   bloqueio automático** do aparelho (Android: Configurações › Tela › Tempo limite; iPhone: Ajustes › Tela e
   Brilho › Bloqueio automático › Nunca). O painel mostra um aviso quando o Wake Lock não está ativo.

### Gestos

| Gesto | O que faz |
|---|---|
| **Deslizar** esquerda/direita | Próxima / anterior tela (carrossel circular, pontinhos mostram a posição) |
| **Toque** | Mostra por 3 s o cabeçalho com o nome da tela e a referência do delta |
| **Toque duplo** | Alterna a referência do delta: *Melhor pessoal → Melhor da sessão → Top capturado* (pula o "top" se a pista não tiver referência capturada) |
| **Segurar** (0,6 s) | Abre o seletor de telas e ajustes |
| **Cadeado** | Toque no cadeado **trava** todos os gestos (evita trocar de tela com o celular no suporte); para **destravar, segure** o cadeado 0,6 s |
| **Pinça** (só no Mapa) | Zoom no traçado; um dedo arrasta com zoom; com zoom, o **toque duplo volta ao mapa inteiro** |

No PC (teclado): `←`/`→` trocam de tela, `Enter` abre o seletor, `D` alterna a referência do delta, `Espaço`
mostra o cabeçalho, `L` liga/desliga o cadeado, `Esc` fecha o seletor.

O app **nunca** troca de tela sozinho no meio da volta. Ao fechar uma volta aparece por 5 s um cartão com o
tempo e o delta (dá para desligar).

### As 11 telas

Corrida, Delta grande, Pneus, Inputs, Motor e câmbio, Mapa, Tempos, Combustível, Forças G, Treino de curva e
Personalizada (grade de widgets que você monta). **Por padrão ficam ligadas só as 5 primeiras**; as outras
aparecem em "Desligadas" no seletor.

### Escolher e ordenar telas

Segure a tela para abrir **Telas deste dispositivo**: toque no nome para ir até a tela, use **↑ ↓** para
reordenar, **★** para definir a tela inicial e o interruptor para ligar/desligar. Ali também ficam: **Delta
contra** (referência), cartão ao fechar a volta, **Travar gestos**, **Editar a tela Personalizada** e o botão
**Abrir análise**. **Cada dispositivo tem a sua configuração**, salva no servidor (sobrevive a limpar o
navegador).

### Controle remoto pelo PC

Em **Configurações › Dispositivos** há a lista dos painéis conectados; o botão **Mostrar tela** escolhe no PC
qual tela aparece no celular (só funciona se a tela estiver ligada naquele dispositivo).

## Fluxos principais

### (a) Treino ao vivo com delta

1. `npm start`, jogo na pista, celular no suporte, tela **Corrida** ou **Delta grande**.
2. O delta compara você com a referência escolhida (**Melhor pessoal** por padrão). **Positivo = mais lento**
   (perdendo tempo); negativo = ganhando. A barra e o fundo mudam de cor.
3. A pista é **reconhecida sozinha** (impressão digital de largada + comprimento + forma). Na primeira volta
   completa numa pista nova, o app grava a linha da pista, detecta as curvas (T1, T2…) e cria 3 setores.
   Delta e setores só aparecem depois da primeira volta válida.
4. Toque duplo troca a referência. Para treinar uma curva específica, use a tela **Treino de curva** (e
   **Fixar esta curva**).
5. Voltas com pausa, saltos nos dados ou saída de pista são marcadas como **inválidas** e não viram recorde.

### (b) Capturar a volta de um piloto do top (replay) e comparar

1. Abra `#/captura` (menu **Captura** da área de análise). Preencha **Piloto** (obrigatório), carro, **tempo do
   ranking** (`m:ss.mmm`, opcional mas ajuda a validar) e notas. Clique **Iniciar captura**.
2. No jogo: **Time Trial** da pista › **ranking** › escolha o replay do piloto. Inicie a captura no app
   **antes** de dar play (a troca para o formato `B` leva até ~15 s).
3. Assista em **velocidade 1×**, do começo ao fim da volta. **Não pule, não avance, não pause.** Qualquer salto
   invalida a volta. Mantenha a câmera no carro do piloto.
4. Quando a volta fecha, o app valida (comprimento ±2% da pista, tempo ±0,3 s do ranking, pacotes perdidos,
   carro esperado) e **salva como referência**, voltando ao formato ao vivo. Se for rejeitada, ele grava a
   próxima volta do replay; os motivos aparecem em português na tela.
5. Compare: o botão **Comparar com o seu melhor** abre a comparação com a sua melhor volta válida do mesmo
   carro. No painel ao vivo, toque duplo até **Top capturado** para ter o delta contra ele.
6. **Use o mesmo carro** (o app avisa se o `carCode` for diferente) e, de preferência, o mesmo acerto e pneu.

Limite honesto: dados de replay são **suavizados**. Pontos de frenagem e traçado têm precisão de **alguns
metros**: ótimo para aprender, não para contar milésimos. O app rebaixa a confiança dos diagnósticos que
dependem de forma de pedal/volante quando a referência é de replay.

### (c) Análise pós-sessão

1. Abra `http://localhost:8770/#/analise` (ou **Abrir análise** no seletor de telas do painel).
2. Entre na sessão, marque **de 1 a 3 voltas** (1ª = a sua, 2ª = a referência, 3ª = extra sobreposta) e clique
   **Comparar**. Com uma volta só, a referência é automática (top → melhor pessoal → melhor da sessão).
3. Na comparação: cabeçalho com tempos, **delta total**, setores e **volta ideal**; gráficos sincronizados
   (arraste para dar zoom, duplo clique volta ao todo); mapa colorido; **"O que treinar"**; e a **tabela de
   curvas**.
4. Como ler a tabela de curvas e os diagnósticos: veja o [guia de pilotagem](docs/guia-de-pilotagem.md).
5. Na página da pista (**Consistência e evolução**): consistência entre as voltas, volta ideal, evolução por
   dia, renomear curvas e anotar o **marco de frenagem** ("placa de 100 m").
6. Botões úteis: **Gerar gráfico (PNG)**, baixar CSV/trace da volta e baixar a gravação `.gt7rec`.

### (d) Debrief com IA no app

1. Em **Configurações › Coach IA**, cole sua **chave da API da Anthropic** (criada em console.anthropic.com).
   Ela fica só no PC (banco local) e nunca volta para o navegador. Alternativa: variável de ambiente
   `ANTHROPIC_API_KEY` (tem prioridade sobre a chave salva).
2. Escolha **modelo** (Claude Opus 5.5 = mais capaz, padrão; Sonnet 5.5 = mais rápido e mais barato;
   Haiku 5.5 = o mais barato) e **esforço** (baixo/médio/alto).
3. Na sessão ou na comparação, clique **Debrief com IA** (ou abra `#/coach`). Escolha sessão, volta, referência,
   curva em foco e, se quiser, uma pergunta ("por que perco tanto na saída da T3?"). **Gerar debrief.**
4. A IA consulta suas métricas pelas mesmas ferramentas do MCP (somente leitura), pode olhar gráficos e
   escreve o relatório: 3 maiores perdas, uma ação por curva e o plano do próximo stint. Dá para fazer
   perguntas de acompanhamento e rever relatórios antigos.
5. **Custo:** as chamadas usam **a sua conta da API da Anthropic** e são cobradas por ela; o app não estima nem
   limita gastos. Modelos menores custam menos.

### (e) Claude Desktop / Claude Code via MCP

O servidor MCP entrega à IA métricas de piloto já calculadas, não os 60 Hz crus. Há dois transportes:

| Transporte | Quando | `get_live_state` |
|---|---|---|
| **stdio** | Claude inicia o processo e lê o banco em `data/` (app pode estar fechado) | não |
| **HTTP** `http://localhost:8770/mcp` | com o app rodando (`npm start`) | sim |

**Claude Code, stdio** (já com o caminho deste repositório):

```powershell
claude mcp add gt7 -- node --disable-warning=ExperimentalWarning --import file:///C:/Users/lucas/Projects/gt7/node_modules/tsx/dist/loader.mjs C:\Users\lucas\Projects\gt7\packages\mcp\src\stdio.ts --data C:\Users\lucas\Projects\gt7\data
```

Use `--scope user` para valer em todos os projetos.

**Claude Code, HTTP** (app rodando):

```powershell
claude mcp add --transport http gt7-live http://localhost:8770/mcp
# com --token no servidor:
claude mcp add --transport http gt7-live http://localhost:8770/mcp --header "Authorization: Bearer SEU_TOKEN"
```

**Claude Desktop (stdio)**: edite `%APPDATA%\Claude\claude_desktop_config.json` e reinicie o Claude Desktop:

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

Pontos de atenção: o `--import` precisa ser uma **URL `file:///`** (o Claude Desktop inicia o processo em
outra pasta); `node` precisa estar no PATH; o `--data` deve ser a pasta de dados do app (`data`, **não**
`data\demo`). Logs do processo: `%APPDATA%\Claude\logs\mcp-server-gt7.log`. A tela **Configurações › MCP**
do app mostra os mesmos trechos prontos.

Depois, peça em linguagem natural ("faça o debrief da minha última sessão"), ou use os prompts prontos
`debrief_sessao`, `foco_curva` e `plano_treino`. Lista de ferramentas e detalhes:
[packages/mcp/README.md](packages/mcp/README.md).

## Comandos e flags

### Scripts (`npm run ...`)

| Comando | O que faz |
|---|---|
| `npm start` | Servidor + painel compilado; abre o navegador |
| `npm run demo` | Idem com console falso (voltas sintéticas, dados em `data/demo`) |
| `npm run dev` | Servidor + Vite em `http://localhost:5173` |
| `npm run build` | Compila o painel web |
| `npm run mcp` | Servidor MCP stdio (use `npm run -s mcp -- --data data` para o npm não escrever no stdout) |
| `npm run mcp:sample-chart` | Regera os gráficos de exemplo em `docs/` (dados sintéticos) |
| `npm run sniff -- --ps-ip IP` | Conecta ao console e imprime 1 linha por segundo (diagnóstico; opções: `--format A\|B\|~\|C`, `--record arquivo.gt7rec`, `--discover`) |
| `npm run live -- --ps-ip IP` | Linha ao vivo no terminal usando o motor completo (delta, setores) |
| `npm run sim` | Console falso em UDP 33739/33740 (para testar `sniff`/`live` sem PS5) |
| `npm run gen-recording` | Gera uma gravação `.gt7rec` sintética |
| `npm test` / `npm run typecheck` / `npm run lint` | Testes, tipos e lint |

No PowerShell, o formato `~` precisa de aspas: `--format '~'`.

> **Atenção no Windows PowerShell 5.1:** o `npm.ps1` engole o primeiro `--`, então
> `npm run demo -- --no-open` abre o navegador mesmo assim e `npm run -s mcp -- --data X`
> ignora o `--data`. Use `npm.cmd run demo -- --no-open`, repita o separador (`-- --`),
> ou variáveis de ambiente (`$env:GT7_NO_OPEN=1`, `$env:GT7_DATA="C:\caminho\data"`).
> No Git Bash e no cmd funciona normalmente.

### Flags do servidor (`npm start -- ...`, `npm run demo -- ...`)

| Flag | Variável de ambiente | Descrição |
|---|---|---|
| `--port N` | `GT7_PORT` | Porta HTTP/WebSocket (padrão 8770) |
| `--host ADDR` | `GT7_HOST` | Endereço de escuta (padrão `0.0.0.0` = toda a rede; `127.0.0.1` = só este PC) |
| `--data DIR` | `GT7_DATA` | Pasta de dados (padrão `<repo>/data`; com `--sim`, `<repo>/data/demo`) |
| `--ps-ip IP` | `GT7_PS_IP` | IP do PlayStation (padrão: o salvo; senão busca por broadcast) |
| `--format F` | `GT7_FORMAT` | Formato ao vivo `A`, `B`, `~` ou `C` |
| `--token T` | `GT7_TOKEN` | Exige o token em `/api`, `/ws` e `/mcp` (abra o painel com `?token=T`; o QR já leva o token) |
| `--sim` | `GT7_SIM=1` | Demonstração com console falso |
| `--sim-profile P` | | `pro` ou `amateur` (padrão) |
| `--sim-laps N` | | Reinicia a sessão sintética a cada N voltas (0 = nunca) |
| `--sim-seed N` | | Semente do gerador (padrão 7) |
| `--sim-replay` | | Dados sintéticos em modo replay |
| `--dev` | | Inicia também o Vite |
| `--no-open` | `GT7_NO_OPEN=1` | Não abre o navegador |
| `--no-record` | | Não grava as sessões brutas |
| `--verbose` | | Logs de requisição do Fastify |
| `-h`, `--help` | | Ajuda |

A flag vence a variável de ambiente. Dentro do app ainda se configuram (e ficam salvos): IP do console,
formatos ao vivo e de captura, gravação das sessões e referência padrão do delta.

### Outras variáveis

| Variável | Uso |
|---|---|
| `ANTHROPIC_API_KEY` | Chave do coach IA (vence a chave salva no app) |
| `GT7_DATA_DIR` | Pasta de dados do **MCP stdio** (alternativa a `--data`; note o nome diferente de `GT7_DATA`) |

## Onde ficam os dados

Tudo em `data/` (ignorado pelo git; `data/demo` é da demonstração):

| Caminho | Conteúdo |
|---|---|
| `data/sessions.db` (+ `-wal`, `-shm`) | SQLite: sessões, voltas, pistas, curvas, linhas centrais, configurações (inclui a chave da API, se salva), relatórios do coach |
| `data/traces/*.bin.gz` | Dados de cada volta (60 Hz, por canal) |
| `data/recordings/*.gt7rec` | Gravação crua de cada sessão (~20 KB/s); permite reprocessar depois e vira fixture de teste |

- **Backup:** feche o app (`Ctrl+C`) e copie a pasta `data/` inteira (os arquivos `-wal`/`-shm` fazem parte do
  banco). Restaurar = colocar a pasta de volta com o app fechado.
- **Limpeza:** na área de análise, **Apagar volta / Apagar sessão** remove também os traces e a gravação. Para
  zerar tudo, feche o app e apague `data/` (ou só `data/demo`). Relatórios do coach guardam imagens (~0,5–1 MB
  cada); o app mantém os **50 mais recentes** (configurável de 5 a 500 em `PUT /api/coach/config`, campo `maxReports`) e você pode apagar os outros pela tela do Coach.
- A chave da API salva fica em texto no banco local: não compartilhe a pasta `data/`.

## Solução de problemas

| Sintoma | O que verificar |
|---|---|
| **Sem dados / "console não conectado"** | PS5 ligado e **dentro de uma pista** (não no menu). IP correto em Configurações (ou `--ps-ip`). Firewall com UDP 33740. Nenhum outro app de telemetria aberto. Teste isolado: `npm run sniff -- --ps-ip <IP> --format B` (feche o app antes: ambos usam a porta 33740) |
| **Aviso "porta UDP já em uso"** | Outro programa (SimHub, outra cópia do app, `sniff`) está com a 33740. O painel abre, mas sem dados ao vivo |
| **IP errado / mudou** | PS5 trocou de IP depois de reiniciar o roteador. Releia em Configurações › Rede e atualize. Reserve IP fixo no roteador |
| **Celular não abre a URL** | Mesma rede Wi-Fi? Regra TCP 8770 criada e rede do PC como "Privada"? Roteador com isolamento de clientes / rede convidado? Use o IP mostrado em "No celular:" (há PCs com várias placas: tente as URLs alternativas) |
| **Painel diz "Sem conexão com o servidor"** | O servidor caiu ou o celular está em outra rede. Ele tenta reconectar sozinho (botão "Tentar agora") |
| **iPhone apaga a tela** | Ajustes › Tela e Brilho › Bloqueio automático › Nunca. O truque do vídeo pode não funcionar no iOS; veja o roteiro de testes |
| **Formato `~` sem dados** | Espere ~10 s: o app cai sozinho para `B` e avisa. Se não cair, escolha `B` em Configurações › Formato ao vivo. Perde-se o acelerador/freio "crus" |
| **Replay não mostra dados (captura)** | O replay não envia `~`: a captura usa `B` (troca de até ~15 s). Inicie a captura **antes** do play e aguarde "Aguardando o replay cruzar a linha de chegada" |
| **Captura rejeitada** | Leia o motivo: pausa, salto, pacotes perdidos, comprimento da pista, tempo diferente do ranking (±0,3 s) ou carro diferente. Assista de novo a 1×, sem pular |
| **Delta/setores não aparecem** | Precisa da 1ª volta completa e válida na pista (e de uma referência). Volta 0 (saída) não conta |
| **Mapa vazio** | Antes do primeiro laço fechado ele mostra o caminho parcial; depois usa a linha gravada da pista |
| **Muitas voltas "inválidas"** | Pausa, perda de pacotes (Wi-Fi) ou teletransporte. Melhore a rede do PS5 |
| **Mensagem de ExperimentalWarning do SQLite** | Os scripts já a suprimem; se rodar `node` à mão use `--disable-warning=ExperimentalWarning` |

## Limitações conhecidas

- **Nada foi validado com um console real ainda** (veja [docs/primeiro-teste-com-ps5.md](docs/primeiro-teste-com-ps5.md)).
  Itens incertos: cadência mínima do heartbeat, XOR e layout do pacote C, comportamento em replay (carro
  focado, suavização), codificação de ré/neutro, sinais do volante/rotação das rodas, orientação (espelhamento)
  do mapa, unidades de sway/heave/surge e de `energyRecovery`, tempo da volta no pacote de troca de volta.
- **Replay é suavizado**: referências do top valem para coaching (metros, km/h), não para milésimos.
- O GT7 **não envia** dados de outros carros, nome/ID da pista, setores, desgaste de pneu, temperatura de freio
  (temperatura de água e óleo são fixas). Pista e setores são inferidos pelo app.
- **Sem nomes de carro**: aparece "Carro #código" (falta um catálogo).
- Pacotes `B`/`~` têm restrições relatadas em Sport Mode online; o `A` é o mais compatível.
- Um update do GT7 pode mudar formatos (já aconteceu, de forma aditiva).
- Referência do top: o app não sabe qual carro está em foco no replay; no Time Trial só há um carro.
- Mudar os portais de setor deixa os tempos de setor antigos inconsistentes (não são recalculados).
- Frenagem logo após a linha de chegada (curva 1 colada na largada) pode não ser vista pela análise.
- Evolução e tendências ainda não consideram mudança de acerto, pneus ou condições.
- Sem zoom por gesto nos gráficos de análise no celular (rolagem funciona); a área de análise é pensada para
  o navegador do PC.
- O coach não tem orçamento em dinheiro nem fila: dois debriefs simultâneos rodam em paralelo.
- Sem autenticação por padrão (app de LAN). Use `--token` se a rede não for de confiança.
- A "tela sempre ligada" em `http` não foi testada em celular real.

## Estrutura do projeto

```
gt7/
  packages/
    shared/     contratos TypeScript (pacote, domínio, análise, API, WebSocket, UI) - isomórfico
    protocol/   Salsa20, parse A/B/~/C, ingestor UDP, gravação .gt7rec, console falso e dados sintéticos
    core/       motor ao vivo (voltas, delta, setores, pistas), SQLite, captura de referência, AnalysisService
    analysis/   análise pura: linha da pista, curvas, métricas, comparação, diagnósticos, consistência
    server/     Fastify: painel, REST, WebSocket, MCP HTTP, coach IA, QR, firewall
    mcp/        servidor MCP (stdio + HTTP), ferramentas, prompts e gráficos PNG
    web/        painel ao vivo (11 telas) e área de análise (React + Vite, PWA)
  docs/         guias e gráficos de exemplo
  data/         seus dados (fora do git)
```

Documentos:

- [ESTUDO-TELEMETRIA-GT7.md](ESTUDO-TELEMETRIA-GT7.md): como o protocolo de telemetria do GT7 funciona.
- [PLANO-APP.md](PLANO-APP.md): requisitos, arquitetura e decisões de produto.
- [DECISOES.md](DECISOES.md): registro técnico por onda, pendências e suposições não verificadas.
- [docs/primeiro-teste-com-ps5.md](docs/primeiro-teste-com-ps5.md): checklist da primeira sessão com o console.
- [docs/guia-de-pilotagem.md](docs/guia-de-pilotagem.md): o que cada métrica significa e como treinar.
- READMEs dos pacotes: [server](packages/server/README.md), [mcp](packages/mcp/README.md),
  [protocol](packages/protocol/README.md).
