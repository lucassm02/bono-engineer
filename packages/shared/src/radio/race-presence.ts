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

const GREETING_WINDOW_MS = 2_500;
const START_LINE_WINDOW_MS = 150;
const START_QUIET_MS = 12_000;
const FINISH_CALL_WINDOW_MS = 750;

export function raceStartInProgress(frame: LiveFrame): boolean {
  return frame.lap.lap <= 0 || (frame.lap.lap === 1 && frame.lap.currentLapMs < START_QUIET_MS);
}

interface PresenceState {
  attempt: number | null;
  greeted: boolean;
  closed: boolean;
}

export const racePresenceRule: RadioRule<PresenceState> = {
  id: 'racePresence',
  priority: 'summary',
  modes: ['race'],
  afterRace: true,
  perRace: true,
  init: () => ({
    attempt: null,
    greeted: false,
    closed: false,
  }),
  evaluate(ctx, state) {
    const { frame, t } = ctx;
    const race = frame.race;
    if (race?.startedAt === undefined) return [];
    if (!ctx.audio || frame.flags?.loadingOrProcessing) return [];
    if (state.attempt !== race.startedAt) {
      Object.assign(state, racePresenceRule.init(), { attempt: race.startedAt });
      for (const call of ctx.recentSpoken) {
        if (call.ruleId !== racePresenceRule.id || call.evidence?.attempt !== race.startedAt)
          continue;
        if (call.key === 'result') state.closed = true;
        else state.greeted = true;
      }
    }
    if (race.state === 'finished') {
      const finish = race.chequered ?? race.result;
      if (!finish || t - finish.at >= FINISH_CALL_WINDOW_MS || state.closed) return [];
      const position = finish.position;
      const positionCall =
        position !== null && position >= 1 && position <= MAX_RADIO_POSITION
          ? positionSegment(position)
          : null;
      const recovered = (finish.gainedOnFinalLap ?? 0) > 0;
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
          evidence: { attempt: race.startedAt, position, recovered, crossedAt: finish.at },
          urgent: true,
        },
      ];
    }

    if (state.greeted || frame.stint?.inPits || frame.pitTyreChange) return [];
    const beforeLine = frame.lap.lap <= 0 && t - race.startedAt < GREETING_WINDOW_MS;
    const atLine =
      frame.lap.lap === 1 &&
      frame.lap.currentLapMs <= START_LINE_WINDOW_MS &&
      (ctx.lineCrossed || (frame.lap.currentLapValid && t - race.startedAt < GREETING_WINDOW_MS));
    if (!beforeLine && !atLine) return [];
    return [
      {
        key: 'start',
        utterance: RACE_HELLO,
        label: RACE_HELLO,
        evidence: { attempt: race.startedAt },
        priority: 'strategy',
      },
    ];
  },
  delivered(candidate, state, _ctx, outcome) {
    if (outcome !== 'spoken') return;
    if (candidate.key === 'result') state.closed = true;
    else state.greeted = true;
  },
};
