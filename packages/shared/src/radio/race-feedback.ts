import type { LiveCornerPass } from '../live.ts';
import { type ClosedLap, closeLaps, newBook } from './coaching.ts';
import {
  cornerSegment,
  PACE_FASTER,
  PACE_SLOWER,
  RACE_CORNER_CAUTION,
  RACE_CORNER_FOCUS,
} from './phrases.ts';
import { cornerNumber } from './rules.ts';
import type { RadioCandidate, RadioRule } from './types.ts';

const BASELINE_LAPS = 3;
const CONFIRM_LAPS = 2;
const PACE_MIN_MS = 500;
const PACE_RELATIVE_THRESHOLD = 0.005;
const LAP_OUTLIER_FRACTION = 0.08;
const CORNER_MIN_LOSS_MS = 200;
const FEEDBACK_MIN_LAPS = 2;
const FEEDBACK_MAX_AGE_MS = 20_000;
const QUIET_AFTER_ALERT_MS = 12_000;

type PaceDirection = 'slower' | 'faster';
interface FeedbackState {
  book: ReturnType<typeof newBook>;
  stint: number | null;
  skipLap: number | null;
  laps: ClosedLap[];
  lastCallLap: number;
  lastPace: PaceDirection | null;
  paceReferenceMs: number | null;
  lastFocus: string | null;
  pending: { candidate: RadioCandidate; expiresT: number } | null;
}

const medianOfThree = (times: number[]) => [...times].sort((a, b) => a - b)[1]!;

function paceFeedback(baseline: ClosedLap[], recent: ClosedLap[], anchorMs: number | null) {
  if (baseline.length !== BASELINE_LAPS || recent.length !== CONFIRM_LAPS) return null;
  const referenceMs = anchorMs ?? medianOfThree(baseline.map((lap) => lap.lapMs));
  const threshold = Math.max(PACE_MIN_MS, referenceMs * PACE_RELATIVE_THRESHOLD);
  const deltas = recent.map((lap) => lap.lapMs - referenceMs);
  // A large outlier is more likely to be an interruption than a change of sustainable pace.
  if (deltas.some((delta) => Math.abs(delta) > referenceMs * LAP_OUTLIER_FRACTION)) return null;
  const direction = deltas.every((d) => d >= threshold)
    ? 'slower'
    : deltas.every((d) => d <= -threshold)
      ? 'faster'
      : null;
  return direction ? { direction, referenceMs, meanDeltaMs: (deltas[0]! + deltas[1]!) / 2 } : null;
}

function cornerLoss(
  latest: LiveCornerPass,
  earlier: LiveCornerPass,
  baseline: ClosedLap[],
): number | null {
  const times = baseline.map((lap) => lap.passes.get(latest.cornerId)?.zoneTimeMs);
  if (times.length === BASELINE_LAPS && times.every((time) => time !== undefined)) {
    const target = medianOfThree(times);
    if (latest.zoneTimeMs !== undefined && earlier.zoneTimeMs !== undefined)
      return Math.min(latest.zoneTimeMs - target, earlier.zoneTimeMs - target);
  }
  if (
    latest.referenceLapId &&
    latest.referenceLapId === earlier.referenceLapId &&
    latest.cause &&
    latest.cause.kind === earlier.cause?.kind &&
    latest.cause.confidence !== 'low' &&
    earlier.cause.confidence !== 'low' &&
    latest.timeLostMs !== null &&
    earlier.timeLostMs !== null
  )
    return Math.min(latest.timeLostMs, earlier.timeLostMs);
  return null;
}

function cornerFeedback(baseline: ClosedLap[], recent: ClosedLap[]) {
  const [prior, current] = recent;
  if (!prior || !current) return null;
  const candidates = [];
  for (const pass of current.passes.values()) {
    const previous = prior.passes.get(pass.cornerId);
    const number = cornerNumber(pass.cornerId);
    if (!previous || number === null) continue;
    const lossMs = cornerLoss(pass, previous, baseline);
    const event = pass.event && pass.event.kind === previous.event?.kind ? pass.event.kind : null;
    if ((lossMs ?? 0) < CORNER_MIN_LOSS_MS && !event) continue;
    candidates.push({ cornerId: pass.cornerId, number, lossMs, event });
  }
  return candidates.sort((a, b) => (b.lossMs ?? 0) - (a.lossMs ?? 0))[0] ?? null;
}

/** One short pace or corner call once a pattern is confirmed across clean laps of this stint. */
export const raceFeedbackRule: RadioRule<FeedbackState> = {
  id: 'raceFeedback',
  priority: 'feedback',
  modes: ['race'],
  requires: ['lapTiming'],
  init: () => ({
    book: newBook(),
    stint: null,
    skipLap: null,
    laps: [],
    lastCallLap: -Infinity,
    lastPace: null,
    paceReferenceMs: null,
    lastFocus: null,
    pending: null,
  }),
  evaluate(ctx, state) {
    const { frame, t } = ctx;
    const stint = frame.stint?.number ?? 1;
    if (state.stint !== stint) {
      const skipLap = state.stint === null ? null : frame.lap.lap;
      Object.assign(state, raceFeedbackRule.init(), { stint, skipLap });
    }
    if (frame.stint?.inPits || frame.pitTyreChange) {
      state.skipLap = frame.lap.lap;
      state.pending = null;
      return [];
    }
    if (frame.lap.finished || frame.race?.state === 'finished') return [];

    const closed = closeLaps(ctx, state.book);
    if (closed) {
      state.pending = null;
      if (!closed.valid || closed.lap <= 1 || closed.lap === state.skipLap || closed.lapMs <= 0) {
        state.laps = [];
        return [];
      }
      state.laps = [...state.laps, closed].slice(-(BASELINE_LAPS + CONFIRM_LAPS));
      const baseline = state.laps.slice(0, -CONFIRM_LAPS);
      const recent = state.laps.slice(-CONFIRM_LAPS);
      const pace = paceFeedback(baseline, recent, state.paceReferenceMs);
      const focus = cornerFeedback(baseline, recent);
      if (!focus) state.lastFocus = null;
      if (closed.lap - state.lastCallLap >= FEEDBACK_MIN_LAPS) {
        let candidate: RadioCandidate | null = null;
        if (pace && pace.direction !== state.lastPace) {
          const phrase = pace.direction === 'slower' ? PACE_SLOWER : PACE_FASTER;
          candidate = {
            key: `pace:${closed.lap}`,
            utterance: phrase,
            label: phrase,
            evidence: { lap: closed.lap, ...pace },
            needsFreeWindow: true,
          };
        } else if (focus && focus.cornerId !== state.lastFocus) {
          const phrase =
            (focus.lossMs ?? 0) >= CORNER_MIN_LOSS_MS ? RACE_CORNER_FOCUS : RACE_CORNER_CAUTION;
          candidate = {
            key: `focus:${closed.lap}`,
            utterance: [cornerSegment(focus.number), phrase],
            label: `Na ${focus.cornerId}, ${phrase}`,
            evidence: { lap: closed.lap, ...focus },
            needsFreeWindow: true,
            priority: 'summary',
          };
        }
        if (candidate) state.pending = { candidate, expiresT: t + FEEDBACK_MAX_AGE_MS };
      }
    }

    if (!state.pending) return [];
    if (t >= state.pending.expiresT) {
      state.pending = null;
      return [];
    }
    const recentAlert = ctx.recentSpoken.some(
      (call) =>
        (call.priority === 'critical' || call.priority === 'strategy') &&
        t - call.t < QUIET_AFTER_ALERT_MS,
    );
    return recentAlert ? [] : [state.pending.candidate];
  },
  delivered(candidate, state) {
    const evidence = candidate.evidence;
    if (typeof evidence?.lap === 'number') state.lastCallLap = evidence.lap;
    if (typeof evidence?.cornerId === 'string') state.lastFocus = evidence.cornerId;
    if (evidence?.direction === 'slower' || evidence?.direction === 'faster') {
      state.lastPace = evidence.direction;
      if (typeof evidence.referenceMs === 'number' && typeof evidence.meanDeltaMs === 'number')
        state.paceReferenceMs = evidence.referenceMs + evidence.meanDeltaMs;
    }
    state.pending = null;
  },
  interrupt(state) {
    state.book = newBook();
    state.pending = null;
    state.laps = [];
    state.lastPace = null;
    state.paceReferenceMs = null;
  },
};
