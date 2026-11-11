/**
 * Track context of the live panel (specs 05 and 06), as pure functions: what the context bar
 * says, when it is safe to ask the driver something, which saved tracks the "Pista de hoje" sheet
 * offers and what reference each one would use. No React and no store here, so every rule is
 * easy to test.
 */

import {
  type ConnectionState,
  type ConsoleConnection,
  describeCar,
  type LiveTrackContext,
  type TrackMismatchInfo,
} from '@gt7/shared';
import type { TrackOverview } from '../analysis/lib/history.ts';
import { fullTrackName, normalizeText } from '../analysis/lib/history.ts';
import { formatLapTime } from './format.ts';
import { t as uiText } from './i18n.ts';

// ---------------------------------------------------------------------------------------------
// Safe to prompt
// ---------------------------------------------------------------------------------------------

/** Below this speed the car counts as stopped (km/h). */
export const SAFE_SPEED_KMH = 10;

/**
 * May the app ask the driver something (open the "Pista de hoje" sheet, show a notice with
 * buttons)? Only with the car stopped, the game paused or in a menu: never while driving. With no
 * frame at all nothing is moving.
 */
export function isSafeToPrompt(input: {
  state: ConnectionState | null;
  speedKmh: number | null;
}): boolean {
  if (input.state === 'onTrack') return (input.speedKmh ?? 0) < SAFE_SPEED_KMH;
  return true;
}

/** The demo (in-browser mock, or the server's fake console) shows none of the track prompts. */
export function isDemoSource(
  source: 'server' | 'mock',
  link: Pick<ConsoleConnection, 'source'> | null | undefined,
): boolean {
  return source === 'mock' || link?.source === 'simulator';
}

/** The tour, or a test, may ask for the prompts in the demo: `?trackprompt=demo`. */
export function demoPromptsAllowed(search: string): boolean {
  return new URLSearchParams(search).get('trackprompt') === 'demo';
}

// ---------------------------------------------------------------------------------------------
// Which prompts may show (spec 06)
// ---------------------------------------------------------------------------------------------

export interface PromptGate {
  demo: boolean;
  demoAllowed: boolean;
  replay: boolean;
  /** The driver's own switch ("Perguntar a pista ao começar"). */
  askOnStart: boolean;
  savedTracks: number;
  /** "Reconhecer sozinho" was chosen for this session. */
  skipped: boolean;
  hasHint: boolean;
}

/** Nothing is asked in the demo, in a replay, without saved tracks or when the driver opted out. */
export function trackPromptAllowed(g: PromptGate): boolean {
  if (g.demo && !g.demoAllowed) return false;
  if (g.replay) return false;
  return g.askOnStart && g.savedTracks > 0 && !g.skipped;
}

/** The "Qual pista hoje?" card in the menu screen: also hidden once a track was chosen. */
export function menuCardVisible(g: PromptGate): boolean {
  return trackPromptAllowed(g) && !g.hasHint;
}

/** How long the "Pista de hoje? Toque para escolher" chip stays after a session opens (ms). */
export const OPEN_CHIP_MS = 8000;

/** The opening chip: a session just opened with no track known, the car is stopped. */
export function openChipWanted(input: {
  gate: PromptGate;
  trackKnown: boolean;
  safe: boolean;
}): boolean {
  return trackPromptAllowed(input.gate) && !input.gate.hasHint && !input.trackKnown && input.safe;
}

// ---------------------------------------------------------------------------------------------
// Context bar
// ---------------------------------------------------------------------------------------------

export type BarTrackKind = 'confirmed' | 'probable' | 'recognizing' | 'new' | 'choose' | 'idle';

export interface BarTrackView {
  kind: BarTrackKind;
  /** Track name (or the state in words). */
  label: string;
  /** Muted extra after the name (layout, "escolhida"…). */
  note: string | null;
  tone: 'accent' | 'warn' | null;
  /** The dot pulses: the app is still working it out. */
  pulse: boolean;
  /** What a tap does. */
  action: 'picker' | 'naming' | null;
  /** Tooltip / screen reader sentence. */
  title: string;
}

/** Name and layout as one line ("Trial Mountain Circuit · Reverse"). */
export function trackLine(name: string | null, layout: string | null): string {
  if (!name) return '';
  return layout ? `${name} · ${layout}` : name;
}

/**
 * The track part of the context bar. `sessionOpen`: a session is recording, so "no track yet" means
 * "still working it out" rather than "nothing chosen". `hasSavedTracks`: the driver could choose.
 */
export function barTrackView(input: {
  ctx: LiveTrackContext | null | undefined;
  sessionOpen: boolean;
  hasSavedTracks: boolean;
}): BarTrackView {
  const { ctx } = input;
  const known = !!ctx?.name;
  if (!ctx || !known) {
    if (input.sessionOpen) {
      return {
        kind: 'recognizing',
        label: uiText('Reconhecendo a pista…'),
        note: null,
        tone: null,
        pulse: true,
        action: input.hasSavedTracks ? 'picker' : null,
        title: uiText('Ainda não sei em que pista você está. Confirmo quando você fechar a volta.'),
      };
    }
    return {
      kind: input.hasSavedTracks ? 'choose' : 'idle',
      label: input.hasSavedTracks ? uiText('Escolher pista') : uiText('Pista não reconhecida'),
      note: null,
      tone: null,
      pulse: false,
      action: input.hasSavedTracks ? 'picker' : null,
      title: input.hasSavedTracks
        ? uiText('Diga em que pista você vai treinar para o engenheiro começar na primeira volta.')
        : uiText('Eu reconheço a pista sozinho quando você fechar a primeira volta.'),
    };
  }
  const line = trackLine(ctx.name, ctx.layout);
  if (ctx.basis === 'catalog') {
    return {
      kind: 'probable',
      label: uiText('Provavelmente {0}', line),
      note: null,
      tone: null,
      pulse: true,
      action: input.hasSavedTracks ? 'picker' : null,
      title: uiText('Provavelmente {0}. Confirmo quando você fechar a volta.', line),
    };
  }
  if (ctx.trackId && ctx.confidence === 'confirmed' && ctx.needsName) {
    return {
      kind: 'new',
      label: uiText('Pista nova'),
      note: uiText('Dar nome'),
      tone: 'warn',
      pulse: false,
      action: 'naming',
      title: uiText('Aprendi o traçado desta pista. Toque para dar o nome.'),
    };
  }
  if (ctx.confidence === 'confirmed') {
    return {
      kind: 'confirmed',
      label: ctx.name ?? '',
      note: ctx.layout,
      tone: 'accent',
      pulse: false,
      action: 'picker',
      title: uiText('Pista confirmada: {0}', line),
    };
  }
  return {
    kind: 'probable',
    label: ctx.name ?? '',
    note: ctx.basis === 'hint' ? uiText('escolhida') : ctx.layout,
    tone: null,
    pulse: true,
    action: 'picker',
    title:
      ctx.basis === 'hint'
        ? uiText('Pista que você escolheu: {0}. Confirmo quando você fechar a volta.', line)
        : uiText('{0}. Confirmo quando você fechar a volta.', line),
  };
}

/** Car as text: the catalogue name, or "Carro #1234" for cars outside it. */
export function carText(carCode: number | null | undefined): string | null {
  if (!carCode) return null;
  return describeCar(carCode).carName ?? uiText('Carro #{0}', carCode);
}

// ---------------------------------------------------------------------------------------------
// "Pista de hoje" sheet
// ---------------------------------------------------------------------------------------------

export interface ReferenceNote {
  kind: 'personal' | 'reference' | 'none';
  timeMs: number | null;
  carName: string | null;
  text: string;
}

/** What the engineer would use as the reference on this track with this car. */
export function referenceNote(track: TrackOverview, carCode: number | null): ReferenceNote {
  const forCar = carCode ? track.cars.find((c) => c.carCode === carCode && c.bestMs) : undefined;
  const own = forCar
    ? { timeMs: forCar.bestMs!, carName: forCar.carName ?? carText(forCar.carCode) }
    : !carCode && track.best
      ? { timeMs: track.best.timeMs, carName: track.best.carName ?? carText(track.best.carCode) }
      : null;
  if (own) {
    return {
      kind: 'personal',
      timeMs: own.timeMs,
      carName: own.carName,
      text: uiText('Melhor pessoal {0} · {1}', formatLapTime(own.timeMs), own.carName ?? ''),
    };
  }
  if (track.bestReferenceMs) {
    return {
      kind: 'reference',
      timeMs: track.bestReferenceMs,
      carName: null,
      text: uiText('Volta de referência {0}', formatLapTime(track.bestReferenceMs)),
    };
  }
  return {
    kind: 'none',
    timeMs: null,
    carName: null,
    text: uiText('O engenheiro vai orientar só pelo traçado'),
  };
}

export interface PickerEntry {
  track: TrackOverview;
  /** The driver has laps with this car here: listed first. */
  carMatch: boolean;
  reference: ReferenceNote;
}

/**
 * Saved tracks for the sheet: recent use first, tracks with laps of the current car before the
 * others, filtered by what was typed (accents and case ignored).
 */
export function pickerEntries(
  tracks: readonly TrackOverview[],
  carCode: number | null,
  query = '',
): PickerEntry[] {
  const words = normalizeText(query).split(' ').filter(Boolean);
  const matches = (t: TrackOverview) => {
    if (words.length === 0) return true;
    const text = normalizeText(fullTrackName(t));
    return words.every((w) => text.includes(w));
  };
  const hasCar = (t: TrackOverview) => !!carCode && t.cars.some((c) => c.carCode === carCode);
  return tracks
    .filter(matches)
    .map((track) => ({ track, carMatch: hasCar(track), reference: referenceNote(track, carCode) }))
    .sort(
      (a, b) =>
        Number(b.carMatch) - Number(a.carMatch) ||
        (b.track.lastActivityAt ?? b.track.createdAt) -
          (a.track.lastActivityAt ?? a.track.createdAt),
    );
}

/** The few tracks of the menu card: most recent use, tracks of the current car first. */
export function recentEntries(
  tracks: readonly TrackOverview[],
  carCode: number | null,
  max = 4,
): PickerEntry[] {
  return pickerEntries(tracks, carCode).slice(0, max);
}

// ---------------------------------------------------------------------------------------------
// Mismatch notice
// ---------------------------------------------------------------------------------------------

/** "Isso não parece X. Troquei para Y." (spec 06 item 3). */
export function mismatchText(m: TrackMismatchInfo, detectedIsNew: boolean): string {
  return detectedIsNew
    ? uiText('Isso não parece {0}. Salvei como uma pista nova.', m.hintedTrackName)
    : uiText('Isso não parece {0}. Troquei para {1}.', m.hintedTrackName, m.detectedTrackName);
}

// ---------------------------------------------------------------------------------------------
// Guide visibility (spec 05 item 3, last bullet)
// ---------------------------------------------------------------------------------------------

export type GuideVisibility = 'full' | 'reduced';

/**
 * The guide with all three steps and instructions is for the engineer in Treino. With the engineer
 * off, or in Corrida/Classificação, it shrinks to "Pista aprendida" once the track is learned.
 */
export function guideVisibility(input: {
  engineerOn: boolean;
  mode: 'training' | 'qualifying' | 'race';
}): GuideVisibility {
  return input.engineerOn && input.mode === 'training' ? 'full' : 'reduced';
}
