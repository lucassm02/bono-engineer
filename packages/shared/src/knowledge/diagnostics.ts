/**
 * One entry per diagnostic code that the app already produces:
 * - corner findings (`CornerFinding.kind`, packages/analysis/src/findings.ts);
 * - lap validity issues (`LapIssueKind`, packages/analysis/src/validity.ts).
 *
 * `DIAGNOSTICS` is a `Record<DiagnosticCode, …>`: adding a code to the shared types without writing
 * its text here is a COMPILE error, and a vitest test (packages/analysis) also scans the analysis
 * sources for codes. Texts say what the app measured, likely causes, ONE main action, a drill and
 * the variation by car group. The thresholds quoted are the app defaults (findings.ts).
 */

import type { CornerFinding, LapIssueKind } from '../analysis.ts';
import type { DiagnosticKnowledge } from './types.ts';

export type DiagnosticCode = CornerFinding['kind'] | LapIssueKind;

/** Codes that come from the corner analysis (coaching). */
export const CORNER_FINDING_CODES = [
  'brakeEarlier',
  'brakeLater',
  'lowerMinSpeed',
  'higherMinSpeed',
  'lateThrottle',
  'earlyThrottle',
  'coasting',
  'noTrailBraking',
  'earlyApex',
  'lateApex',
  'lineOffset',
  'exitSlip',
  'frontLock',
  'steeringCorrections',
  'gearChoice',
  'slowerExit',
  'softBraking',
] as const satisfies readonly CornerFinding['kind'][];

/** Codes about the lap data itself (validity). */
export const LAP_ISSUE_CODES = [
  'offTrack',
  'timeGap',
  'distanceJump',
  'backwards',
  'incomplete',
  'timeMismatch',
] as const satisfies readonly LapIssueKind[];

export const DIAGNOSTICS: Readonly<Record<DiagnosticCode, DiagnosticKnowledge>> = {
  // ---------------------------------------------------------------- braking
  brakeEarlier: {
    code: 'brakeEarlier',
    area: 'braking',
    title: 'Freia mais cedo que a referência',
    meaning:
      'O ponto onde o freio começa está 5 m ou mais antes do da referência (no app, brakePointM menor em relação à entrada da curva).',
    causes: [
      'margem de segurança por medo de travar ou passar do ponto',
      'falta de referência visual fixa para a frenagem',
      'pico de freio baixo, que obriga a começar antes',
      'carro/classe diferente da referência (peso e pneus diferentes mudam o ponto)',
    ],
    fix: 'Avance o ponto de frenagem em passos de 5 m por volta, mantendo o pico firme, até a V-mín começar a cair.',
    drill:
      '5 voltas: volta 1 igual à base; nas seguintes, frear 5 m depois a cada volta. Pare quando a V-mín cair mais de ~2 km/h ou o carro passar do ápice; vale o último ponto bom.',
    byGroup: {
      '1': 'Gr.1: o downforce permite frear bem tarde em alta velocidade, mas avance em passos de 5 a 10 m e alivie o pico mais cedo à medida que o carro desacelera.',
      '2': 'Gr.2 (pouca evidência): trate como Gr.3 com mais cuidado na traseira; passos de 5 m.',
      '3': 'Gr.3: passos de 5 m com pico firme; em FR cuidado para não empurrar a dianteira, em MR cuidado com a traseira ao aliviar.',
      '4': 'Gr.4: o carro tem menos freio efetivo e a traseira solta com facilidade; avance só 3 a 5 m por volta e mantenha a frenagem reta e suave.',
      B: 'Gr.B: carros de rali jogam muito peso; avance em passos curtos e confira a estabilidade antes de frear mais tarde.',
      N: 'Carros de rua (N): frear cedo é normal; só avance o ponto se o ABS não estiver atuando o tempo todo e o carro não mergulhar demais.',
    },
    caveat:
      'Se a referência for replay, os pontos têm precisão de alguns metros; diferenças abaixo de ~10 m são indício, não certeza. Com carro diferente, o ponto não é comparável 1:1.',
    basis: 'general-rule',
    src: ['dgedge-5-reasons', 'dgedge-physics-149', 'fisica-geral'],
  },
  brakeLater: {
    code: 'brakeLater',
    area: 'braking',
    title: 'Freia mais tarde e chega lento ao ápice',
    meaning:
      'O ponto de frenagem está 5 m ou mais depois do da referência e a V-mín é menor (2 km/h ou mais): frear tarde não rendeu nada no meio da curva.',
    causes: [
      'frenagem tardia sem pico suficiente para compensar',
      'soltar o freio tarde e chegar ao ápice com velocidade demais para virar',
      'carro cria subesterço e perde velocidade no meio da curva',
    ],
    fix: 'Freie perto do marco da referência e solte o freio progressivamente até o ápice; o objetivo é a V-mín da referência, não o ponto mais tardio.',
    drill:
      '5 voltas: volta 1 no marco da referência; nas seguintes, 5 m mais cedo ao dar subesterço. Critério: V-mín ≥ a da referência menos 1 km/h e saída igual ou melhor.',
    byGroup: {
      '1': 'Gr.1: pico forte e alívio mais cedo; o excesso de velocidade na entrada de curva lenta aqui vira trava de dianteira e ápice largo.',
      '2': 'Gr.2 (pouca evidência): mesmo conselho do Gr.3; cuidado com a traseira ao soltar o freio de repente.',
      '3': 'Gr.3: confira se a perda é subesterço da dianteira (FR) ou instabilidade da traseira (MR) e solte o freio em rampa.',
      '4': 'Gr.4: frear tarde costuma estourar o ápice; volte 5 m e use um resto de freio muito suave.',
      B: 'Gr.B: tração integral empurra a dianteira em entradas rápidas; volte alguns metros e gire com freio aliviando.',
      N: 'Carros de rua (N): frear tarde demais aumenta mergulho e rolagem; volte o ponto e entre mais devagar.',
    },
    basis: 'general-rule',
    src: ['dgedge-5-reasons', 'fisica-geral'],
  },
  softBraking: {
    code: 'softBraking',
    area: 'braking',
    title: 'Pico de freio baixo',
    meaning:
      'O pico de freio nesta curva é pelo menos 12 pontos percentuais menor que o da referência (20 pontos se a referência é replay, que suaviza pedais).',
    causes: [
      'pisar devagar demais no início da frenagem',
      'medo de travar ou ABS inibindo a pisada',
      'pico bom, mas rampa lenta (pisa só depois de perder distância)',
    ],
    fix: 'Pise forte logo no início da frenagem e vá aliviando conforme a velocidade cai; só depois mexa no ponto de frenagem.',
    drill:
      '5 voltas num ponto de frenagem fixo: pico alvo igual ao da referência (±5 pontos); critério: peakBrake alvo em 4 de 5 voltas sem frontLock.',
    byGroup: {
      '1': 'Gr.1: o carro suporta pico forte em alta velocidade; pise firme no início e alivie cedo, senão trava a dianteira ao desacelerar.',
      '2': 'Gr.2 (pouca evidência): pico firme com alívio progressivo, como em Gr.3.',
      '3': 'Gr.3: pico firme no começo e alívio progressivo; o ABS deixa pisar sem travar, use isso.',
      '4': 'Gr.4: o pico ideal é mais baixo que o de um Gr.3 por causa da traseira; suba aos poucos, vendo se a traseira aguenta.',
      B: 'Gr.B: aumente o pico aos poucos; o peso se transfere devagar nesses carros.',
      N: 'Carros de rua (N): pico alto exige ABS; sem ABS, um pico firme porém dosado evita travamento.',
    },
    caveat:
      'Com referência de replay a forma do pedal é suavizada: trate como indício. Pico baixo em curva rápida pode ser intencional.',
    basis: 'general-rule',
    src: ['dgedge-5-reasons', 'fisica-geral'],
  },
  noTrailBraking: {
    code: 'noTrailBraking',
    area: 'braking',
    title: 'Solta o freio antes de virar',
    meaning:
      'Na referência há trail braking (freio e volante juntos por 0,25 s ou mais), mas aqui o tempo com freio e volante é menos de 40% disso: o freio acaba antes de o carro girar.',
    causes: [
      'soltar o freio de uma vez ao iniciar a curva',
      'medo de sobresterço ao virar com freio',
      'ponto de frenagem tardio demais para dar tempo de aliviar',
    ],
    fix: 'Leve um pouco de freio até perto do ápice, aliviando conforme o volante entra (trail braking).',
    drill:
      '5 voltas numa curva lenta ou média: manter ~10 a 20% de freio na entrada do volante e zerar no ápice. Critério: trail_s da referência ±0,1 s sem aumento de correções de volante.',
    byGroup: {
      '1': 'Gr.1: um trail curto e firme, aliviando cedo; um resto longo de freio com volante sobrecarrega a dianteira.',
      '2': 'Gr.2 (pouca evidência): trail leve e progressivo; cuidado com a traseira em carros antigos.',
      '3': 'Gr.3: em FR, trail ajuda a fechar a linha; em MR, solte em rampa lenta para não perder a traseira.',
      '4': 'Gr.4: a traseira solta fácil; mantenha só um resto mínimo de freio e vire gradualmente.',
      B: 'Gr.B: tração integral aceita trail para girar a dianteira; solte em rampa suave.',
      N: 'Carros de rua (N): em FF o trail é a principal ferramenta para girar; em RWD potente, só um toque.',
    },
    caveat:
      'A forma dos pedais em replay é suavizada; trail_s da referência de replay é indício, não medida exata.',
    basis: 'general-rule',
    src: ['dgedge-physics-149', 'coachdave-gr4', 'fisica-geral'],
  },
  frontLock: {
    code: 'frontLock',
    area: 'braking',
    title: 'Dianteira travando na frenagem',
    meaning:
      'As rodas dianteiras travam por 0,08 s ou mais (e mais que na referência): o pico de freio passou da aderência do momento.',
    causes: [
      'pico alto demais, sobretudo em baixa velocidade (com menos carga aerodinâmica)',
      'balanço de freio muito à frente',
      'frear virando, quando a dianteira já divide a aderência com a curva',
    ],
    fix: 'Alivie um pouco o pico de freio e module a pressão quando sentir a roda travar; só depois pense em balanço de freio.',
    drill:
      '5 voltas: pico alvo 5 a 10 pontos abaixo do atual, sem mexer no ponto de frenagem. Critério: frontLock zero e V-mín igual ou maior.',
    byGroup: {
      '1': 'Gr.1: o travamento costuma vir no fim da frenagem, quando o downforce já caiu; alivie o pico mais cedo.',
      '2': 'Gr.2 (pouca evidência): alivie o pico no fim da frenagem, como em Gr.1.',
      '3': 'Gr.3: confira o balanço de freio (mais para trás reduz o travamento da frente) e a pressão de pico.',
      '4': 'Gr.4: dianteira mais leve; alivie o pico antes de entrar na curva e evite frear virando.',
      B: 'Gr.B: em piso com menos aderência o travamento aparece cedo; reduza o pico.',
      N: 'Carros de rua (N): com ABS ligado o valor deveria ser baixo; se aparecer, confira se o ABS está ligado e reduza o pico.',
    },
    basis: 'general-rule',
    src: ['dgedge-brake-balance', 'fisica-geral'],
  },
  coasting: {
    code: 'coasting',
    area: 'braking',
    title: 'Roda livre entre freio e acelerador',
    meaning:
      'Há 0,25 s ou mais sem freio nem acelerador (e 0,15 s a mais que na referência): o carro fica sem apoio entre a frenagem e a retomada.',
    causes: [
      'soltar o freio cedo e esperar o ápice para acelerar',
      'inseguro no ápice (medo de sobresterço ou subesterço)',
      'marcha errada que faz o carro "esperar" a rotação',
    ],
    fix: 'Emende freio e acelerador: não fique sem pedal entre a frenagem e a retomada.',
    drill:
      '5 voltas: acelerar levemente assim que soltar o freio, mantendo ~10 a 20% até o ápice. Critério: coast_s < 0,15 s sem aumento de TCS.',
    byGroup: {
      '1': 'Gr.1: não há como "esperar" no ápice, o downforce já ajuda; mantenha 10 a 15% de acelerador em curvas rápidas.',
      '2': 'Gr.2 (pouca evidência): mesmo conselho do Gr.3.',
      '3': 'Gr.3: acelerador de manutenção no ápice estabiliza o carro; em MR, não tire o pé de uma vez.',
      '4': 'Gr.4: o acelerador de manutenção ajuda a estabilizar a traseira; cuide para não passar de ~20%.',
      B: 'Gr.B: tração integral aguenta acelerador cedo; use para empurrar o carro para fora do ápice.',
      N: 'Carros de rua (N): em FF, acelerador leve após o ápice ajuda a puxar o carro; em RWD, só depois do ápice.',
    },
    basis: 'general-rule',
    src: ['sintese-propria'],
  },
  // ---------------------------------------------------------------- mid corner
  lowerMinSpeed: {
    code: 'lowerMinSpeed',
    area: 'mid-corner',
    title: 'V-mín menor que a referência',
    meaning:
      'A menor velocidade da curva é 2 km/h ou mais abaixo da referência: o carro passa pelo ápice mais lento.',
    causes: [
      'freio solto tarde demais (carro ainda apoiado na frente)',
      'ponto de frenagem cedo demais',
      'subesterço e correções de volante',
      'linha mais fechada que o necessário',
    ],
    fix: 'Carregue mais velocidade até o ápice: alivie o freio mais cedo no fim da frenagem.',
    drill:
      '5 voltas: aliviar o freio 5 m mais cedo, mantendo o volante entrando suave. Critério: V-mín ≥ referência menos 1 km/h.',
    byGroup: {
      '1': 'Gr.1: a V-mín em curva rápida depende de confiança no downforce; mantenha acelerador estável em vez de levantar.',
      '2': 'Gr.2 (pouca evidência): idem Gr.1/Gr.3 conforme a curva.',
      '3': 'Gr.3: em FR, alivie o freio mais cedo para a dianteira recuperar aderência; em MR, volante suave.',
      '4': 'Gr.4: a V-mín é limitada pela aderência; mire linha limpa e saída, não velocidade de ápice.',
      B: 'Gr.B: rolagem do carro limita a V-mín; entradas suaves rendem mais.',
      N: 'Carros de rua (N): pneus de rua limitam muito a V-mín; compare só com sua melhor volta ou referências de carro igual.',
    },
    caveat: 'Se o carro da referência for diferente, a V-mín não é comparável 1:1.',
    basis: 'general-rule',
    src: ['fisica-geral', 'dgedge-5-reasons'],
  },
  higherMinSpeed: {
    code: 'higherMinSpeed',
    area: 'mid-corner',
    title: 'V-mín maior, mas saída pior',
    meaning:
      'A V-mín é 3 km/h ou mais acima da referência, mas a saída é 3 km/h ou mais mais lenta: velocidade carregada demais custa a retomada.',
    causes: [
      'ápice cedo: o carro abre na saída',
      'entrada rápida demais, o carro não endireita',
      'acelerador tardio por falta de rotação',
    ],
    fix: 'Entre um pouco mais devagar para endireitar o carro e acelerar mais cedo.',
    drill:
      '5 voltas: 2 a 3 km/h menos na V-mín, acelerador mais cedo. Critério: exitSpeed ≥ referência menos 1 km/h.',
    byGroup: {
      '1': 'Gr.1: priorize a saída para a reta; ápice mais tardio e acelerador progressivo, aproveitando o torque dos híbridos.',
      '2': 'Gr.2 (pouca evidência): ápice tardio nas curvas antes de reta.',
      '3': 'Gr.3: sacrifique a entrada em curvas antes de retas.',
      '4': 'Gr.4: V-mín alta com saída ruim costuma vir de subesterço; entre mais devagar e use o acelerador cedo.',
      B: 'Gr.B: 4WD premia a saída forte; sacrifique entrada.',
      N: 'Carros de rua (N): a saída vale mais que a V-mín; sacrifique entrada.',
    },
    basis: 'general-rule',
    src: ['fisica-geral', 'sintese-propria'],
  },
  earlyApex: {
    code: 'earlyApex',
    area: 'mid-corner',
    title: 'Ápice cedo (tangenciando cedo)',
    meaning:
      'O ponto de V-mín está 15 m ou mais antes do da referência (só em curvas curtas): o carro chega ao ápice cedo e abre na saída.',
    causes: [
      'virar cedo demais',
      'entrada com muito volante em vez de um traçado longo',
      'medo de sobrar tempo na curva',
    ],
    fix: 'Vire um pouco mais tarde para mirar um ápice mais adiante e abrir a saída.',
    drill:
      '5 voltas: atrasar o ponto de virar em ~3 a 5 m. Critério: apexM da referência ±10 m e saída ≥ a da referência.',
    byGroup: {
      '1': 'Gr.1: ápice cedo é caro porque a reta seguinte é longa; atrase o ponto de virar.',
      '2': 'Gr.2 (pouca evidência): ápice tardio antes de reta.',
      '3': 'Gr.3: ápice um pouco mais tardio ajuda a acelerar mais cedo; confira em MR para não sobrevirar.',
      '4': 'Gr.4: ápice cedo piora o subesterço na saída; atrase.',
      B: 'Gr.B: em rali o ápice cedo faz o carro passar por fora; atrase.',
      N: 'Carros de rua (N): ápice tardio e entrada mais aberta.',
    },
    caveat:
      'Só curvas com até ~80 m têm V-mín bem definida; em curvas longas esse sinal não é usado.',
    basis: 'general-rule',
    src: ['dgedge-5-reasons', 'fisica-geral'],
  },
  lateApex: {
    code: 'lateApex',
    area: 'mid-corner',
    title: 'Ápice tardio',
    meaning:
      'O ponto de V-mín está 15 m ou mais depois do da referência (só em curvas curtas): o carro vira tarde e aponta tarde.',
    causes: [
      'esperar demais para virar',
      'freio solto tarde (carro ainda apoiado na frente)',
      'subesterço que empurra o carro mais adiante',
    ],
    fix: 'Aponte para o ápice um pouco mais cedo para começar a acelerar antes.',
    drill:
      '5 voltas: antecipar o volante em ~3 a 5 m. Critério: apexM da referência ±10 m, sem aumento de V-mín baixa.',
    byGroup: {
      '1': 'Gr.1: ápice mais cedo só se a saída não for para reta longa.',
      '2': 'Gr.2 (pouca evidência): idem Gr.3.',
      '3': 'Gr.3: antecipar o volante com freio aliviando ajuda a girar.',
      '4': 'Gr.4: cuidado para não antecipar demais e abrir a saída.',
      B: 'Gr.B: antecipe com trail braking suave.',
      N: 'Carros de rua (N): o ápice tardio costuma ser mais seguro, o ajuste fino é pequeno.',
    },
    basis: 'general-rule',
    src: ['fisica-geral'],
  },
  gearChoice: {
    code: 'gearChoice',
    area: 'mid-corner',
    title: 'Marcha diferente no ápice',
    meaning: 'A referência passa pelo ápice numa marcha diferente da sua (gearAtApex).',
    causes: [
      'rebaixar demais ou de menos na frenagem',
      'câmbio configurado diferente do carro da referência',
      'preferência de estilo (marcha mais alta = mais velocidade, menos torque)',
    ],
    fix: 'Experimente a marcha da referência no ápice, desde que a RPM caia na faixa de potência.',
    drill:
      '5 voltas: repetir a marcha da referência, verificando V-mín e saída. Critério: V-mín e saída iguais ou melhores com a marcha nova.',
    byGroup: {
      '1': 'Gr.1: com muito torque (híbridos) uma marcha mais alta pode bastar no ápice, mas confirme a RPM na saída.',
      '2': 'Gr.2 (pouca evidência): conferir RPM na saída.',
      '3': 'Gr.3: confira se o carro ainda está na faixa de potência na saída.',
      '4': 'Gr.4: com menos torque que Gr.3, uma marcha mais baixa pode render saída melhor; teste e meça.',
      B: 'Gr.B: turbos pedem manter a RPM na faixa de pressão.',
      N: 'Carros de rua (N): a marcha ideal depende muito do carro; confie na referência só se o carro for igual.',
    },
    caveat: 'Só compare marchas com o mesmo carro e câmbio; câmbio ajustado muda tudo.',
    basis: 'car-dependent',
    src: ['coachdave-tuning'],
  },
  // ---------------------------------------------------------------- exit
  lateThrottle: {
    code: 'lateThrottle',
    area: 'exit',
    title: 'Acelera tarde',
    meaning:
      'O acelerador volta 8 m ou mais depois da referência (throttlePickupM): a retomada atrasa.',
    causes: [
      'esperar o carro estar totalmente reto',
      'medo de sobresterço ou patinagem',
      'ápice tardio demais ou V-mín baixa',
    ],
    fix: 'Volte ao acelerador logo após o ápice, de forma progressiva.',
    drill:
      '5 voltas: antecipar a retomada em ~5 m com 20% de acelerador. Critério: throttle_m igual ou antes da referência, TCS < 0,2 s.',
    byGroup: {
      '1': 'Gr.1: a potência é alta; comece com 20 a 30% e vá abrindo conforme o volante abre.',
      '2': 'Gr.2 (pouca evidência): idem Gr.3.',
      '3': 'Gr.3: em MR, retome com cuidado; em FR, 20% no ápice estabiliza o carro.',
      '4': 'Gr.4: 4WD aceita acelerador cedo; FR, progressivo.',
      B: 'Gr.B: 4WD permite acelerar cedo; use isso.',
      N: 'Carros de rua (N): em FF, acelere cedo mas progressivo; em RWD, espere o volante abrir.',
    },
    basis: 'general-rule',
    src: ['sintese-propria', 'fisica-geral'],
  },
  earlyThrottle: {
    code: 'earlyThrottle',
    area: 'exit',
    title: 'Acelera cedo demais',
    meaning:
      'O acelerador volta antes do ápice ou antes de o carro estar apontado (código previsto; hoje o app ainda não o gera).',
    causes: [
      'pressa em sair da curva',
      'ápice cedo que parece liberar o acelerador',
      'ignorar o volante ainda aberto',
    ],
    fix: 'Espere o carro apontar para a saída e abra o acelerador junto da abertura do volante.',
    drill: '5 voltas: retomar só após o ápice. Critério: TCS < 0,2 s e saída igual ou melhor.',
    byGroup: {
      '1': 'Gr.1: o torque elétrico agrava; espere o volante abrir.',
      '2': 'Gr.2 (pouca evidência): idem Gr.3.',
      '3': 'Gr.3: em MR, acelerar cedo gera sobresterço.',
      '4': 'Gr.4: FR escapa da traseira; dose.',
      B: 'Gr.B: mesmo conselho.',
      N: 'Carros de rua (N): mesmo conselho.',
    },
    caveat: 'Código reservado: a regra ainda não é gerada pelo app.',
    basis: 'general-rule',
    src: ['fisica-geral'],
  },
  exitSlip: {
    code: 'exitSlip',
    area: 'exit',
    title: 'Patinando na saída',
    meaning:
      'O TCS atua 0,15 s ou mais a mais que na referência, ou a patinagem traseira passa 5 pontos percentuais da referência (e 10% no total).',
    causes: [
      'acelerador abrindo antes do volante estar quase reto',
      'acelerador "tudo ou nada"',
      'marcha baixa demais para a saída',
      'pneus gastos ou frios',
    ],
    fix: 'Dose o acelerador na saída: abra progressivamente até o volante estar quase reto.',
    drill:
      '5 voltas: limitar o acelerador a ~50% até o volante a 1/3 e abrir depois. Critério: tcs_s < 0,2 s e rearSlipPeak abaixo da volta base.',
    byGroup: {
      '1': 'Gr.1: potência e torque enormes; comece em 30% e abra aos poucos.',
      '2': 'Gr.2 (pouca evidência): idem Gr.1.',
      '3': 'Gr.3: em FR e MR, dose o acelerador; confira o TCS antes de culpar o carro.',
      '4': 'Gr.4: FR escapa a traseira; 4WD patina menos.',
      B: 'Gr.B: 4WD patina menos; confira a marcha.',
      N: 'Carros de rua (N): pneus de rua patinam fácil; em RWD potente, só depois do ápice.',
    },
    basis: 'general-rule',
    src: ['fisica-geral', 'coachdave-gr4'],
  },
  slowerExit: {
    code: 'slowerExit',
    area: 'exit',
    title: 'Saída mais lenta',
    meaning:
      'A velocidade ao sair da curva é 3 km/h ou mais menor que a da referência; o custo se repete em toda a reta seguinte.',
    causes: [
      'ápice cedo ou entrada rápida demais',
      'acelerador tardio ou patinagem',
      'linha que não usa a pista na saída',
    ],
    fix: 'Priorize a saída: ápice um pouco mais tarde e acelerador mais cedo.',
    drill:
      '5 voltas numa curva antes de reta: sacrificar 2 km/h de V-mín e acelerar antes. Critério: exitSpeed ≥ referência e tempo da reta seguinte melhor.',
    byGroup: {
      '1': 'Gr.1: a saída vale muito (retas longas); ápice tardio e acelerador progressivo.',
      '2': 'Gr.2 (pouca evidência): idem Gr.1/Gr.3.',
      '3': 'Gr.3: ápice tardio; em MR, acelerador progressivo.',
      '4': 'Gr.4: a saída decide o ritmo; ápice tardio.',
      B: 'Gr.B: 4WD premia saída forte.',
      N: 'Carros de rua (N): acelere cedo mas progressivo.',
    },
    basis: 'general-rule',
    src: ['sintese-propria'],
  },
  // ---------------------------------------------------------------- line/technique
  lineOffset: {
    code: 'lineOffset',
    area: 'racing-line',
    title: 'Linha diferente da referência',
    meaning:
      'Entrada, ápice ou saída estão 1,2 m ou mais deslocados do traçado da referência (lateralOffsetM).',
    causes: [
      'entrada fechada demais (menos largura para virar)',
      'ápice por fora (não usa a zebra)',
      'saída mais fechada ou mais aberta que a referência',
    ],
    fix: 'Corrija o ponto do traçado indicado: abra mais na entrada, feche no ápice ou use toda a pista na saída.',
    drill:
      '5 voltas mirando um ponto fixo do traçado (placa ou zebra). Critério: desvio lateral dentro de ±1 m em 4 de 5 voltas.',
    byGroup: {
      '1': 'Gr.1: linha precisa; use a pista toda.',
      '2': 'Gr.2 (pouca evidência): idem Gr.3.',
      '3': 'Gr.3: linha limpa, ápice na zebra, saída até a borda.',
      '4': 'Gr.4: linha limpa vale mais que velocidade.',
      B: 'Gr.B: confira o traçado para o carro de rali.',
      N: 'Carros de rua (N): linha mais fácil, mas cuidado com zebras.',
    },
    caveat:
      'O app mede o desvio lateral com a geometria da pista; em pistas novas o erro pode ser maior.',
    basis: 'general-rule',
    src: ['dgedge-5-reasons'],
  },
  steeringCorrections: {
    code: 'steeringCorrections',
    area: 'technique',
    title: 'Muitas correções de volante',
    meaning:
      'Há 4 ou mais correções de volante na curva (e 3 a mais que a referência): o carro está sendo pedido além do que dá.',
    causes: [
      'entrar rápido demais e o carro escapar',
      'freio solto de repente',
      'acelerador abrindo antes do tempo',
      'volante brusco',
    ],
    fix: 'Suavize o volante: uma entrada só e constante; se a traseira escapa, entre mais devagar.',
    drill:
      '5 voltas: entrar 3 a 5 km/h mais devagar com uma entrada única de volante. Critério: corrections ≤ referência + 1.',
    byGroup: {
      '1': 'Gr.1: correções de volante em alta velocidade perdem muito tempo; suavize.',
      '2': 'Gr.2 (pouca evidência): idem Gr.3.',
      '3': 'Gr.3: em MR, pouco volante basta; em FR, corrija a causa (entrada rápida).',
      '4': 'Gr.4: traseira escapa fácil; corrija a causa (freio solto) e entre mais devagar.',
      B: 'Gr.B: volante mais progressivo.',
      N: 'Carros de rua (N): dirija suave; o carro rola e precisa de tempo.',
    },
    basis: 'general-rule',
    src: ['sintese-propria'],
  },
  // ---------------------------------------------------------------- lap validity
  offTrack: {
    code: 'offTrack',
    area: 'data',
    title: 'Volta com saída de pista',
    meaning:
      'A volta tem um trecho fora da pista, então o tempo e as métricas dela são pouco confiáveis.',
    causes: ['erro de pilotagem', 'zebra ou grama usada demais', 'limite de pista mal avaliado'],
    fix: 'Não use essa volta como base de comparação; peça outra volta válida.',
    drill: 'Refaça a curva da saída de pista com ponto de frenagem menos agressivo.',
    byGroup: {},
    caveat: 'A detecção usa a posição lateral; pode haver falso positivo perto de zebras largas.',
    basis: 'general-rule',
    src: ['sintese-propria'],
  },
  timeGap: {
    code: 'timeGap',
    area: 'data',
    title: 'Falha no tempo dos dados',
    meaning: 'Há um intervalo de tempo maior que o normal entre amostras (pacotes perdidos).',
    causes: ['perda de pacotes de rede', 'pausa do jogo', 'carga do PC ou do Wi-Fi'],
    fix: 'Trate a volta com cuidado; prefira outra volta sem falhas.',
    drill: 'Verifique a conexão (cabo ou Wi-Fi 5 GHz) e repita a volta.',
    byGroup: {},
    basis: 'general-rule',
    src: ['sintese-propria'],
  },
  distanceJump: {
    code: 'distanceJump',
    area: 'data',
    title: 'Salto de distância',
    meaning: 'A distância percorrida pulou de um jeito incompatível com a velocidade.',
    causes: ['pacotes perdidos', 'reposicionamento do carro'],
    fix: 'Descarte a volta da comparação.',
    drill: 'Repita a volta.',
    byGroup: {},
    basis: 'general-rule',
    src: ['sintese-propria'],
  },
  backwards: {
    code: 'backwards',
    area: 'data',
    title: 'Distância regrediu',
    meaning: 'A distância percorrida diminuiu durante a volta (carro girou ou foi reposicionado).',
    causes: ['rodopio', 'retorno à pista', 'dados fora de ordem'],
    fix: 'Descarte a volta da comparação.',
    drill: 'Repita a volta.',
    byGroup: {},
    basis: 'general-rule',
    src: ['sintese-propria'],
  },
  incomplete: {
    code: 'incomplete',
    area: 'data',
    title: 'Volta incompleta',
    meaning: 'A volta não cobre toda a pista ou tem poucas amostras.',
    causes: [
      'volta de entrada ou saída dos boxes',
      'sessão encerrada antes da linha',
      'perda de dados',
    ],
    fix: 'Ignore essa volta na análise.',
    drill: 'Complete uma volta inteira.',
    byGroup: {},
    basis: 'general-rule',
    src: ['sintese-propria'],
  },
  timeMismatch: {
    code: 'timeMismatch',
    area: 'data',
    title: 'Tempo medido difere do jogo',
    meaning: 'O tempo calculado pelo app não bate com o tempo oficial da volta no jogo.',
    causes: ['pacotes perdidos', 'pausa durante a volta'],
    fix: 'Confie no tempo do jogo e trate as métricas com cautela.',
    drill: 'Repita a volta com conexão estável.',
    byGroup: {},
    basis: 'general-rule',
    src: ['sintese-propria'],
  },
};

export function diagnosticFor(code: string): DiagnosticKnowledge | undefined {
  return Object.hasOwn(DIAGNOSTICS, code) ? DIAGNOSTICS[code as DiagnosticCode] : undefined;
}

export const ALL_DIAGNOSTIC_CODES = Object.keys(DIAGNOSTICS) as DiagnosticCode[];
