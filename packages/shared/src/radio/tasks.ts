/**
 * Engineer tasks (spec 20): the dictionary of spoken pieces and the composer that turns a
 * structured request ("on T7 entry, brake 20 m later") into a sentence made only of pieces that
 * exist in the voice packs. The MCP composes; nothing outside this dictionary can be spoken.
 *
 * Pure and isomorphic. A piece (segment) is a whole clip: its key is the pt-BR text (like every
 * radio clip) and its `say` holds what each language's voice reads. Pieces never depend on the
 * gender or number of their neighbours, and the order of the slots is the same in the three
 * languages: [focus] [where] [action] [purpose].
 *
 * Ids are stable forever (only added, never renamed or removed): a stored task keeps working in
 * any later dictionary version.
 */

import type { Corner } from '../analysis.ts';
import type { Language } from '../language.ts';
import { localizedRadioUtterance, radioCatalog } from '../radio-translations.ts';
import {
  cornerSegment,
  fromCornerSegment,
  gearSegment,
  type RadioEntry,
  toCornerSegment,
} from './phrases.ts';
import { TASK_VOICE_MANIFEST } from './task-voice-manifest.ts';

/** Bump when pieces are added; the packs on GitHub carry the same number. */
export const TASK_DICTIONARY_VERSION = 1;

export const TASK_BUDGET = {
  /** Longest sentence (ms), counted with the real clips of the longest voice (the manifest). */
  maxMs: 7000,
  /** Most clips in one sentence. */
  maxClips: 8,
} as const;

// ---- pieces -----------------------------------------------------------------------------------

/** A piece that is new in the task pack (key = pt-BR text). */
export interface TaskPiece {
  id: string;
  /** Clip key and pt-BR text. */
  key: string;
  /** What the pt-BR voice reads, when it differs from `key` (e.g. "tê sete"). */
  say?: string;
  en: string;
  es: string;
}

const p = (id: string, key: string, en: string, es: string, say?: string): TaskPiece =>
  say === undefined ? { id, key, en, es } : { id, key, en, es, say };

const NUM_EN = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];
const NUM_ES = [
  '',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
];
const NUM_PT = [
  '',
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
  'catorze',
  'quinze',
  'dezesseis',
  'dezessete',
  'dezoito',
  'dezenove',
  'vinte',
];

export const MAX_TASK_CORNER = 20;
export const MAX_TASK_SECTOR = 6;
export const MAX_TASK_GEAR = 8;

// WHERE ----------------------------------------------------------------------------------------

export const PHASES = ['entry', 'apex', 'exit'] as const;
export type TaskPhase = (typeof PHASES)[number];
const PHASE_PIECES: Record<TaskPhase, TaskPiece> = {
  entry: p('loc.phase.entry', 'entrada', 'entry', 'entrada'),
  apex: p('loc.phase.apex', 'ápice', 'apex', 'ápice'),
  exit: p('loc.phase.exit', 'saída', 'exit', 'salida'),
};

export const STRAIGHTS = ['start', 'finish'] as const;
export type TaskStraight = (typeof STRAIGHTS)[number];
const STRAIGHT_PIECES: Record<TaskStraight, TaskPiece> = {
  start: p(
    'loc.straight.start',
    'Na reta dos boxes',
    'On the pit straight',
    'En la recta de boxes',
  ),
  finish: p(
    'loc.straight.finish',
    'Na linha de chegada',
    'At the finish line',
    'En la línea de meta',
  ),
};

export const GLOBALS = [
  'slowCorners',
  'fastCorners',
  'hardBraking',
  'allCorners',
  'allStraights',
] as const;
export type TaskGlobal = (typeof GLOBALS)[number];
const GLOBAL_PIECES: Record<TaskGlobal, TaskPiece> = {
  slowCorners: p(
    'loc.global.slowCorners',
    'Nas curvas lentas',
    'In the slow corners',
    'En las curvas lentas',
  ),
  fastCorners: p(
    'loc.global.fastCorners',
    'Nas curvas rápidas',
    'In the fast corners',
    'En las curvas rápidas',
  ),
  hardBraking: p(
    'loc.global.hardBraking',
    'Nas freadas fortes',
    'Under heavy braking',
    'En las frenadas fuertes',
  ),
  allCorners: p(
    'loc.global.allCorners',
    'Em todas as curvas',
    'In every corner',
    'En todas las curvas',
  ),
  allStraights: p(
    'loc.global.allStraights',
    'Em todas as retas',
    'On every straight',
    'En todas las rectas',
  ),
};

const SECTOR_PIECES: TaskPiece[] = Array.from({ length: MAX_TASK_SECTOR }, (_, i) =>
  p(
    `loc.sector.${i + 1}`,
    `No setor ${NUM_PT[i + 1]}`,
    `In sector ${NUM_EN[i + 1]}`,
    `En el sector ${NUM_ES[i + 1]}`,
  ),
);
const BEFORE_PIECES: TaskPiece[] = Array.from({ length: MAX_TASK_CORNER }, (_, i) =>
  p(
    `loc.before.${i + 1}`,
    `Antes da T${i + 1}`,
    `Before turn ${NUM_EN[i + 1]}`,
    `Antes de la curva ${NUM_ES[i + 1]}`,
    `Antes da tê ${NUM_PT[i + 1]}`,
  ),
);
const AFTER_PIECES: TaskPiece[] = Array.from({ length: MAX_TASK_CORNER }, (_, i) =>
  p(
    `loc.after.${i + 1}`,
    `Depois da T${i + 1}`,
    `After turn ${NUM_EN[i + 1]}`,
    `Después de la curva ${NUM_ES[i + 1]}`,
    `Depois da tê ${NUM_PT[i + 1]}`,
  ),
);

// ACTION: verbs, comparatives, amounts --------------------------------------------------------------

export const STEMS = ['brake', 'throttle', 'steer', 'enter'] as const;
export type TaskStem = (typeof STEMS)[number];
const STEM_PIECES: Record<TaskStem, TaskPiece> = {
  brake: p('act.stem.brake', 'Freie', 'Brake', 'Frena'),
  throttle: p('act.stem.throttle', 'Acelere', 'Accelerate', 'Acelera'),
  steer: p('act.stem.steer', 'Vire', 'Turn in', 'Gira'),
  enter: p('act.stem.enter', 'Entre', 'Enter', 'Entra'),
};

export const COMPARATORS = [
  'earlier',
  'later',
  'harderStart',
  'lighter',
  'smoother',
  'slower',
  'wider',
  'inside',
] as const;
export type TaskComparator = (typeof COMPARATORS)[number];
const COMPARATOR_PIECES: Record<TaskComparator, TaskPiece> = {
  earlier: p('cmp.earlier', 'mais cedo.', 'earlier.', 'antes.'),
  later: p('cmp.later', 'mais tarde.', 'later.', 'más tarde.'),
  harderStart: p(
    'cmp.harderStart',
    'mais forte no início.',
    'harder at the start.',
    'más fuerte al principio.',
  ),
  lighter: p('cmp.lighter', 'mais leve.', 'lighter.', 'más ligero.'),
  smoother: p('cmp.smoother', 'mais suave.', 'smoother.', 'más suave.'),
  slower: p('cmp.slower', 'mais devagar.', 'more slowly.', 'más despacio.'),
  wider: p('cmp.wider', 'mais aberto.', 'wider.', 'más abierto.'),
  inside: p('cmp.inside', 'mais por dentro.', 'tighter, on the inside.', 'más por dentro.'),
};

/** Which comparatives each stem accepts. */
export const STEM_COMPARATORS: Record<TaskStem, readonly TaskComparator[]> = {
  brake: ['later', 'earlier', 'harderStart', 'lighter', 'smoother'],
  throttle: ['earlier', 'later', 'smoother', 'slower'],
  steer: ['earlier', 'later', 'smoother'],
  enter: ['wider', 'inside'],
};

export const AMOUNT_METERS = [5, 10, 15, 20, 25, 30, 50, 75, 100, 150] as const;
export const AMOUNTS = ['little', 'lot', ...AMOUNT_METERS.map((m) => `m${m}`)] as readonly string[];
export type TaskAmount = string;
const METERS_PT: Record<number, string> = {
  5: 'cinco metros',
  10: 'dez metros',
  15: 'quinze metros',
  20: 'vinte metros',
  25: 'vinte e cinco metros',
  30: 'trinta metros',
  50: 'cinquenta metros',
  75: 'setenta e cinco metros',
  100: 'cem metros',
  150: 'cento e cinquenta metros',
};
const METERS_EN: Record<number, string> = {
  5: 'five meters',
  10: 'ten meters',
  15: 'fifteen meters',
  20: 'twenty meters',
  25: 'twenty-five meters',
  30: 'thirty meters',
  50: 'fifty meters',
  75: 'seventy-five meters',
  100: 'one hundred meters',
  150: 'one hundred fifty meters',
};
const METERS_ES: Record<number, string> = {
  5: 'cinco metros',
  10: 'diez metros',
  15: 'quince metros',
  20: 'veinte metros',
  25: 'veinticinco metros',
  30: 'treinta metros',
  50: 'cincuenta metros',
  75: 'setenta y cinco metros',
  100: 'cien metros',
  150: 'ciento cincuenta metros',
};
const AMOUNT_PIECES: Record<string, TaskPiece> = {
  little: p('amt.little', 'um pouco', 'a little', 'un poco'),
  lot: p('amt.lot', 'bem', 'much', 'bastante'),
  ...Object.fromEntries(
    AMOUNT_METERS.map((m) => [
      `m${m}`,
      p(`amt.m${m}`, METERS_PT[m]!, METERS_EN[m]!, METERS_ES[m]!),
    ]),
  ),
};
/** Distances only make sense when the move is in time or place (earlier / later). */
const METER_COMPARATORS: readonly TaskComparator[] = ['earlier', 'later'];

// GEAR ------------------------------------------------------------------------------------------

export const GEAR_ACTIONS = ['gearDown', 'gearUp', 'gearHold'] as const;
export type TaskGearAction = (typeof GEAR_ACTIONS)[number];
const GEAR_PIECES: Record<TaskGearAction, TaskPiece> = {
  gearDown: p('act.gear.down', 'Reduza para a', 'Downshift to', 'Reduce a'),
  gearUp: p('act.gear.up', 'Suba para a', 'Upshift to', 'Sube a'),
  gearHold: p('act.gear.hold', 'Segure a', 'Hold', 'Mantén la'),
};

// CLOSED PHRASES ---------------------------------------------------------------------------------

export type TaskGroup =
  | 'gear'
  | 'brake'
  | 'throttle'
  | 'steering'
  | 'line'
  | 'pace'
  | 'stability'
  | 'resource'
  | 'reference'
  | 'race';

interface ClosedDef {
  id: string;
  group: TaskGroup;
  piece: TaskPiece;
}
const c = (group: TaskGroup, id: string, key: string, en: string, es: string): ClosedDef => ({
  id,
  group,
  piece: p(`act.${group}.${id}`, key, en, es),
});

const CLOSED: readonly ClosedDef[] = [
  // gear
  c('gear', 'noDownshift', 'Não reduza.', 'Don’t downshift.', 'No reduzcas.'),
  c('gear', 'noUpshift', 'Não suba de marcha.', 'Don’t upshift.', 'No subas de marcha.'),
  c(
    'gear',
    'shiftEarlier',
    'Troque de marcha mais cedo.',
    'Shift earlier.',
    'Cambia de marcha antes.',
  ),
  c(
    'gear',
    'shiftLater',
    'Troque de marcha mais tarde.',
    'Shift later.',
    'Cambia de marcha más tarde.',
  ),
  c('gear', 'stretchGear', 'Estique a marcha.', 'Hold the gear longer.', 'Alarga la marcha.'),
  // brake
  c(
    'brake',
    'releaseEarlier',
    'Solte o freio mais cedo.',
    'Release the brake earlier.',
    'Suelta el freno antes.',
  ),
  c(
    'brake',
    'releaseSlower',
    'Solte o freio mais devagar.',
    'Release the brake more slowly.',
    'Suelta el freno más despacio.',
  ),
  c(
    'brake',
    'trailBrake',
    'Solte o freio aos poucos enquanto vira.',
    'Ease off the brake as you turn in.',
    'Ve soltando el freno mientras giras.',
  ),
  c(
    'brake',
    'holdBrake',
    'Segure o freio até virar.',
    'Hold the brake until you turn in.',
    'Mantén el freno hasta girar.',
  ),
  c(
    'brake',
    'blendPedals',
    'Emende freio e acelerador.',
    'Blend brake and throttle.',
    'Enlaza freno y acelerador.',
  ),
  c(
    'brake',
    'easePeak',
    'Alivie o pico do freio.',
    'Ease the peak brake pressure.',
    'Alivia el pico del freno.',
  ),
  c('brake', 'noBrake', 'Não freie aqui.', 'Don’t brake here.', 'No frenes aquí.'),
  c(
    'brake',
    'brakeStraight',
    'Freie com o carro reto.',
    'Brake with the car straight.',
    'Frena con el coche recto.',
  ),
  // throttle
  c(
    'throttle',
    'progressive',
    'Acelere de forma progressiva.',
    'Build the throttle progressively.',
    'Acelera de forma progresiva.',
  ),
  c('throttle', 'dose', 'Dose o acelerador.', 'Meter the throttle.', 'Dosifica el acelerador.'),
  c('throttle', 'fullThrottle', 'Acelere a fundo.', 'Go full throttle.', 'Acelera a fondo.'),
  c(
    'throttle',
    'liftThrottle',
    'Alivie o acelerador.',
    'Ease off the throttle.',
    'Alivia el acelerador.',
  ),
  c('throttle', 'liftOff', 'Levante o pé.', 'Lift off.', 'Levanta el pie.'),
  c(
    'throttle',
    'noCoast',
    'Não deixe o carro rolar.',
    'Don’t let the car coast.',
    'No dejes rodar el coche.',
  ),
  c(
    'throttle',
    'steadyThrottle',
    'Mantenha o acelerador firme.',
    'Keep the throttle steady.',
    'Mantén el acelerador firme.',
  ),
  // steering
  c(
    'steering',
    'turnLess',
    'Vire menos na entrada.',
    'Turn in less on entry.',
    'Gira menos en la entrada.',
  ),
  c(
    'steering',
    'lessLock',
    'Tire um pouco de volante.',
    'Take off a little steering.',
    'Quita un poco de volante.',
  ),
  c(
    'steering',
    'fewerCorrections',
    'Menos correções de volante.',
    'Fewer steering corrections.',
    'Menos correcciones de volante.',
  ),
  c('steering', 'smoothWheel', 'Volante suave.', 'Smooth hands.', 'Volante suave.'),
  c(
    'steering',
    'openWheel',
    'Abra o volante na saída.',
    'Unwind the wheel on exit.',
    'Abre el volante en la salida.',
  ),
  c('steering', 'lookExit', 'Olhe para a saída.', 'Look to the exit.', 'Mira a la salida.'),
  c(
    'steering',
    'wheelStraightBraking',
    'Mantenha o volante reto na frenagem.',
    'Keep the wheel straight under braking.',
    'Mantén el volante recto al frenar.',
  ),
  // line
  c('line', 'useKerb', 'Use a zebra.', 'Use the kerb.', 'Usa el piano.'),
  c('line', 'noKerb', 'Não use a zebra.', 'Stay off the kerb.', 'No uses el piano.'),
  c(
    'line',
    'fullWidthExit',
    'Use toda a pista na saída.',
    'Use all the track on exit.',
    'Usa todo el ancho en la salida.',
  ),
  c(
    'line',
    'stayInside',
    'Fique na parte de dentro.',
    'Stay on the inside.',
    'Quédate por dentro.',
  ),
  c('line', 'lateApex', 'Corda mais tarde.', 'Apex later.', 'Vértice más tarde.'),
  c('line', 'earlyApex', 'Corda mais cedo.', 'Apex earlier.', 'Vértice antes.'),
  // pace
  c('pace', 'enterSlower', 'Entre mais devagar.', 'Enter slower.', 'Entra más despacio.'),
  c('pace', 'enterFaster', 'Entre mais rápido.', 'Enter faster.', 'Entra más rápido.'),
  c(
    'pace',
    'carryMore',
    'Carregue mais velocidade no meio.',
    'Carry more speed mid-corner.',
    'Lleva más velocidad en mitad de la curva.',
  ),
  c(
    'pace',
    'sacrificeEntry',
    'Sacrifique a entrada.',
    'Sacrifice the entry.',
    'Sacrifica la entrada.',
  ),
  c('pace', 'prioritiseExit', 'Priorize a saída.', 'Prioritise the exit.', 'Prioriza la salida.'),
  c('pace', 'dontForce', 'Não force.', 'Don’t force it.', 'No fuerces.'),
  c(
    'pace',
    'settleCar',
    'Espere o carro assentar.',
    'Let the car settle.',
    'Espera a que el coche se asiente.',
  ),
  c(
    'pace',
    'stabiliseCar',
    'Estabilize o carro antes de acelerar.',
    'Settle the car before the throttle.',
    'Estabiliza el coche antes de acelerar.',
  ),
  // stability
  c(
    'stability',
    'watchRear',
    'Cuidado com a traseira.',
    'Watch the rear.',
    'Cuidado con la trasera.',
  ),
  c(
    'stability',
    'watchFront',
    'Cuidado com a dianteira.',
    'Watch the front.',
    'Cuidado con la delantera.',
  ),
  c(
    'stability',
    'watchTraction',
    'Cuidado com a tração.',
    'Watch the traction.',
    'Cuidado con la tracción.',
  ),
  // resource
  c(
    'resource',
    'saveFuel',
    'Economize combustível aqui.',
    'Save fuel here.',
    'Ahorra combustible aquí.',
  ),
  c('resource', 'saveTyres', 'Poupe os pneus.', 'Look after the tyres.', 'Cuida los neumáticos.'),
  c('resource', 'warmTyres', 'Aqueça os pneus.', 'Warm the tyres.', 'Calienta los neumáticos.'),
  c(
    'resource',
    'liftEarlySave',
    'Levante cedo para economizar.',
    'Lift early to save fuel.',
    'Levanta pronto para ahorrar.',
  ),
  // reference
  c(
    'reference',
    'useBoard',
    'Use a placa de cem metros como referência.',
    'Use the one hundred meter board as your marker.',
    'Usa el cartel de cien metros como referencia.',
  ),
  c(
    'reference',
    'useMark',
    'Use a marca no asfalto como referência.',
    'Use the mark on the tarmac as your marker.',
    'Usa la marca del asfalto como referencia.',
  ),
  c(
    'reference',
    'lookBrakePoint',
    'Olhe para o ponto de freada.',
    'Look at the braking point.',
    'Mira el punto de frenada.',
  ),
  // race
  c('race', 'useSlipstream', 'Aproveite o vácuo.', 'Use the slipstream.', 'Aprovecha el rebufo.'),
  c('race', 'leaveSlipstream', 'Saia do vácuo.', 'Pull out of the slipstream.', 'Sal del rebufo.'),
  c('race', 'leaveRoom', 'Deixe espaço.', 'Leave some room.', 'Deja espacio.'),
];
const CLOSED_BY_ID = new Map(CLOSED.map((d) => [d.id, d]));

// PURPOSE and FOCUS -------------------------------------------------------------------------------

export const PURPOSES = [
  'exit',
  'traction',
  'noLock',
  'apex',
  'fuel',
  'tyres',
  'rhythm',
  'stability',
  'straight',
] as const;
export type TaskPurpose = (typeof PURPOSES)[number];
const PURPOSE_PIECES: Record<TaskPurpose, TaskPiece> = {
  exit: p('why.exit', 'para sair melhor.', 'to exit better.', 'para salir mejor.'),
  traction: p('why.traction', 'para ganhar tração.', 'for more traction.', 'para ganar tracción.'),
  noLock: p('why.noLock', 'para não travar.', 'to avoid locking up.', 'para no bloquear.'),
  apex: p(
    'why.apex',
    'para chegar mais rápido no ápice.',
    'to reach the apex faster.',
    'para llegar más rápido al vértice.',
  ),
  fuel: p('why.fuel', 'para economizar combustível.', 'to save fuel.', 'para ahorrar combustible.'),
  tyres: p(
    'why.tyres',
    'para proteger os pneus.',
    'to protect the tyres.',
    'para proteger los neumáticos.',
  ),
  rhythm: p('why.rhythm', 'para manter o ritmo.', 'to keep the rhythm.', 'para mantener el ritmo.'),
  stability: p(
    'why.stability',
    'para ficar mais estável.',
    'to stay stable.',
    'para estar más estable.',
  ),
  straight: p(
    'why.straight',
    'para ganhar tempo na reta.',
    'to gain time on the straight.',
    'para ganar tiempo en la recta.',
  ),
};

export const FOCUSES = ['focus', 'attention', 'reminder', 'none'] as const;
export type TaskFocus = (typeof FOCUSES)[number];
const FOCUS_PIECES: Record<Exclude<TaskFocus, 'none'>, TaskPiece> = {
  focus: p('pre.focus', 'Foco.', 'Focus.', 'Foco.'),
  attention: p('pre.attention', 'Atenção.', 'Heads up.', 'Atención.'),
  reminder: p('pre.reminder', 'Lembrete.', 'Reminder.', 'Recordatorio.'),
};

// ---- all new pieces ---------------------------------------------------------------------------

/** Every piece that is new in the task pack, in a fixed order. */
export const TASK_PIECES: readonly TaskPiece[] = [
  ...Object.values(FOCUS_PIECES),
  ...Object.values(PHASE_PIECES),
  ...Object.values(STRAIGHT_PIECES),
  ...Object.values(GLOBAL_PIECES),
  ...SECTOR_PIECES,
  ...BEFORE_PIECES,
  ...AFTER_PIECES,
  ...Object.values(STEM_PIECES),
  ...Object.values(COMPARATOR_PIECES),
  ...Object.values(AMOUNT_PIECES),
  ...Object.values(GEAR_PIECES),
  ...CLOSED.map((d) => d.piece),
  ...Object.values(PURPOSE_PIECES),
];

const PIECE_BY_ID = new Map(TASK_PIECES.map((x) => [x.id, x]));

/** Ids of the reused pieces (already clips of the main packs). */
const reusedId = {
  corner: (n: number) => `loc.corner.${n}`,
  from: (n: number) => `loc.from.${n}`,
  to: (n: number) => `loc.to.${n}`,
  gear: (g: number) => `act.gear.${g}`,
};
const REUSED_KEYS = new Map<string, string>();
for (let n = 1; n <= MAX_TASK_CORNER; n++) {
  REUSED_KEYS.set(reusedId.corner(n), cornerSegment(n));
  REUSED_KEYS.set(reusedId.from(n), fromCornerSegment(n));
  REUSED_KEYS.set(reusedId.to(n), toCornerSegment(n));
}
for (let g = 1; g <= MAX_TASK_GEAR; g++) REUSED_KEYS.set(reusedId.gear(g), gearSegment(g));

/** The clip key (pt-BR text) of a piece id, or null for an unknown id. */
export function taskPieceKey(id: string): string | null {
  return PIECE_BY_ID.get(id)?.key ?? REUSED_KEYS.get(id) ?? null;
}

/** The text of a piece in a language (what the panel shows and the voice reads). */
export function taskPieceText(id: string, language: Language): string | null {
  const piece = PIECE_BY_ID.get(id);
  if (piece) return language === 'pt-BR' ? piece.key : language === 'en' ? piece.en : piece.es;
  const key = REUSED_KEYS.get(id);
  return key ? localizedRadioUtterance(key, language) : null;
}

/** What the voice of a language reads for a piece (the pt-BR `say` spells "T7" as "tê sete"). */
function entryFor(piece: TaskPiece, language: Language): RadioEntry {
  if (language === 'pt-BR') return { text: piece.key, say: piece.say ?? piece.key };
  return { text: piece.key, say: language === 'en' ? piece.en : piece.es };
}

/**
 * The catalog of the task pack for one language: the new pieces plus the reused ones (corner and
 * gear clips), so a task sentence plays from a single pack. Keys are unique.
 */
export function taskCatalog(language: Language): readonly RadioEntry[] {
  const main = new Map(radioCatalog(language).map((e) => [e.text, e]));
  const entries: RadioEntry[] = TASK_PIECES.map((piece) => entryFor(piece, language));
  for (const key of REUSED_KEYS.values()) {
    const e = main.get(key);
    if (!e) throw new Error(`Reused task piece is not in the radio catalog: ${key}`);
    entries.push(e);
  }
  return entries;
}

// ---- request and composition -------------------------------------------------------------------

export type TaskWhere =
  | { corner: number; phase?: TaskPhase }
  | { between: [number, number] }
  | { before: number }
  | { after: number }
  | { sector: number }
  | { straight: TaskStraight }
  | { global: TaskGlobal }
  | { atM: number };

export interface TaskSay {
  /** A stem (`brake`…), a gear action (`gearDown`…) or a closed phrase id (`trailBrake`…). */
  action: string;
  amount?: string;
  comparator?: string;
  gear?: number;
  purpose?: string;
  focus?: TaskFocus;
}

export interface TaskRequest {
  where: TaskWhere;
  say: TaskSay;
}

export interface TaskComposition {
  /** Piece ids in speaking order. */
  ids: string[];
  /** Clip keys (pt-BR texts) in speaking order: what the radio plays. */
  keys: string[];
  /** The sentence in each language. */
  text: Record<Language, string>;
  /** The where, normalised (an `atM` becomes a corner or a stretch). */
  where: TaskWhere;
  /** Estimated duration (ms), the real clips are measured at generation. */
  estimatedMs: number;
}

export type TaskComposeError = {
  code: 'invalidWhere' | 'invalidAction' | 'invalidCombination' | 'tooLong' | 'needsTrack';
  message: string;
  /** What is valid here, to help the caller fix the request. */
  valid?: readonly string[];
};

export type TaskComposeResult =
  | { ok: true; composition: TaskComposition }
  | { ok: false; error: TaskComposeError };

const fail = (
  code: TaskComposeError['code'],
  message: string,
  valid?: readonly string[],
): TaskComposeResult => ({ ok: false, error: { code, message, ...(valid ? { valid } : {}) } });

const isCorner = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_TASK_CORNER;

/** The corner number of an id like "T7" (null for a name or a number above the dictionary). */
export function taskCornerNumber(id: string): number | null {
  const m = /^T(\d{1,2})$/.exec(id);
  const n = m ? Number(m[1]) : NaN;
  return isCorner(n) ? n : null;
}

/** Closest "where" for a position (m) on the lap: a corner phase, or between two corners. */
export function locatorForDistance(
  corners: readonly Pick<Corner, 'id' | 'entryM' | 'apexM' | 'exitM'>[],
  lengthM: number,
  atM: number,
): TaskWhere | null {
  const usable = corners
    .map((c) => ({ ...c, n: taskCornerNumber(c.id) }))
    .filter((c): c is typeof c & { n: number } => c.n !== null)
    .sort((a, b) => a.entryM - b.entryM);
  if (usable.length === 0 || !(lengthM > 0)) return null;
  const pos = ((atM % lengthM) + lengthM) % lengthM;
  // Inside a corner: entry, apex (±20 m) or exit.
  for (const c of usable) {
    const inside =
      c.exitM >= c.entryM ? pos >= c.entryM && pos <= c.exitM : pos >= c.entryM || pos <= c.exitM;
    if (!inside) continue;
    if (Math.abs(pos - c.apexM) <= 20) return { corner: c.n, phase: 'apex' };
    const before = c.apexM >= c.entryM ? pos < c.apexM : pos >= c.entryM;
    return { corner: c.n, phase: before ? 'entry' : 'exit' };
  }
  // On a straight: between the corner that ended before and the next one.
  const next = usable.find((c) => c.entryM > pos) ?? usable[0]!;
  const prevIndex = (usable.indexOf(next) - 1 + usable.length) % usable.length;
  const prev = usable[prevIndex]!;
  if (prev.n === next.n) return { after: prev.n };
  return { between: [prev.n, next.n] };
}

function whereIds(where: TaskWhere): { ids: string[]; where: TaskWhere } | TaskComposeError {
  const bad = (message: string, valid?: readonly string[]): TaskComposeError => ({
    code: 'invalidWhere',
    message,
    ...(valid ? { valid } : {}),
  });
  if ('corner' in where) {
    if (!isCorner(where.corner)) return bad(`Curva inválida: use 1 a ${MAX_TASK_CORNER}.`);
    if (where.phase !== undefined && !PHASES.includes(where.phase)) {
      return bad('Fase inválida.', PHASES);
    }
    const ids = [reusedId.corner(where.corner)];
    if (where.phase) ids.push(PHASE_PIECES[where.phase].id);
    return { ids, where };
  }
  if ('between' in where) {
    const [a, b] = where.between ?? [];
    if (!isCorner(a) || !isCorner(b) || a === b) {
      return bad('Entre duas curvas diferentes (1 a 20).');
    }
    return { ids: [reusedId.from(a), reusedId.to(b)], where };
  }
  if ('before' in where) {
    return isCorner(where.before)
      ? { ids: [BEFORE_PIECES[where.before - 1]!.id], where }
      : bad(`Curva inválida: use 1 a ${MAX_TASK_CORNER}.`);
  }
  if ('after' in where) {
    return isCorner(where.after)
      ? { ids: [AFTER_PIECES[where.after - 1]!.id], where }
      : bad(`Curva inválida: use 1 a ${MAX_TASK_CORNER}.`);
  }
  if ('sector' in where) {
    return Number.isInteger(where.sector) && where.sector >= 1 && where.sector <= MAX_TASK_SECTOR
      ? { ids: [SECTOR_PIECES[where.sector - 1]!.id], where }
      : bad(`Setor inválido: use 1 a ${MAX_TASK_SECTOR}.`);
  }
  if ('straight' in where) {
    return STRAIGHTS.includes(where.straight)
      ? { ids: [STRAIGHT_PIECES[where.straight].id], where }
      : bad('Reta inválida.', STRAIGHTS);
  }
  if ('global' in where) {
    return GLOBALS.includes(where.global)
      ? { ids: [GLOBAL_PIECES[where.global].id], where }
      : bad('Trecho global inválido.', GLOBALS);
  }
  return bad('Informe onde: corner, between, before, after, sector, straight, global ou atM.');
}

/** Ids of every action the dictionary accepts. */
export function taskActionIds(): string[] {
  return [...STEMS, ...GEAR_ACTIONS, ...CLOSED.map((d) => d.id)];
}

function actionIds(say: TaskSay): { ids: string[] } | TaskComposeError {
  const err = (
    code: TaskComposeError['code'],
    message: string,
    valid?: readonly string[],
  ): TaskComposeError => ({ code, message, ...(valid ? { valid } : {}) });
  const { action, amount, comparator, gear } = say;

  if ((STEMS as readonly string[]).includes(action)) {
    const stem = action as TaskStem;
    const allowed = STEM_COMPARATORS[stem];
    if (!comparator || !(allowed as readonly string[]).includes(comparator)) {
      return err('invalidCombination', `"${action}" pede um comparativo.`, allowed);
    }
    const ids = [STEM_PIECES[stem].id];
    if (amount !== undefined) {
      if (!AMOUNTS.includes(amount))
        return err('invalidCombination', 'Quantidade inválida.', AMOUNTS);
      const meters = /^m\d+$/.test(amount);
      if (meters && !METER_COMPARATORS.includes(comparator as TaskComparator)) {
        return err(
          'invalidCombination',
          'Metros só combinam com "earlier" e "later"; use "little" ou "lot".',
          ['little', 'lot'],
        );
      }
      ids.push(AMOUNT_PIECES[amount]!.id);
    }
    ids.push(COMPARATOR_PIECES[comparator as TaskComparator].id);
    return { ids };
  }

  if ((GEAR_ACTIONS as readonly string[]).includes(action)) {
    if (!Number.isInteger(gear) || (gear as number) < 1 || (gear as number) > MAX_TASK_GEAR) {
      return err('invalidCombination', `Informe a marcha (1 a ${MAX_TASK_GEAR}).`);
    }
    if (amount !== undefined || comparator !== undefined) {
      return err('invalidCombination', 'Ações de marcha não levam quantidade nem comparativo.');
    }
    return { ids: [GEAR_PIECES[action as TaskGearAction].id, reusedId.gear(gear as number)] };
  }

  const closed = CLOSED_BY_ID.get(action);
  if (closed) {
    if (amount !== undefined || comparator !== undefined || gear !== undefined) {
      return err(
        'invalidCombination',
        `"${action}" é uma frase pronta: sem quantidade, comparativo nem marcha.`,
      );
    }
    return { ids: [closed.piece.id] };
  }
  return err('invalidAction', `Ação desconhecida: "${action}".`, taskActionIds());
}

const upperFirst = (s: string) => (s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s);
const lowerFirst = (s: string) => (s ? `${s[0]!.toLowerCase()}${s.slice(1)}` : s);
const noStop = (s: string) => s.replace(/[.,;:]+$/u, '');

/**
 * The sentence as the panel writes it: "Foco. Na T7, entrada. Freie vinte metros mais tarde."
 * Pieces of one slot are joined (the action reads as one phrase, the place as a short label).
 */
function sentenceText(
  slots: { focus: string[]; where: string[]; action: string[]; purpose: string[] },
  language: Language,
): string {
  const text = (ids: string[]) => ids.map((id) => taskPieceText(id, language)!);
  const parts: string[] = [];
  parts.push(...text(slots.focus));
  if (slots.where.length) {
    const where = text(slots.where).map(noStop);
    // "Na T7, entrada" but "Da T3 à T4"
    const label = where.reduce(
      (acc, piece, i) =>
        i === 0 ? piece : `${acc}${slots.where[i]!.startsWith('loc.phase') ? ', ' : ' '}${piece}`,
      '',
    );
    parts.push(`${upperFirst(label)}.`);
  }
  let action = upperFirst(
    text(slots.action)
      .map((t, i) => (i === 0 ? t : lowerFirst(t)))
      .join(' '),
  );
  if (slots.purpose.length) action = `${noStop(action)}, ${text(slots.purpose).join(' ')}`;
  if (action) parts.push(action);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** The longest real duration (ms) of each clip across the voices, from the generated manifest. */
const REAL_MS = new Map<string, number>();
for (const voice of Object.values(TASK_VOICE_MANIFEST.voices)) {
  for (const [key, [, length]] of Object.entries(voice.clips)) {
    const ms = (length / TASK_VOICE_MANIFEST.sampleRate) * 1000;
    if (ms > (REAL_MS.get(key) ?? 0)) REAL_MS.set(key, ms);
  }
}

/** A clip's duration: the real one when the packs exist, else an estimate from its letters. */
const SEGMENT_MS = (key: string) =>
  REAL_MS.get(key) ?? 280 + 62 * key.replace(/[^\p{L}\p{N}]/gu, '').length;

/**
 * Composes a request into a sentence. With `corners` (and the lap length) an `atM` position is
 * turned into a corner phase or a stretch between two corners; without them `atM` is refused.
 */
export function composeTask(
  request: TaskRequest,
  track?: {
    corners: readonly Pick<Corner, 'id' | 'entryM' | 'apexM' | 'exitM'>[];
    lengthM: number;
  },
): TaskComposeResult {
  let where = request.where;
  if (where && 'atM' in where) {
    if (!track) return fail('needsTrack', 'Uma posição em metros precisa da pista.');
    const resolved =
      typeof where.atM === 'number'
        ? locatorForDistance(track.corners, track.lengthM, where.atM)
        : null;
    if (!resolved) {
      return fail('invalidWhere', 'Não foi possível situar essa posição entre as curvas da pista.');
    }
    where = resolved;
  }
  if (!where || typeof where !== 'object') return fail('invalidWhere', 'Informe onde.');
  const w = whereIds(where);
  if ('code' in w) return { ok: false, error: w };
  const a = actionIds(request.say ?? ({} as TaskSay));
  if ('code' in a) return { ok: false, error: a };

  const { purpose, focus = 'focus' } = request.say;
  const focusIds: string[] = [];
  if (focus !== 'none') {
    if (!FOCUSES.includes(focus)) return fail('invalidCombination', 'Prefixo inválido.', FOCUSES);
    focusIds.push(FOCUS_PIECES[focus].id);
  }
  const purposeIds: string[] = [];
  if (purpose !== undefined) {
    if (!(PURPOSES as readonly string[]).includes(purpose)) {
      return fail('invalidCombination', 'Porquê inválido.', PURPOSES);
    }
    purposeIds.push(PURPOSE_PIECES[purpose as TaskPurpose].id);
  }
  const ids = [...focusIds, ...w.ids, ...a.ids, ...purposeIds];

  const keys = ids.map((id) => taskPieceKey(id)!);
  const estimatedMs = keys.reduce((sum, k) => sum + SEGMENT_MS(k), 0) + 60 * (keys.length - 1);
  if (keys.length > TASK_BUDGET.maxClips || estimatedMs > TASK_BUDGET.maxMs) {
    return fail(
      'tooLong',
      `A frase ficaria longa demais (${Math.round(estimatedMs)} ms, ${keys.length} pedaços). Tire o porquê, a quantidade ou o prefixo.`,
    );
  }
  const slots = { focus: focusIds, where: w.ids, action: a.ids, purpose: purposeIds };
  const text = (language: Language) => sentenceText(slots, language);
  return {
    ok: true,
    composition: {
      ids,
      keys,
      text: { 'pt-BR': text('pt-BR'), en: text('en'), es: text('es') },
      where: w.where,
      estimatedMs,
    },
  };
}

// ---- where the sentence is spoken ----------------------------------------------------------------

/**
 * The lap distances (m) where the sentence must be finished: one for a corner or a stretch, many
 * for a global ("in every slow corner"). Empty when the track lacks what the task refers to.
 */
export function taskTriggers(
  where: TaskWhere,
  track: {
    corners: readonly Pick<Corner, 'id' | 'entryM' | 'apexM' | 'exitM' | 'kind'>[];
    lengthM: number;
    /** Where each sector starts (m), the first at 0; default: three equal sectors. */
    sectorStartsM?: readonly number[];
  },
): number[] {
  const byNumber = (n: number) => track.corners.find((c) => taskCornerNumber(c.id) === n);
  const wrap = (m: number) => ((m % track.lengthM) + track.lengthM) % track.lengthM;
  if ('corner' in where) {
    const c = byNumber(where.corner);
    if (!c) return [];
    return [wrap(where.phase === 'apex' ? c.apexM : where.phase === 'exit' ? c.exitM : c.entryM)];
  }
  if ('between' in where) {
    const c = byNumber(where.between[0]);
    return c ? [wrap(c.exitM)] : [];
  }
  if ('before' in where) {
    const c = byNumber(where.before);
    return c ? [wrap(c.entryM - 120)] : [];
  }
  if ('after' in where) {
    const c = byNumber(where.after);
    return c ? [wrap(c.exitM + 30)] : [];
  }
  if ('sector' in where) {
    const starts = track.sectorStartsM?.length
      ? track.sectorStartsM
      : [0, track.lengthM / 3, (2 * track.lengthM) / 3];
    const start = starts[where.sector - 1];
    return start === undefined ? [] : [wrap(start)];
  }
  if ('straight' in where) return [wrap(track.lengthM - (where.straight === 'start' ? 300 : 80))];
  if ('global' in where) {
    const kinds: Record<Exclude<TaskGlobal, 'allCorners' | 'allStraights'>, readonly string[]> = {
      slowCorners: ['hairpin', 'slow', 'chicane'],
      fastCorners: ['fast', 'kink'],
      hardBraking: ['hairpin', 'slow'],
    };
    if (where.global === 'allStraights') return track.corners.map((c) => wrap(c.exitM));
    const wanted = where.global === 'allCorners' ? null : kinds[where.global];
    return track.corners
      .filter((c) => wanted === null || (c.kind !== undefined && wanted.includes(c.kind)))
      .map((c) => wrap(c.entryM));
  }
  return [];
}

// ---- the dictionary for callers (MCP, editor) ----------------------------------------------------

export interface TaskDictionaryView {
  version: number;
  budget: typeof TASK_BUDGET;
  grammar: string;
  where: Record<string, unknown>;
  actions: {
    stems: Record<string, { text: string; comparators: readonly string[] }>;
    gear: Record<string, string>;
    closed: Record<string, { id: string; group: TaskGroup; text: string }[]>;
  };
  amounts: Record<string, string>;
  comparators: Record<string, string>;
  purposes: Record<string, string>;
  focuses: readonly string[];
  examples: { request: TaskRequest; text: string }[];
}

export function taskDictionaryView(): TaskDictionaryView {
  const closedById: TaskDictionaryView['actions']['closed'] = {};
  for (const d of CLOSED) {
    const list = closedById[d.group] ?? [];
    closedById[d.group] = list;
    list.push({ id: d.id, group: d.group, text: d.piece.key });
  }
  const examples: TaskRequest[] = [
    {
      where: { corner: 7, phase: 'entry' },
      say: { action: 'brake', amount: 'm20', comparator: 'later' },
    },
    { where: { after: 7 }, say: { action: 'gearUp', gear: 4, purpose: 'exit' } },
    {
      where: { between: [3, 4] },
      say: { action: 'throttle', amount: 'little', comparator: 'earlier' },
    },
    { where: { corner: 9, phase: 'exit' }, say: { action: 'progressive', purpose: 'traction' } },
    { where: { global: 'slowCorners' }, say: { action: 'trailBrake' } },
  ];
  return {
    version: TASK_DICTIONARY_VERSION,
    budget: TASK_BUDGET,
    grammar:
      'Frase = [prefixo] [onde] [ação] [porquê]. Onde: corner (1-20, fase opcional entry|apex|exit), between [a,b], before n, after n, sector 1-6, straight start|finish, global ou atM (metros). Ação: um verbo (brake|throttle|steer|enter) com comparator (e amount opcional), uma ação de marcha (gearDown|gearUp|gearHold com gear 1-8) ou uma frase pronta (id).',
    where: {
      corner: `1-${MAX_TASK_CORNER}`,
      phase: PHASES,
      between: '[de, até] (duas curvas diferentes)',
      before: `1-${MAX_TASK_CORNER}`,
      after: `1-${MAX_TASK_CORNER}`,
      sector: `1-${MAX_TASK_SECTOR}`,
      straight: STRAIGHTS,
      global: GLOBALS,
      atM: 'posição na volta, em metros (vira "curva e fase" ou "entre duas curvas")',
    },
    actions: {
      stems: Object.fromEntries(
        STEMS.map((s) => [s, { text: STEM_PIECES[s].key, comparators: STEM_COMPARATORS[s] }]),
      ),
      gear: Object.fromEntries(GEAR_ACTIONS.map((g) => [g, GEAR_PIECES[g].key])),
      closed: closedById,
    },
    amounts: Object.fromEntries(Object.entries(AMOUNT_PIECES).map(([k, v]) => [k, v.key])),
    comparators: Object.fromEntries(COMPARATORS.map((k) => [k, COMPARATOR_PIECES[k].key])),
    purposes: Object.fromEntries(PURPOSES.map((k) => [k, PURPOSE_PIECES[k].key])),
    focuses: FOCUSES,
    examples: examples.map((request) => {
      const r = composeTask(request);
      return { request, text: r.ok ? r.composition.text['pt-BR'] : '' };
    }),
  };
}

// ---- the options of the app's editor (what a driver can pick, in the app language) -------------------

export interface TaskOption {
  id: string;
  label: string;
}

export interface TaskEditorOptions {
  /** Verbs that need a comparative (brake, throttle...); `comparators` lists what each accepts. */
  stems: (TaskOption & { comparators: TaskOption[] })[];
  gear: TaskOption[];
  /** Ready phrases by group. */
  closed: { group: TaskGroup; items: TaskOption[] }[];
  amounts: TaskOption[];
  purposes: TaskOption[];
  focuses: TaskOption[];
}

const textIn = (piece: TaskPiece, language: Language) =>
  language === 'pt-BR' ? piece.key : language === 'en' ? piece.en : piece.es;

/** The pieces a driver can combine in the editor, in a language. */
export function taskEditorOptions(language: Language): TaskEditorOptions {
  const opt = (id: string, piece: TaskPiece): TaskOption => ({
    id,
    // the sentence closes with a full stop; a menu entry does not
    label: textIn(piece, language).replace(/\.$/, ''),
  });
  const groups: TaskGroup[] = [];
  for (const d of CLOSED) if (!groups.includes(d.group)) groups.push(d.group);
  return {
    stems: STEMS.map((s) => ({
      ...opt(s, STEM_PIECES[s]),
      comparators: STEM_COMPARATORS[s].map((k) => opt(k, COMPARATOR_PIECES[k])),
    })),
    gear: GEAR_ACTIONS.map((g) => opt(g, GEAR_PIECES[g])),
    closed: groups.map((group) => ({
      group,
      items: CLOSED.filter((d) => d.group === group).map((d) => opt(d.id, d.piece)),
    })),
    amounts: Object.entries(AMOUNT_PIECES).map(([k, v]) => opt(k, v)),
    purposes: PURPOSES.map((k) => opt(k, PURPOSE_PIECES[k])),
    focuses: FOCUSES.filter((f): f is Exclude<TaskFocus, 'none'> => f !== 'none').map((f) =>
      opt(f, FOCUS_PIECES[f]),
    ),
  };
}
