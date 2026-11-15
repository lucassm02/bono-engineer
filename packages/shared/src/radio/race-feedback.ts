import type { LiveCornerPass } from '../live.ts';
import { type ClosedLap, closeLaps, newBook } from './coaching.ts';
import {
  attentionCornerSegment,
  cornerSegment,
  PACE_FASTER,
  PACE_RECOVERED,
  PACE_SLOWER,
  PACE_STABLE,
  RACE_CORNER_CAUTION,
  RACE_CORNER_FOCUS,
  RACE_FINAL_LAP,
} from './phrases.ts';
import { cornerNumber } from './rules.ts';
import type { RadioCandidate, RadioRule } from './types.ts';

const BASELINE_LAPS = 3;
const CONFIRM_LAPS = 2;
const PACE_MIN_MS = 500;
const PACE_RELATIVE_THRESHOLD = 0.005;
const SECTOR_PACE_MIN_MS = 150;
const LAP_OUTLIER_FRACTION = 0.08;
/** Even six laps leave fewer than five usable laps before the final lap. */
const SPRINT_MAX_LAPS = 6;
const CORNER_MIN_LOSS_MS = 200;
const FEEDBACK_MIN_LAPS = 2;
const FEEDBACK_MAX_AGE_MS = 20_000;
const SPRINT_PACE_MAX_AGE_MS = 45_000;
const QUIET_AFTER_ALERT_MS = 12_000;
const LONG_RACE_MIN_LAPS = 8;
const STABLE_QUIET_MS = 45_000;

type PaceDirection = 'slower' | 'faster';
interface FeedbackState {
  book: ReturnType<typeof newBook>;
  stint: number | null;
  skipLap: number | null;
  laps: ClosedLap[];
  lastCallLap: number;
  lastPace: PaceDirection | null;
  paceReferenceMs: number | null;
  paceBeforeDropMs: number | null;
  stableReported: boolean;
  lastFocus: string | null;
  pending: { candidate: RadioCandidate; expiresT: number } | null;
}

const medianOfThree = (times: number[]) => [...times].sort((a, b) => a - b)[1]!;

function paceDirection(referenceMs: number, deltas: number[]): PaceDirection | null {
  const threshold = Math.max(PACE_MIN_MS, referenceMs * PACE_RELATIVE_THRESHOLD);
  // A large outlier is more likely to be an interruption than a change of sustainable pace.
  if (deltas.some((delta) => Math.abs(delta) > referenceMs * LAP_OUTLIER_FRACTION)) return null;
  return deltas.every((d) => d >= threshold)
    ? 'slower'
    : deltas.every((d) => d <= -threshold)
      ? 'faster'
      : null;
}

function paceFeedback(baseline: ClosedLap[], recent: ClosedLap[], anchorMs: number | null) {
  if (baseline.length !== BASELINE_LAPS || recent.length !== CONFIRM_LAPS) return null;
  const referenceMs = anchorMs ?? medianOfThree(baseline.map((lap) => lap.lapMs));
  const deltas = recent.map((lap) => lap.lapMs - referenceMs);
  const direction = paceDirection(referenceMs, deltas);
  return direction ? { direction, referenceMs, meanDeltaMs: (deltas[0]! + deltas[1]!) / 2 } : null;
}

/** A short race can confirm a change across sectors in two consecutive clean laps. */
function sprintPaceFeedback(recent: ClosedLap[]) {
  const [prior, current] = recent;
  if (
    !prior ||
    !current ||
    current.lap !== prior.lap + 1 ||
    prior.sectorsMs.length < 2 ||
    prior.sectorsMs.length !== current.sectorsMs.length
  )
    return null;

  const referenceMs = prior.lapMs;
  const meanDeltaMs = current.lapMs - referenceMs;
  const direction = paceDirection(referenceMs, [meanDeltaMs]);
  if (!direction) return null;
  const sign = direction === 'slower' ? 1 : -1;
  let supportingSectors = 0;
  for (const [i, priorMs] of prior.sectorsMs.entries()) {
    const threshold = Math.max(SECTOR_PACE_MIN_MS, priorMs * PACE_RELATIVE_THRESHOLD);
    const delta = (current.sectorsMs[i]! - priorMs) * sign;
    if (delta <= -threshold) return null;
    if (delta >= threshold) supportingSectors++;
  }
  return supportingSectors >= 2 ? { direction, referenceMs, meanDeltaMs, supportingSectors } : null;
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

function stablePace(laps: ClosedLap[]): number | null {
  const window = laps.slice(-BASELINE_LAPS);
  if (window.length !== BASELINE_LAPS || window.at(-1)!.lap - window[0]!.lap !== BASELINE_LAPS - 1)
    return null;
  const times = window.map((lap) => lap.lapMs);
  const spreadMs = Math.max(...times) - Math.min(...times);
  return spreadMs <= Math.max(400, medianOfThree(times) * 0.004) ? spreadMs : null;
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
    paceBeforeDropMs: null,
    stableReported: false,
    lastFocus: null,
    pending: null,
  }),
  evaluate(ctx, state) {
    const { frame, t } = ctx;
    const stint = frame.stint?.number ?? 1;
    if (state.stint !== stint) {
      const skipLap = state.stint === null ? null : frame.lap.lap;
      Object.assign(state, raceFeedbackRule.init(), {
        stint,
        skipLap,
        stableReported: state.stableReported,
      });
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
      const totalLaps = frame.race?.totalLaps ?? frame.lap.totalLaps;
      const sprint = totalLaps !== null && totalLaps > 0 && totalLaps <= SPRINT_MAX_LAPS;
      const pace = sprint
        ? sprintPaceFeedback(recent)
        : paceFeedback(baseline, recent, state.paceReferenceMs);
      const focus = cornerFeedback(baseline, recent);
      if (!focus) state.lastFocus = null;
      if (closed.lap - state.lastCallLap >= FEEDBACK_MIN_LAPS) {
        let candidate: RadioCandidate | null = null;
        if (pace && pace.direction !== state.lastPace) {
          const recovered =
            state.paceBeforeDropMs !== null &&
            pace.referenceMs + pace.meanDeltaMs <= state.paceBeforeDropMs + PACE_MIN_MS;
          const phrase =
            pace.direction === 'slower' ? PACE_SLOWER : recovered ? PACE_RECOVERED : PACE_FASTER;
          candidate = {
            key: `pace:${closed.lap}`,
            utterance: phrase,
            label: phrase,
            evidence: { lap: closed.lap, ...pace },
            needsFreeWindow: true,
          };
        } else if (focus && focus.cornerId !== state.lastFocus) {
          const loss = (focus.lossMs ?? 0) >= CORNER_MIN_LOSS_MS;
          const corner = loss ? attentionCornerSegment(focus.number) : cornerSegment(focus.number);
          const phrase = loss ? RACE_CORNER_FOCUS : RACE_CORNER_CAUTION;
          candidate = {
            key: `focus:${closed.lap}`,
            utterance: [corner, phrase],
            label: `${corner}, ${phrase}`,
            evidence: { lap: closed.lap, ...focus },
            needsFreeWindow: true,
            priority: 'summary',
          };
        } else if (
          !state.stableReported &&
          totalLaps !== null &&
          totalLaps >= LONG_RACE_MIN_LAPS &&
          closed.lap >= Math.ceil(totalLaps / 2) &&
          frame.lap.lap < totalLaps
        ) {
          const spreadMs = stablePace(state.laps);
          if (spreadMs !== null)
            candidate = {
              key: `stable:${closed.lap}`,
              utterance: PACE_STABLE,
              label: PACE_STABLE,
              evidence: { lap: closed.lap, spreadMs },
              needsFreeWindow: true,
              priority: 'summary',
            };
        }
        if (candidate) {
          const ageMs =
            sprint && candidate.key.startsWith('pace:')
              ? SPRINT_PACE_MAX_AGE_MS
              : FEEDBACK_MAX_AGE_MS;
          state.pending = { candidate, expiresT: t + ageMs };
        }
      }
    }

    if (!state.pending) return [];
    if (t >= state.pending.expiresT) {
      state.pending = null;
      return [];
    }
    const recentAlert = ctx.recentSpoken.some(
      (call) =>
        (call.priority === 'critical' ||
          call.priority === 'strategy' ||
          call.ruleId === 'raceFinalLap') &&
        t - call.t < QUIET_AFTER_ALERT_MS,
    );
    const stable = state.pending.candidate.key.startsWith('stable:');
    const last = ctx.recentSpoken.at(-1);
    return recentAlert || (stable && last && t - last.t < STABLE_QUIET_MS)
      ? []
      : [state.pending.candidate];
  },
  delivered(candidate, state, _ctx, outcome) {
    const evidence = candidate.evidence;
    if (typeof evidence?.lap === 'number') state.lastCallLap = evidence.lap;
    if (typeof evidence?.cornerId === 'string') state.lastFocus = evidence.cornerId;
    if (evidence?.direction === 'slower' || evidence?.direction === 'faster') {
      state.lastPace = evidence.direction;
      if (typeof evidence.referenceMs === 'number' && typeof evidence.meanDeltaMs === 'number') {
        state.paceReferenceMs = evidence.referenceMs + evidence.meanDeltaMs;
        if (evidence.direction === 'slower') state.paceBeforeDropMs = evidence.referenceMs;
        if (candidate.utterance === PACE_RECOVERED) state.paceBeforeDropMs = null;
      }
    }
    if (candidate.key.startsWith('stable:') && outcome === 'spoken') state.stableReported = true;
    state.pending = null;
  },
  interrupt(state) {
    state.book = newBook();
    state.pending = null;
    state.laps = [];
    state.lastPace = null;
    state.paceReferenceMs = null;
    state.paceBeforeDropMs = null;
  },
};

/** A single useful call even when the race generates no alerts or pace changes. */
export const raceFinalLapRule: RadioRule<{ delivered: boolean }> = {
  id: 'raceFinalLap',
  priority: 'summary',
  modes: ['race'],
  init: () => ({ delivered: false }),
  evaluate(ctx, state) {
    const { frame } = ctx;
    const race = frame.race;
    if (
      state.delivered ||
      race?.state !== 'racing' ||
      race.totalLaps < 2 ||
      frame.lap.lap !== race.totalLaps ||
      frame.lap.finished ||
      frame.stint?.inPits ||
      frame.pitTyreChange ||
      frame.car.speedKmh < 30
    )
      return [];
    const last = ctx.recentSpoken.at(-1);
    if (last && ctx.t - last.t < QUIET_AFTER_ALERT_MS) return [];
    return [
      {
        key: 'final',
        label: RACE_FINAL_LAP,
        utterance: RACE_FINAL_LAP,
        evidence: { lap: frame.lap.lap, totalLaps: race.totalLaps },
        needsFreeWindow: true,
      },
    ];
  },
  delivered(_candidate, state) {
    state.delivered = true;
  },
};
