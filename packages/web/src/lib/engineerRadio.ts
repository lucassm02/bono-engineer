import {
  BRAKE_ON_THRESHOLD,
  type EngineerCue,
  type EngineerCueKind,
  type LiveCar,
} from '@gt7/shared';

const WORDS: Record<EngineerCueKind, { label: string; phrase: string; ms: number }> = {
  brake: { label: 'Freio', phrase: 'Freio', ms: 460 },
  brakeHard: { label: 'Freio forte', phrase: 'Freada forte', ms: 760 },
  brakeLight: { label: 'Freio leve', phrase: 'Toque no freio', ms: 930 },
  release: { label: 'Solte o freio', phrase: 'Solta o freio', ms: 840 },
  releaseSmooth: { label: 'Solte o freio aos poucos', phrase: 'Vai soltando o freio', ms: 1120 },
  coast: { label: 'Deixe rolar', phrase: 'Deixa rolar', ms: 810 },
  throttle: { label: 'Volte ao acelerador', phrase: 'Volta no acelerador', ms: 1080 },
  throttleSmooth: {
    label: 'Acelere progressivamente',
    phrase: 'Acelera, suave',
    ms: 950,
  },
};

const MARKS = [
  [50, 'cinquenta'],
  [100, 'cem'],
  [150, 'cento e cinquenta'],
  [200, 'duzentos'],
  [250, 'duzentos e cinquenta'],
  [300, 'trezentos'],
] as const;

export const ENGINEER_PREVIEW = 'Freada forte em duzentos.';
export const ENGINEER_PHRASES = [
  ...(['brake', 'brakeHard', 'brakeLight'] as const).flatMap((kind) =>
    MARKS.map(([, meters]) => `${WORDS[kind].phrase} em ${meters}.`),
  ),
  ...(['release', 'releaseSmooth', 'coast', 'throttle', 'throttleSmooth'] as const).map(
    (kind) => `${WORDS[kind].phrase}.`,
  ),
  'Freia.',
];

export function isBrake(kind: EngineerCueKind): boolean {
  return kind === 'brake' || kind === 'brakeHard' || kind === 'brakeLight';
}

export interface EngineerCall {
  id: string;
  text: string;
  brake: boolean;
  expiresInMs: number;
}

/** Determine whether a fixed phrase still fits before the action or the end of the zone. */
export function engineerCall(
  cue: EngineerCue,
  car: LiveCar,
  estimate: (text: string, ms: number) => number,
  anticipationMs = 0,
): EngineerCall | null {
  const speed = car.speedKmh / 3.6;
  if (speed < 8 || cue.aheadM < 0) return null;
  const eta = (cue.aheadM / speed) * 1000;
  const brake = car.brakeRaw ?? car.brake;
  const throttle = car.throttleRaw ?? car.throttle;
  const words = WORDS[cue.kind];
  const call = (text: string, expiresInMs: number, braking: boolean): EngineerCall => ({
    id: cue.id,
    text,
    expiresInMs,
    brake: braking,
  });

  if (isBrake(cue.kind)) {
    if (brake >= BRAKE_ON_THRESHOLD) return null;
    for (const [meters, spoken] of MARKS) {
      const text = `${words.phrase} em ${spoken}.`;
      const duration = estimate(text, words.ms + spoken.length * 50 + 380);
      const reserve = 350 + anticipationMs;
      if (
        cue.aheadM < meters - Math.max(4, speed * 0.13) ||
        (meters / speed) * 1000 < duration + reserve
      )
        continue;
      if (cue.aheadM > meters) break;
      const budget = eta - 350 - anticipationMs;
      if (budget >= duration) {
        return call(text, budget, true);
      }
    }
    const text = 'Freia.';
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

export function engineerDisplay(cues: readonly EngineerCue[], car: LiveCar) {
  const speed = car.speedKmh / 3.6;
  const brake = car.brakeRaw ?? car.brake;
  const throttle = car.throttleRaw ?? car.throttle;
  const approaching = cues
    .filter((c) => isBrake(c.kind) && c.aheadM >= -8 && c.aheadM <= Math.max(50, speed * 4.5))
    .sort((a, b) => a.aheadM - b.aheadM)[0];
  const braking = approaching && brake < BRAKE_ON_THRESHOLD;
  const action = cues
    .filter((c) => {
      if (isBrake(c.kind) || c.aheadM > speed * 0.6 || (c.endAheadM ?? c.aheadM + 12) < 0)
        return false;
      if (c.kind === 'release' || c.kind === 'releaseSmooth') return brake >= BRAKE_ON_THRESHOLD;
      if (c.kind === 'coast') return throttle < 0.1;
      return brake < BRAKE_ON_THRESHOLD && throttle < 0.1;
    })
    .sort((a, b) => b.aheadM - a.aheadM)[0];
  const cue = braking && (!action || approaching.aheadM <= speed * 1.1) ? approaching : action;
  if (!cue) return null;
  const isBraking = isBrake(cue.kind);
  return {
    kind: cue.kind,
    label: isBraking && cue.aheadM <= 0 ? 'Freie' : WORDS[cue.kind].label,
    meters: isBraking && cue.aheadM > 0 ? Math.ceil(cue.aheadM / 5) * 5 : null,
  };
}
