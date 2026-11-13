/** Glossary pt-BR / English (terms used by the app, by the game and by the community). */

import type { GlossaryTerm } from './types.ts';

export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    id: 'trail-braking',
    term: 'Frenagem com o carro virando (trail braking)',
    en: 'trail braking',
    definition:
      'Manter um resto de freio depois de começar a virar, aliviando até perto do ápice. Mantém peso na frente e ajuda o carro a girar.',
  },
  {
    id: 'apex',
    term: 'Ápice',
    en: 'apex',
    definition:
      'O ponto da curva mais próximo da borda interna (a zebra). No app, o ponto de menor velocidade (V-mín) é usado como ápice nas curvas curtas.',
  },
  {
    id: 'late-apex',
    term: 'Ápice tardio',
    en: 'late apex',
    definition:
      'Ápice mais adiante na curva: perde-se um pouco na entrada, mas se acelera mais cedo na saída. Ótimo antes de retas.',
  },
  {
    id: 'early-apex',
    term: 'Ápice cedo',
    en: 'early apex',
    definition:
      'Ápice antes do ponto ideal: o carro chega ao ápice cedo e abre na saída, perdendo velocidade.',
  },
  {
    id: 'understeer',
    term: 'Subesterço',
    en: 'understeer',
    definition:
      'A dianteira perde aderência e o carro faz uma trajetória mais aberta que a pedida no volante. Mais volante raramente ajuda: reduza freio/velocidade.',
  },
  {
    id: 'oversteer',
    term: 'Sobresterço',
    en: 'oversteer',
    definition:
      'A traseira perde aderência e o carro gira mais do que o volante pede. Comum ao soltar o freio de repente ou ao acelerar demais.',
  },
  {
    id: 'rotation',
    term: 'Rotação',
    en: 'rotation',
    definition:
      'A capacidade do carro de apontar para o ápice. Pouca rotação = subesterço; excesso = sobresterço.',
  },
  {
    id: 'braking-point',
    term: 'Ponto de frenagem',
    en: 'braking point',
    definition:
      'Onde o piloto começa a frear. No app é medido em metros antes da entrada da curva, nas voltas do piloto e nas referências.',
  },
  {
    id: 'vmin',
    term: 'V-mín (velocidade mínima)',
    en: 'minimum speed',
    definition:
      'A menor velocidade da curva. Quanto mais alta, mais velocidade se carrega, desde que a saída não piore.',
  },
  {
    id: 'corner-exit',
    term: 'Retomada do acelerador',
    en: 'throttle pickup',
    definition: 'O ponto em que o acelerador volta depois do ápice (throttlePickupM no app).',
  },
  {
    id: 'coasting',
    term: 'Roda livre',
    en: 'coasting',
    definition: 'Tempo sem freio nem acelerador. É perda de tempo e de apoio.',
  },
  {
    id: 'lsd',
    term: 'Diferencial autoblocante (LSD)',
    en: 'limited-slip differential',
    definition:
      'Controla como o torque é dividido entre as rodas de um eixo. No GT7: torque inicial, sensibilidade de aceleração e sensibilidade de frenagem.',
  },
  {
    id: 'tcs',
    term: 'Controle de tração (TCS)',
    en: 'traction control system',
    definition:
      'Corta potência quando as rodas patinam. Atuando muito = acelerador demais para a tração.',
  },
  {
    id: 'abs',
    term: 'ABS',
    en: 'anti-lock braking system',
    definition: 'Impede que as rodas travem ao frear; quando atua demais, alonga a frenagem.',
  },
  {
    id: 'asm',
    term: 'Controle de estabilidade (ASM)',
    en: 'active stability management',
    definition: 'Ajuda a manter o carro estável, freando rodas e cortando potência em derrapagens.',
  },
  {
    id: 'brake-balance',
    term: 'Balanço de freio',
    en: 'brake balance / bias',
    definition:
      'Divisão da força de frenagem entre frente e trás (no GT7, -5 a +5). Mais à frente = mais estável; mais atrás = gira mais sob freio.',
  },
  {
    id: 'downforce',
    term: 'Downforce (carga aerodinâmica)',
    en: 'downforce',
    definition:
      'Força aerodinâmica que empurra o carro para o chão e cresce com a velocidade; dá mais aderência em curvas rápidas e na frenagem em alta.',
  },
  {
    id: 'camber',
    term: 'Cambagem',
    en: 'camber',
    definition:
      'Inclinação da roda em relação à vertical. Mais negativo ajuda em curva, mas desgasta a parte interna.',
  },
  {
    id: 'toe',
    term: 'Convergência (toe)',
    en: 'toe',
    definition:
      'Ângulo das rodas em relação ao eixo do carro: toe-out dianteiro ajuda a virada inicial; toe-in traseiro dá estabilidade.',
  },
  {
    id: 'ff-fr-mr-4wd',
    term: 'FF, FR, MR, 4WD',
    en: 'drivetrain layout',
    definition:
      'Motor dianteiro e tração dianteira (FF), motor dianteiro e tração traseira (FR), motor central e tração traseira (MR), tração integral (4WD).',
  },
  {
    id: 'bop',
    term: 'BoP (balanço de performance)',
    en: 'Balance of Performance',
    definition:
      'Ajuste do jogo que limita potência e peso por carro e por faixa de pista (alta, média, baixa velocidade) em eventos, para igualar o desempenho.',
  },
  {
    id: 'pp',
    term: 'PP (pontos de performance)',
    en: 'performance points',
    definition: 'Número que resume o desempenho do carro; as classes N100 a N1000 se baseiam nele.',
  },
  {
    id: 'replay-reference',
    term: 'Referência de replay',
    en: 'replay reference',
    definition:
      'Volta de piloto de ponta capturada de um replay no jogo. Tem entradas suavizadas: pontos de frenagem e retomada têm precisão de alguns metros.',
  },
  {
    id: 'delta',
    term: 'Delta',
    en: 'delta',
    definition: 'Diferença de tempo contra a referência ao longo da volta: positivo = mais lento.',
  },
  {
    id: 'kerb',
    term: 'Zebra',
    en: 'kerb',
    definition:
      'Faixa listrada na borda da pista; ponto de referência para o ápice e para o limite da pista.',
  },
  {
    id: 'wheelspin',
    term: 'Patinagem',
    en: 'wheelspin / slip',
    definition:
      'Roda girando mais do que a velocidade do carro; no app, rearSlipPeak e tempo com TCS ativo.',
  },
  {
    id: 'lateral-g',
    term: 'Força G lateral',
    en: 'lateral G',
    definition:
      'Aceleração lateral sentida na curva; um indicador de quanta aderência está sendo usada.',
  },
  {
    id: 'hairpin',
    term: 'Grampo',
    en: 'hairpin',
    definition: 'Curva muito fechada (cerca de 180°), com baixa velocidade.',
  },
  {
    id: 'chicane',
    term: 'Chicane',
    en: 'chicane',
    definition: 'Sequência de duas curvas opostas, normalmente lentas.',
  },
];
