/**
 * Treino de curva (spec 18): after each pass through the corner being drilled, the engineer says
 * how it compared with the best pass of the drill ("Na T7. Melhorou dois décimos."). It speaks only
 * after the exit, in a free window, never inside the corner, and reuses phrases every voice
 * already ships. The first pass has nothing to compare with and stays on the panel.
 */

import { assessDrillPass } from '../drill.ts';
import type { LiveDrillPass } from '../live.ts';
import {
  cornerSegment,
  IMPROVED,
  LOST,
  type RadioUtterance,
  tenthsAmount,
  YOU_IMPROVED_HERE,
} from './phrases.ts';
import { cornerNumber } from './rules.ts';
import type { RadioCandidate, RadioRule } from './types.ts';

/** A result not spoken this long after the pass is dropped (ms). */
export const DRILL_RESULT_MAX_AGE_MS = 15_000;

const seconds = (ms: number) => (Math.abs(ms) / 1000).toFixed(3).replace('.', ',');

interface DrillState {
  /** Pass number last seen (passes arrive once, in order). */
  lastN: number;
  drillStartedAt: number | null;
  best: LiveDrillPass | null;
  result: RadioCandidate | null;
  expiresT: number;
}

/** What to say about a pass, given the best pass before it. */
export function drillPassCandidate(
  cornerId: string,
  pass: LiveDrillPass,
  bestBefore: LiveDrillPass | null,
): RadioCandidate {
  const verdict = assessDrillPass(pass, bestBefore ? [bestBefore] : []);
  const key = `drill-${cornerId}-${pass.n}`;
  const evidence = {
    pass: pass.n,
    timeMs: pass.timeMs,
    vsBestMs: verdict.vsBestMs,
    entrySpeedKmh: pass.entrySpeedKmh,
    minSpeedKmh: pass.minSpeedKmh,
  };
  const head = `${cornerId} · passagem ${pass.n} · ${seconds(pass.timeMs)} s`;
  if (verdict.vsBestMs === null) {
    return { key, utterance: [], label: head, evidence, panelOnly: true };
  }
  const n = cornerNumber(cornerId);
  const corner: string[] = n ? [cornerSegment(n)] : [];
  const tenths = Math.round(Math.abs(verdict.vsBestMs) / 100);
  if (verdict.improved) {
    const utterance: RadioUtterance =
      tenths >= 1 ? [...corner, IMPROVED, tenthsAmount(tenths)] : [...corner, YOU_IMPROVED_HERE];
    return {
      key,
      utterance,
      label: `${head} · ${seconds(verdict.vsBestMs)} s melhor que a melhor`,
      evidence,
      needsFreeWindow: true,
      postLine: true,
    };
  }
  if (verdict.slower && tenths >= 1) {
    return {
      key,
      utterance: [...corner, LOST, tenthsAmount(tenths)],
      label: `${head} · ${seconds(verdict.vsBestMs)} s pior que a melhor`,
      evidence,
      needsFreeWindow: true,
      postLine: true,
    };
  }
  return {
    key,
    utterance: [],
    label: `${head} · mesmo tempo da melhor`,
    evidence,

    panelOnly: true,
  };
}

export const drillRule: RadioRule<DrillState> = {
  id: 'drill',
  priority: 'feedback',
  modes: ['training'],
  drill: true,
  init: () => ({ lastN: 0, drillStartedAt: null, best: null, result: null, expiresT: 0 }),
  evaluate(ctx, s) {
    const drill = ctx.frame.drill;
    if (!drill) {
      s.lastN = 0;
      s.drillStartedAt = null;
      s.best = null;
      s.result = null;
      return [];
    }
    if (s.drillStartedAt !== drill.startedAt) {
      s.drillStartedAt = drill.startedAt;
      s.lastN = 0;
      s.best = null;
      s.result = null;
    }
    const fresh = drill.passes.filter((p) => p.n > s.lastN);
    for (const pass of fresh) {
      s.result = drillPassCandidate(drill.cornerId, pass, s.best);
      s.expiresT = ctx.t + DRILL_RESULT_MAX_AGE_MS;
      s.lastN = pass.n;
      if (!s.best || pass.timeMs < s.best.timeMs) s.best = pass;
    }
    if (s.result && ctx.t > s.expiresT) s.result = null;
    return s.result ? [s.result] : [];
  },
  delivered(_candidate, s) {
    s.result = null;
  },
  interrupt(s) {
    s.result = null;
  },
};
