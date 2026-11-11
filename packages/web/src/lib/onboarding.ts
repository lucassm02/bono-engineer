/**
 * First-run assistant (spec 03): the six screens, the per-step state saved in `gt7.setup.v2`, when to
 * show the assistant (or only the light invite), where to resume and when to offer the help
 * checklist of the PS5 search. Pure (the components and the gate hook only wire these to React and
 * localStorage).
 */

import type { ConsoleLinkState, Language } from '@gt7/shared';
import { SETUP_STATE_KEY, SETUP_STEP_IDS, type SetupStepId } from '../analysis/lib/configNav.ts';
import { isLinkFound } from './consoleLink.ts';
import { loadString, saveJson, saveString } from './storage.ts';

export { SETUP_STATE_KEY, SETUP_STEP_IDS, type SetupStepId };

/** localStorage key of the old 3-step assistant: "1" once it was finished or skipped. */
export const ONBOARDING_KEY = 'gt7.onboardingDone';

/** Searching for longer than this without finding the console → show the help checklist. */
export const HELP_AFTER_MS = 40_000;

/** How long the gate waits for the server's first connection status before giving up. */
export const ONBOARDING_WAIT_MS = 4000;

/** After the console shows up, how long "PS5 encontrado" stays before the assistant moves on. */
export const FOUND_PAUSE_MS = 1400;

/** Version of the assistant. A saved state with a lower version only gets the light invite. */
export const SETUP_VERSION = 2;

// ---------------------------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------------------------

/** The five steps that save something, plus the closing summary. */
export type SetupScreen = SetupStepId | 'ready';
export const SETUP_SCREENS: readonly SetupScreen[] = [...SETUP_STEP_IDS, 'ready'];

export function screenIndex(screen: SetupScreen): number {
  return SETUP_SCREENS.indexOf(screen);
}

export function nextScreen(screen: SetupScreen): SetupScreen {
  return SETUP_SCREENS[Math.min(SETUP_SCREENS.length - 1, screenIndex(screen) + 1)] ?? 'ready';
}

export function prevScreen(screen: SetupScreen): SetupScreen {
  return SETUP_SCREENS[Math.max(0, screenIndex(screen) - 1)] ?? 'welcome';
}

// ---------------------------------------------------------------------------------------------
// Saved state
// ---------------------------------------------------------------------------------------------

export type StepOutcome = 'done' | 'skipped';

export interface SetupState {
  version: number;
  steps: Partial<Record<SetupStepId, StepOutcome>>;
  /** Nothing is left to configure: every step done (or the invite was dismissed). */
  done: boolean;
  /** Where to resume when the app closes mid-way. */
  current?: SetupScreen;
  /** Why the assistant is not open: reached the end, or "Fazer isso depois". */
  closed?: 'finished' | 'later';
  /** The light invite was already answered. */
  invited?: boolean;
  /** The PS5 step was skipped in favour of the demo. */
  demo?: boolean;
}

export function emptySetupState(): SetupState {
  return { version: SETUP_VERSION, steps: {}, done: false };
}

const isScreen = (v: unknown): v is SetupScreen =>
  typeof v === 'string' && (SETUP_SCREENS as readonly string[]).includes(v);

/** Saved text → state; `null` when there is none or it is unreadable. Unknown fields are dropped. */
export function parseSetupState(raw: string | null | undefined): SetupState | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const steps: SetupState['steps'] = {};
  const rawSteps = typeof v.steps === 'object' && v.steps !== null ? v.steps : {};
  for (const id of SETUP_STEP_IDS) {
    const o = (rawSteps as Record<string, unknown>)[id];
    if (o === 'done' || o === true) steps[id] = 'done';
    else if (o === 'skipped') steps[id] = 'skipped';
  }
  const state: SetupState = {
    version: typeof v.version === 'number' ? v.version : 1,
    steps,
    done: v.done === true,
  };
  if (isScreen(v.current)) state.current = v.current;
  if (v.closed === 'finished' || v.closed === 'later') state.closed = v.closed;
  if (v.invited === true) state.invited = true;
  if (v.demo === true) state.demo = true;
  return state;
}

export function loadSetupState(): SetupState | null {
  return parseSetupState(loadString(SETUP_STATE_KEY));
}

export function saveSetupState(state: SetupState): void {
  saveJson(SETUP_STATE_KEY, state);
  // the "Falta configurar" cards listen to `storage`, which the browser only fires in other tabs
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('storage'));
}

export function allStepsDone(steps: SetupState['steps']): boolean {
  return SETUP_STEP_IDS.every((id) => steps[id] === 'done');
}

export function markStep(state: SetupState, step: SetupStepId, outcome: StepOutcome): SetupState {
  const steps = { ...state.steps, [step]: outcome };
  return { ...state, steps, done: allStepsDone(steps) };
}

export function withCurrent(state: SetupState, current: SetupScreen): SetupState {
  return state.current === current ? state : { ...state, current };
}

/** The assistant is closed: it will not open by itself again (the pending card takes over). */
export function closeSetup(state: SetupState, how: 'finished' | 'later'): SetupState {
  return { ...state, version: SETUP_VERSION, closed: how, invited: true };
}

/** "Refazer o assistente": forget what was done, keep nothing that would hide a screen. */
export function resetSetupState(state: SetupState | null): SetupState {
  return { ...emptySetupState(), invited: state?.invited };
}

/** The light invite was dismissed or used: nothing is pending for someone who already races here. */
export function acceptInvite(state: SetupState | null): SetupState {
  return {
    ...(state ?? emptySetupState()),
    version: SETUP_VERSION,
    closed: 'later',
    invited: true,
    done: true,
  };
}

/** Screen to open on: where it stopped, or the first step when nothing was done yet. */
export function resumeScreen(state: SetupState | null): SetupScreen {
  if (!state) return 'welcome';
  const touched = SETUP_STEP_IDS.some((id) => state.steps[id]);
  if (!touched || state.closed === 'finished') return 'welcome';
  return state.current && state.current !== 'ready'
    ? state.current
    : (firstPending(state) ?? 'welcome');
}

export function firstPending(state: SetupState): SetupStepId | null {
  return SETUP_STEP_IDS.find((id) => state.steps[id] !== 'done') ?? null;
}

/** Everything is marked done in the old key too, so no other piece asks again. */
export function markLegacyDone(): void {
  saveString(ONBOARDING_KEY, '1');
}

// ---------------------------------------------------------------------------------------------
// When to show
// ---------------------------------------------------------------------------------------------

export interface GateInput {
  /** What is saved in `gt7.setup.v2` (null = nothing). */
  state: SetupState | null;
  /** The old assistant was finished or skipped on this device. */
  legacyDone: boolean;
  /** `?onboarding=1`: show it regardless (preview/testing). */
  forced: boolean;
  source: 'server' | 'mock';
  wsOpen: boolean;
  /** Link state from the server's first status (null = none yet). */
  linkState: ConsoleLinkState | null;
  /** The console is the in-process demo simulator. */
  simulator: boolean;
  /** Number of sessions in the history (null = not known yet). */
  sessionCount: number | null;
  /** The wait for the first status ran out. */
  timedOut: boolean;
  /** The car is not moving (paused, menu, stopped); always true for the demos. */
  safe: boolean;
}

export type GateDecision = 'wait' | 'wizard' | 'invite' | 'none';

/**
 * - Never raced or configured here → the whole assistant.
 * - Left it half-way → the assistant, at the same step.
 * - Already races here (history) or used the old assistant → only the light invite, once.
 * - Not in the demo (`?mock=1`, the server's simulated console) unless forced.
 * - Never with the car moving: waits for a pause.
 */
export function decideSetup(i: GateInput): GateDecision {
  if (i.forced) return i.safe ? 'wizard' : 'wait';
  if (i.source === 'mock') return 'none';
  if (i.state?.closed && i.state.version >= SETUP_VERSION) return 'none';
  if (!i.wsOpen || i.linkState === null || i.sessionCount === null) {
    return i.timedOut ? 'none' : 'wait';
  }
  if (i.simulator) return 'none';

  let want: GateDecision;
  if (i.state && !i.state.closed) want = 'wizard';
  else if (i.state) want = i.state.invited ? 'none' : 'invite';
  else if (i.legacyDone || i.sessionCount > 0) want = 'invite';
  else want = 'wizard';

  if (want !== 'none' && !i.safe) return 'wait';
  return want;
}

// ---------------------------------------------------------------------------------------------
// Console search (step 2)
// ---------------------------------------------------------------------------------------------

/** Offer the checklist when the search is taking too long. */
export function needsHelp(
  searchingForMs: number,
  linkState: ConsoleLinkState | null,
  step: SetupScreen = 'console',
): boolean {
  return step === 'console' && !isLinkFound(linkState) && searchingForMs >= HELP_AFTER_MS;
}

// ---------------------------------------------------------------------------------------------
// Welcome (step 1)
// ---------------------------------------------------------------------------------------------

/** Browser/system language → one of the three the app speaks (null = none matches). */
export function detectLanguage(candidates: readonly string[]): Language | null {
  for (const c of candidates) {
    const lang = c.toLowerCase();
    if (lang.startsWith('pt')) return 'pt-BR';
    if (lang.startsWith('en')) return 'en';
    if (lang.startsWith('es')) return 'es';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// "Como você quer treinar?" (step 3)
// ---------------------------------------------------------------------------------------------

export type TrainChoice = 'learn' | 'time' | 'view';
export const TRAIN_CHOICES: readonly TrainChoice[] = ['learn', 'time', 'view'];

/** What each card writes: the same engineer controls the settings use. */
export function trainChoicePlan(choice: TrainChoice): {
  enabled: boolean;
  mode: 'training';
  trainingProfile: 'learnTrack' | 'gainTime';
} {
  return {
    enabled: choice !== 'view',
    mode: 'training',
    trainingProfile: choice === 'time' ? 'gainTime' : 'learnTrack',
  };
}

/** Card that matches what is already saved (null = nothing fits, keep the default card). */
export function trainChoiceFrom(
  enabled: boolean,
  controls: { mode: string; trainingProfile: string },
): TrainChoice | null {
  if (!enabled) return 'view';
  if (controls.mode !== 'training') return null;
  if (controls.trainingProfile === 'learnTrack') return 'learn';
  if (controls.trainingProfile === 'gainTime') return 'time';
  return null;
}

// ---------------------------------------------------------------------------------------------
// "Seu painel" (step 5)
// ---------------------------------------------------------------------------------------------

/** Simple on a phone/tablet in the hand, complete on a PC. */
export function defaultPanelPreset(input: {
  coarsePointer: boolean;
  width: number;
}): 'simple' | 'full' {
  return input.coarsePointer || input.width < 700 ? 'simple' : 'full';
}
