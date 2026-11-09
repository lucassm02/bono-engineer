/**
 * First-run assistant: when to show it, which step it is on and when to offer the help checklist.
 * Pure (the component and the gate hook only wire these to React and localStorage).
 */

import type { ConsoleLinkState } from '@gt7/shared';
import { isLinkFound } from './consoleLink.ts';

/** localStorage key: "1" once the assistant was finished or skipped. */
export const ONBOARDING_KEY = 'gt7.onboardingDone';

/** Searching for longer than this without finding the console → show the help checklist. */
export const HELP_AFTER_MS = 40_000;

/** How long the gate waits for the server's first connection status before giving up. */
export const ONBOARDING_WAIT_MS = 4000;

export type OnboardingStep = 'search' | 'found' | 'ready';
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['search', 'found', 'ready'];

export interface GateInput {
  /** The assistant was already finished/skipped on this device. */
  done: boolean;
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
}

export type GateDecision = 'wait' | 'show' | 'skip';

/**
 * Show the assistant only to someone who has never raced here (empty history), whose console has
 * not been found yet, on a real server (not the demo simulator and not `?mock=1`).
 */
export function decideOnboarding(i: GateInput): GateDecision {
  if (i.forced) return 'show';
  if (i.done) return 'skip';
  if (i.source === 'mock' || i.simulator) return 'skip';
  if (!i.wsOpen || i.linkState === null || i.sessionCount === null) {
    return i.timedOut ? 'skip' : 'wait';
  }
  if (i.sessionCount > 0) return 'skip';
  return i.linkState === 'searching' ? 'show' : 'skip';
}

/** The wizard moves from "search" to "found" by itself; the other steps are the user's choice. */
export function nextStep(
  current: OnboardingStep,
  linkState: ConsoleLinkState | null,
): OnboardingStep {
  if (current === 'search' && isLinkFound(linkState)) return 'found';
  return current;
}

/** Offer the checklist when the search is taking too long. */
export function needsHelp(
  step: OnboardingStep,
  searchingForMs: number,
  linkState: ConsoleLinkState | null,
): boolean {
  return step === 'search' && !isLinkFound(linkState) && searchingForMs >= HELP_AFTER_MS;
}
