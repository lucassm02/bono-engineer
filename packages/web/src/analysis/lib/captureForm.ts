/**
 * Pure helpers of the reference-capture page (#/capture, Onda 10a): ranking-time parsing with
 * friendly messages, car names from the catalogue, the car <select> data, driver suggestions,
 * the live "what the app detected" header, progress/guidance of an armed capture, the list of
 * captured references grouped by track. No DOM, no React: everything is unit-tested.
 */

import {
  type CaptureWaiting,
  type CarEntry,
  type ConnectionState,
  carsOfMaker,
  DEFAULT_REPLAY_DRIVER,
  getCar,
  type Id,
  type Lap,
  listMakers,
  makerOfCar,
  type ReferenceCaptureStatus,
  type ReferenceMeta,
  type Track,
} from '@gt7/shared';
import { clockText } from '../../lib/captureStatus.ts';
import { formatLapTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { parseLapTime } from './lapTime.ts';

// ---------------------------------------------------------------------------------------------
// Ranking time
// ---------------------------------------------------------------------------------------------

/** The server accepts up to 1 h; a real lap is never shorter than this. */
export const MIN_RANKING_MS = 10_000;
export const MAX_RANKING_MS = 3_600_000;
/** Tolerance between the ranking time and the one measured from the packets (ms). */
export const RANKING_TOLERANCE_MS = 300;

export type RankingTimeInput =
  | { kind: 'empty' }
  | { kind: 'ok'; ms: number; shown: string }
  | { kind: 'invalid'; message: string };

/**
 * Turns whatever the user typed or pasted into the canonical `m:ss.mmm` text the parser reads:
 * accepts comma decimals, the game's own notation (1'30.960 or 1'30"960), stray spaces and
 * non-breaking spaces.
 */
export function normalizeRankingText(raw: string): string {
  return raw
    .replace(/[\s  ]+/g, '')
    .replace(/[′’‘']/g, ':')
    .replace(/[″”“"](?=\d)/g, '.')
    .replace(/[″”“"]/g, '')
    .replace(',', '.');
}

/**
 * Reads the "Tempo do ranking" field. Accepts "1:30.960", "1:30,960", "90.960", "1'30.960" and
 * pasted text with spaces; "1:30" is 1 min 30 s. Anything shorter than 10 s is refused (almost
 * surely a typo).
 */
export function parseRankingTime(raw: string): RankingTimeInput {
  if (raw.trim() === '') return { kind: 'empty' };
  const ms = parseLapTime(normalizeRankingText(raw));
  if (ms === null) {
    return {
      kind: 'invalid',
      message: uiText(
        'Não entendi esse tempo. Use minutos:segundos.milésimos, por exemplo 1:30.960.',
      ),
    };
  }
  if (ms < MIN_RANKING_MS) {
    return {
      kind: 'invalid',
      message: uiText('Tempo curto demais para uma volta. Confira os minutos (ex.: 1:30.960).'),
    };
  }
  if (ms > MAX_RANKING_MS) {
    return { kind: 'invalid', message: uiText('Tempo longo demais para uma volta.') };
  }
  return { kind: 'ok', ms, shown: formatLapTime(ms) };
}

// ---------------------------------------------------------------------------------------------
// Cars
// ---------------------------------------------------------------------------------------------

const MAX_CAR_NAME = 80;

/**
 * "Marca Modelo" from the catalogue ("Lamborghini Huracan Gr.4"), null when the car is not in
 * it. Catalogue names carry no maker, so the maker is prefixed (unless already there).
 */
export function resolvedCarName(carCode: number | null | undefined): string | null {
  const car = getCar(carCode);
  if (!car) return null;
  const maker = makerOfCar(carCode);
  const name =
    maker && !car.name.toLowerCase().startsWith(maker.name.toLowerCase())
      ? `${maker.name} ${car.name}`
      : car.name;
  return name.slice(0, MAX_CAR_NAME);
}

/** Name shown for a car code: catalogue name or "Carro #1234". */
export function carDisplayName(carCode: number | null | undefined): string {
  if (carCode === null || carCode === undefined) return '—';
  return resolvedCarName(carCode) ?? uiText('Carro #{0}', carCode);
}

export interface CarOptionGroup {
  makerId: number;
  makerName: string;
  cars: { id: number; label: string }[];
}

let optionGroupsCache: CarOptionGroup[] | null = null;

/** Every car of the catalogue grouped by maker (A–Z), for the native `<select>`. */
export function carOptionGroups(): readonly CarOptionGroup[] {
  if (!optionGroupsCache) {
    optionGroupsCache = listMakers()
      .map((m) => ({
        makerId: m.id,
        makerName: m.name,
        cars: carsOfMaker(m.id).map((c: CarEntry) => ({ id: c.id, label: c.name })),
      }))
      .filter((g) => g.cars.length > 0);
  }
  return optionGroupsCache;
}

/** What the car `<select>` holds: the car detected in the replay, nothing, or a chosen one. */
export type CarChoice = 'auto' | 'none' | number;

export function carChoiceValue(choice: CarChoice): string {
  return typeof choice === 'number' ? String(choice) : choice;
}

export function parseCarChoice(value: string): CarChoice {
  if (value === 'auto' || value === 'none') return value;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 'auto';
}

/**
 * Car fields of `POST /api/capture/start`: the resolved name (`carName`) always, the expected
 * code (`expectedCarCode`, which makes the server refuse another car) only when the user
 * chose the car by hand.
 */
export function carRequestFields(
  choice: CarChoice,
  detectedCarCode: number | null,
): { carName?: string; expectedCarCode?: number } {
  if (choice === 'none') return {};
  if (choice === 'auto') {
    const name = resolvedCarName(detectedCarCode);
    return name ? { carName: name } : {};
  }
  return { carName: carDisplayName(choice).slice(0, MAX_CAR_NAME), expectedCarCode: choice };
}

// ---------------------------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------------------------

/**
 * Driver names already used in saved references (most recent first, one per name ignoring
 * case), for the `<datalist>`. The generic default is not suggested.
 */
export function driverSuggestions(
  refs: readonly Pick<Lap, 'referenceMeta'>[],
  limit = 30,
): string[] {
  const rows = refs
    .map((l) => l.referenceMeta)
    .filter((m): m is ReferenceMeta => !!m)
    .sort((a, b) => b.capturedAt - a.capturedAt);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of rows) {
    const name = m.driverName.trim();
    const key = name.toLocaleLowerCase('pt-BR');
    if (!name || key === DEFAULT_REPLAY_DRIVER.toLocaleLowerCase('pt-BR') || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Live detection header
// ---------------------------------------------------------------------------------------------

export interface DetectionInput {
  /** The WebSocket is open or the REST status answered. */
  online: boolean;
  /** `ServerStatus.connection` (console state). */
  connection: ConnectionState | null;
  /** State of the latest fresh live frame, null when stale/none. */
  liveState: ConnectionState | null;
  /** Car of the latest fresh live frame (0/unknown → null). */
  carCode: number | null;
  capture: ReferenceCaptureStatus | null;
}

export type DetectionKind = 'offline' | 'idle' | 'replay' | 'replayUnknownTrack';

export interface DetectionView {
  kind: DetectionKind;
  tone: 'idle' | 'ok' | 'warn';
  /** First line ("Replay detectado" / "Abra o replay no jogo — eu detecto sozinho"). */
  title: string;
  trackName: string | null;
  carCode: number | null;
  /** "Marca Modelo" or null. */
  carName: string | null;
  /** Short explanation under the title. */
  message: string;
}

export function detectionView(i: DetectionInput): DetectionView {
  const replay =
    !!i.capture?.replayDetected || i.connection === 'replay' || i.liveState === 'replay';
  const base = { trackName: null, carCode: null, carName: null };
  if (!i.online && !i.capture) {
    return {
      ...base,
      kind: 'offline',
      tone: 'warn',
      title: uiText('Sem conexão com o app'),
      message: uiText('A captura precisa do app rodando no PC. Confira se ele está aberto.'),
    };
  }
  if (!replay) {
    return {
      ...base,
      kind: 'idle',
      tone: 'idle',
      title: uiText('Abra o replay no jogo — eu detecto sozinho'),
      message: uiText(
        'No jogo: Time Trial › Ranking › escolha o piloto › Replay. Dê play: esta faixa muda quando o replay começar.',
      ),
    };
  }
  const carCode = i.carCode;
  const carName = resolvedCarName(carCode) ?? (carCode ? uiText('Carro #{0}', carCode) : null);
  const trackName = i.capture?.trackName ?? null;
  const known = { carCode, carName, trackName };
  if (i.capture?.waiting === 'unknownTrack') {
    return {
      ...known,
      kind: 'replayUnknownTrack',
      tone: 'warn',
      title: uiText('Replay detectado'),
      message: uiText(
        'Não conheço esta pista ainda. Dirija essa pista ao vivo primeiro (uma volta completa) e depois capture o replay.',
      ),
    };
  }
  if (trackName) {
    return {
      ...known,
      kind: 'replay',
      tone: 'ok',
      title: uiText('Replay detectado'),
      message: uiText('Tudo certo: é só tocar em “Capturar esta volta”.'),
    };
  }
  const armed = !!i.capture && i.capture.state !== 'idle';
  return {
    ...known,
    kind: 'replay',
    tone: 'ok',
    title: uiText('Replay detectado'),
    message: armed
      ? uiText('Identificando a pista pela posição do carro…')
      : uiText('A pista é identificada assim que você tocar em “Capturar esta volta”.'),
  };
}

// ---------------------------------------------------------------------------------------------
// Progress of an armed capture
// ---------------------------------------------------------------------------------------------

export const PROGRESS_STEPS = ['Replay', 'Linha de largada', 'Gravando', 'Validando'] as const;

export interface ProgressView {
  /** 0–3 (index in {@link PROGRESS_STEPS}). */
  step: number;
  steps: { label: string; state: 'done' | 'now' | 'todo' }[];
  /** Fill of the "Gravando" segment, 0–1. */
  recordingFraction: number;
  /** Big clock: "0:45" while recording, empty otherwise. */
  clock: string;
  /** "de 2:05" estimate, empty until the lap is far enough to extrapolate. */
  estimate: string;
  /** What to do now (pt-BR, imperative and short). */
  headline: string;
  text: string;
  tone: 'wait' | 'rec' | 'warn';
}

const WAITING_TEXT: Record<CaptureWaiting, { headline: string; text: string }> = {
  replay: {
    get headline() {
      return uiText('Abra o replay no jogo');
    },
    get text() {
      return uiText('Abra o replay da volta (Time Trial › Ranking › Replay) e dê play.');
    },
  },
  track: {
    get headline() {
      return uiText('Identificando a pista');
    },
    get text() {
      return uiText(
        'Replay detectado. Deixe tocar: estou reconhecendo a pista pela posição do carro.',
      );
    },
  },
  unknownTrack: {
    get headline() {
      return uiText('Pista desconhecida');
    },
    get text() {
      return uiText(
        'Dirija essa pista ao vivo primeiro (uma volta completa) e depois capture o replay.',
      );
    },
  },
  startLine: {
    get headline() {
      return uiText('Deixe o replay tocar');
    },
    get text() {
      return uiText(
        'Aguardando o carro cruzar a linha de largada. Não pause, não volte e não avance.',
      );
    },
  },
};

/** The step index of a status (same mapping the page always used). */
export function stepOf(s: ReferenceCaptureStatus): number {
  switch (s.state) {
    case 'recording':
      return 2;
    case 'validating':
      return 3;
    case 'waitingLapStart':
      return s.waiting === 'startLine' ? 1 : 0;
    default:
      return 0;
  }
}

export function progressView(s: ReferenceCaptureStatus): ProgressView {
  const step = stepOf(s);
  const steps = PROGRESS_STEPS.map((label, i) => ({
    label,
    state: (i < step ? 'done' : i === step ? 'now' : 'todo') as 'done' | 'now' | 'todo',
  }));
  const recording = s.state === 'recording';
  const frac = recording && s.lapFraction != null ? Math.min(1, Math.max(0, s.lapFraction)) : 0;
  const rec = recording && s.recordingMs != null ? s.recordingMs : null;
  let guidance: { headline: string; text: string };
  let tone: ProgressView['tone'] = 'wait';
  if (s.state === 'recording') {
    guidance = {
      headline: uiText('Gravando a volta'),
      text: uiText('Deixe o replay tocar até o fim da volta. Não pause, não volte e não avance.'),
    };
    tone = 'rec';
  } else if (s.state === 'validating') {
    guidance = {
      headline: uiText('Conferindo a volta'),
      text: uiText('Validando distância, pacotes e tempo…'),
    };
  } else if (s.state === 'switchingFormat') {
    guidance = { headline: uiText('Preparando'), text: uiText('Preparando a captura…') };
  } else {
    guidance = WAITING_TEXT[s.waiting ?? 'replay'];
    if (s.waiting === 'unknownTrack') tone = 'warn';
  }
  return {
    step,
    steps,
    recordingFraction: frac,
    clock: rec != null ? clockText(rec) : '',
    estimate: rec != null && frac >= 0.04 ? `de ${clockText(Math.round(rec / frac))}` : '',
    ...guidance,
    tone,
  };
}

/**
 * Validation problems worth showing now. The status keeps the issues of the last rejected lap
 * while the NEXT lap is already being recorded, which looked like the current lap was broken:
 * they are only shown while waiting (right after a rejection) or once the capture is over.
 */
export function visibleIssues(s: ReferenceCaptureStatus): string[] {
  return s.state === 'recording' || s.state === 'validating' ? [] : s.issues;
}

/** A rejection is identified by its codes + measured time (changes when a new lap is rejected). */
export function discardKey(s: ReferenceCaptureStatus): string | null {
  return s.issues.length ? `${s.issues.join(',')}|${s.measuredLapMs ?? ''}` : null;
}

export function signedMs(ms: number): string {
  return `${ms > 0 ? '+' : ms < 0 ? '−' : ''}${Math.abs(ms)} ms`;
}

// ---------------------------------------------------------------------------------------------
// Captured references list
// ---------------------------------------------------------------------------------------------

export interface ReferenceGroup {
  trackId: Id;
  trackName: string;
  layout: string | null;
  laps: Lap[];
  /** Ids of the laps the live delta uses: the fastest of each car on this track. */
  deltaIds: ReadonlySet<Id>;
}

/** Where a reference's time comes from, in plain pt-BR. */
export function timeOriginLabel(meta: ReferenceMeta | null | undefined): string {
  if (!meta) return '—';
  if (meta.timeSource === 'ranking') return 'tempo do ranking';
  if (meta.timeSource === 'packets') return 'estimado pela telemetria';
  if (meta.source === 'replayCapture') return meta.rankingTimeMs ? 'tempo do ranking' : 'replay';
  return meta.source === 'import' ? 'importada' : uiText('volta própria');
}

/** References grouped by track (most recently captured track first), fastest lap first. */
export function groupReferences(
  laps: readonly Lap[],
  tracks: readonly Pick<Track, 'id' | 'name' | 'layout'>[],
): ReferenceGroup[] {
  const byTrack = new Map<Id, Lap[]>();
  for (const l of laps) {
    if (!l.isReference) continue;
    const key = l.trackId ?? '';
    const list = byTrack.get(key);
    if (list) list.push(l);
    else byTrack.set(key, [l]);
  }
  const lastAt = (ls: Lap[]) => Math.max(...ls.map((l) => l.referenceMeta?.capturedAt ?? 0));
  return [...byTrack.entries()]
    .map(([trackId, ls]) => {
      const sorted = [...ls].sort((a, b) => a.timeMs - b.timeMs);
      const t = tracks.find((x) => x.id === trackId);
      const fastestOfCar = new Set<number>();
      const deltaIds = new Set<Id>();
      for (const l of sorted) {
        if (fastestOfCar.has(l.carCode)) continue;
        fastestOfCar.add(l.carCode);
        deltaIds.add(l.id);
      }
      return {
        trackId,
        trackName: t?.name ?? uiText('Pista não identificada'),
        layout: t?.layout ?? null,
        laps: sorted,
        deltaIds,
        at: lastAt(sorted),
      };
    })
    .sort((a, b) => b.at - a.at || a.trackName.localeCompare(b.trackName, 'pt-BR'))
    .map(({ at: _at, ...g }) => g);
}
