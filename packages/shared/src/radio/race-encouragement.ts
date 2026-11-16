import { RACE_POSITION_RECOVERY } from './phrases.ts';
import { raceStartInProgress } from './race-presence.ts';
import type { RadioRule } from './types.ts';

const MAX_CALLS = 2;
const BETWEEN_CALLS_MS = 60_000;
const ERROR_BEFORE_LOSS_MS = 6_000;
const REVIEW_AFTER_LOSS_MS = 2_000;
const LOSS_WINDOW_MS = 9_000;
const QUIET_AFTER_RADIO_MS = 12_000;

interface EncouragementState {
  attempt: number | null;
  drivingError: { kind: string; at: number; lap: number } | null;
  delivered: number;
  lastLossAt: number;
  lastCallAt: number;
}

export const raceEncouragementRule: RadioRule<EncouragementState> = {
  id: 'raceEncouragement',
  priority: 'summary',
  modes: ['race'],
  perRace: true,
  init: () => ({
    attempt: null,
    drivingError: null,
    delivered: 0,
    lastLossAt: -Infinity,
    lastCallAt: -Infinity,
  }),
  evaluate(ctx, state) {
    const { frame, previous, t } = ctx;
    const race = frame.race;
    if (race?.state !== 'racing' || race.startedAt === undefined) return [];
    if (state.attempt !== race.startedAt) {
      Object.assign(state, raceEncouragementRule.init(), { attempt: race.startedAt });
    }
    if (
      !ctx.config.raceEncouragement ||
      frame.stint?.inPits ||
      frame.pitTyreChange ||
      frame.flags?.loadingOrProcessing ||
      raceStartInProgress(frame)
    ) {
      state.drivingError = null;
      return [];
    }
    if (state.delivered >= MAX_CALLS) return [];

    const impact = race.lastImpactAt;
    if (
      impact !== undefined &&
      previous?.race?.startedAt === race.startedAt &&
      impact !== previous.race.lastImpactAt &&
      t - impact < ERROR_BEFORE_LOSS_MS
    ) {
      state.drivingError = { kind: 'impact', at: impact, lap: frame.lap.lap };
    }
    for (const pass of ctx.passes) {
      const cause = pass.cause?.confidence === 'high' ? pass.cause.kind : null;
      const kind = pass.event?.kind ?? cause;
      if (
        kind &&
        pass.reviewedAt !== undefined &&
        pass.lap === frame.lap.lap &&
        pass.reviewedAt >= (state.drivingError?.at ?? -Infinity)
      ) {
        state.drivingError = { kind, at: pass.reviewedAt, lap: pass.lap };
      }
    }

    const loss = race.lastChange;
    const error = state.drivingError;
    if (
      !ctx.audio ||
      !loss ||
      !error ||
      loss.to <= loss.from ||
      race.position !== loss.to ||
      error.lap !== frame.lap.lap ||
      loss.at <= state.lastLossAt ||
      t - loss.at >= LOSS_WINDOW_MS ||
      t - state.lastCallAt < BETWEEN_CALLS_MS
    )
      return [];
    const sinceError = loss.at - error.at;
    if (
      sinceError > ERROR_BEFORE_LOSS_MS ||
      sinceError < (error.kind === 'impact' ? 0 : -REVIEW_AFTER_LOSS_MS)
    )
      return [];
    const last = ctx.recentSpoken.at(-1);
    if (last && t - last.t < QUIET_AFTER_RADIO_MS) return [];

    return [
      {
        key: `loss:${loss.at}`,
        label: RACE_POSITION_RECOVERY,
        utterance: RACE_POSITION_RECOVERY,
        needsFreeWindow: true,
        deadlineT: loss.at + LOSS_WINDOW_MS,
        evidence: {
          error: error.kind,
          errorAt: error.at,
          from: loss.from,
          to: loss.to,
          lossAt: loss.at,
        },
      },
    ];
  },
  delivered(candidate, state, ctx, outcome) {
    if (outcome !== 'spoken') return;
    state.delivered++;
    state.lastLossAt = Number(candidate.evidence.lossAt);
    state.lastCallAt = ctx.t;
    state.drivingError = null;
  },
  interrupt(state) {
    state.drivingError = null;
  },
};
