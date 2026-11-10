# Primeiro teste com o PS5: checklist de validação

Tudo no app foi desenvolvido e testado com **dados sintéticos** (o "Synthetic Ring" e o console falso). Várias
suposições sobre o GT7 real ainda **não foram verificadas**; elas vêm do [estudo](../ESTUDO-TELEMETRIA-GT7.md)
(§9) e das seções "Pendências" do [DECISOES.md](../DECISOES.md). Este roteiro transforma cada uma em um teste
curto, com o resultado esperado e o que ajustar se o console real se comportar diferente.

**Regra de ouro: grave tudo.** Cada teste abaixo deve gerar um arquivo `.gt7rec`. Guarde-os (com um nome
descritivo, ex.: `C-superficie-grama.gt7rec`) numa pasta como `data/recordings/primeiro-teste/` e **não apague**:
eles viram *fixtures* de regressão (dá para reenviar a gravação inteira com `npm run sim -- --recording arquivo`
ou ler os pacotes em testes) e permitem corrigir o parser depois sem precisar ligar o console de novo.

## Preparação

- [ ] `npm install` e `npm run build` feitos; Node 24+.
- [ ] IP do PS5 anotado (Configurações › Rede › Ver status da conexão). Abaixo, `IP` = esse endereço.
- [ ] Firewall: regra de entrada **UDP 33740** (e TCP 8770 para o celular). Comandos em [README](README.md#firewall-do-windows).
- [ ] PC e PS5 na mesma sub-rede; **nenhum outro app de telemetria aberto** (SimHub etc.).
- [ ] Pasta para guardar os testes: `mkdir data\recordings\primeiro-teste`.
- [ ] Um carro e uma pista simples e conhecidos (por exemplo, uma pista com uma curva fechada à direita logo
      depois da largada, para o teste do mapa). Anote qual.

### Duas ferramentas

**1. `sniff` (diagnóstico cru, sem o app).** Imprime uma linha por segundo e grava a sessão. Ele e o app usam a
**mesma porta UDP 33740**: nunca rode os dois ao mesmo tempo.

```powershell
npm run sniff -- --ps-ip IP --format B --record data/recordings/primeiro-teste/NOME.gt7rec
```

Formatos: `--format A`, `B`, `'~'` (com aspas no PowerShell) e `C`. Colunas da linha:
`km/h rpm marcha(sugerida) acelerador freio volta última melhor | formato taxa(Hz) perda% flags`.
`Ctrl+C` fecha a gravação e mostra quantos pacotes foram salvos. Saídas `[sniff] state ...` mostram o estado
do ingestor e `[sniff] warning: ...` mostram avisos (por exemplo, XOR diferente do esperado).

**2. Inspetor de gravação.** Para olhar campos que o `sniff` não imprime, salve este arquivo na raiz do
repositório como `tmp-inspect.ts` (é descartável; apague depois) e rode
`node --disable-warning=ExperimentalWarning --import tsx tmp-inspect.ts caminho/da/gravacao.gt7rec`:

```ts
import { loadRecording, parsePacket } from '@gt7/protocol';

const { header, records } = await loadRecording(process.argv[2]!);
console.log('formato', header.format, 'pacotes', records.length, 'meta', header.meta);
const ps = records.map((r) => parsePacket(r.data, header.format));

// marchas (atual/sugerida) e faixa de velocidade em cada uma
const gears = new Map<string, { n: number; min: number; max: number }>();
for (const p of ps) {
  const k = `${p.gear}/${p.suggestedGear}`;
  const v = p.speedMps * 3.6;
  const g = gears.get(k) ?? { n: 0, min: 1e9, max: -1 };
  gears.set(k, { n: g.n + 1, min: Math.min(g.min, v), max: Math.max(g.max, v) });
}
console.table(Object.fromEntries(gears));

// sinais: volante x guinada, rotação das rodas, G lateral
const corr = (a: number[], b: number[]) => {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i]! - ma) * (b[i]! - mb); saa += (a[i]! - ma) ** 2; sbb += (b[i]! - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
};
const mov = ps.filter((p) => p.speedMps > 10);
const yaw = mov.map((p) => p.angularVelocity.y);
if (mov[0]?.steeringAngle !== undefined) console.log('corr(volante, guinada)', corr(mov.map((p) => p.steeringAngle!), yaw).toFixed(2));
if (mov[0]?.sway !== undefined) console.log('corr(sway, guinada)', corr(mov.map((p) => p.sway!), yaw).toFixed(2));
console.log('rotação das rodas (1ª amostra em movimento)', mov[0]?.wheelRps);

// volta: em que pacote muda lapCount e em qual muda lastLapMs?
for (let i = 1; i < ps.length; i++) {
  const a = ps[i - 1]!, b = ps[i]!;
  if (a.lapCount !== b.lapCount) console.log(`pacote ${i}: lapCount ${a.lapCount} -> ${b.lapCount} (lastLapMs ${a.lastLapMs} -> ${b.lastLapMs})`);
  else if (a.lastLapMs !== b.lastLapMs) console.log(`pacote ${i}: lastLapMs ${a.lastLapMs} -> ${b.lastLapMs} (lapCount ${b.lapCount})`);
}

// extras do ~ e do C
const last = ps.at(-1)!;
console.log('combustível', ps[0]!.fuelLevel, '->', last.fuelLevel, 'capacidade', last.fuelCapacity);
console.log('energyRecovery', ps.map((p) => p.energyRecovery).filter((x) => x !== undefined).slice(0, 5), 'flag', last.energyRecoveryFlag);
console.log('superfícies', [...new Set(ps.map((p) => p.surfaceTypes?.join('')))]);
console.log('currentLapMs (amostra)', ps.slice(0, 600).filter((_, i) => i % 120 === 0).map((p) => p.currentLapMs));
```

Se o seu `parsePacket` reclamar do tamanho/formato, o próprio erro diz o que faltou; é informação útil para o item
correspondente abaixo.

---

## 1. Conexão e cadência do heartbeat

**Incerteza (estudo §9.1):** as fontes divergem (1,6 s, 10 s, 16 s). O app envia **1 heartbeat por segundo**
com timer próprio, que cobre todos os casos.

**Como testar**
1. `npm run sniff -- --ps-ip IP --format B --record data/recordings/primeiro-teste/01-conexao-B.gt7rec`.
2. Entre numa pista e dirija ~2 min.
3. Observe a coluna `Hz` e `loss`. Depois, com o jogo ainda na pista, **mate o sniff** (`Ctrl+C`) e rode de
   novo na hora; veja se os pacotes voltam e em quanto tempo.

**Esperado:** `Hz` ≈ 60, `loss` ≈ 0% (com Wi-Fi ruim, algumas perdas; PS5 por cabo ajuda). Estado vai de
`connecting` para `connected`. Em menus, os pacotes param ou vêm com a flag de "no menu".

**Se divergir:** taxa bem menor que 60 Hz → rede (5 GHz/cabo) ou o console exige outro formato. Sem nenhum
pacote → IP/firewall (veja o README). Se o console parar de transmitir mesmo com o app rodando, o intervalo
do heartbeat precisa mudar: `heartbeatIntervalMs` em `packages/protocol/src/ingestor.ts` (padrão 1000).

**Extra (opcional):** quanto tempo o console continua transmitindo depois que você mata o sniff? Cronometre. O
valor ajuda a calibrar `timeoutMs`/`formatSwitchCooldownMs` (3 s e 15 s) no mesmo arquivo.

## 2. Formatos A, B e `~`: tamanho, XOR e disponibilidade

**Como testar:** repita o item 1 com cada formato, **esperando ≥ 20 s entre uma troca e outra** com o sniff
parado (o console "trava" o primeiro formato):

```powershell
npm run sniff -- --ps-ip IP --format A   --record data/recordings/primeiro-teste/02-formato-A.gt7rec
npm run sniff -- --ps-ip IP --format B   --record data/recordings/primeiro-teste/02-formato-B.gt7rec
npm run sniff -- --ps-ip IP --format '~' --record data/recordings/primeiro-teste/02-formato-til.gt7rec
```

**Esperado:** coluna `|` mostra o formato pedido; sem `warning`. `~` em corrida ao vivo traz acelerador/freio
"crus" e volante.

**Troca de formato:** com o sniff em `A`, mate-o e **imediatamente** rode com `B`. Se a coluna continuar `A`
(ou não chegar nada por um tempo), o console manteve o formato travado: confirma a necessidade da pausa de
~15 s. Repita esperando 20 s e veja se agora troca.

**Se divergir**
- `~` sem pacotes: o app já cai para `B` após 10 s (aviso `formatFallback`). Anote que no seu console o `~`
  não funciona e deixe `B` como formato ao vivo em Configurações.
- Pacotes chegam mas o magic falha: XOR errado para o formato → `PACKET_XOR_KEYS` em
  `packages/shared/src/telemetry.ts`.
- O tempo de trava real diferente de 15 s → `formatSwitchCooldownMs` (ingestor) e `formatLockMs` (console falso).

## 3. Pacote C: existe? XOR e layout

**Incerteza (estudo §9.2):** o formato C (368 bytes) e seu XOR (`0xDEADBEEF`) vêm de uma única fonte.

**Como testar**
1. `npm run sniff -- --ps-ip IP --format C --record data/recordings/primeiro-teste/03-formato-C.gt7rec` e dirija.
2. Veja se aparece `warning: XOR mismatch for format C: key 0x... worked`. O app **tenta os outros XORs
   conhecidos** e avisa uma vez; anote a chave que funcionou.
3. Rode o inspetor na gravação. Passe duas rodas pela **zebra** e duas pela **grama** (se for seguro: em
   Treino livre) e confira os caracteres de `superfícies` (esperado: `T` asfalto, `C` zebra, `G` grama, `D` terra,
   `S` areia, `s` neve) e se `currentLapMs` começa em ~0 na linha de chegada e cresce a cada 1000 ms/s.
4. Teste também `wheelSteerAngle`, `wheelbase` (entre-eixos em metros, ~2,5 a 3 m) e `carCategory`.

**Se divergir:** XOR diferente → ajuste `PACKET_XOR_KEYS.C`. Campos fora do lugar → `packages/protocol/src/layout.ts`
(offsets) e `parse.ts`/`encode.ts`. Se o C não existir no console: desligue/ignore (a opção `C` continua
"experimental" em Configurações), o app funciona com `~`/`B`.

## 4. Replay (captura de referência)

**Incertezas:** carro em foco, suavização, indisponibilidade do `~`, e se `lapCount`/`lastLapMs` se comportam
como ao vivo.

**Como testar**
1. `npm run sniff -- --ps-ip IP --format '~' --record data/recordings/primeiro-teste/04-replay-til.gt7rec` e
   abra um replay do Time Trial (ranking › replay de um piloto). Os pacotes chegam? Em qual formato?
2. Pare e repita com `--format B` (`04-replay-B.gt7rec`): assista uma volta inteira a 1×. Confira no inspetor
   que a posição `position` segue **o carro do replay** (não a câmera) e que `throttle`/`brake` parecem
   suaves (rampas em vez de degraus).
3. Se houver replay com vários carros (replay de corrida), troque o carro em foco no meio e veja se os dados
   saltam: o app valida salto (`discontinuity`).
4. Fluxo completo no app: `npm start`, `#/captura`, preencha piloto e tempo do ranking (use o tempo
   **exato** do ranking) e assista a volta. Resultado esperado: etapas "Trocando o formato…" →
   "Aguardando o replay cruzar a linha de chegada" → "Gravando…" → "Validando…" → **salva**, e o botão
   "Comparar com o seu melhor" funciona. Baixe a gravação `.gt7rec` da sessão de captura (página da sessão ›
   *Baixar gravação*) e guarde.

**Esperado:** `~` sem dados em replay; `B` com dados. Volta validada com comprimento ±2% e tempo ±0,3 s do
ranking.

**Se divergir**
- Tempo medido ≠ ranking por mais de 0,3 s mesmo com a volta limpa → o replay pode rodar com tempo diferente
  ou o `lastLapMs` não vem; ajuste `timeToleranceMs` (padrão 300 ms) e `lengthTolerance` (2%) em `packages/core/src/capture/reference-capture.ts`.
- Replay manda dados do carro errado/com saltos → a captura rejeita (`discontinuity`); documente no
  DECISOES.md e peça a volta sem trocar câmera.
- Replay envia `~` normalmente: então a captura pode usar `~` (opção de formato da captura em Configurações).

## 5. Codificação de marcha: neutro e ré

**Incerteza (estudo §9.3):** o app trata `gear = 0` como neutro/ré, e a sugerida `15` como "nenhuma".

**Como testar:** gravação curta no formato B ou `~` (`05-marchas.gt7rec`) com o carro parado: câmbio em N (se o
carro/câmbio permitir), engate a ré (use câmbio manual), 1ª, e acelere até a 3ª. Rode o inspetor e leia a
tabela `marcha/sugerida`.

**Esperado:** neutro = 0; ré = outro valor (ex.: 15 ou 0). Marchas 1..8 batem com o que o jogo mostra.

**Se divergir:** adapte `decodeGearByte` em `packages/shared/src/telemetry.ts` e o rótulo em
`packages/web/src/lib/format.ts` (hoje `gear <= 0` vira "N"; ré aparece como N).

## 6. Sinais: volante, rotação das rodas, guinada, G lateral

**Incerteza:** o sintético usa **+ = esquerda** para volante e G lateral; `wheelRps` com sinal.

**Como testar:** gravação em `B`/`~` (`06-sinais.gt7rec`) fazendo 2 curvas à **esquerda** e 2 à **direita** bem
marcadas, e uma ré curta. Rode o inspetor e leia: `corr(volante, guinada)`, `corr(sway, guinada)` e os
`wheelRps`. Compare com a tela **Inputs** (barra do volante) e **Forças G**: curva à esquerda deve levar o ponto
do G para a esquerda e o volante para a esquerda.

**Esperado:** correlação **positiva** entre volante e guinada e entre sway e guinada se a convenção do app
(+ = esquerda) vale no console. `wheelRps` pode ser negativo andando para frente (o app usa valor absoluto).

**Se divergir:** inverta o sinal na origem. O ponto único é `parsePacket` (`packages/protocol/src/parse.ts`)
para volante/sway; a análise já alinha sozinha o sinal da guinada (`packages/analysis/src/corners.ts`), mas o
**volante** entra em "correções de volante" e no gráfico (rad → graus), e a **direção das curvas** (esquerda
× direita) vem da geometria (item 7).

## 7. Espelhamento do mapa e direção das curvas (eixo X)

**Incerteza:** a convenção assumida é heading θ=0 → +Z, direção (sin θ, cos θ), curvatura positiva = esquerda.
Se o sistema de coordenadas do GT7 tiver a outra "mão", o **mapa aparece espelhado** e as curvas esquerda/direita
ficam trocadas (o que afeta também o diagnóstico de traçado: "entrada mais para dentro/fora").

**Como testar:** `npm start`, faça 2 voltas numa pista conhecida e abra **Mapa** (painel) e a página da
**Pista** (`#/analise` › sessão › pista). Compare o desenho com a pista no jogo/na internet, e confira os
ícones ↰/↱ de cada curva (T1 é esquerda ou direita de verdade?).

**Esperado:** mapa com a mesma forma da pista (não espelhada); ↰ para curvas à esquerda.

**Se divergir**
- Só o desenho espelhado: inverta `mx` em `packages/web/src/lib/mapMath.ts`.
- **Atenção:** hoje o mapa do **painel/análise web** usa `x` para a direita e `-z` para cima, enquanto o
  **gráfico PNG do MCP/coach** (`packages/mcp/src/chart.ts`) espelha o X (`-x`). Com dados sintéticos eles
  ficam **espelhados um em relação ao outro** (veja a comparação `/api/analysis/chart.png?...` ao lado da página
  de comparação). Decida qual está certo com o console real e alinhe os dois.
- Direção das curvas trocada (↰ onde era ↱): corrigir a convenção de sinal da curvatura na construção da linha
  (`packages/analysis/src/centerline.ts`) e a do `Corner.direction` (`corners.ts`); a convenção está documentada em `packages/shared/src/analysis.ts`.

## 8. Sway / heave / surge (unidades)

**Incerteza:** o sintético emite em g; no jogo a unidade não é documentada.

**Como testar:** gravação `B`/`~` (`08-g.gt7rec`) com uma frenagem forte em reta (esperado ≈ −1 a −1,5 g
no carro de corrida), uma curva rápida e um salto/zebra. No inspetor, imprima máximos/mínimos de `sway`, `surge`
e `heave` (ex.: `Math.max(...ps.map(p => p.surge))`) e compare com a tela **Forças G** (picos por volta).

**Esperado:** |sway| e |surge| na faixa 0,5–2,5 (g). Valores como 10–25 indicam m/s²; valores em centenas, outra escala.

**Se divergir:** converta na origem em `packages/core/src/live/gforce.ts` (`p.sway`, `p.surge`, `p.heave`
usados direto) e veja se o sinal de `surge` (+ = frente) bate: frear deve dar valor negativo.
Lembre-se de que em `A` o app **deriva** o G da velocidade; compare as duas fontes: devem ser parecidas.

## 9. Tempo da volta: quando `lastLapMs` muda

**Incerteza:** o core espera até 60 pacotes pelo `lastLapMs` novo depois da troca de `lapCount`. Se vier no mesmo
pacote (ideal) ou 1 s depois, o resultado é o mesmo; mas se **nunca** vier, ele cai para a contagem de pacotes
(precisão pior).

**Como testar:** gravação `~` ou `B` de 3 voltas completas (`09-voltas.gt7rec`); rode o inspetor: as linhas
`pacote N: lapCount ... (lastLapMs ...)` mostram a ordem dos eventos. Compare o tempo mostrado no app (cartão de
volta/Tempos) com o do jogo, milésimo a milésimo. Se usar o formato C, confira também `currentLapMs`.

**Esperado:** `lastLapMs` igual ao tempo do jogo; o app mostra o mesmo valor, **sem** marca "tempo divergente".

**Se divergir:** `lastLapMs` chega com atraso grande → ajuste a janela de espera em `packages/core/src/live/live-engine.ts`
(opção `lapCloseWaitPackets`, padrão 60). Diferença sistemática de ±1 quadro (~17 ms) é a quantização do pacote e
é esperada; maior que isso, relate com a gravação.

## 10. Combustível e energia (`energyRecovery`)

**Incertezas:** semântica do combustível (litros × % EV), `fuelCapacity = 0` em eventos sem consumo, e a unidade
de `energyRecovery`.

**Como testar:** 3 voltas com um carro a combustão (`10-combustivel.gt7rec`): compare `combustível início → fim`
do inspetor e a tela **Combustível** (consumo por volta, "necessário até o fim"). Depois, se tiver, um
híbrido/EV por 2 voltas: veja se `energyRecovery` muda em frenagem/aceleração e qual a faixa de valores.

**Esperado:** litros decrescendo ~linearmente; em Time Trial/replay a capacidade pode ser 0 ou o consumo não
aparecer (o app mostra "sem consumo"). `energyRecovery` é só uma barra relativa ao máximo da sessão.

**Se divergir:** unidade/escala de `energyRecovery` → `packages/web/src/views/CombustivelView.tsx`.
Consumo por volta errado em corridas com abastecimento → regra "média das últimas 3 voltas" em `live-engine.ts`.

## 11. Identificação de pista entre sessões

**Incerteza:** não há ID de pista no pacote; o app usa impressão digital (largada, comprimento 2D, forma).

**Como testar:** feche o app, rode **2 sessões separadas** na mesma pista (e outra pista no meio). Ao final,
em `#/analise` as voltas das duas sessões devem estar na **mesma pista** (mesmo nome, mesmas curvas). Teste
também a **mesma pista em layout diferente** (ex.: GP × curto) e o **mesmo circuito invertido**.

**Esperado:** mesma pista = reconhecida; layouts diferentes = pistas separadas ("Pista desconhecida N"), sem
mistura. Renomeie as pistas (página da Pista).

**Se divergir** (pistas duplicadas ou misturadas): tolerâncias de `packages/core/src/track/fingerprint.ts`
(30 m de largada, 0,5 rad, 3% de comprimento, RMS 0,3 rad). Junte duplicatas apagando uma e guarde as gravações para
reprocessar.

## 12. Gestos e telas no celular (iOS e Android)

**Incertezas:** scroll-snap com recentralização no iOS Safari, `scrollend`, pinça no Mapa, vibração (só
Android), voz pt-BR, e o PWA em `http`.

**Como testar** (celular em paisagem, `npm run demo` serve para isso sem o console; depois repita com o jogo):
- [ ] Deslizar entre telas é suave e circular; sem "pulo" visível ao assentar (iOS e Android).
- [ ] Toque (cabeçalho 3 s), toque duplo (troca a referência do delta), segurar 0,6 s (seletor).
- [ ] Cadeado: toque trava; para destravar, segurar 0,6 s. Com o celular travado, toques acidentais não fazem nada.
- [ ] Mapa: pinça dá zoom sem trocar de tela; um dedo arrasta com zoom; com zoom, o toque duplo volta ao todo.
- [ ] Vibração ao trocar de tela (Android; iOS não suporta, é normal).
- [ ] **Treino de curva** com Áudio ligado: a voz em português fala 1 frase por passagem (no iOS exige o toque
      que liga o áudio).
- [ ] Adicionar à tela inicial abre em tela cheia/paisagem? Em `http` o Chrome pode oferecer só um atalho (sem
      service worker): anote o que aconteceu em cada sistema.
- [ ] Rotação: o iOS ignora a orientação do manifest; gire manualmente.

**Se divergir:** `packages/web/src/components/useGestures.ts`, `lib/gestures.ts`, `lib/carousel.ts` e
`components/Carousel.tsx` (swipe); `views/MapaView.tsx`/`widgets/TrackMap.tsx` (pinça); `config.ts` (tempos dos gestos).

## 13. Tela sempre ligada (Wake Lock / vídeo)

**Incerteza:** em `http://192.168...` o Wake Lock não existe; o app usa um vídeo invisível em loop iniciado no
primeiro toque. **Não testado em celular real.**

**Como testar:** abra o painel, toque uma vez, **não toque mais** e deixe o celular 5 minutos com o bloqueio
automático em 30 s. Veja o aviso no seletor ("Tela ligada pelo vídeo invisível" / "Não foi possível manter...").
Teste Android (Chrome) e iPhone (Safari e PWA instalado).

**Esperado:** tela não apaga. Se apagar, o aviso orienta desligar o bloqueio automático.

**Se divergir:** `packages/web/src/lib/wakeLock.ts`. Alternativa documentada no PLANO §3: HTTPS local (mkcert),
que habilita o Wake Lock de verdade.

## 14. Estados e dados de sessão (comportamentos pequenos)

- [ ] Pausar o jogo no meio da volta: a volta fica inválida (`pausa`) e o painel mostra "Pausado".
- [ ] Ir para o menu e voltar: estado "No menu" e retomada sem travar; a sessão termina após 60 s fora da pista.
- [ ] Tocar na tela do console / reiniciar a volta: `lapCount` retrocede → volta descartada (não conta).
- [ ] Sair da pista (grama) no formato C: marca `fora da pista` só com C; sem C, só pelo desvio > 12 m da linha.
- [ ] Wi-Fi ruim de propósito (afastar o PS5): a volta fica "dados incompletos" acima de ~2% de perda.
- [ ] Dois apps mandando heartbeat (estudo §9.5): com o app aberto, rode o `sniff` na porta 33740 não é possível
      (porta ocupada); o teste correto é abrir **outro programa em outro PC** e ver se o app continua recebendo.
      O esperado é que o console siga o último remetente.

## Depois dos testes

1. Copie os `.gt7rec` para um lugar seguro (e inclua no backup de `data/`).
2. Anote os resultados no [DECISOES.md](../DECISOES.md) (uma seção "Primeiro teste com o PS5": o que confirmou,
   o que mudou).
3. Apague `tmp-inspect.ts`.
4. Abra uma sessão real de volta rápida e faça o fluxo completo (ao vivo → captura de referência → comparação →
   debrief); se algo se comportou diferente do esperado nesta lista, o primeiro suspeito é o item correspondente.
