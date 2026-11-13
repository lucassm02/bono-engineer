/**
 * What the app knows about "the track you are on" while you drive (specs 05 and 06): shown by the
 * context bar of the live panel, by the "Pista de hoje" sheet and by the learning guide.
 *
 * The packet carries no track id. The core builds this from what it has at each moment: a track
 * chosen by the driver (`hint`), the start line against saved tracks (`start`) or against the
 * shipped catalogue (`catalog`), and finally the geometry of a closed lap (`lap`). Pure types and
 * helpers (isomorphic), so the text rules can be tested without a browser.
 */

import type { Id, Session, Track } from './domain.ts';

/** How sure the core is about the track (same values as `LiveTrackInfo.confidence`). */
export type TrackConfidence = 'unknown' | 'probable' | 'confirmed';

/** What the confidence rests on. */
export type TrackBasis =
  /** Nothing is known yet. */
  | 'none'
  /** The driver chose it ("Pista de hoje"). */
  | 'hint'
  /** The start line matches a track saved before. */
  | 'start'
  /** The start line matches a layout of the shipped catalogue (never persisted). */
  | 'catalog'
  /** The car that runs in the background of the pre-race screen drew a known path (never persisted). */
  | 'path'
  /** A closed lap's geometry matched (or created) the track. */
  | 'lap';

/** Where the identification of the current track came from, by the track record. */
export type TrackSourceKind = Track['source'];

/** The driver's choice of track for this session (in memory only; spec 06). */
export interface TrackHint {
  trackId: Id;
  /** Epoch ms when it was chosen. */
  setAt: number;
  source: 'user';
  /** Epoch ms when it expires if the console stays silent (informative). */
  expiresAt: number;
}

/** Hint expires after this long without a signal from the console (ms). */
export const TRACK_HINT_TTL_MS = 30 * 60_000;

/** Learning-guide steps of a new track (spec 05 item 3). */
export type LearningStage = 1 | 2 | 3;

/** Why the last recognition lap was thrown away. */
export type LearningInvalidReason = 'restart' | 'discontinuity' | 'leftTrack';

export interface LiveLearning {
  /** 1 out lap · 2 recognition lap · 3 learned (curves are being analysed or ready). */
  stage: LearningStage;
  /** The last recognition lap did not count (shown until a lap does). */
  invalid: LearningInvalidReason | null;
}

/** Corner detection of the active track. */
export type CornersState = 'pending' | 'ready';

export interface LiveTrackContext {
  trackId: Id | null;
  /** Name to show (venue, or the saved name); null while nothing is known. */
  name: string | null;
  /** Layout label ("Reverse", "Full Course"…), when known. */
  layout: string | null;
  confidence: TrackConfidence;
  basis: TrackBasis;
  /** `source` of the saved track ('auto' = still unnamed by the driver); null without a track. */
  trackSource: TrackSourceKind | null;
  /** The track is saved with an automatic name: "Pista nova · Dar nome". */
  needsName: boolean;
  /** Null while there is no saved track. */
  corners: CornersState | null;
  /** Guide of the recognition lap; null when the track is already known. */
  learning: LiveLearning | null;
  /** The driver's choice, if one is in force. */
  hint: TrackHint | null;
}

export const EMPTY_TRACK_CONTEXT: LiveTrackContext = {
  trackId: null,
  name: null,
  layout: null,
  confidence: 'unknown',
  basis: 'none',
  trackSource: null,
  needsName: false,
  corners: null,
  learning: null,
  hint: null,
};

/** The engine found the hinted track does not match the lap just driven (spec 06). */
export interface TrackMismatchInfo {
  sessionId: Id;
  /** Track the driver chose. */
  hintedTrackId: Id;
  hintedTrackName: string;
  /** Track the lap geometry says it is. */
  detectedTrackId: Id;
  detectedTrackName: string;
  lapNumber: number;
  /** Laps of the session that moved to the detected track. */
  lapsMoved: number;
  /** Epoch ms. */
  at: number;
}

/** What `GET /api/session/current` returns: the open session and what is known of its track. */
export interface ApiSessionCurrent {
  /** The open session, null while none is open (menu, game closed). */
  session: Session | null;
  track: LiveTrackContext;
  /** Car code of the open session (or of the last packet), null if unknown. */
  carCode: number | null;
}

/** PUT /api/session/track-hint body. */
export interface ApiTrackHintRequest {
  /** Saved track chosen for today; null = "Reconhecer sozinho". */
  trackId: Id | null;
  /** Keep the chosen track even if the lap geometry disagrees (answer to a mismatch notice). */
  force?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Engineer status (spec 05 item 2): a truthful text for every mode
// ---------------------------------------------------------------------------------------------

export type EngineerStatusKey =
  | 'off'
  | 'noSignal'
  | 'learning'
  | 'recognizing'
  | 'waitingReference'
  | 'incompatible'
  | 'noCues'
  | 'waitingLap'
  | 'ready';

export type EngineerStatusTone = 'ok' | 'wait' | 'warn' | 'off';

export type EngineerStatusAction =
  | 'recordReplay'
  | 'pickReference'
  | 'toggleEngineer'
  | 'nameTrack';

export interface EngineerStatusView {
  key: EngineerStatusKey;
  tone: EngineerStatusTone;
  /** Short word for the context bar ("Engenheiro: pronto"). */
  short: string;
  /** Full sentence for the radio card (pt-BR; the web translates through `t()`). */
  text: string;
  /** Extra explanation line (for `incompatible`), when there is one. */
  detail: string | null;
  action: EngineerStatusAction | null;
}

export interface EngineerStatusInput {
  /** The driver turned the engineer on. */
  enabled: boolean;
  /** No fresh frame (stale / hidden page / offline). */
  noSignal: boolean;
  /** `LiveFrame.engineer?.status`, undefined while no frame has it. */
  status:
    | 'waitingTrack'
    | 'waitingReference'
    | 'incompatible'
    | 'noCues'
    | 'suspended'
    | 'ready'
    | undefined;
  /** `LiveFrame.trackContext`, undefined for old servers. */
  context: Pick<LiveTrackContext, 'basis' | 'confidence' | 'trackId'> | undefined | null;
}

/**
 * Table of spec 05 item 2, valid in any radio mode. "Rádio pronto" is gone: `ready` is the only
 * status that says the engineer is ready.
 */
export function engineerStatusView(i: EngineerStatusInput): EngineerStatusView {
  if (!i.enabled) {
    return {
      key: 'off',
      tone: 'off',
      short: 'desligado',
      text: 'Engenheiro desligado',
      detail: null,
      action: 'toggleEngineer',
    };
  }
  if (i.noSignal) {
    return {
      key: 'noSignal',
      tone: 'wait',
      short: 'sem sinal',
      text: 'Aguardando telemetria',
      detail: null,
      action: null,
    };
  }
  switch (i.status) {
    case 'waitingTrack': {
      const basis = i.context?.basis ?? 'none';
      // a track saved before (start line, or chosen by the driver) is only waiting to be confirmed
      const saved = basis === 'start' || basis === 'hint';
      return saved
        ? {
            key: 'recognizing',
            tone: 'wait',
            short: 'reconhecendo a pista',
            text: 'Reconhecendo a pista… vou confirmar quando você cruzar a linha',
            detail: null,
            action: null,
          }
        : {
            key: 'learning',
            tone: 'wait',
            short: 'aprendendo a pista',
            text: 'Dê uma volta completa para eu aprender o traçado',
            detail: null,
            action: null,
          };
    }
    case 'waitingReference':
      return {
        key: 'waitingReference',
        tone: 'warn',
        short: 'aguardando referência',
        text: 'Preciso de uma volta de referência. Complete uma volta limpa ou grave um replay',
        detail: null,
        action: 'recordReplay',
      };
    case 'incompatible':
      return {
        key: 'incompatible',
        tone: 'warn',
        short: 'referência incompatível',
        text: 'A referência é de outro carro ou traçado',
        detail: 'Use uma volta do mesmo carro e do mesmo traçado.',
        action: 'pickReference',
      };
    case 'noCues':
      return {
        key: 'noCues',
        tone: 'warn',
        short: 'sem pontos de orientação',
        text: 'A referência não tem pontos de orientação confiáveis',
        detail: null,
        action: null,
      };
    case 'ready':
      return {
        key: 'ready',
        tone: 'ok',
        short: 'pronto',
        text: 'Engenheiro pronto',
        detail: null,
        action: null,
      };
    default:
      // `suspended` (between laps, slow, out of the track) or no engineer data yet
      return {
        key: 'waitingLap',
        tone: 'wait',
        short: 'aguardando volta',
        text: 'Aguardando volta em pista',
        detail: null,
        action: null,
      };
  }
}

// ---------------------------------------------------------------------------------------------
// Learning guide (spec 05 item 3)
// ---------------------------------------------------------------------------------------------

export interface LearningGuideText {
  stage: LearningStage;
  /** The three steps, with the current one flagged. */
  steps: { n: 1 | 2 | 3; label: string; state: 'done' | 'current' | 'todo' }[];
  /** Instruction of the current step. */
  message: string;
  /** Shown when the last recognition lap did not count. */
  invalidMessage: string | null;
  /** Step 3 only: curves finished? */
  curves: CornersState | null;
}

const INVALID_TEXT: Record<LearningInvalidReason, string> = {
  restart: 'Essa volta não serviu (você reiniciou). Faça mais uma.',
  discontinuity: 'Essa volta não serviu (houve um salto ou uma pausa longa). Faça mais uma.',
  leftTrack: 'Essa volta não serviu (você saiu da pista). Faça mais uma.',
};

/** Texts of the guide for the three stages; null when there is nothing to guide. */
export function learningGuideText(
  learning: LiveLearning | null | undefined,
  corners: CornersState | null,
): LearningGuideText | null {
  if (!learning) return null;
  const { stage } = learning;
  const label = [
    'Volta de saída (não conta)',
    'Volta de reconhecimento',
    'Pronto: a próxima volta já tem engenheiro',
  ] as const;
  const message =
    stage === 1
      ? 'Faça uma volta de saída.'
      : stage === 2
        ? 'Dê a volta completa, sem sair da pista nem reiniciar. É assim que eu aprendo o traçado.'
        : corners === 'ready'
          ? 'Aprendi a pista. Curvas prontas: a próxima volta já tem engenheiro.'
          : 'Aprendi a pista. Analisando as curvas…';
  return {
    stage,
    steps: label.map((l, k) => ({
      n: (k + 1) as 1 | 2 | 3,
      label: l,
      state: k + 1 < stage ? 'done' : k + 1 === stage ? 'current' : 'todo',
    })),
    message,
    invalidMessage: learning.invalid ? INVALID_TEXT[learning.invalid] : null,
    curves: stage === 3 ? corners : null,
  };
}

/** Line of the lap pop-up after the recognition lap (spec 05 item 3, step 3). */
export function learnedPopupText(corners: CornersState | null): string {
  return corners === 'ready'
    ? 'Aprendi a pista ✓ Curvas prontas. A partir da próxima volta eu te ajudo.'
    : 'Aprendi a pista ✓ Analisando as curvas…';
}
