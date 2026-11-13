/**
 * Knowledge by car group (the `group` of the car catalogue: Gr.1, Gr.2, Gr.3, Gr.4, Gr.B, N, X).
 *
 * Evidence is uneven and said so: Gr.1/3/4/B have a public class guide each (Coach Dave) and the
 * DG-EDGE physics notes; Gr.2 (9 cars), the N road cars (289 cars, all kinds) and the X specials
 * (Vision GT, historic racers, Super Formula, kart…) have NO good source: those are our synthesis
 * from general principles and are marked `limited-evidence` / `evidence: 'baixa'`.
 */

import type { CarGroup } from '../cars/catalog.ts';
import type { CarClassKnowledge, Tip } from './types.ts';

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
const be = (text: string, ...src: string[]): Tip => ({
  text,
  basis: 'limited-evidence',
  ...(src.length ? { src } : {}),
});

export const CAR_CLASSES: readonly CarClassKnowledge[] = [
  {
    group: '1',
    label: 'Gr.1',
    name: 'Protótipos e hipercarros (LMP/Hypercar) e Vision GT Gr.1',
    evidence: 'media',
    summary:
      'Os carros mais rápidos do jogo: muito downforce, frenagens muito fortes e curvas rápidas feitas em velocidades altas. Perdoam pouco quem freia ou acelera de forma brusca.',
    examples: ["919 Hybrid '16", "TS050 - Hybrid '16", "GR010 HYBRID '21", "R18 TDI '11"],
    assists: [
      rg(
        'Em geral se começa com ABS e TCS ligados; o TCS baixo só faz sentido quando a dosagem do acelerador na saída está estável.',
        'sintese-propria',
      ),
    ],
    style: [
      fo(
        'Muito downforce e frenagens pesadas: o carro "gruda" em curvas rápidas, então a V-mín é alta e o erro principal costuma ser aliviar o acelerador demais ali.',
        'coachdave-gr1',
      ),
      rg(
        'A aderência de freio é máxima em alta velocidade (carga aerodinâmica) e cai ao desacelerar: pise forte no início e alivie o pico mais cedo do que num Gr.3/Gr.4, para não travar a dianteira em baixa velocidade.',
        'fisica-geral',
      ),
      fo(
        'Os híbridos aceleram mais forte na saída (torque elétrico): dose o acelerador em curvas lentas, e use isso para ganhar tempo nas retas depois de saídas limpas.',
        'coachdave-gr1',
      ),
      rg(
        'Trail braking existe, mas curto: o freio é muito eficaz, e um resto longo de freio com volante sobrecarrega a dianteira.',
        'sintese-propria',
      ),
    ],
    mistakes: [
      rg(
        'Frear tarde demais por confiar no downforce e chegar lento ao ápice (V-mín baixa, saída ruim).',
        'sintese-propria',
      ),
      rg(
        'Soltar o freio de uma vez ainda em velocidade alta e perder o apoio aerodinâmico na dianteira.',
        'fisica-geral',
      ),
      rg('Abrir o acelerador cedo demais em curvas lentas e patinar.', 'sintese-propria'),
    ],
    whatChanges: [
      fo(
        'Aprenda a técnica primeiro em Gr.3/Gr.4 e só depois no Gr.1: a margem de erro é menor.',
        'coachdave-gr1',
      ),
      rg(
        'Distâncias de frenagem maiores em velocidades muito altas, V-mín muito maior em curvas rápidas e referências de pista que "chegam" mais depressa.',
        'fisica-geral',
      ),
    ],
    src: ['coachdave-gr1', 'fisica-geral', 'gt7info'],
  },
  {
    group: '2',
    label: 'Gr.2',
    name: 'GT500, DTM e GT1 clássicos (9 carros no catálogo)',
    evidence: 'baixa',
    summary:
      'Grupo pequeno de carros de turismo de alta potência com bastante aerodinâmica (Super GT GT500, DTM, GT1 antigos). Não achamos guia de qualidade para o Gr.2 no GT7: o que segue é síntese de princípios gerais.',
    examples: ["GT-R GT500 '08", "NSX GT500 '08", "GT-R NISMO GT500 '16", "RS 5 Turbo DTM '19"],
    assists: [
      be(
        'Sem referência: comece com as assistências que usa em Gr.3 e reduza uma de cada vez.',
        'sintese-propria',
      ),
    ],
    style: [
      be(
        'Trate como algo entre Gr.3 e Gr.1: bastante downforce, potência alta e carros ainda pesados em relação a protótipos.',
        'sintese-propria',
      ),
      rg(
        'Freio firme em reta, alívio progressivo e trail braking moderado; acelerador dosado na saída.',
        'fisica-geral',
      ),
    ],
    mistakes: [
      be(
        'Supor que se comporta como um GT3 moderno: os GT500/DTM antigos são mais nervosos na traseira ao soltar o freio de repente.',
        'sintese-propria',
      ),
    ],
    whatChanges: [
      be(
        'Mais potência e downforce que o Gr.3; menos que o Gr.1. As diferenças exatas variam muito de carro para carro.',
        'sintese-propria',
      ),
    ],
    src: ['gt7info', 'sintese-propria'],
  },
  {
    group: '3',
    label: 'Gr.3',
    name: 'GT3 e GT1/GT500 antigos (50 carros no catálogo)',
    evidence: 'media',
    summary:
      'A classe mais popular: carros de GT3 (e alguns GT1/GT500 antigos do catálogo) com downforce médio e BoP que muda o ranking de cada pista. A tração (FR × MR) define muito o comportamento.',
    examples: ['4C Gr.3', "R8 LMS Evo '19", "Mercedes-AMG GT3 '16"],
    assists: [
      rg(
        'ABS e TCS costumam ficar ligados em corrida; reduza o TCS só depois de dosar a saída.',
        'sintese-propria',
      ),
      fo(
        'O balanço de freio é um dos poucos ajustes livres em eventos com BoP: use-o para estabilizar a frenagem.',
        'dgedge-brake-balance',
      ),
    ],
    style: [
      fo(
        'FR (motor dianteiro) tende a subesterço na entrada; MR (motor central) responde mais ao volante e pode sobrevirar: no FR priorize frenagem reta e rotação com freio aliviando, no MR cuidado com a traseira ao soltar o freio.',
        'coachdave-gr3',
      ),
      fo(
        'Frear em reta, com pico firme e alívio progressivo, e usar trail braking leve em curvas lentas e médias.',
        'dgedge-physics-149',
      ),
      rg(
        'Downforce médio: a V-mín em curva rápida é alta, mas a margem para erro é maior que no Gr.1.',
        'fisica-geral',
      ),
    ],
    mistakes: [
      fo(
        'Entrar rápido demais e gastar o pneu dianteiro (queda forte depois de ~50% de desgaste).',
        'dgedge-physics-149',
      ),
      dc(
        'Em MR, tirar o pé do acelerador e soltar o freio juntos no meio da curva e perder a traseira.',
        'coachdave-gr3',
      ),
    ],
    whatChanges: [
      fo(
        'A BoP muda de pista para pista: o carro melhor numa pista pode não ser em outra; não compare ritmo entre carros diferentes sem considerar isso.',
        'coachdave-gr3',
      ),
      rg('Menos downforce e potência que o Gr.1/Gr.2; mais que o Gr.4.', 'fisica-geral'),
    ],
    src: ['coachdave-gr3', 'dgedge-physics-149', 'dgedge-brake-balance'],
  },
  {
    group: '4',
    label: 'Gr.4',
    name: 'GT4 (32 carros no catálogo)',
    evidence: 'media',
    summary:
      'Carros de GT4: baseados em esportivos de rua, mais leves em aerodinâmica e potência que o Gr.3. A traseira solta com facilidade em frenagem forte e o subesterço aparece cedo.',
    examples: ['Huracan Gr.4', 'M4 Gr.4', "Cayman GT4 Clubsport '16", 'GT-R Gr.4'],
    assists: [
      rg(
        'Começar com ABS e TCS ligados; o ganho de desligar vem depois, quando a frenagem em reta é repetível.',
        'sintese-propria',
      ),
    ],
    style: [
      fo(
        'Freie em reta e com suavidade: a traseira escapa com facilidade quando a frenagem é brusca ou feita virando.',
        'coachdave-gr4',
      ),
      fo(
        '4WD traciona mais cedo na saída; FR é mais previsível. Ajuste o acelerador à tração do carro.',
        'coachdave-gr4',
      ),
      rg(
        'Menos downforce: a V-mín em curva rápida é mais baixa e o freio é mais sensível ao peso do carro e à transferência de carga.',
        'fisica-geral',
      ),
      rg(
        'Subesterço na entrada é comum: reduzir a velocidade de entrada e aliviar o freio mais cedo costuma render mais do que forçar o volante.',
        'sintese-propria',
      ),
    ],
    mistakes: [
      fo('Frear virando demais e soltar o freio de repente (traseira solta).', 'coachdave-gr4'),
      rg(
        'Querer "frear tarde" como num Gr.3: o ganho de frear tarde é menor e o risco de passar do ápice é maior.',
        'sintese-propria',
      ),
    ],
    whatChanges: [
      rg(
        'Menos aderência aerodinâmica e mais transferência de peso que Gr.3: a frenagem é mais longa e a técnica de entrada, mais suave.',
        'fisica-geral',
      ),
    ],
    src: ['coachdave-gr4', 'dgedge-physics-149'],
  },
  {
    group: 'B',
    label: 'Gr.B',
    name: 'Carros de rali (modernos Gr.B e os Grupo B originais)',
    evidence: 'baixa',
    summary:
      'Carros de rali (12 no catálogo), de tração integral na maioria, entre eles os Gr.B modernos do jogo e os clássicos Grupo B. Há pouca informação específica; os modernos são descritos como mais fáceis que os originais.',
    examples: [
      "205 Turbo 16 Evolution 2 '86",
      "Sport quattro S1 Pikes Peak '87",
      'WRX Gr.B Rally Car',
      'GT-R Gr.B Rally Car',
    ],
    assists: [
      be(
        'Sem fonte específica: mantenha ABS/TCS que usa em carros de rua de alta potência e reduza com calma.',
        'sintese-propria',
      ),
    ],
    style: [
      fo(
        'Os Gr.B modernos são mais fáceis de guiar do que os Grupo B originais; use os modernos para aprender.',
        'coachdave-grb',
      ),
      be(
        'Tração integral costuma dar saída forte, mas empurra a dianteira na entrada: gire com freio aliviando e acelere assim que o carro estiver apontado.',
        'sintese-propria',
      ),
      dc(
        'Os clássicos têm turbo com resposta lenta: antecipe o acelerador e evite pegar o turbo "fora de hora" no meio da curva.',
        'sintese-propria',
      ),
    ],
    mistakes: [
      be(
        'Usar linha de asfalto/GT3 sem considerar o peso e o balanço de carros de rali (mais rolagem, mais transferência de peso).',
        'sintese-propria',
      ),
    ],
    whatChanges: [
      be(
        'Mais curso de suspensão e rolagem que carros de pista: trabalhe com movimentos de pedal e volante mais progressivos.',
        'sintese-propria',
      ),
    ],
    src: ['coachdave-grb', 'sintese-propria'],
  },
  {
    group: 'N',
    label: 'Gr.N',
    name: 'Carros de rua (289 carros no catálogo; N100 a N1000+ por PP)',
    evidence: 'baixa',
    summary:
      'Carros de rua, de utilitários a superesportivos. O catálogo do app não traz a classe por PP (N300, N500…), só "N"; o comportamento depende de potência, peso e tração, não do rótulo. Não achamos fonte para N-classes.',
    examples: ["A110 '17", "Civic Type R (FK2) '15", "GR Supra RZ '20", "458 Italia '09"],
    assists: [
      rg(
        'ABS, TCS e controle de estabilidade ligados são o normal em carros de rua; a vantagem de desligar é pequena perto do ganho de pilotar limpo.',
        'sintese-propria',
      ),
      fo(
        'O guia oficial de iniciantes cita TCS inicial no nível 3 e ABS padrão como ponto de partida.',
        'gt-apex',
      ),
    ],
    style: [
      be(
        'Carros de rua rolam e jogam peso mais que carros de corrida: entradas de volante e de pedal mais suaves; frear mais cedo do que o instinto de GT3 dita.',
        'sintese-propria',
      ),
      dc(
        'Pneus de rua (Conforto/Esportivo) dão muito menos aderência que Corrida: espere V-mín menor e frenagens mais longas; os gráficos de referência de Gr.3/Gr.4 não servem de meta.',
        'sintese-propria',
      ),
      dc(
        'Tração dianteira: use trail braking para girar e acelere só com o volante quase reto. Tração traseira potente: dose o acelerador na saída. Integral: acelere cedo.',
        'traxion-fwd',
      ),
    ],
    mistakes: [
      be('Copiar pontos de frenagem de carros de corrida.', 'sintese-propria'),
      be(
        'Mexer em muitos ajustes ao mesmo tempo: a diferença entre carros N é enorme e o ganho vem de entender o carro, não de uma receita da classe.',
        'sintese-propria',
      ),
    ],
    whatChanges: [
      be(
        'Quase tudo depende do carro: potência por peso, tração e pneus. Trate o rótulo "N" como pista de que não há downforce relevante, nada mais.',
        'sintese-propria',
      ),
    ],
    src: ['gt-apex', 'sintese-propria'],
  },
  {
    group: 'X',
    label: 'Gr.X',
    name: 'Especiais (Vision GT, clássicos de corrida, Super Formula, kart…)',
    evidence: 'baixa',
    summary:
      'Grupo heterogêneo (93 carros): Vision GT, protótipos clássicos, Super Formula SF19, kart, carros de segurança, etc. Não há conselho de classe: use o que cada carro tem (downforce, peso, tração).',
    examples: [
      "SF19 Super Formula / Toyota '19",
      'Racing Kart 125 Shifter',
      "330 P4 '67",
      'Red Bull X2019 Competition',
    ],
    assists: [be('Sem regra de classe: veja o carro.', 'sintese-propria')],
    style: [
      be(
        'Monopostos e carros com muito downforce: regras do Gr.1 valem em espírito (freio forte e cedo, V-mín alta nas curvas rápidas). Clássicos sem downforce: regras de carro de rua/Gr.4 (frear antes, entrada suave).',
        'sintese-propria',
      ),
      be(
        'Kart e carros muito leves pedem entradas rápidas, pouco freio e linha limpa; o peso quase não transfere.',
        'sintese-propria',
      ),
    ],
    mistakes: [be('Aplicar uma receita de classe a um carro único.', 'sintese-propria')],
    whatChanges: [
      be(
        'Nada específico: peça ao piloto o tipo de carro quando for relevante.',
        'sintese-propria',
      ),
    ],
    src: ['gt7info', 'sintese-propria'],
  },
];

const BY_GROUP = new Map<CarGroup, CarClassKnowledge>(CAR_CLASSES.map((c) => [c.group, c]));

export function classFor(group: CarGroup | null | undefined): CarClassKnowledge | undefined {
  return group ? BY_GROUP.get(group) : undefined;
}
