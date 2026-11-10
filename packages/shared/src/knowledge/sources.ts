/**
 * Sources of the driving knowledge base. All were consulted on 2026-11-09 (see
 * docs/pesquisa/frenagem-referencias-e-conhecimento.md and docs/pesquisa/carros-bop-e-setups.md);
 * statements are summaries in our own words, never copied text.
 */

import type { KnowledgeSource } from './types.ts';

const CONSULTED = '2026-11-09';

export const KNOWLEDGE_SOURCES: readonly KnowledgeSource[] = [
  {
    id: 'dgedge-5-reasons',
    title: "5 Reasons Why You Can't Go Faster in Gran Turismo 7",
    author: 'Mihael Matika',
    publisher: 'DG-EDGE',
    published: '04/2025',
    url: 'https://www.dg-edge.com/articles/guides/5-reasons-why-you-can-t-go-faster-in-gran-turismo-7/517',
    consultedAt: CONSULTED,
    access: 'lido-na-pesquisa',
    usedFor:
      'referências visuais fixas, frear a tempo, usar a pista toda, modular o freio (uso moderado em curvas médias) e não frear demais',
  },
  {
    id: 'dgedge-physics-149',
    title: 'Gran Turismo 7 Physics Update 1.49 Breakdown',
    publisher: 'DG-EDGE',
    url: 'https://dg-edge.com/articles/guides/gran-turismo-7-physics-update-1-49-breakdown/424',
    consultedAt: CONSULTED,
    access: 'lido-na-pesquisa',
    usedFor:
      'carros mais pesados, frear antes e em reta, trail braking aquece o pneu, desgaste concentrado no pneu dianteiro ao virar cedo, queda forte de aderência após ~50% de desgaste',
  },
  {
    id: 'dgedge-brake-balance',
    title: 'Mastering Brake Balance in Gran Turismo 7',
    publisher: 'DG-EDGE',
    url: 'https://www.dg-edge.com/articles/guides-equipment/mastering-brake-balance-in-gran-turismo-7/360',
    consultedAt: CONSULTED,
    access: 'lido-na-pesquisa',
    usedFor:
      'balanço de freio por layout (MR/FR/FF/4WD), mais atrás em pistas rápidas e mais à frente em grampos',
  },
  {
    id: 'dgedge-telemetry',
    title: 'Telemetry in Gran Turismo 7: how to use it to find more pace',
    publisher: 'DG-EDGE',
    url: 'https://www.dg-edge.com/articles/guides/telemetry-in-gran-turismo-7-how-to-use-it-find-more-pace/544',
    consultedAt: CONSULTED,
    access: 'lido-na-pesquisa',
    usedFor: 'leitura de traços (freio, acelerador, velocidade) para achar tempo',
  },
  {
    id: 'coachdave-gr1',
    title: 'Best Gr.1 cars in Gran Turismo 7',
    publisher: 'Coach Dave Academy',
    url: 'https://coachdaveacademy.com/tutorials/best-gr-1-cars-in-gran-turismo-7/',
    consultedAt: CONSULTED,
    access: 'lido-na-pesquisa',
    usedFor:
      'Gr.1: muito downforce, frenagens pesadas, híbridos aceleram mais na saída, aprender antes em Gr.3/Gr.4',
  },
  {
    id: 'coachdave-gr3',
    title: 'Best Gr.3 cars in Gran Turismo 7',
    publisher: 'Coach Dave Academy',
    url: 'https://coachdaveacademy.com/tutorials/best-gr-3-cars-in-gran-turismo-7/',
    consultedAt: CONSULTED,
    access: 'lido-na-pesquisa',
    usedFor:
      'Gr.3: FR tende a subesterço, MR responde mais e sobrevira, BoP muda o ranking por pista',
  },
  {
    id: 'coachdave-gr4',
    title: 'Best Gr.4 cars in Gran Turismo 7',
    publisher: 'Coach Dave Academy',
    url: 'https://coachdaveacademy.com/tutorials/best-gr-4-cars-in-gran-turismo-7/',
    consultedAt: CONSULTED,
    access: 'lido-na-pesquisa',
    usedFor:
      'Gr.4: 4WD traciona cedo, FR é mais previsível, traseira solta com facilidade em frenagem forte, frear em reta e com suavidade',
  },
  {
    id: 'coachdave-grb',
    title: 'Gr.B rally cars in GT7 explained',
    publisher: 'Coach Dave Academy',
    url: 'https://coachdaveacademy.com/tutorials/gr-b-rally-cars-in-gt7-explained',
    consultedAt: CONSULTED,
    access: 'lido-na-pesquisa',
    usedFor: 'Gr.B modernos são mais fáceis de guiar do que os Grupo B originais',
  },
  {
    id: 'coachdave-tuning',
    title: 'Gran Turismo 7 tuning explained',
    author: 'Alexandre Tonini',
    publisher: 'Coach Dave Academy',
    url: 'https://coachdaveacademy.com/tutorials/gran-turismo-7-tuning-explained',
    consultedAt: CONSULTED,
    access: 'lido-na-pesquisa',
    usedFor:
      'ordem de afinação, altura, frequência, amortecedores, barras, camber, toe, LSD, aerodinâmica, câmbio, balanço de freio',
  },
  {
    id: 'traxion-fwd',
    title: 'Gran Turismo 7 front-wheel drive setup guide',
    publisher: 'Traxion.gg',
    url: 'https://traxion.gg/gran-turismo-7-front-wheel-drive-setup-guide-2/',
    consultedAt: CONSULTED,
    access: 'lido-na-pesquisa',
    usedFor: 'altura baixa, camber em tração dianteira, medições de afinação em FF',
  },
  {
    id: 'gt-apex',
    title: 'Beyond the Apex (guia oficial para iniciantes)',
    publisher: 'Polyphony Digital / gran-turismo.com',
    url: 'https://www.gran-turismo.com/us/gt7/apex/for_beginners/03',
    consultedAt: CONSULTED,
    access: 'so-resumo-de-busca',
    usedFor:
      'assistências iniciais (TCS no nível 3, ABS padrão para iniciantes), marcos de frenagem (zebra, placas 100 m/50 m). A página é renderizada por JavaScript e não foi aberta: confirmar à mão',
  },
  {
    id: 'gtplanet-forum',
    title: 'Fórum GTPlanet (threads de frenagem, ABS e aprendizado de pista)',
    publisher: 'GTPlanet',
    url: 'https://www.gtplanet.net/forum/',
    consultedAt: CONSULTED,
    access: 'so-resumo-de-busca',
    usedFor:
      'opinião de jogadores (ex.: ABS desligado deixa pisar mais forte no início da frenagem). Não é regra: o site bloqueou a leitura e só vimos resumos de busca',
  },
  {
    id: 'gtplanet-telemetry-overview',
    title: 'Overview of GT7 telemetry software',
    publisher: 'GTPlanet',
    url: 'https://www.gtplanet.net/forum/threads/overview-of-gt7-telemetry-software.418011/',
    consultedAt: CONSULTED,
    access: 'so-resumo-de-busca',
    usedFor: 'contexto técnico da telemetria UDP e do replay',
  },
  {
    id: 'gt7info',
    title: 'gt7info (banco de carros, grupos e pistas do GT7)',
    publisher: 'ddm999 (licença MIT-0)',
    url: 'https://github.com/ddm999/gt7info',
    consultedAt: CONSULTED,
    access: 'lido-na-pesquisa',
    usedFor: 'grupos dos carros (Gr.1–4, B, N, X) e exemplos de cada grupo',
  },
  {
    id: 'fisica-geral',
    title: 'Dinâmica veicular básica (círculo de atrito, transferência de carga)',
    publisher: 'Conhecimento geral de engenharia automotiva',
    url: null,
    consultedAt: CONSULTED,
    access: 'sem-fonte-externa',
    usedFor:
      'princípios que não dependem do jogo: aderência limitada entre frear, virar e acelerar; peso passa para a frente ao frear; downforce cresce com a velocidade',
  },
  {
    id: 'sintese-propria',
    title: 'Síntese própria do projeto',
    publisher: 'Bono Engineer',
    url: null,
    consultedAt: CONSULTED,
    access: 'sem-fonte-externa',
    usedFor:
      'texto de coaching escrito para este app; onde marcado como "pouca evidência", é hipótese de trabalho sem fonte que a confirme',
  },
];

const BY_ID = new Map(KNOWLEDGE_SOURCES.map((s) => [s.id, s]));

export function getSource(id: string): KnowledgeSource | undefined {
  return BY_ID.get(id);
}

/** Short label for a source id ("DG-EDGE: Physics Update 1.49 Breakdown"). */
export function sourceLabel(id: string): string {
  const s = BY_ID.get(id);
  if (!s) return id;
  const pub = (s.publisher.split(' (')[0] ?? s.publisher).split(' / ')[0] ?? s.publisher;
  return `${pub}: ${s.title}`;
}
