/**
 * Corner calls of the Treino mode: whether a fixed braking/pedal phrase still fits before the
 * action point (engineerCall) and what the panel shows (engineerDisplay). Pure; used by the radio
 * corner-cue rule and by the web HUD.
 */

import { BRAKE_ON_THRESHOLD } from '../analysis.ts';
import type { EngineerCue, EngineerCueKind, LiveCar } from '../live.ts';
import {
  ACTION_WORDS,
  BRAKE_MARKS,
  BRAKE_NOW,
  BRAKE_WORDS,
  detailedBrakeUtterance,
  ptNumber,
  type RadioUtterance,
  utteranceKeys,
} from './phrases.ts';

/** On-screen label and a duration estimate; the spoken words live in radioPhrases.ts. */
const WORDS: Record<EngineerCueKind, { label: string; phrase: string; ms: number }> = {
  brake: { label: 'Freio', phrase: BRAKE_WORDS.brake, ms: 460 },
  brakeHard: { label: 'Freio forte', phrase: BRAKE_WORDS.brakeHard, ms: 760 },
  brakeLight: { label: 'Freio leve', phrase: BRAKE_WORDS.brakeLight, ms: 930 },
  release: { label: 'Solte o freio', phrase: ACTION_WORDS.release, ms: 840 },
  releaseSmooth: {
    label: 'Solte o freio aos poucos',
    phrase: ACTION_WORDS.releaseSmooth,
    ms: 1120,
  },
  coast: { label: 'Deixe rolar', phrase: ACTION_WORDS.coast, ms: 810 },
  throttle: { label: 'Volte ao acelerador', phrase: ACTION_WORDS.throttle, ms: 1080 },
  throttleSmooth: {
    label: 'Acelere progressivamente',
    phrase: ACTION_WORDS.throttleSmooth,
    ms: 950,
  },
};

const MARKS = BRAKE_MARKS.map((meters) => [meters, ptNumber(meters)] as const);

/**
 * Driver reaction time (ms) kept between the end of a call and its action point: the call is
 * planned from the distance, the current speed, the phrase duration and this reaction time.
 */
export const REACTION_MS = 350;

export function isBrakeCue(kind: EngineerCueKind): boolean {
  return kind === 'brake' || kind === 'brakeHard' || kind === 'brakeLight';
}

export interface EngineerCall {
  id: string;
  text: string;
  utterance: RadioUtterance;
  brake: boolean;
  expiresInMs: number;
}

function brakeTargetPercent(cue: EngineerCue): number | null {
  const peak = cue.brakePeak;
  if (peak === undefined || !(peak >= BRAKE_ON_THRESHOLD && peak <= 1)) return null;
  return Math.max(10, Math.round(peak * 10) * 10);
}

/** Determine whether a fixed phrase still fits before the action or the end of the zone. */
export function engineerCall(
  cue: EngineerCue,
  car: LiveCar,
  estimate: (utterance: RadioUtterance, ms: number) => number,
  anticipationMs = 0,
  useBrakePercent = false,
): EngineerCall | null {
  const speed = car.speedKmh / 3.6;
  if (speed < 8 || cue.aheadM < 0) return null;
  const eta = (cue.aheadM / speed) * 1000;
  const brake = car.brakeRaw ?? car.brake;
  const throttle = car.throttleRaw ?? car.throttle;
  const words = WORDS[cue.kind];
  const call = (
    utterance: RadioUtterance,
    expiresInMs: number,
    braking: boolean,
  ): EngineerCall => ({
    id: cue.id,
    text: utteranceKeys(utterance).join(' '),
    utterance,
    expiresInMs,
    brake: braking,
  });

  if (isBrakeCue(cue.kind)) {
    if (brake >= BRAKE_ON_THRESHOLD) return null;
    const reserve = REACTION_MS + anticipationMs;
    const budget = eta - reserve;
    const percent = useBrakePercent ? brakeTargetPercent(cue) : null;
    if (percent !== null) {
      for (const [meters] of MARKS) {
        if (cue.aheadM < meters - Math.max(4, speed * 0.13)) continue;
        const utterance = detailedBrakeUtterance(percent, meters);
        const duration = estimate(utterance, 2500);
        if ((meters / speed) * 1000 < duration + reserve) continue;
        if (cue.aheadM > meters) return null;
        if (budget >= duration) return call(utterance, budget, true);
      }
    }
    for (const [meters, spoken] of MARKS) {
      const text = `${words.phrase} em ${spoken}.`;
      const duration = estimate(text, words.ms + spoken.length * 50 + 380);
      if (
        cue.aheadM < meters - Math.max(4, speed * 0.13) ||
        (meters / speed) * 1000 < duration + reserve
      )
        continue;
      if (cue.aheadM > meters) break;
      if (budget >= duration) {
        return call(text, budget, true);
      }
    }
    const text = BRAKE_NOW;
    return eta <= 950 && eta - 150 >= estimate(text, 500) ? call(text, eta - 150, true) : null;
  }

  if (eta > 750 + anticipationMs) return null;
  const release = cue.kind === 'release' || cue.kind === 'releaseSmooth';
  if (release && brake < BRAKE_ON_THRESHOLD) return null;
  if (!release && throttle >= 0.1) return null;
  if (cue.kind === 'coast' && brake >= 0.15) return null;
  if (cue.kind !== 'coast' && !release && brake >= BRAKE_ON_THRESHOLD) return null;
  const text = `${words.phrase}.`;
  // The verb comes first. Aim to start just before the point and finish during the action.
  const budget = cue.endAheadM === undefined ? eta + 750 : (cue.endAheadM / speed) * 1000;
  return budget >= estimate(text, words.ms + 130) ? call(text, budget, false) : null;
}

export function engineerDisplay(
  cues: readonly EngineerCue[],
  car: LiveCar,
  useBrakePercent = false,
) {
  const speed = car.speedKmh / 3.6;
  const brake = car.brakeRaw ?? car.brake;
  const throttle = car.throttleRaw ?? car.throttle;
  const approaching = cues
    .filter((c) => isBrakeCue(c.kind) && c.aheadM >= -8 && c.aheadM <= Math.max(50, speed * 4.5))
    .sort((a, b) => a.aheadM - b.aheadM)[0];
  const braking = approaching && brake < BRAKE_ON_THRESHOLD;
  const action = cues
    .filter((c) => {
      if (isBrakeCue(c.kind) || c.aheadM > speed * 0.6 || (c.endAheadM ?? c.aheadM + 12) < 0)
        return false;
      if (c.kind === 'release' || c.kind === 'releaseSmooth') return brake >= BRAKE_ON_THRESHOLD;
      if (c.kind === 'coast') return throttle < 0.1;
      return brake < BRAKE_ON_THRESHOLD && throttle < 0.1;
    })
    .sort((a, b) => b.aheadM - a.aheadM)[0];
  const cue = braking && (!action || approaching.aheadM <= speed * 1.1) ? approaching : action;
  if (!cue) return null;
  const isBraking = isBrakeCue(cue.kind);
  const percent = isBraking && useBrakePercent ? brakeTargetPercent(cue) : null;
  return {
    kind: cue.kind,
    label:
      percent !== null
        ? `Freio · ${percent}%`
        : isBraking && cue.aheadM <= 0
          ? 'Freie'
          : WORDS[cue.kind].label,
    meters: isBraking && cue.aheadM > 0 ? Math.ceil(cue.aheadM / 5) * 5 : null,
  };
}
