# Relatório: sessões com stints, ciclo de setup e Pit Wall

**Data:** 2026-11-12 · **Origem:** comparação com o APEX Race Telemetry (únicas funções dele que o Bono não tem,
fora "permissões por papel", que você dispensou) · **Base:** leitura do código do Bono, não do app do APEX.

## 1. Resumo

| Função | O que é, em uma frase | Dá para fazer sem backend? | Esforço | Recomendação |
|---|---|---|---|---|
| **Sessões com vários stints** | Dividir a sessão em "saídas de pista" (cada entrada no box fecha um stint) e comparar um stint com o outro | Sim, 100% local | **M** (3 a 5 dias) | Fazer primeiro: é a base das outras duas |
| **Ciclo de setup entre stints** | Você registra o setup, o Bono sugere **uma** mudança, você testa no stint seguinte e ele mede o efeito | Sim, mas exige você informar o setup à mão | **G** (2 a 3 semanas para uma versão enxuta) | Fazer em segundo, começando por poucos sintomas |
| **Pit Wall da equipe** | Uma tela onde o engenheiro vê **todos os pilotos ao vivo** (posição, última volta, delta) | Sim, se cada piloto expõe o próprio Bono e um Bono "anfitrião" junta tudo (modelo federado) | **G** (1 a 2 semanas para o essencial) | Fazer em terceiro, no modelo federado |

Ordem sugerida: **stints → setup → Pit Wall**. A importação/exportação de backup que acabamos de criar já resolve
parte do "comparar entre pilotos" (seção 5.4).

## 2. O que é o "Pit Wall"

O *pit wall* (muro dos boxes) é o muro entre a pista e o box onde ficam os engenheiros com os monitores durante uma
corrida. No APEX, "Pit Wall" é a tela da **equipe**: uma tabela com cada piloto que está na pista agora e, para cada
um, a posição, a última volta, o delta contra a melhor volta e o Top 3. O engenheiro acompanha vários pilotos de um
lugar só e compara as voltas deles. O Bono hoje mostra **um piloto** (o PS5 que está ligado ao PC). O que falta é
juntar vários.

## 3. O que o Bono já tem (fatos do código)

- **Sessão automática:** abre quando o carro entra na pista e só fecha depois de **10 minutos** fora da pista, ou na
  troca de carro ou de pista (`live-engine.ts`, `sessionIdleEndMs`). Então uma ida ao box de poucos minutos já fica
  dentro da mesma sessão. O que não existe é a **divisão em stints**: as voltas ficam todas na mesma lista.
- **Sem sinal de "box" no pacote do GT7:** os flags do pacote são só carro na pista, pausado, carregando, marcha,
  turbo, limitador, freio de mão, luzes, ASM e TCS. Não há "no pit lane". Na prática, entrar no box vira menu/garagem
  (pacotes zerados) e o carro sai de "na pista". Um stint, portanto, é um trecho contínuo com o carro na pista.
- **Análise por curva:** o motor de análise tem diagnósticos como `frontLock` (travada da frente), `exitSlip`
  (patinada na saída), `steeringCorrections` (correções de volante), `lateThrottle`, `lowerMinSpeed`, `coasting` e
  outros (`analysis/src/findings.ts`). Há sinais úteis para setup: patinagem por roda, taxa de guinada, volante,
  G lateral, temperatura e suspensão de cada pneu (já gravados no traço de cada volta).
- **Base de conhecimento:** 46 tópicos de pilotagem por classe de carro e um conjunto de diagnósticos usado pelo coach
  e pelo guia. É o lugar natural para a tabela "sintoma → ajuste".
- **Uma única fonte de telemetria por servidor:** o runtime tem **um** receptor UDP, **um** motor ao vivo e **um** IP
  de console (`runtime.ts`). Várias consoles ao mesmo tempo exigiriam refatorar isso.
- **Proteção de origem:** o servidor recusa páginas de outra origem (`auth.ts`, `registerOriginGuard`), o que importa
  para o Pit Wall (seção 6).

## 4. Sessões com vários stints

### 4.1 Como funcionaria

- **Stint** = período contínuo com o carro na pista. Um novo stint começa quando o carro volta à pista depois de uma
  pausa longa o bastante para ser uma ida ao box (sugestão: 20 segundos fora da pista, configurável), **dentro da
  mesma sessão**.
- **Banco:** nova coluna `stint` (número) em `laps` e uma tabela `stints` (sessão, número, início, fim, voltas, melhor
  volta, média das 5 melhores, anotação, setup ligado). Migração do esquema `v6`, **com backup antes** (regra do projeto).
- **Voltas antigas:** podem ser divididas retroativamente pelos intervalos entre voltas (rotina de migração opcional).
- **Tela da sessão:** voltas agrupadas por stint, cabeçalho de cada stint com ritmo e consistência, botão
  "Comparar com o stint anterior" (média por setor, curvas que mais mudaram).
- **Ao vivo:** o pop-up de volta e o engenheiro passam a saber "stint 2, volta 3". O resumo do engenheiro pode comparar
  com o stint anterior.

### 4.2 Riscos

- Sem sinal de box, um **menu aberto por engano** vira "novo stint". Mitigação: limiar de tempo, edição manual
  (juntar ou separar stints) na tela da sessão.
- Voltas de saída e de entrada do box sujam a média: já são descartadas pelas regras de validade; os stints devem
  reaproveitá-las.

### 4.3 Esforço e testes

**M.** Núcleo (detecção e migração) 1,5 dia, API 0,5 dia, telas 1,5 dia, testes e ajuste de textos 1 dia.

## 5. Ciclo de setup entre stints

### 5.1 O que o APEX promete e o que dá para entregar

Segundo o site deles: com o **BoP desligado** e um **setup-base informado**, o app sugere **uma mudança por vez** no
box; você confirma o valor aplicado e compara o stint seguinte com o anterior para ver o efeito. É um fluxo guiado,
não um ajuste automático.

O Bono **não consegue ler o setup do carro**: o pacote de telemetria não traz molas, amortecedores, diferencial,
aerodinâmica etc. Portanto o setup é **informado pelo piloto**, e o Bono guarda e compara.

### 5.2 Peças

1. **Ficha de setup** (por stint): categorias do GT7 (aerodinâmica, altura, molas, amortecedores, estabilizadoras,
   cambagem e convergência, diferencial, balanço de freio, marchas, pneus, lastro, restritor). O piloto preenche só
   o que mudou; o resto herda do stint anterior.
2. **Motor de sintomas** (determinístico, sem IA, como o resto do engenheiro): a partir das voltas do stint, mede por
   fase de curva (entrada, meio, saída): subesterço, sobresterço, travada, patinada, instabilidade. Reaproveita
   `frontLock`, `exitSlip`, `steeringCorrections` e acrescenta a classificação subesterço/sobresterço pela relação
   entre volante, taxa de guinada e G lateral.
3. **Tabela de ajustes** (sintoma → alavanca → direção → passo), na base de conhecimento: por exemplo, subesterço na
   entrada de curvas lentas → balanço de freio para trás ou estabilizadora dianteira mais mole. Uma sugestão por vez,
   com a justificativa e a evidência (curvas e números).
4. **Validação do efeito:** no stint seguinte, o Bono compara a **mesma métrica nas mesmas curvas** e diz "melhorou /
   piorou / inconclusivo", com mínimo de voltas limpas (sugestão: 3 por stint) e aviso de fatores de confusão (pneu
   gasto, combustível, clima).
5. **Telas:** aba "Setup" na sessão e um convite no menu quando o stint termina ("Entrou no box. Quer testar uma
   mudança?"). O engenheiro **não fala** setup durante a volta; só no box.

### 5.2.1 BoP

Com **BoP ligado** (corridas diárias, Sport), o setup é limitado e o desempenho é ajustado pelo jogo, então as sugestões
perdem sentido. O Bono não consegue detectar o BoP: a tela de setup pergunta ao piloto ("BoP ligado ou desligado?") e
só sugere com BoP desligado, como o APEX.

### 5.3 Riscos

| Risco | Gravidade | Mitigação |
|---|---|---|
| **Conselho errado** (cada carro reage diferente) | Alta | Começar com 3 sintomas e 6 alavancas bem conhecidas, sempre rotulado como "sugestão para testar", sempre reversível; validar com 2 ou 3 carros reais antes de ampliar |
| **Trabalho de digitar o setup** | Média | Preencher só o que mudou, herdar o resto, valores mais usados em menus |
| **Efeito mascarado** por pneu, combustível, clima | Média | Exigir comparação sob condições parecidas e dizer "inconclusivo" quando não der |
| **Precisão da classificação** subesterço/sobresterço | Média | Calibrar com sessões reais do PS5 (o repositório já tem gravações) antes de ligar a sugestão |

### 5.4 Esforço

**G.** Ficha de setup e histórico 4 dias, motor de sintomas 5 dias, tabela de ajustes e conhecimento 3 dias,
validação do efeito 3 dias, telas 4 dias, calibração com dados reais 3 dias. **Dá para entregar uma versão
enxuta em duas etapas:** (a) ficha de setup + comparação de stints, sem sugestões (valor imediato, baixo risco);
(b) sugestões, em um conjunto pequeno.

## 6. Pit Wall da equipe

### 6.1 O obstáculo

A telemetria do GT7 só chega ao PC **dentro da rede local** do piloto (UDP). Cada piloto em uma casa diferente tem o
próprio Bono, e nada junta esses dados. O APEX resolve com um **servidor deles na nuvem**. Você decidiu não ter
backend, então o desenho precisa ser outro.

### 6.2 Opções

| Opção | Como funciona | Sem backend? | Prós | Contras |
|---|---|---|---|---|
| **A. Federado (recomendada)** | Um Bono "anfitrião" se conecta ao Bono de cada piloto (WebSocket servidor a servidor, com o token) e junta os quadros em uma tabela. Entre casas diferentes, usa-se uma VPN gratuita (Tailscale/ZeroTier) ou a mesma rede | Sim | Quase tudo já existe: o WebSocket e o token; nenhum servidor nosso | Cada piloto precisa deixar o Bono acessível (VPN ou rede) |
| **B. Várias consoles no mesmo Bono** | Um PC recebe de vários PS5 na mesma rede | Sim | Ideal para sala de simuladores e eventos | Refatora o receptor único; só funciona na mesma LAN |
| **C. WebRTC ponto a ponto** | Os Bonos falam direto, com sinalização manual (QR ou colar código) | Sim | Funciona entre casas sem VPN | Complexo; parte das redes exige um servidor TURN; difícil de manter |
| **D. Serviço serverless (ex.: Cloudflare Workers)** | Um relé mínimo na nuvem | **Não** (é backend, mesmo pequeno) | Simples para o usuário | Contraria a decisão; custo e manutenção |

### 6.3 O que a opção A entrega

- **Cadastro de pilotos** em Configurações → Equipe: nome, endereço do Bono do piloto e token.
- **Tela Pit Wall:** tabela com piloto, estado (na pista, no box, sem sinal), pista e carro, volta atual, última volta,
  melhor volta, **delta ao vivo**, setores e Top 3 de cada piloto (consultado na API de cada Bono).
- **Comparação entre pilotos:** escolher uma volta de outro piloto como referência (a API já expõe o traço da volta).
- **Sem permissões por papel** (dispensado): qualquer pessoa que tem o endereço e o token vê; o piloto controla o
  acesso por token e pode revogá-lo.
- Os quadros são reduzidos a ~5 por segundo para a tabela, então o tráfego é pequeno.

### 6.4 Cuidados

- **Segurança:** o piloto está dando acesso de leitura ao próprio Bono; exigir token (já existe `--token`) e mostrar na
  tela quem está conectado. Isso não expõe contas nem chaves.
- **Origem:** como a junção é feita **servidor a servidor**, o bloqueio de origem do navegador não atrapalha. Se um dia
  o navegador falar direto com o Bono do piloto, será preciso uma lista de origens permitidas.
- **Privacidade:** o Pit Wall só mostra telemetria de corrida; nada do histórico sai sem o piloto exportar.

### 6.5 Esforço

**G.** Cliente de pares no servidor 3 dias, agregador e API 2 dias, tela e cadastro 4 dias, Top 3 e comparação 2 dias,
testes com 2 Bonos simulados 2 dias. A opção B (mesma LAN) soma mais ~2 semanas de refatoração do receptor.

## 7. Relação com o que acabamos de criar

O **backup `.bono`** permite, hoje, levar voltas entre PCs: o colega exporta e você importa ("Adicionar ao que eu já
tenho"). As pistas iguais são reconhecidas pelo traçado e as voltas dele aparecem ao lado das suas, prontas para o
Comparar. Falta rotular de quem é cada volta (hoje não há nome de piloto na sessão); incluir o **nome do piloto no
manifesto do backup** e nas sessões é um passo pequeno e útil também para o Pit Wall.

## 8. Decisões que preciso de você

1. **Pit Wall:** seguimos com o modelo **federado (A)**, que depende de VPN para pilotos em casas diferentes? Ou o foco
   é sala de simuladores na mesma rede (B)?
2. **Setup:** tudo bem a primeira entrega ser **só ficha de setup + comparação de stints**, deixando as **sugestões**
   para uma segunda etapa, depois de calibrar com sessões reais?
3. **Limiar de stint:** 20 segundos fora da pista é um bom padrão para "foi ao box"?
4. **Nome do piloto:** posso adicionar um campo "Seu nome" nas Configurações e gravá-lo nas sessões e no backup?

## 9. Próximo passo sugerido

Transformar isto em specs numeradas (09 Stints, 10 Setup, 11 Pit Wall) no mesmo formato das anteriores e começar pela
spec 09. Os testes e os critérios de aceite já ficam definidos nas specs.
