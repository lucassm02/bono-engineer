/**
 * Symptom → tuning-direction map (pt-BR). Principles only, from Coach Dave's tuning guide, the
 * Traxion FWD guide and the research draft (docs/research/cars-bop-and-setups.md §5.3).
 *
 * HONEST LIMITS: there is no open database of GT7 setups and the app does not read the car's setup
 * (the telemetry has no springs, dampers, LSD or aero values). Directions below are typical, not
 * validated here, and the effect of each slider depends on the car and the track. The coach must
 * offer them as hypotheses, one change at a time, after the driving technique is stable.
 */

import type { SetupEntry, Tip } from './types.ts';

const gen = (text: string, ...src: string[]): Tip => ({
  text,
  basis: 'general-rule',
  ...(src.length ? { src } : {}),
});
const car = (text: string, ...src: string[]): Tip => ({
  text,
  basis: 'car-dependent',
  ...(src.length ? { src } : {}),
});

export const SETUP_RULES: readonly string[] = [
  'Antes de afinar, estabilize a técnica: o app só enxerga o efeito de uma mudança se o piloto repete as voltas (veja consistência).',
  'Uma mudança por vez, em passos pequenos, e compare 5 voltas antes e depois (V-mín, TCS, correções de volante, tempo da curva).',
  'Ordem de trabalho: pneus e downforce, lastro/peso, suspensão, depois câmbio e diferencial.',
  'Valores extremos raramente funcionam; consistência vale mais que uma volta isolada.',
  'Em eventos com BoP muitos ajustes são travados (em geral restam balanço de freio e mapa de combustível; confirme no regulamento do evento, não verificado).',
  'O app não lê o setup do carro: pergunte ao piloto o que está instalado antes de sugerir qualquer mudança.',
];

export const SETUP_MAP: readonly SetupEntry[] = [
  {
    id: 'entry-understeer',
    symptom: 'Subesterço na entrada (o carro não fecha ao virar com freio)',
    phase: 'entry',
    diagnostics: ['noTrailBraking', 'lowerMinSpeed', 'lateApex', 'steeringCorrections'],
    likelyCause:
      'Dianteira saturada: entra rápido, pouco peso na frente ou diferencial travando sob freio.',
    adjustments: [
      gen(
        'Primeiro técnica: aliviar o freio um pouco mais cedo e reduzir a velocidade de entrada em 3 a 5 km/h.',
        'sintese-propria',
      ),
      car(
        'Balanço de freio um pouco mais para trás ajuda a virar sob freio (mais comum em pistas rápidas).',
        'dgedge-brake-balance',
      ),
      car(
        'Diferencial: sensibilidade de frenagem menor reduz o subesterço na entrada.',
        'coachdave-tuning',
      ),
      car(
        'Barras: amolecer a dianteira ou endurecer a traseira aumenta a rotação na entrada.',
        'coachdave-tuning',
      ),
    ],
    caution:
      'Mudanças de rotação podem criar sobresterço ao soltar o freio; refaça 5 voltas após cada passo.',
  },
  {
    id: 'mid-corner-understeer',
    symptom: 'Subesterço no meio da curva (V-mín baixa, carro empurra)',
    phase: 'mid-corner',
    diagnostics: ['lowerMinSpeed', 'steeringCorrections'],
    likelyCause: 'Falta aderência dianteira em carga constante.',
    adjustments: [
      gen(
        'Mais downforce frontal (se o carro tem) e conferir pressão/estado dos pneus dianteiros.',
        'coachdave-tuning',
      ),
      car(
        'Camber dianteiro um pouco mais negativo ajuda em curva; em tração dianteira o excesso (-5° a -6°) prejudica.',
        'coachdave-tuning',
        'traxion-fwd',
      ),
      car(
        'Toe-out frontal pequeno ajuda a virada inicial, ao custo de velocidade em curva longa.',
        'coachdave-tuning',
      ),
    ],
    caution:
      'Aerodinâmica e camber têm efeito diferente conforme a pista; teste em passos pequenos.',
  },
  {
    id: 'exit-understeer',
    symptom: 'Subesterço na saída (acelera e o carro abre)',
    phase: 'exit',
    diagnostics: ['lateThrottle', 'slowerExit', 'exitSlip'],
    likelyCause:
      'Acelerar com o volante aberto em FF, ou diferencial/barras empurrando a dianteira.',
    adjustments: [
      gen(
        'Primeiro técnica: acelerar mais progressivo e só com o volante quase reto.',
        'sintese-propria',
      ),
      car(
        'Diferencial: ajustar a sensibilidade de aceleração (menos travamento tende a abrir menos a linha).',
        'coachdave-tuning',
      ),
      car(
        'Barra traseira mais mole ou frente mais dura dá mais aderência na traseira (mais rotação na saída).',
        'coachdave-tuning',
      ),
    ],
    caution: 'Rotação extra na saída pode virar sobresterço em RWD potente.',
  },
  {
    id: 'entry-oversteer',
    symptom: 'Sobresterço na entrada ou ao soltar o freio (a traseira vem)',
    phase: 'entry',
    diagnostics: ['steeringCorrections', 'brakeLater'],
    likelyCause:
      'Muito peso saindo da traseira ao aliviar o freio, ou balanço de freio muito atrás.',
    adjustments: [
      gen(
        'Primeiro técnica: soltar o freio em rampa e frear com o carro mais reto.',
        'coachdave-gr4',
      ),
      car(
        'Balanço de freio mais para a frente estabiliza a frenagem (comum em grampos).',
        'dgedge-brake-balance',
      ),
      car(
        'Toe-in traseiro dá estabilidade (principalmente RWD); sensibilidade de frenagem do diferencial maior estabiliza.',
        'coachdave-tuning',
      ),
    ],
    caution: 'Estabilidade extra costuma custar rotação: pode surgir subesterço.',
  },
  {
    id: 'exit-oversteer',
    symptom: 'Sobresterço ou patinagem na saída (traseira acelera e vai)',
    phase: 'exit',
    diagnostics: ['exitSlip', 'slowerExit'],
    likelyCause:
      'Acelerador demais com o volante aberto, pouca aderência traseira ou diferencial agressivo.',
    adjustments: [
      gen(
        'Primeiro técnica: dosar o acelerador e conferir a marcha (marcha mais alta reduz torque na roda).',
        'sintese-propria',
      ),
      gen(
        'Se o TCS está desligado ou baixo, subir um nível até corrigir a dosagem.',
        'sintese-propria',
      ),
      car(
        'Barras: o inverso do subesterço de saída (traseira mais dura ou frente mais mole); downforce traseiro maior estabiliza em alta.',
        'coachdave-tuning',
      ),
    ],
    caution: 'Meça TCS ativo e patinagem traseira no app antes e depois.',
  },
  {
    id: 'braking-instability',
    symptom: 'Instabilidade na frenagem (traseira solta ou carro dança)',
    phase: 'braking',
    diagnostics: ['softBraking', 'brakeEarlier', 'noTrailBraking'],
    likelyCause: 'Balanço de freio muito atrás, frenagem virando ou pico brusco.',
    adjustments: [
      car('Balanço de freio para a frente.', 'dgedge-brake-balance'),
      car(
        'Toe-in traseiro maior e amortecedores com extensão maior que compressão.',
        'coachdave-tuning',
      ),
    ],
    caution:
      'Corrija primeiro o pico e o ponto de frenagem; afinação não substitui frenagem em reta.',
  },
  {
    id: 'front-lockup',
    symptom: 'Dianteira trava na frenagem',
    phase: 'braking',
    diagnostics: ['frontLock'],
    likelyCause: 'Pico alto demais para a aderência do momento ou balanço de freio muito à frente.',
    adjustments: [
      gen('Reduzir o pico de freio em 5 a 10 pontos percentuais.', 'sintese-propria'),
      car('Balanço de freio para trás.', 'dgedge-brake-balance'),
    ],
    caution: 'Balanço muito para trás causa instabilidade (traseira trava).',
  },
  {
    id: 'front-tyre-wear',
    symptom: 'Pneu dianteiro esquenta ou desgasta antes do traseiro',
    phase: 'general',
    diagnostics: ['noTrailBraking'],
    likelyCause: 'Virar cedo, trail braking forte ou camber/entrada de carga em excesso.',
    adjustments: [
      gen(
        'Menos trail braking e entrada mais suave nas curvas médias e lentas.',
        'dgedge-physics-149',
      ),
      car('Rever o camber e a pressão da frente.', 'coachdave-tuning', 'traxion-fwd'),
    ],
    caution:
      'A telemetria do GT7 tem uma temperatura por pneu (não dá para ler camber por ela): compare frente × trás e esquerda × direita.',
  },
  {
    id: 'low-straight-speed',
    symptom: 'Perde velocidade final ou aceleração na reta',
    phase: 'straight',
    diagnostics: ['slowerExit'],
    likelyCause: 'Muito downforce ou câmbio mal ajustado à pista.',
    adjustments: [
      gen(
        'Reduzir o downforce dos dois eixos se o arrasto prejudica a máxima.',
        'coachdave-tuning',
      ),
      car(
        'Ajustar a relação final para a velocidade máxima da pista (a telemetria informa as relações e a velocidade máxima da transmissão).',
        'coachdave-tuning',
      ),
    ],
    caution: 'Menos downforce reduz a V-mín em curvas rápidas: o saldo depende da pista.',
  },
];

export const SETUP_HEADER =
  'Mapa sintoma → ajuste (princípios gerais; o app não lê o setup do carro e nada aqui foi validado em pista). Sugira sempre como hipótese e uma mudança por vez.';
