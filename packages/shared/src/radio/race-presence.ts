import { BRAKE_ON_THRESHOLD } from '../analysis.ts';
import type { LiveFrame } from '../live.ts';
import {
  MAX_RADIO_POSITION,
  positionSegment,
  RACE_FINISH_RECOVERY,
  RACE_FLAG,
  RACE_HELLO,
  RACE_WELL_DONE,
  type RadioUtterance,
} from './phrases.ts';
import type { RadioRule } from './types.ts';

const GRID_HOLD_MS = 300;
const GRID_WINDOW_MS = 3_000;
const START_QUIET_MS = 12_000;
const BETWEEN_CALLS_MS = 12_000;
const RESULT_WINDOW_MS = 12_000;
const STRAIGHT_CONFIRM_MS = 2_000;

export function raceStartInProgress(frame: LiveFrame): boolean {
  return frame.lap.lap <= 0 || (frame.lap.lap === 1 && frame.lap.currentLapMs < START_QUIET_MS);
}

export function raceGridHeld(frame: LiveFrame): boolean {
  return (
    frame.lap.lap <= 0 &&
    frame.car.speedKmh < 1 &&
    (frame.car.throttleRaw ?? frame.car.throttle) < 0.05 &&
    frame.flags?.handBrake === true
  );
}

export function raceQuietStraight(frame: LiveFrame): boolean {
  return (
    frame.car.speedKmh >= 45 &&
    (frame.car.brakeRaw ?? frame.car.brake) < BRAKE_ON_THRESHOLD &&
    Math.abs(frame.g?.lateral ?? Infinity) < 0.25 &&
    (frame.g?.longitudinal ?? 0) > -0.25
  );
}

interface PresenceState {
  attempt: number | null;
  gridSince: number | null;
  straightSince: number | null;
  leftGrid: boolean;
  greeted: boolean;
  closed: boolean;
}

export const racePresenceRule: RadioRule<PresenceState> = {
  id: 'racePresence',
  priority: 'summary',
  modes: ['race'],
  afterRace: true,
  init: () => ({
    attempt: null,
    gridSince: null,
    straightSince: null,
    leftGrid: false,
    greeted: false,
    closed: false,
  }),
  evaluate(ctx, state) {
    const { frame, t } = ctx;
    const race = frame.race;
    if (race?.startedAt === undefined) return [];
    if (state.attempt !== race.startedAt) {
      Object.assign(state, racePresenceRule.init(), { attempt: race.startedAt });
      for (const call of ctx.recentSpoken) {
        if (call.ruleId !== racePresenceRule.id || call.evidence?.attempt !== race.startedAt)
          continue;
        if (call.key === 'result') state.closed = true;
        else state.greeted = true;
      }
    }
    if (frame.flags?.loadingOrProcessing || frame.stint?.inPits || frame.pitTyreChange) return [];
    if (race.state === 'finished') {
      const result = race.result;
      if (!result || t - result.at >= RESULT_WINDOW_MS || state.closed || !ctx.audio) return [];
      const position = result.position;
      const positionCall =
        position !== null && position >= 1 && position <= MAX_RADIO_POSITION
          ? positionSegment(position)
          : null;
      const recovered = (result.gainedOnFinalLap ?? 0) > 0;
      const utterance: RadioUtterance = [
        RACE_FLAG,
        ...(positionCall ? [positionCall] : []),
        recovered ? RACE_FINISH_RECOVERY : RACE_WELL_DONE,
      ];
      return [
        {
          key: 'result',
          label: utterance.join(' '),
          utterance,
          evidence: { attempt: race.startedAt, position, recovered },
          needsFreeWindow: frame.state === 'onTrack',
          deadlineT: result.at + RESULT_WINDOW_MS,
        },
      ];
    }

    if (state.greeted || (race.totalLaps > 1 && frame.lap.lap >= race.totalLaps)) return [];
    if (
      frame.lap.lap > 0 ||
      frame.car.speedKmh >= 1 ||
      (frame.car.throttleRaw ?? frame.car.throttle) >= 0.05
    )
      state.leftGrid = true;
    const onGrid = raceGridHeld(frame) && !state.leftGrid && race.position !== null;
    state.gridSince = onGrid ? (state.gridSince ?? t) : null;
    const unmappedStraight = !frame.nextCorner && !ctx.cues.length && raceQuietStraight(frame);
    state.straightSince = unmappedStraight ? (state.straightSince ?? t) : null;
    if (!ctx.audio) return [];
    const last = ctx.recentSpoken.at(-1);
    if (last && last.t >= race.startedAt && t - last.t < BETWEEN_CALLS_MS) return [];

    const gridDeadline = race.startedAt + GRID_WINDOW_MS;
    const grid =
      state.gridSince !== null && t - state.gridSince >= GRID_HOLD_MS && t < gridDeadline;
    const inMotion = frame.car.speedKmh >= 35 && !raceStartInProgress(frame);
    if (!grid && !inMotion) return [];
    // An unmapped straight has no projected window. Wait for measured stability and stop
    // the greeting when the driver brakes or turns.
    const observedStraight =
      state.straightSince !== null && t - state.straightSince >= STRAIGHT_CONFIRM_MS;
    return [
      {
        key: grid ? 'grid' : observedStraight ? 'unmappedStraight' : 'driving',
        utterance: RACE_HELLO,
        label: RACE_HELLO,
        evidence: { attempt: race.startedAt },
        ...(grid ? { deadlineT: gridDeadline } : { needsFreeWindow: !observedStraight }),
      },
    ];
  },
  delivered(candidate, state, _ctx, outcome) {
    if (outcome !== 'spoken') return;
    if (candidate.key === 'result') state.closed = true;
    else state.greeted = true;
  },
  interrupt(state) {
    state.gridSince = null;
    state.straightSince = null;
  },
};
