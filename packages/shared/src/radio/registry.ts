/**
 * Rule registry and mode policy.
 *
 * The registry order is the stable tie order between candidates of the same priority. To add a
 * behaviour (Treino profiles, summary, praise): write a `RadioRule` (rules.ts shows the shape),
 * declare `modes`/`profiles`/`priority`/`level`/`intervalMs`, and append it here — or pass a custom
 * list to `new RadioEngine({ rules })`. The scheduler applies mode, level, phase, per-corner
 * limit and interval for every rule; a rule only confirms its own condition.
 */

import {
  consistencyRule,
  cornerCorrectionRule,
  drivingEventRule,
  lapSummaryRule,
  liftThrottleRule,
} from './coaching.ts';
import {
  cornerCuesRule,
  fuelRule,
  lapResultRule,
  learnReferenceRule,
  tyresHotRule,
  tyresWarmUpRule,
} from './rules.ts';
import type { RadioEngineConfig } from './settings.ts';
import {
  RADIO_PRIORITIES,
  type RadioCandidate,
  type RadioPhase,
  type RadioPriority,
  type RadioRule,
} from './types.ts';

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous rule states
export type AnyRadioRule = RadioRule<any>;

export const RADIO_RULES: readonly AnyRadioRule[] = [
  fuelRule,
  tyresHotRule,
  tyresWarmUpRule,
  cornerCuesRule,
  liftThrottleRule,
  cornerCorrectionRule,
  learnReferenceRule,
  drivingEventRule,
  lapResultRule,
  lapSummaryRule,
  consistencyRule,
];

export const priorityRank = (priority: RadioPriority): number => RADIO_PRIORITIES.indexOf(priority);

/** Whether the rule runs at all with this mode and Treino profile. */
export function ruleRuns(rule: AnyRadioRule, config: Readonly<RadioEngineConfig>): boolean {
  if (!rule.modes.includes(config.mode)) return false;
  if (config.mode !== 'training') return true;
  // Livre: only the essential car alerts.
  if (config.trainingProfile === 'free') return rule.carAlert === true;
  return !rule.profiles || rule.profiles.includes(config.trainingProfile);
}

/**
 * Mode and phase gate for one candidate; returns why it must wait, or null when allowed.
 * Unknown phase → quietest behaviour (critical only). Classificação: silence on the timed lap
 * except critical alerts and the result right after the line.
 */
export function phaseBlock(
  candidate: RadioCandidate,
  priority: RadioPriority,
  config: Readonly<RadioEngineConfig>,
  phase: RadioPhase,
): string | null {
  if (priority === 'critical') return null;
  if (phase === 'unknown') return 'fase desconhecida';
  if (config.mode === 'qualifying' && phase === 'timedLap' && !candidate.postLine)
    return 'volta rápida';
  return null;
}
