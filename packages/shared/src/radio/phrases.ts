/**
 * Single source of truth for everything the radio engineer can say.
 *
 * Every entry is pre-generated for every neural voice by `npm run radio:voices`
 * (packages/web/scripts/radio-voices). To add a call: add it here (as a phrase or as segments),
 * rerun the generator and commit the new packs + manifest. A test fails while any voice lacks a
 * catalog entry.
 *
 * - A **phrase** is a complete utterance, played as one clip. The key is the text itself.
 * - A **segment** is a reusable piece (corner, gear, tenths…). Values without a recorded phrase
 *   are assembled deterministically from segments with a fixed gap (see `RadioUtterance`).
 *
 * `say` overrides the text the synthesizer reads (pronunciation), never the key.
 * No runtime dependencies: the generator imports this module from Node, and the radio decision
 * engine (packages/shared/src/radio) picks its utterances from here.
 */

export interface RadioEntry {
  /** Key used by callers and in the manifest. */
  text: string;
  /** What the synthesizer reads, when it differs from `text`. */
  say?: string;
}

/** A complete phrase key, or a sequence of segment/phrase keys played back to back. */
export type RadioUtterance = string | readonly string[];

/** Gap between consecutive clips of a sequence, after each clip's own trimmed pad. */
export const RADIO_SEQUENCE_GAP_MS = 60;

// ---- pt-BR numbers ---------------------------------------------------------------------------

const UNITS = [
  'zero',
  'um',
  'dois',
  'três',
  'quatro',
  'cinco',
  'seis',
  'sete',
  'oito',
  'nove',
  'dez',
  'onze',
  'doze',
  'treze',
  'quatorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
];
const TENS = [
  '',
  '',
  'vinte',
  'trinta',
  'quarenta',
  'cinquenta',
  'sessenta',
  'setenta',
  'oitenta',
  'noventa',
];
const HUNDREDS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
];

/** Spell an integer 0–999 in pt-BR (masculine): 150 → "cento e cinquenta". */
export function ptNumber(value: number): string {
  const n = Math.trunc(value);
  if (n < 0 || n > 999) throw new RangeError(`ptNumber: ${value}`);
  if (n < 20) return UNITS[n]!;
  if (n === 100) return 'cem';
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]!);
  if (rest >= 20) {
    parts.push(TENS[Math.floor(rest / 10)]!);
    if (rest % 10) parts.push(UNITS[rest % 10]!);
  } else if (rest) parts.push(UNITS[rest]!);
  return parts.join(' e ');
}

// ---- Live driving calls (Treino) -------------------------------------------------------------

export const BRAKE_WORDS = {
  brake: 'Freio',
  brakeHard: 'Freada forte',
  brakeLight: 'Toque no freio',
} as const;

export const ACTION_WORDS = {
  release: 'Solta o freio',
  releaseSmooth: 'Vai soltando o freio',
  coast: 'Deixa rolar',
  throttle: 'Volta no acelerador',
  throttleSmooth: 'Acelera, suave',
} as const;

/** Distances (m) with a recorded braking call. */
export const BRAKE_MARKS = [50, 100, 150, 200, 250, 300] as const;

const BRAKE_PERCENTAGES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
const brakePercentSegment = (percent: number) => `${ptNumber(percent)} por cento de freio`;
const brakeDistanceSegment = (meters: number) => `em ${ptNumber(meters)} metros.`;

export const detailedBrakeUtterance = (percent: number, meters: number): RadioUtterance => [
  brakePercentSegment(percent),
  brakeDistanceSegment(meters),
];

export const brakePhrase = (kind: keyof typeof BRAKE_WORDS, meters: number) =>
  `${BRAKE_WORDS[kind]} em ${ptNumber(meters)}.`;
export const actionPhrase = (kind: keyof typeof ACTION_WORDS) => `${ACTION_WORDS[kind]}.`;
export const BRAKE_NOW = 'Freia.';

/** Every phrase the live engineer (engineerRadio.ts) can call today. */
export const LIVE_CALL_PHRASES: readonly string[] = [
  ...(Object.keys(BRAKE_WORDS) as (keyof typeof BRAKE_WORDS)[]).flatMap((kind) =>
    BRAKE_MARKS.map((meters) => brakePhrase(kind, meters)),
  ),
  ...(Object.keys(ACTION_WORDS) as (keyof typeof ACTION_WORDS)[]).map(actionPhrase),
  BRAKE_NOW,
];

// ---- Car, strategy and result phrases (spec do engenheiro de rádio) --------------------------

export const TYRES_COLD = 'Pneus frios. Aqueça progressivamente.';
export const TYRES_OK = 'Pneus na faixa.';
export const TYRES_HOT = 'Pneus quentes.';
export const FUEL_SHORT = 'Nesse ritmo, falta combustível para terminar. Economize nesta volta.';
export const LIFT_THROTTLE = 'Alivia o acelerador.';
export const GOOD_LAP = 'Boa volta.';
export const SAME_TIME = 'Mesmo tempo.';

/** Fuel autonomy when the race length is unknown, by whole laps left (0 = less than one lap). */
export const FUEL_LAPS = {
  0: 'Combustível para menos de uma volta.',
  1: 'Combustível para uma volta.',
  2: 'Combustível para duas voltas.',
  5: 'Combustível para cinco voltas.',
} as const;
export type FuelLapsLeft = keyof typeof FUEL_LAPS;

export const ALERT_PHRASES: readonly string[] = [
  TYRES_COLD,
  TYRES_OK,
  TYRES_HOT,
  FUEL_SHORT,
  LIFT_THROTTLE,
  GOOD_LAP,
  SAME_TIME,
  FUEL_LAPS[5],
  FUEL_LAPS[2],
  FUEL_LAPS[1],
  FUEL_LAPS[0],
];

// ---- Segments ---------------------------------------------------------------------------------

export const MAX_CORNER = 20;
export const MAX_TENTHS = 9;
const GEARS = ['primeira', 'segunda', 'terceira', 'quarta', 'quinta', 'sexta', 'sétima', 'oitava'];

/** "Na T4" → spoken "Na tê quatro". Corners 1–MAX_CORNER. */
export const cornerSegment = (corner: number) => `Na T${corner}`;
/** "Terceira marcha." Gears 1–8. */
export const gearSegment = (gear: number) => {
  const word = GEARS[gear - 1];
  if (!word) throw new RangeError(`gearSegment: ${gear}`);
  return `${word[0]!.toUpperCase()}${word.slice(1)} marcha.`;
};
/** "dois décimos." Tenths 1–MAX_TENTHS. */
export const tenthsSegment = (tenths: number) =>
  tenths === 1 ? 'um décimo.' : `${ptNumber(tenths)} décimos.`;
export const ONE_SECOND = 'um segundo.';
export const OVER_ONE_SECOND = 'mais de um segundo.';
export const IMPROVED = 'Melhorou';
export const LOST = 'Perdeu';

/** "da T1" → spoken "da tê um": start of a corner range ("Você melhorou da T1 à T3."). */
export const fromCornerSegment = (corner: number) => `da T${corner}`;
/** "à T3." → spoken "à tê três.": end of a corner range. */
export const toCornerSegment = (corner: number) => `à T${corner}.`;

// ---- Coaching (Treino: Aprender pista, Ganhar tempo, Consistência, resumo) --------------------

/** "Você melhorou" + "da T1" + "à T3." */
export const YOU_IMPROVED = 'Você melhorou';
/** "Na T4" + "você melhorou." */
export const YOU_IMPROVED_HERE = 'você melhorou.';

/** Post-hoc correction of Ganhar tempo: "Na T4" + cause + action. */
export const CAUSE_WORDS = {
  heldBrake: 'você segurou o freio.',
  brakeEarly: 'você freou cedo.',
  lateThrottle: 'você demorou a acelerar.',
  coasting: 'você ficou sem pedal.',
} as const;
export const CAUSE_ACTIONS = {
  heldBrake: 'Na próxima, comece a soltar quando virar.',
  brakeEarly: 'Na próxima, freie mais tarde.',
  lateThrottle: 'Na próxima, acelere mais cedo.',
  coasting: 'Na próxima, emende freio e acelerador.',
} as const;
/** Next action of the summary: "Na T4" + "foque na soltura do freio." */
export const CAUSE_FOCUS = {
  heldBrake: 'foque na soltura do freio.',
  brakeEarly: 'foque no ponto de freada.',
  lateThrottle: 'foque na retomada do acelerador.',
  coasting: 'foque na emenda dos pedais.',
  gear: 'foque na marcha.',
} as const;

/** Driving events (high confidence, after the car straightens): "Na T9" + event + action. */
export const EVENT_WORDS = {
  frontLock: 'você travou a dianteira.',
  oversteer: 'a traseira escapou.',
  understeer: 'o carro saiu de frente.',
  exitTraction: 'a traseira patinou na saída.',
} as const;
export const EVENT_ACTIONS = {
  easeBrakePeak: 'Na próxima, alivie o pico do freio.',
  releaseSmoother: 'Na próxima, solte o freio mais suave.',
  progressiveThrottle: 'Na próxima, acelere de forma progressiva.',
  smootherPedals: 'Na próxima, suavize a troca de pedais.',
  turnLessOnEntry: 'Na próxima, vire menos na entrada.',
  slowerThrottle: 'Na próxima, abra o acelerador mais devagar.',
  lessSteering: 'Na próxima, tire um pouco de volante.',
  doseThrottle: 'Na próxima, dose o acelerador.',
} as const;
export type EventAction = keyof typeof EVENT_ACTIONS;

/** Block summary: "Distância para a meta:" + "três décimos." */
export const TO_GOAL = 'Distância para a meta:';
/** Consistência: "Variação de" + "três décimos." + adherence. */
export const VARIATION = 'Variação de';
export const ADHERENCE = {
  all: 'Todas as voltas na meta.',
  most: 'A maioria das voltas na meta.',
  half: 'Metade das voltas na meta.',
  few: 'Poucas voltas na meta.',
  none: 'Nenhuma volta na meta.',
} as const;
export type Adherence = keyof typeof ADHERENCE;

export const COACHING_PHRASES: readonly string[] = [
  YOU_IMPROVED,
  YOU_IMPROVED_HERE,
  ...Object.values(CAUSE_WORDS),
  ...Object.values(CAUSE_ACTIONS),
  ...Object.values(CAUSE_FOCUS),
  ...Object.values(EVENT_WORDS),
  ...Object.values(EVENT_ACTIONS),
  TO_GOAL,
  VARIATION,
  ...Object.values(ADHERENCE),
];

/** A time in tenths as a segment: 1–9 tenths, "um segundo." or "mais de um segundo.". */
export function tenthsAmount(tenths: number): string {
  const size = Math.max(1, Math.abs(Math.round(tenths)));
  return size > 10 ? OVER_ONE_SECOND : size === 10 ? ONE_SECOND : tenthsSegment(size);
}

export const SEGMENTS: readonly RadioEntry[] = [
  ...BRAKE_PERCENTAGES.map((percent) => ({ text: brakePercentSegment(percent) })),
  ...BRAKE_MARKS.map((meters) => ({ text: brakeDistanceSegment(meters) })),
  ...Array.from({ length: MAX_CORNER }, (_, i) => ({
    text: cornerSegment(i + 1),
    say: `Na tê ${ptNumber(i + 1)}`,
  })),
  ...Array.from({ length: MAX_CORNER }, (_, i) => ({
    text: fromCornerSegment(i + 1),
    say: `da tê ${ptNumber(i + 1)}`,
  })),
  ...Array.from({ length: MAX_CORNER }, (_, i) => ({
    text: toCornerSegment(i + 1),
    say: `à tê ${ptNumber(i + 1)}.`,
  })),
  ...GEARS.map((_, i) => ({ text: gearSegment(i + 1) })),
  ...Array.from({ length: MAX_TENTHS }, (_, i) => ({ text: tenthsSegment(i + 1) })),
  { text: ONE_SECOND },
  { text: OVER_ONE_SECOND },
  { text: IMPROVED },
  { text: LOST },
];

/**
 * Lap-time result in tenths, assembled from segments: +2 → "Melhorou · dois décimos.",
 * -12 → "Perdeu · mais de um segundo.". Returns the recorded phrase for 0.
 */
export function lapDeltaUtterance(gainedTenths: number): RadioUtterance {
  const tenths = Math.round(gainedTenths);
  if (tenths === 0) return SAME_TIME;
  return [tenths > 0 ? IMPROVED : LOST, tenthsAmount(tenths)];
}

// ---- Catalog ----------------------------------------------------------------------------------

/** Preview played by "Testar voz": the same text for every voice. */
export const RADIO_PREVIEW_KEY = 'preview';
export const RADIO_PREVIEW_TEXT =
  'Rádio na escuta. Freada forte em duzentos. Terceira marcha na tê quatro. Melhorou dois décimos.';

/** Short call played when the radio is enabled. */
export const RADIO_HELLO = brakePhrase('brakeHard', 200);

export const RADIO_PHRASES: readonly string[] = [
  ...LIVE_CALL_PHRASES,
  ...ALERT_PHRASES,
  ...COACHING_PHRASES,
];

/** Everything every voice must ship, deduplicated, in a stable order. */
export const RADIO_CATALOG: readonly RadioEntry[] = (() => {
  const entries: RadioEntry[] = [
    { text: RADIO_PREVIEW_KEY, say: RADIO_PREVIEW_TEXT },
    ...RADIO_PHRASES.map((text) => ({ text })),
    ...SEGMENTS,
  ];
  const seen = new Set<string>();
  return entries.filter((entry) => !seen.has(entry.text) && seen.add(entry.text));
})();

/** Keys of an utterance, in playback order. */
export const utteranceKeys = (utterance: RadioUtterance): readonly string[] =>
  typeof utterance === 'string' ? [utterance] : utterance;
