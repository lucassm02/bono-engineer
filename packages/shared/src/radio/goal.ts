/**
 * Meta da pista (spec 13): after each valid lap the engineer says how far the lap is from the goal
 * the driver set for the track ("Distância para a meta: três décimos."), or "Boa volta." when the
 * lap reached it. It only speaks while the frame carries a goal, and uses phrases every voice
 * already ships (no new clips).
 */

import { GOOD_LAP, TO_GOAL, tenthsAmount } from './phrases.ts';
import { formatLapMs, LAP_TIME_WAIT_MS } from './rules.ts';
import type { RadioCandidate, RadioRule } from './types.ts';

/** A result not spoken this long after the line is dropped (ms). */
export const GOAL_RESULT_MAX_AGE_MS = 20_000;

interface GoalState {
  closing: {
    at: number;
    lap: number;
    valid: boolean;
    targetMs: number;
    lastBefore: number | null;
  } | null;
  result: RadioCandidate | null;
  expiresT: number;
}

const seconds = (ms: number) => (Math.abs(ms) / 1000).toFixed(3).replace('.', ',');

/** The candidate for a closed lap against the goal; null when the lap does not count. */
export function goalLapResult(
  lap: number,
  lapMs: number,
  valid: boolean,
  targetMs: number,
): RadioCandidate | null {
  if (!valid) return null;
  const diffMs = lapMs - targetMs;
  const evidence = { lap, lapMs, goalMs: targetMs, diffMs };
  if (diffMs <= 0) {
    return {
      key: `goal-${lap}`,
      utterance: GOOD_LAP,
      label: `Meta batida · ${formatLapMs(lapMs)} (${seconds(diffMs)} s abaixo)`,
      evidence,
      needsFreeWindow: true,
      postLine: true,
    };
  }
  return {
    key: `goal-${lap}`,
    utterance: [TO_GOAL, tenthsAmount(diffMs / 100)],
    label: `Volta ${formatLapMs(lapMs)} · faltam ${seconds(diffMs)} s para a meta`,
    evidence,
    needsFreeWindow: true,
    postLine: true,
  };
}

export const goalRule: RadioRule<GoalState> = {
  id: 'goal',
  priority: 'feedback',
  modes: ['training', 'qualifying'],
  requires: ['lapTiming'],
  init: () => ({ closing: null, result: null, expiresT: 0 }),
  evaluate(ctx, s) {
    const { frame, previous, t } = ctx;
    if (ctx.lineCrossed && previous && previous.lap.lap >= 1) {
      const goal = previous.goal ?? frame.goal;
      s.closing = goal
        ? {
            at: t,
            lap: previous.lap.lap,
            valid: previous.lap.currentLapValid === true,
            targetMs: goal.targetMs,
            lastBefore: previous.lap.lastLapMs,
          }
        : null;
      s.result = null;
    }
    const closing = s.closing;
    if (closing) {
      const last = frame.lap.lastLapMs;
      const fresh = last !== null && last !== closing.lastBefore;
      if (fresh || t - closing.at >= LAP_TIME_WAIT_MS) {
        s.closing = null;
        if (last !== null) {
          s.result = goalLapResult(closing.lap, last, closing.valid, closing.targetMs);
          s.expiresT = closing.at + GOAL_RESULT_MAX_AGE_MS;
        }
      }
    }
    if (s.result && t > s.expiresT) s.result = null;
    return s.result ? [s.result] : [];
  },
  delivered(_candidate, s) {
    s.result = null;
  },
  interrupt(s) {
    s.closing = null;
    s.result = null;
  },
};
