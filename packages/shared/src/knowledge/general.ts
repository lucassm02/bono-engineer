/**
 * General driving principles (pt-BR) and per-corner-type advice. Written in our own words from the
 * sources in ./sources.ts. Every point says how solid it is (`basis`).
 *
 * Reminder for whoever uses it: the app has NO table of absolute braking points; the only braking
 * points that exist are the ones measured on the driver's own laps (and on captured replays).
 */

import type { GeneralTopic, KnowledgeCornerKind, Tip } from './types.ts';

const rg = (text: string, ...src: string[]): Tip => ({
  text,
  basis: 'general-rule',
  ...(src.length ? { src } : {}),
});
const dc = (text: string, ...src: string[]): Tip => ({
  text,
  basis: 'car-dependent',
  ...(src.length ? { src } : {}),
});
const fo = (text: string, ...src: string[]): Tip => ({ text, basis: 'sources', src });

export const GENERAL_TOPICS: readonly GeneralTopic[] = [
  {
    id: 'braking-point',
    title: 'Ponto de frenagem',
    summary:
      'Onde o pé sai do acelerador e vai ao freio. O ganho está em chegar ao ápice com a velocidade certa, não em frear o mais tarde possível.',
    points: [
      rg(
        'O app mede o ponto de frenagem das SUAS voltas (metros antes da entrada da curva). Não existe tabela de pontos de frenagem do GT7: compare sempre com voltas medidas (a sua melhor ou uma referência de replay).',
        'fisica-geral',
      ),
      fo(
        'Use uma referência visual fixa (placa, zebra, sombra, marca no asfalto) em vez de "sentir" a distância; frear a tempo e de forma repetível vale mais do que frear no limite uma volta e longe dele na seguinte.',
        'dgedge-5-reasons',
      ),
      rg(
        'Mexa no ponto em passos pequenos (5 a 10 m por volta) e confira a V-mín e a saída: se a V-mín cair mais de uns 2 a 3 km/h ou o carro passar do ápice, volte um passo.',
        'sintese-propria',
      ),
      fo(
        'Freie com o carro o mais reto possível e o volante parado: a frenagem em reta aguenta mais pressão e é mais previsível, sobretudo depois da física da atualização 1.49 (carros mais pesados, frear antes).',
        'dgedge-physics-149',
        'coachdave-gr4',
      ),
      rg(
        'Frear tarde demais costuma custar a saída: o carro chega ao ápice rápido demais, não gira e a retomada do acelerador atrasa. Se a "frenagem tardia" veio com V-mín menor, ela não rendeu nada.',
        'fisica-geral',
      ),
      fo(
        'Os marcos oficiais do jogo (zebra, placas de 100 m e 50 m) ajudam a construir a referência visual no início.',
        'gt-apex',
      ),
    ],
  },
  {
    id: 'brake-pressure',
    title: 'Pressão e modulação do freio',
    summary:
      'Pise firme e cedo, alivie progressivamente. A pressão certa muda com a velocidade, a aerodinâmica e as assistências.',
    points: [
      rg(
        'Formato típico de uma boa frenagem: sobe rápido até o pico, mantém por pouco tempo e desce em rampa conforme a velocidade cai. Pisar devagar no começo desperdiça distância; soltar de uma vez no fim desestabiliza o carro.',
        'fisica-geral',
      ),
      rg(
        'A aderência disponível para frear cresce com a carga aerodinâmica, que cai junto com a velocidade. Em carros com muito downforce o pico pode ser mais forte em alta velocidade e precisa aliviar mais cedo à medida que o carro desacelera.',
        'fisica-geral',
      ),
      fo(
        'Em curvas médias o guia da DG-EDGE sugere uso moderado do freio (em torno de metade do curso) em vez de pisar fundo: sobrefrear só gasta pneu e tempo.',
        'dgedge-5-reasons',
      ),
      dc(
        'Com ABS ligado o carro tolera um pico mais alto sem travar, mas o ABS atuando já alonga a frenagem. Sem ABS o pico precisa ser dosado; jogadores relatam que, desligado, dá para pisar mais forte no início (opinião de comunidade, sem validação).',
        'gtplanet-forum',
      ),
      rg(
        'Travar a dianteira (frontLock no app) significa pico alto demais para a aderência do momento: reduza o pico em 5 a 10 pontos percentuais antes de mexer no ponto de frenagem.',
        'sintese-propria',
      ),
    ],
  },
  {
    id: 'trail-braking',
    title: 'Trail braking (frear virando)',
    summary:
      'Levar um resto de freio para dentro da curva, aliviando até o ápice, para ajudar o carro a girar. Pouco e progressivo.',
    points: [
      rg(
        'Manter um pouco de freio enquanto o volante entra mantém o peso na frente e dá mais aderência às rodas dianteiras, o que ajuda a girar o carro. Quanto mais volante, menos freio: o limite de aderência é compartilhado.',
        'fisica-geral',
      ),
      fo(
        'O custo é o pneu dianteiro: trail braking aquece e gasta mais o pneu da frente, e o desgaste forte do pneu derruba a aderência depois de ~50% de desgaste. Use onde rende, não em todas as curvas.',
        'dgedge-physics-149',
      ),
      rg(
        'Solte o freio em rampa, nunca de uma vez: soltar de repente tira peso da dianteira e a traseira pode escapar (sobresterço), principalmente em RWD e motor central.',
        'fisica-geral',
      ),
      rg(
        'Onde usar: curvas lentas e médias (grampo, curva lenta, curva de média com frenagem forte). Em curvas rápidas quase não há freio, e trail braking forte ali é erro.',
        'sintese-propria',
      ),
      dc(
        'Tração dianteira e 4WD toleram mais trail braking (a dianteira "puxa" o carro); RWD e motor central pedem um resto de freio menor e mais gradual.',
        'coachdave-gr3',
        'coachdave-gr4',
      ),
    ],
  },
  {
    id: 'rotation',
    title: 'Rotação do carro (entrada e ápice)',
    summary:
      'Fazer o carro apontar para o ápice sem perder aderência dianteira nem soltar a traseira.',
    points: [
      rg(
        'Subesterço (o carro "não fecha") quase sempre vem de pedir demais da dianteira: entrar rápido, volante demais ou freio demais. A correção é menos volante e menos freio por um instante, não mais volante.',
        'fisica-geral',
      ),
      rg(
        'Sobresterço (a traseira sai) vem de transferir peso para a frente de repente (soltar o freio de uma vez, tirar o pé do acelerador no meio da curva) ou de acelerar forte com o volante ainda aberto.',
        'fisica-geral',
      ),
      rg(
        'Uma entrada de volante única, suave e constante gira mais do que várias correções: correções de volante repetidas (steeringCorrections) mostram que o carro está sendo pedido além do que dá.',
        'sintese-propria',
      ),
      dc(
        'Motor central (MR) responde mais rápido ao volante e tende a sobreviras ao exagerar; FR tende a subesterço na entrada; FF empurra a dianteira para fora; 4WD costuma ter entrada estável e tração forte.',
        'coachdave-gr3',
        'coachdave-gr4',
      ),
    ],
  },
  {
    id: 'exit-and-throttle',
    title: 'Saída e retomada do acelerador',
    summary:
      'A saída vale tempo em toda a reta seguinte. Acelere assim que o carro estiver apontado, de forma progressiva.',
    points: [
      rg(
        'Uma saída mais lenta custa tempo na reta inteira que vem depois: priorize as curvas que antecedem retas longas (ápice um pouco mais tarde, acelerador mais cedo).',
        'sintese-propria',
      ),
      rg(
        'Volta ao acelerador junto da abertura do volante: quanto mais reto o volante, mais acelerador. Pé a fundo com o volante muito aberto gera patinagem (TCS atuando) e perde tempo.',
        'fisica-geral',
      ),
      rg(
        'Evite "roda livre" (nem freio nem acelerador) entre a frenagem e a retomada: o carro fica sem apoio e perde tempo sem ganhar estabilidade. Emende o fim do freio com o início do acelerador.',
        'sintese-propria',
      ),
      fo(
        'Os carros híbridos (Gr.1) aceleram forte já na saída por causa do torque elétrico: a retomada precisa ser mais dosada do que o gráfico de velocidade sugere.',
        'coachdave-gr1',
      ),
      dc(
        'Em tração traseira com muita potência, o TCS atuando na saída é sinal de acelerador abrindo antes do volante estar quase reto.',
        'sintese-propria',
      ),
    ],
  },
  {
    id: 'racing-line',
    title: 'Linha e uso da pista',
    summary:
      'Entrar aberto, passar o ápice rente à zebra e abrir a saída até a borda: use a largura toda.',
    points: [
      fo(
        'Usar a pista inteira (borda externa na entrada, ápice na zebra, borda externa na saída) faz a curva mais larga e mais rápida.',
        'dgedge-5-reasons',
      ),
      rg(
        'Ápice tardio (late apex) antes de retas: perde-se um pouco de V-mín na entrada, mas a saída endireita antes e rende mais na reta. Ápice cedo deixa o carro abrir na saída.',
        'fisica-geral',
      ),
      rg(
        'Em curvas ligadas ou chicanes, sacrifique a primeira para acertar a segunda (o que importa é a saída da última).',
        'sintese-propria',
      ),
      rg(
        'Saída "mais aberta que a referência" costuma ser acelerador demais para o volante; saída "mais para dentro" é ápice cedo ou medo de usar a pista.',
        'sintese-propria',
      ),
    ],
  },
  {
    id: 'tyres',
    title: 'Pneus',
    summary: 'Aderência cai com desgaste e superaquecimento; ao virar cedo o pneu da frente sofre.',
    points: [
      fo(
        'Depois da física 1.49 a aderência cai de forma acentuada em torno de 50% de desgaste e o pneu dianteiro gasta mais quando se vira cedo ou se faz trail braking.',
        'dgedge-physics-149',
      ),
      rg(
        'Compostos mais duros duram mais e dão menos aderência; os macios o contrário. Em stints longos, o ritmo cai volta a volta: acompanhe a queda no app antes de culpar a técnica.',
        'fisica-geral',
      ),
      rg(
        'A telemetria do GT7 informa uma temperatura de superfície por pneu (não interna/central/externa). Dá para comparar esquerda × direita e frente × trás, não para ler camber pela temperatura.',
        'sintese-propria',
      ),
      rg(
        'Eventos com multiplicadores de desgaste (2x a 10x) mudam o plano: poupe o pneu da frente (menos trail braking, entrada mais suave) quando o multiplicador é alto.',
        'sintese-propria',
      ),
    ],
  },
  {
    id: 'consistency',
    title: 'Consistência',
    summary:
      'Separe erro de técnica (sempre igual) de erro de consistência (varia entre voltas); cada um se treina de um jeito.',
    points: [
      rg(
        'Se o ponto de frenagem, a V-mín ou a retomada variam muito entre voltas, o problema é de repetição: fixe uma referência visual e um ritmo antes de caçar décimos novos.',
        'sintese-propria',
      ),
      rg(
        'Os limiares do app são: ponto de frenagem ~5 m, V-mín ~3 km/h, retomada do acelerador ~8 m, velocidade de saída ~3 km/h, roda livre ~0,2 s. Variações acima disso entre voltas contam como inconsistência.',
        'sintese-propria',
      ),
      rg(
        'Mude uma coisa por vez e repita 5 voltas antes de concluir: uma volta isolada mais rápida pode ser sorte.',
        'sintese-propria',
      ),
      rg(
        'Pilotar um pouco abaixo do limite de forma constante quase sempre rende melhor tempo médio e menos desgaste do que alternar voltas no limite e erros.',
        'dgedge-5-reasons',
      ),
    ],
  },
  {
    id: 'assists',
    title: 'Assistências (ABS, TCS, ASM) e balanço de freio',
    summary:
      'As assistências mudam o que é possível fazer no pedal. Mexa uma por vez e meça no app.',
    points: [
      fo(
        'O guia oficial para iniciantes coloca o TCS num nível intermediário (3) e o ABS no padrão. É um ponto de partida, não um ideal: o resumo veio de resultados de busca e deve ser confirmado.',
        'gt-apex',
      ),
      rg(
        'TCS atuando na saída (tcsActive) = acelerador abrindo mais do que a tração aguenta. Reduza o TCS aos poucos (um nível por sessão) depois de corrigir a dosagem, nunca antes.',
        'sintese-propria',
      ),
      dc(
        'O ABS evita travar mas alonga a frenagem quando atua; desligá-lo exige modulação precisa e pode render distância, ou perder o controle (relato de comunidade, sem validação).',
        'gtplanet-forum',
      ),
      fo(
        'Balanço de freio (-5 a +5 no jogo) é um ajuste de estabilidade: mais para trás ajuda a virar sob freio e é comum em pistas rápidas; mais para a frente estabiliza e é comum em grampos. O ponto de partida depende do layout (MR perto de 0/-1, FR por volta de +2/+3, FF mais para trás, 4WD mais para a frente).',
        'dgedge-brake-balance',
      ),
      rg(
        'Assistências ligadas costumam custar um pouco de tempo; desligá-las só compensa quando a técnica já está estável (veja consistência).',
        'sintese-propria',
      ),
    ],
  },
  {
    id: 'drivetrain',
    title: 'Layout e tração (FF, FR, MR, 4WD)',
    summary:
      'O catálogo do app só diz o grupo do carro, não a tração. Pergunte ao piloto ou observe o comportamento antes de ajustar o conselho.',
    points: [
      dc(
        'FR (motor dianteiro, tração traseira): tende a subesterço na entrada e a sobresterço ao abusar do acelerador na saída; previsível em Gr.4.',
        'coachdave-gr3',
        'coachdave-gr4',
      ),
      dc(
        'MR (motor central): gira fácil e responde rápido ao volante; pode sobrevirar se o freio for solto de uma vez ou se o volante for brusco.',
        'coachdave-gr3',
      ),
      dc(
        'FF (tração dianteira): subesterço na saída ao acelerar com o volante aberto; trail braking ajuda a girar; camber exagerado atrapalha a consistência.',
        'traxion-fwd',
      ),
      dc(
        '4WD (integral): tração forte e saída cedo, mas pode empurrar a dianteira na entrada; costuma aceitar acelerador mais cedo.',
        'coachdave-gr4',
      ),
    ],
  },
  {
    id: 'how-to-practise',
    title: 'Como treinar (exercícios mensuráveis)',
    summary: 'Um foco por sessão, cinco voltas, meta numérica que o app consegue conferir.',
    points: [
      rg(
        'Escolha 1 curva (no máximo 2) por sessão. Faça 5 voltas mexendo numa única variável e confira o resultado no app (V-mín, saída, tempo da curva).',
        'sintese-propria',
      ),
      rg(
        'Exemplos de meta: "V-mín ≥ X km/h em 4 de 5 voltas", "ponto de frenagem com desvio-padrão < 5 m", "TCS ativo < 0,2 s na saída".',
        'sintese-propria',
      ),
      rg(
        'Após o exercício, rode a volta completa e veja se o ganho local virou ganho de tempo: melhorar uma curva às custas da saída seguinte não conta.',
        'sintese-propria',
      ),
    ],
  },
];

/** Advice by corner type, as detected by the app (`Corner.kind`). */
export const CORNER_TYPE_ADVICE: Readonly<
  Record<KnowledgeCornerKind, { title: string; tips: readonly Tip[] }>
> = {
  hairpin: {
    title: 'Grampo (curva muito lenta)',
    tips: [
      rg(
        'Frenagem longa e em reta, trail braking progressivo, ápice tardio e saída priorizada; marchas baixas (1ª a 2ª), com cuidado na retomada para não patinar.',
        'fisica-geral',
      ),
      fo(
        'Balanço de freio mais à frente costuma ajudar em grampos, em pista com muitas curvas lentas.',
        'dgedge-brake-balance',
      ),
    ],
  },
  slow: {
    title: 'Curva lenta',
    tips: [
      rg(
        'Trail braking vale a pena; sacrifique a entrada para ter saída forte, sobretudo se vier uma reta.',
        'sintese-propria',
      ),
    ],
  },
  medium: {
    title: 'Curva média',
    tips: [
      fo(
        'Freio moderado e curto, V-mín alta e linha limpa; evite sobrefrear. Aqui o equilíbrio entre entrada e saída é mais sensível.',
        'dgedge-5-reasons',
      ),
    ],
  },
  fast: {
    title: 'Curva rápida',
    tips: [
      rg(
        'Quase sem freio: suavidade com volante e acelerador, confiança no downforce. Erro aqui tira velocidade da reta seguinte inteira; um alívio curto de acelerador costuma bastar.',
        'fisica-geral',
      ),
    ],
  },
  kink: {
    title: 'Leve inflexão (kink)',
    tips: [
      rg(
        'Normalmente a fundo ou com leve alívio; o ganho está em um traçado limpo, sem correção de volante.',
        'sintese-propria',
      ),
    ],
  },
  chicane: {
    title: 'Chicane',
    tips: [
      rg(
        'Sacrifique a primeira perna para alinhar a segunda; use a zebra e mantenha o carro o mais reto possível entre as inflexões; a saída da última manda.',
        'sintese-propria',
      ),
    ],
  },
};

/** Rules the coach must follow when using the base (also shown in the guide page). */
export const COACH_RULES: readonly string[] = [
  'Cite sempre os números da telemetria (você × referência) antes de recomendar.',
  'Adapte o conselho à classe do carro (Gr.1, Gr.2, Gr.3, Gr.4, Gr.B, N, X) e, se o piloto disser, à tração (FF/FR/MR/4WD).',
  'Diga quando a recomendação é "regra geral" e quando "depende do carro"; não afirme o que a base marca como pouca evidência.',
  'NUNCA invente pontos de frenagem absolutos (distâncias, placas, marcas de pista): o app só conhece os medidos nas voltas do piloto e nas referências capturadas.',
  'Proponha UMA ação principal por curva e um exercício de 5 voltas com critério medível.',
  'Se o carro da referência for de outra class/carro, avise que frenagem, V-mín e marcha não são comparáveis 1:1.',
  'Mudanças de afinação: só como hipótese, uma por vez, em passos pequenos, e depois de a técnica estar estável.',
];
