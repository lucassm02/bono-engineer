import type { Language } from './language.ts';
import {
  BRAKE_MARKS,
  type BRAKE_WORDS,
  brakePhrase,
  cornerSegment,
  detailedBrakeUtterance,
  fromCornerSegment,
  gearSegment,
  RADIO_CATALOG,
  type RadioEntry,
  type RadioUtterance,
  tenthsAmount,
  toCornerSegment,
  utteranceKeys,
} from './radio/phrases.ts';

type Translation = readonly [english: string, spanish: string];

const fixed: Record<string, Translation> = {
  preview: [
    'Radio check. Brake hard at two hundred. Third gear at turn four. Two tenths faster.',
    'Prueba de radio. Frena fuerte a doscientos. Tercera marcha en la curva cuatro. Mejoraste dos décimas.',
  ],
  'Solta o freio.': ['Release the brake.', 'Suelta el freno.'],
  'Vai soltando o freio.': ['Ease off the brake.', 'Ve soltando el freno.'],
  'Deixa rolar.': ['Let it roll.', 'Deja rodar el coche.'],
  'Volta no acelerador.': ['Back on the throttle.', 'Vuelve a acelerar.'],
  'Acelera, suave.': ['Ease onto the throttle.', 'Acelera con suavidad.'],
  'Freia.': ['Brake now.', 'Frena ya.'],
  'Pneus frios. Aqueça progressivamente.': [
    'Cold tyres. Warm them up gradually.',
    'Neumáticos fríos. Caliéntalos poco a poco.',
  ],
  'Pneus na faixa.': ['Tyres in range.', 'Temperatura de neumáticos en rango.'],
  'Pneus quentes.': ['Tyres are hot.', 'Neumáticos calientes.'],
  'Nesse ritmo, falta combustível para terminar. Economize nesta volta.': [
    'At this pace, we’re short on fuel. Save fuel this lap.',
    'A este ritmo no alcanza el combustible. Ahorra en esta vuelta.',
  ],
  'Alivia o acelerador.': ['Lift off the throttle.', 'Levanta el pie del acelerador.'],
  'Boa volta.': ['Good lap.', 'Buena vuelta.'],
  'Mesmo tempo.': ['Same time.', 'Mismo tiempo.'],
  'Combustível para cinco voltas.': ['Five laps of fuel left.', 'Combustible para cinco vueltas.'],
  'Combustível para duas voltas.': ['Two laps of fuel left.', 'Combustible para dos vueltas.'],
  'Combustível para uma volta.': ['One lap of fuel left.', 'Combustible para una vuelta.'],
  'Combustível para menos de uma volta.': [
    'Less than a lap of fuel left.',
    'Combustible para menos de una vuelta.',
  ],
  'Você melhorou': ['You gained time', 'Ganaste tiempo'],
  'você melhorou.': ['you gained time.', 'ganaste tiempo.'],
  'você segurou o freio.': [
    'you held the brake too long.',
    'mantuviste el freno demasiado tiempo.',
  ],
  'você freou cedo.': ['you braked early.', 'frenaste pronto.'],
  'você demorou a acelerar.': ['you got on the throttle late.', 'tardaste en acelerar.'],
  'você ficou sem pedal.': [
    'you coasted for too long.',
    'pasaste demasiado tiempo sin pisar los pedales.',
  ],
  'Na próxima, comece a soltar quando virar.': [
    'Next time, start releasing the brake as you turn in.',
    'La próxima vez, empieza a soltar el freno al girar.',
  ],
  'Na próxima, freie mais tarde.': ['Next time, brake later.', 'La próxima vez, frena más tarde.'],
  'Na próxima, acelere mais cedo.': [
    'Next time, get on the throttle earlier.',
    'La próxima vez, acelera antes.',
  ],
  'Na próxima, emende freio e acelerador.': [
    'Next time, shorten the gap between brake and throttle.',
    'La próxima vez, acorta la transición del freno al acelerador.',
  ],
  'foque na soltura do freio.': ['focus on brake release.', 'céntrate en soltar el freno.'],
  'foque no ponto de freada.': ['focus on your braking point.', 'céntrate en el punto de frenada.'],
  'foque na retomada do acelerador.': [
    'focus on getting back on the throttle.',
    'céntrate en cuándo vuelves a acelerar.',
  ],
  'foque na emenda dos pedais.': [
    'focus on the pedal transition.',
    'céntrate en la transición entre pedales.',
  ],
  'foque na marcha.': ['focus on gear selection.', 'céntrate en elegir la marcha.'],
  'você travou a dianteira.': ['you locked the front tyres.', 'bloqueaste las ruedas delanteras.'],
  'a traseira escapou.': ['the rear stepped out.', 'se fue la parte trasera.'],
  'o carro saiu de frente.': ['the car understeered.', 'el coche subviró.'],
  'a traseira patinou na saída.': [
    'the rear tyres spun on exit.',
    'las ruedas traseras patinaron en la salida.',
  ],
  'Na próxima, alivie o pico do freio.': [
    'Next time, ease the peak brake pressure.',
    'La próxima vez, reduce la presión máxima de frenado.',
  ],
  'Na próxima, solte o freio mais suave.': [
    'Next time, release the brake more smoothly.',
    'La próxima vez, suelta el freno con más suavidad.',
  ],
  'Na próxima, acelere de forma progressiva.': [
    'Next time, feed in the throttle gradually.',
    'La próxima vez, acelera de forma progresiva.',
  ],
  'Na próxima, suavize a troca de pedais.': [
    'Next time, smooth out the pedal transition.',
    'La próxima vez, suaviza la transición entre pedales.',
  ],
  'Na próxima, vire menos na entrada.': [
    'Next time, use less steering on entry.',
    'La próxima vez, gira menos al entrar.',
  ],
  'Na próxima, abra o acelerador mais devagar.': [
    'Next time, apply the throttle more slowly.',
    'La próxima vez, pisa el acelerador más despacio.',
  ],
  'Na próxima, tire um pouco de volante.': [
    'Next time, unwind the steering a little.',
    'La próxima vez, endereza un poco el volante.',
  ],
  'Na próxima, dose o acelerador.': [
    'Next time, modulate the throttle.',
    'La próxima vez, dosifica el acelerador.',
  ],
  'Distância para a meta:': ['Gap to target:', 'Diferencia con el objetivo:'],
  'Variação de': ['Variation of', 'Variación de'],
  'Todas as voltas na meta.': ['All laps on target.', 'Todas las vueltas en el objetivo.'],
  'A maioria das voltas na meta.': [
    'Most laps on target.',
    'La mayoría de las vueltas en el objetivo.',
  ],
  'Metade das voltas na meta.': [
    'Half the laps on target.',
    'La mitad de las vueltas en el objetivo.',
  ],
  'Poucas voltas na meta.': ['A few laps on target.', 'Pocas vueltas en el objetivo.'],
  'Nenhuma volta na meta.': ['No laps on target.', 'Ninguna vuelta en el objetivo.'],
  'um segundo.': ['one second.', 'un segundo.'],
  'mais de um segundo.': ['over a second.', 'más de un segundo.'],
  Melhorou: ['Faster by', 'Mejoraste'],
  Perdeu: ['Lost', 'Perdiste'],
};

const braking: Record<keyof typeof BRAKE_WORDS, Translation> = {
  brake: ['Brake', 'Frena'],
  brakeHard: ['Brake hard', 'Frena fuerte'],
  brakeLight: ['Light braking', 'Frenada suave'],
};
const numberWords: Record<number, Translation> = {
  1: ['one', 'uno'],
  2: ['two', 'dos'],
  3: ['three', 'tres'],
  4: ['four', 'cuatro'],
  5: ['five', 'cinco'],
  6: ['six', 'seis'],
  7: ['seven', 'siete'],
  8: ['eight', 'ocho'],
  9: ['nine', 'nueve'],
  10: ['ten', 'diez'],
  11: ['eleven', 'once'],
  12: ['twelve', 'doce'],
  13: ['thirteen', 'trece'],
  14: ['fourteen', 'catorce'],
  15: ['fifteen', 'quince'],
  16: ['sixteen', 'dieciséis'],
  17: ['seventeen', 'diecisiete'],
  18: ['eighteen', 'dieciocho'],
  19: ['nineteen', 'diecinueve'],
  20: ['twenty', 'veinte'],
  30: ['thirty', 'treinta'],
  40: ['forty', 'cuarenta'],
  50: ['fifty', 'cincuenta'],
  60: ['sixty', 'sesenta'],
  70: ['seventy', 'setenta'],
  80: ['eighty', 'ochenta'],
  90: ['ninety', 'noventa'],
  100: ['one hundred', 'cien'],
  150: ['one hundred fifty', 'ciento cincuenta'],
  200: ['two hundred', 'doscientos'],
  250: ['two hundred fifty', 'doscientos cincuenta'],
  300: ['three hundred', 'trescientos'],
};
const gears = [
  ['First', 'Primera'],
  ['Second', 'Segunda'],
  ['Third', 'Tercera'],
  ['Fourth', 'Cuarta'],
  ['Fifth', 'Quinta'],
  ['Sixth', 'Sexta'],
  ['Seventh', 'Séptima'],
  ['Eighth', 'Octava'],
] as const;

const translations: Record<string, Translation> = { ...fixed };
for (const distance of BRAKE_MARKS) {
  const [en, es] = numberWords[distance]!;
  for (const kind of Object.keys(braking) as (keyof typeof braking)[]) {
    const [callEn, callEs] = braking[kind];
    translations[brakePhrase(kind, distance)] = [
      `${callEn} at ${en}.`,
      `${callEs} a ${es} metros.`,
    ];
  }
  const distanceKey = utteranceKeys(detailedBrakeUtterance(10, distance))[1]!;
  translations[distanceKey] = [`at ${en} metres.`, `a ${es} metros.`];
}
for (let percent = 10; percent <= 100; percent += 10) {
  const [en, es] = numberWords[percent]!;
  const key = utteranceKeys(detailedBrakeUtterance(percent, 100))[0]!;
  translations[key] = [`${en} percent brake`, `${es} por ciento de freno`];
}
for (let corner = 1; corner <= 20; corner++) {
  const [en, es] = numberWords[corner]!;
  translations[cornerSegment(corner)] = [`At turn ${en}`, `En la curva ${es}`];
  translations[fromCornerSegment(corner)] = [`from turn ${en}`, `de la curva ${es}`];
  translations[toCornerSegment(corner)] = [`to turn ${en}.`, `a la curva ${es}.`];
}
gears.forEach(([en, es], i) => {
  translations[gearSegment(i + 1)] = [`${en} gear.`, `${es} marcha.`];
});
for (let tenths = 1; tenths <= 9; tenths++) {
  const [en, es] = numberWords[tenths]!;
  translations[tenthsAmount(tenths)] =
    tenths === 1 ? ['one tenth.', 'una décima.'] : [`${en} tenths.`, `${es} décimas.`];
}

export function radioCatalog(language: Language): readonly RadioEntry[] {
  if (language === 'pt-BR') return RADIO_CATALOG;
  const index = language === 'en' ? 0 : 1;
  return RADIO_CATALOG.map(({ text }) => {
    const say = translations[text]?.[index];
    if (!say) throw new Error(`Missing ${language} radio phrase: ${text}`);
    return { text, say };
  });
}

export function localizedRadioUtterance(utterance: RadioUtterance, language: Language): string {
  const keys = utteranceKeys(utterance);
  if (language === 'pt-BR') return keys.join(' ');
  const index = language === 'en' ? 0 : 1;
  return keys.map((key) => translations[key]?.[index] ?? key).join(' ');
}
