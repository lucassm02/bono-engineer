/**
 * Radio rules of delivery step 2: car alerts (tyres, fuel), the Classificação lap result and the
 * Aprender pista corner calls (the other Treino rules live in coaching.ts). Each rule confirms
 * its condition (tolerance, persistence, hysteresis) and returns candidates; the scheduler
 * (engine.ts) chooses, times and logs them.
 */

import type { LiveCornerPass } from '../live.ts';
import { engineerCall, isBrakeCue, REACTION_MS } from './cues.ts';
import { fuelProjection } from './fuel.ts';
import {
  cornerSegment,
  FUEL_LAPS,
  FUEL_SHORT,
  type FuelLapsLeft,
  gearSegment,
  lapDeltaUtterance,
  MAX_CORNER,
  type RadioUtterance,
  TYRES_COLD,
  TYRES_HOT,
  TYRES_OK,
} from './phrases.ts';
import type { RadioCandidate, RadioRule, RadioRuleContext } from './types.ts';
import { isTyreScaleUsable, tyreTempsLabel } from './tyres.ts';

/** Minimum speed (km/h) for the tyre conditions to count (not crawling in the pits). */
export const TYRE_MIN_SPEED_KMH = 30;
/** Cold must persist this long before the warning. */
export const TYRE_COLD_PERSIST_MS = 3000;
/** Hysteresis (°C) around the bottom of the ideal window. */
export const TYRE_COLD_HYSTERESIS_C = 2;
/** All wheels in range for this long before "Pneus na faixa". */
export const TYRE_OK_STABLE_MS = 5000;
/** "Pneus na faixa" is only worth saying shortly after the stabilization. */
export const TYRE_OK_VALID_MS = 20000;
/** Stopped this long (pits, garage) → the next run is a new warm-up. */
export const TYRE_REARM_STOPPED_MS = 15000;
export const TYRE_HOT_PERSIST_MS = 20000;
export const TYRE_HOT_HYSTERESIS_C = 8;
export const TYRE_HOT_CLEAR_MS = 10000;
export const TYRE_HOT_INTERVAL_MS = 180000;
/** Fuel margin (L) for the "not enough to finish" hysteresis. */
export const FUEL_MARGIN_L = 0.5;
export const FUEL_CONFIRM_MS = 3000;
/** Laps above a band before a refuel re-arms the autonomy calls. */
export const FUEL_REARM_LAPS = 0.3;
/** Lap counter to lap time: how long to wait for the closed lap time. */
export const LAP_TIME_WAIT_MS = 2000;
/** The lap result is dropped when no free window comes in this time after the line. */
export const LAP_RESULT_MAX_AGE_MS = 20000;

const minOf = (values: readonly number[]) => Math.min(...values);
const maxOf = (values: readonly number[]) => Math.max(...values);
const round1 = (n: number) => Math.round(n * 10) / 10;

function tyreRangeTrusted(ctx: RadioRuleContext): boolean {
  return ctx.config.tyreScaleValidated && isTyreScaleUsable(ctx.config.tyreScale);
}

// ---- Pneus frios / na faixa -------------------------------------------------------------------

interface WarmUpState {
  /** Inside a warm-up (context start or after a long stop). */
  armed: boolean;
  cold: boolean;
  coldSince: number | null;
  warned: boolean;
  okSince: number | null;
  stoppedSince: number | null;
  valuesShown: boolean;
}

/**
 * After the session starts (or after a long stop), warn once when the coldest wheel stays below
 * the ideal window; optional "Pneus na faixa" (Detalhado) once every wheel is stable in range.
 * Without a trusted range only the values go to the panel.
 */
export const tyresWarmUpRule: RadioRule<WarmUpState> = {
  id: 'tyresWarmUp',
  priority: 'instruction',
  modes: ['training', 'qualifying', 'race'],
  carAlert: true,
  requires: ['tyreTemps'],
  init: () => ({
    armed: true,
    cold: false,
    coldSince: null,
    warned: false,
    okSince: null,
    stoppedSince: null,
    valuesShown: false,
  }),
  evaluate(ctx, s) {
    const { frame, t } = ctx;
    const speed = frame.car.speedKmh;
    if (speed < 5) s.stoppedSince ??= t;
    else {
      if (s.stoppedSince !== null && t - s.stoppedSince >= TYRE_REARM_STOPPED_MS) {
        Object.assign(s, tyresWarmUpRule.init(), { stoppedSince: null });
      }
      s.stoppedSince = null;
    }
    if (!s.armed) return [];

    const temps = frame.tyres.tempC;
    const scale = ctx.config.tyreScale;
    const coldest = minOf(temps);
    s.cold = s.cold
      ? coldest < scale.idealMin + TYRE_COLD_HYSTERESIS_C
      : coldest < scale.idealMin - TYRE_COLD_HYSTERESIS_C;
    const evidence = {
      coldestC: round1(coldest),
      idealMinC: scale.idealMin,
      tempsC: temps.map(Math.round).join('/'),
    };

    if (s.cold) {
      s.okSince = null;
      if (speed < TYRE_MIN_SPEED_KMH) return [];
      s.coldSince ??= t;
      if (s.warned || t - s.coldSince < TYRE_COLD_PERSIST_MS) return [];
      if (!tyreRangeTrusted(ctx)) {
        return s.valuesShown
          ? []
          : [
              {
                key: 'values',
                utterance: TYRES_COLD,
                label: `Pneus ${tyreTempsLabel(temps)} · faixa não validada`,
                evidence,
                panelOnly: true,
              },
            ];
      }
      return [
        {
          key: 'cold',
          utterance: TYRES_COLD,
          label: `Pneus frios · ${tyreTempsLabel(temps)}`,
          evidence: { ...evidence, coldForMs: t - s.coldSince },
          needsFreeWindow: true,
        },
      ];
    }

    s.coldSince = null;
    if (!s.warned) {
      // Reached the range before any warning: the warm-up is over, nothing to say.
      if (speed >= TYRE_MIN_SPEED_KMH) s.armed = false;
      return [];
    }
    s.okSince ??= t;
    const stable = t - s.okSince;
    if (stable > TYRE_OK_STABLE_MS + TYRE_OK_VALID_MS) {
      s.armed = false;
      return [];
    }
    if (stable < TYRE_OK_STABLE_MS || !tyreRangeTrusted(ctx)) return [];
    return [
      {
        key: 'ok',
        utterance: TYRES_OK,
        label: `Pneus na faixa · ${tyreTempsLabel(temps)}`,
        evidence: { ...evidence, stableForMs: stable },
        priority: 'feedback',
        level: 'detailed',
        needsFreeWindow: true,
      },
    ];
  },
  delivered(candidate, s) {
    if (candidate.key === 'cold') s.warned = true;
    else if (candidate.key === 'values') s.valuesShown = true;
    else if (candidate.key === 'ok') s.armed = false;
  },
  interrupt(s) {
    s.coldSince = null;
    s.okSince = null;
  },
};

// ---- Pneus quentes ----------------------------------------------------------------------------

interface HotState {
  hotSince: number | null;
  coolSince: number | null;
  episode: boolean;
  warned: boolean;
}

/** Warn once per episode when the hottest wheel stays at/above the "hot" end of the scale. */
export const tyresHotRule: RadioRule<HotState> = {
  id: 'tyresHot',
  priority: 'strategy',
  modes: ['training', 'qualifying', 'race'],
  carAlert: true,
  requires: ['tyreTemps'],
  intervalMs: TYRE_HOT_INTERVAL_MS,
  init: () => ({ hotSince: null, coolSince: null, episode: false, warned: false }),
  evaluate(ctx, s) {
    if (!tyreRangeTrusted(ctx)) return [];
    const { frame, t } = ctx;
    const temps = frame.tyres.tempC;
    const hottest = maxOf(temps);
    const { hot } = ctx.config.tyreScale;
    if (!s.episode) {
      if (hottest >= hot && frame.car.speedKmh >= TYRE_MIN_SPEED_KMH) {
        s.hotSince ??= t;
        if (t - s.hotSince >= TYRE_HOT_PERSIST_MS) {
          s.episode = true;
          s.warned = false;
        }
      } else if (hottest < hot) s.hotSince = null;
    } else if (hottest < hot - TYRE_HOT_HYSTERESIS_C) {
      s.coolSince ??= t;
      if (t - s.coolSince >= TYRE_HOT_CLEAR_MS) {
        s.episode = false;
        s.hotSince = null;
        s.coolSince = null;
      }
    } else s.coolSince = null;
    if (!s.episode || s.warned) return [];
    return [
      {
        key: 'hot',
        utterance: TYRES_HOT,
        label: `Pneus quentes · ${tyreTempsLabel(temps)}`,
        evidence: { hottestC: round1(hottest), hotC: hot, tempsC: temps.map(Math.round).join('/') },
        needsFreeWindow: true,
      },
    ];
  },
  delivered(_candidate, s) {
    s.warned = true;
  },
  interrupt(s) {
    if (!s.episode) s.hotSince = null;
    s.coolSince = null;
  },
};

// ---- Combustível ------------------------------------------------------------------------------

interface FuelState {
  short: boolean;
  shortSince: number | null;
  saidShort: boolean;
  /** Lowest autonomy band already announced (whole laps), null = none yet. */
  band: number | null;
  pendingBand: number | null;
  bandSince: number | null;
}

/**
 * With the race length: "falta combustível para terminar" when the projection goes short
 * (hysteresis ±FUEL_MARGIN_L). Without it: autonomy calls when it drops to 2, 1 and < 1 lap.
 * Suppressed without a reliable consumption sample (e.g. Sport Mode time trial).
 */
export const fuelRule: RadioRule<FuelState> = {
  id: 'fuel',
  priority: 'strategy',
  modes: ['training', 'qualifying', 'race'],
  carAlert: true,
  requires: ['fuel'],
  init: () => ({
    short: false,
    shortSince: null,
    saidShort: false,
    band: null,
    pendingBand: null,
    bandSince: null,
  }),
  evaluate(ctx, s) {
    const { frame, t } = ctx;
    const p = fuelProjection(frame.fuel, frame.lap, frame.lapFraction);
    if (p.perLap === null) return [];
    const evidence = {
      levelL: round1(p.level),
      perLapL: Math.round(p.perLap * 100) / 100,
      lapsOfFuel: p.lapsOfFuel === null ? null : round1(p.lapsOfFuel),
      raceLapsLeft: p.raceLapsLeft === null ? null : round1(p.raceLapsLeft),
      neededL: p.needed === null ? null : round1(p.needed),
    };

    if (p.raceLapsLeft !== null && p.needed !== null) {
      const margin = p.level - p.needed;
      if (s.short ? margin > FUEL_MARGIN_L : margin < -FUEL_MARGIN_L) {
        s.short = !s.short;
        s.shortSince = s.short ? t : null;
        if (!s.short) s.saidShort = false;
      }
      if (!s.short || s.saidShort || s.shortSince === null) return [];
      if (t - s.shortSince < FUEL_CONFIRM_MS) return [];
      const save = p.savePerLap === null ? '' : ` · economize ${p.savePerLap.toFixed(2)} L/volta`;
      return [
        {
          key: 'short',
          utterance: FUEL_SHORT,
          label: `Combustível: faltam ${(p.missing ?? 0).toFixed(1)} L${save}`,
          evidence: { ...evidence, missingL: round1(p.missing ?? 0) },
          needsFreeWindow: true,
        },
      ];
    }

    // Race length unknown: autonomy only.
    if (p.lapsOfFuel === null) return [];
    const band = Math.max(0, Math.min(3, Math.floor(p.lapsOfFuel)));
    if (s.band !== null && p.lapsOfFuel >= s.band + 1 + FUEL_REARM_LAPS) {
      s.band = null; // refuelled
    }
    const announce = band <= 2 && (s.band === null || band < s.band);
    if (!announce) {
      s.pendingBand = null;
      s.bandSince = null;
      return [];
    }
    if (s.pendingBand !== band) {
      s.pendingBand = band;
      s.bandSince = t;
    }
    if (s.bandSince === null || t - s.bandSince < FUEL_CONFIRM_MS) return [];
    return [
      {
        key: `laps-${band}`,
        utterance: FUEL_LAPS[band as FuelLapsLeft],
        label: `Autonomia: ${p.lapsOfFuel.toFixed(1)} volta${p.lapsOfFuel >= 2 ? 's' : ''}`,
        evidence,
        priority: band === 0 ? 'critical' : 'strategy',
        needsFreeWindow: band > 0,
      },
    ];
  },
  delivered(candidate, s) {
    if (candidate.key === 'short') s.saidShort = true;
    else {
      s.band = Number(candidate.key.slice('laps-'.length));
      s.pendingBand = null;
      s.bandSince = null;
    }
  },
  interrupt(s) {
    if (s.short && !s.saidShort) s.shortSince = null;
    s.pendingBand = null;
    s.bandSince = null;
  },
};

// ---- Resultado da volta (Classificação) -------------------------------------------------------

interface LapResultState {
  closing: {
    at: number;
    lap: number;
    valid: boolean;
    bestBefore: number | null;
    lastBefore: number | null;
  } | null;
  result: RadioCandidate | null;
  expiresT: number;
}

export function formatLapMs(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function lapResult(closing: NonNullable<LapResultState['closing']>, lapMs: number): RadioCandidate {
  const key = `lap-${closing.lap}`;
  const evidence = {
    lap: closing.lap,
    lapMs,
    bestBeforeMs: closing.bestBefore,
    valid: closing.valid,
  };
  if (!closing.valid)
    return {
      key,
      utterance: [],
      label: `Volta ${formatLapMs(lapMs)} · inválida`,
      evidence,
      panelOnly: true,
    };
  if (closing.bestBefore === null)
    return { key, utterance: [], label: `Volta ${formatLapMs(lapMs)}`, evidence, panelOnly: true };
  const gainMs = closing.bestBefore - lapMs;
  const sign = gainMs > 0 ? '−' : '+';
  return {
    key,
    utterance: lapDeltaUtterance(gainMs / 100),
    label: `Volta ${formatLapMs(lapMs)} · ${sign}${(Math.abs(gainMs) / 1000).toFixed(3).replace('.', ',')} s`,
    evidence: { ...evidence, gainMs },
    needsFreeWindow: true,
    postLine: true,
  };
}

/**
 * After the line, the gain against the best lap before it ("Melhorou dois décimos"), in the first
 * free window. Invalid laps and the first timed lap go to the panel only.
 */
export const lapResultRule: RadioRule<LapResultState> = {
  id: 'lapResult',
  priority: 'feedback',
  modes: ['qualifying'],
  requires: ['lapTiming'],
  init: () => ({ closing: null, result: null, expiresT: 0 }),
  evaluate(ctx, s) {
    const { frame, previous, t } = ctx;
    if (ctx.lineCrossed && previous && previous.lap.lap >= 1) {
      s.closing = {
        at: t,
        lap: previous.lap.lap,
        valid: previous.lap.currentLapValid === true,
        bestBefore: previous.lap.bestLapMs,
        lastBefore: previous.lap.lastLapMs,
      };
      s.result = null;
    }
    const closing = s.closing;
    if (closing) {
      const last = frame.lap.lastLapMs;
      const fresh = last !== null && last !== closing.lastBefore;
      if (fresh || t - closing.at >= LAP_TIME_WAIT_MS) {
        s.closing = null;
        if (last !== null) {
          s.result = lapResult(closing, last);
          s.expiresT = closing.at + LAP_RESULT_MAX_AGE_MS;
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

// ---- Chamadas de curva (Treino) ---------------------------------------------------------------

/** Corner number of a track corner id ("T4" → 4), null when it has no spoken segment. */
export function cornerNumber(cornerId: string | null | undefined): number | null {
  const m = cornerId ? /^T(\d+)$/.exec(cornerId) : null;
  const n = m ? Number(m[1]) : Number.NaN;
  return n >= 1 && n <= MAX_CORNER ? n : null;
}

/** Brake point within this of the reference counts as right (m); replay reference: the second. */
export const LEARN_BRAKE_TOLERANCE_M = 10;
export const LEARN_BRAKE_TOLERANCE_REPLAY_M = 15;
/** Consecutive right passes after which the corner help is reduced. */
export const LEARN_MASTERED_STREAK = 3;
/** A mastered corner still gets its call every this many passes. */
export const LEARN_MASTERED_EVERY = 3;
/** The gear call is not said earlier than this before the brake point (ms). */
export const LEARN_GEAR_LEAD_MS = 6000;

const gearMissed = (pass: LiveCornerPass) =>
  pass.gearAtApex !== null &&
  pass.referenceGearAtApex !== null &&
  pass.gearAtApex !== pass.referenceGearAtApex;

/**
 * Whether a pass was right for Aprender pista: brake point within the tolerance of the reference
 * and the reference gear at the apex. Null when it cannot be judged (no reference brake point).
 */
export function learnPassRight(pass: LiveCornerPass): boolean | null {
  if (pass.referenceBrakePointM === null || pass.timeLostMs === null) return null;
  if (pass.brakePointM === null) return false;
  const tolerance = pass.referenceIsReplay
    ? LEARN_BRAKE_TOLERANCE_REPLAY_M
    : LEARN_BRAKE_TOLERANCE_M;
  const brakeRight = Math.abs(pass.brakePointM - pass.referenceBrakePointM) <= tolerance;
  return brakeRight && !gearMissed(pass);
}

interface LearnCorner {
  streak: number;
  mastered: boolean;
  masteredPasses: number;
  /** Reference gear to call on the next pass (the last pass missed only the gear). */
  gearNext: number | null;
}

interface CornerCuesState {
  spoken: Set<string>;
  corners: Map<string, LearnCorner>;
  /** Decision for each corner pass: call, gear call first, or skipped (mastered corner). */
  passMode: Map<string, 'call' | 'gear' | 'skip'>;
  gearDone: Set<string>;
}

const CUE_LABELS: Record<string, string> = {
  brake: 'Freio',
  brakeHard: 'Freio forte',
  brakeLight: 'Freio leve',
  release: 'Solte o freio',
  releaseSmooth: 'Solte o freio aos poucos',
  coast: 'Deixe rolar',
  throttle: 'Volte ao acelerador',
  throttleSmooth: 'Acelere progressivamente',
};

/**
 * Aprender pista: the reference braking/pedal calls, one instruction at a time per corner pass,
 * planned from the distance, the current speed, the phrase duration and the reaction time
 * (engineerCall); a call that would end too late is never started and a pending one is dropped.
 * Without a validated landmark model the brake call uses the distance ("Freio em duzentos") or
 * the short command ("Freia."), never "na placa".
 *
 * After LEARN_MASTERED_STREAK right passes (brake point and gear, see learnPassRight) the corner
 * is called only every LEARN_MASTERED_EVERY passes; a miss brings the help back, and the corners
 * in `env.assistCornerIds` always keep it. When the last pass missed only the gear, the next
 * instruction is the gear ("Na T4 · Terceira marcha."). Essencial keeps the main braking calls.
 */
export const cornerCuesRule: RadioRule<CornerCuesState> = {
  id: 'cornerCues',
  priority: 'instruction',
  modes: ['training'],
  profiles: ['learnTrack'],
  requires: ['cues', 'progress'],
  init: () => ({
    spoken: new Set<string>(),
    corners: new Map(),
    passMode: new Map(),
    gearDone: new Set(),
  }),
  evaluate(ctx, s) {
    const { frame, t } = ctx;
    const out: RadioCandidate[] = [];
    for (const pass of ctx.passes) {
      const right = learnPassRight(pass);
      if (right === null) continue;
      const c = s.corners.get(pass.cornerId) ?? {
        streak: 0,
        mastered: false,
        masteredPasses: 0,
        gearNext: null,
      };
      s.corners.set(pass.cornerId, c);
      c.streak = right ? c.streak + 1 : 0;
      c.gearNext =
        !right && gearMissed(pass) && pass.brakePointM !== null ? pass.referenceGearAtApex : null;
      if (!right) {
        c.mastered = false;
        c.masteredPasses = 0;
      } else if (c.streak >= LEARN_MASTERED_STREAK && !c.mastered) {
        c.mastered = true;
        c.masteredPasses = 0;
        out.push({
          key: `mastered:${pass.id}`,
          utterance: [],
          label: `${pass.cornerId} acertada ${c.streak} vezes · ajuda reduzida`,
          evidence: { cornerId: pass.cornerId, streak: c.streak },
          panelOnly: true,
        });
      }
    }
    const engineer = frame.engineer;
    if (engineer?.status !== 'ready') return out;
    const ids = new Set(engineer.cues.map((cue) => cue.id));
    for (const id of s.spoken) if (!ids.has(id)) s.spoken.delete(id);
    const passKey = (cornerId: string) => `${frame.lap.startedAt ?? frame.lap.lap}|${cornerId}`;
    const modeOf = (cornerId: string) => {
      const key = passKey(cornerId);
      let mode = s.passMode.get(key);
      if (mode) return mode;
      const c = s.corners.get(cornerId);
      const help = c?.gearNext ? 'gear' : 'call';
      if (!c?.mastered || ctx.assist.has(cornerId)) mode = help;
      else mode = ++c.masteredPasses % LEARN_MASTERED_EVERY === 0 ? help : 'skip';
      s.passMode.set(key, mode);
      if (s.passMode.size > 64) s.passMode.delete(s.passMode.keys().next().value!);
      return mode;
    };

    const car = frame.car;
    const speed = car.speedKmh / 3.6;
    const imminentBrake = ctx.cues.some(
      (c) => isBrakeCue(c.kind) && c.aheadM >= 0 && c.aheadM < speed,
    );
    const detailed = ctx.config.speechLevel === 'detailed';
    const estimate = (u: RadioUtterance) => ctx.utteranceMs(u) ?? Number.POSITIVE_INFINITY;
    const gearCorners = new Set<string>();
    for (const cue of ctx.cues) {
      if (!cue.cornerId || !isBrakeCue(cue.kind) || modeOf(cue.cornerId) !== 'gear') continue;
      const key = passKey(cue.cornerId);
      const gear = s.corners.get(cue.cornerId)?.gearNext;
      if (!gear || s.gearDone.has(key) || speed < 8 || cue.aheadM < 0) continue;
      const n = cornerNumber(cue.cornerId);
      const utterance = n ? [cornerSegment(n), gearSegment(gear)] : gearSegment(gear);
      const eta = (cue.aheadM / speed) * 1000;
      const budget = eta - REACTION_MS - ctx.config.anticipationMs;
      if (eta - ctx.outputLatencyMs > LEARN_GEAR_LEAD_MS) continue;
      if (budget < estimate(utterance) + ctx.outputLatencyMs) {
        s.gearDone.add(key); // no longer fits: back to the brake call
        continue;
      }
      gearCorners.add(cue.cornerId);
      out.push({
        key: `gear:${key}`,
        cornerId: cue.cornerId,
        utterance,
        label: `${cue.cornerId} · ${gear}ª marcha`,
        evidence: { gear, aheadM: Math.round(cue.aheadM), speedKmh: Math.round(car.speedKmh) },
        urgent: true,
        deadlineT: t + budget,
      });
    }
    for (const cue of ctx.cues) {
      if (s.spoken.has(cue.id) || (imminentBrake && !isBrakeCue(cue.kind))) continue;
      if (!detailed && !isBrakeCue(cue.kind)) continue;
      if (cue.cornerId && (gearCorners.has(cue.cornerId) || modeOf(cue.cornerId) === 'skip'))
        continue;
      const call = engineerCall(
        cue,
        car,
        estimate,
        ctx.config.anticipationMs,
        ctx.config.learningBrakePercent,
        ctx.outputLatencyMs,
        ctx.approachSpeedKmh,
      );
      if (!call) continue;
      out.push({
        key: cue.id,
        cueId: cue.id,
        ...(cue.cornerId ? { cornerId: cue.cornerId } : {}),
        utterance: call.utterance,
        label: typeof call.utterance === 'string' ? (CUE_LABELS[cue.kind] ?? call.text) : call.text,
        evidence: {
          kind: cue.kind,
          aheadM: Math.round(cue.aheadM),
          speedKmh: Math.round(car.speedKmh),
        },
        urgent: call.brake,
        deadlineT: t + call.expiresInMs,
      });
    }
    return out;
  },
  delivered(candidate, s) {
    if (candidate.cueId) s.spoken.add(candidate.cueId);
    if (candidate.key.startsWith('gear:')) s.gearDone.add(candidate.key.slice('gear:'.length));
  },
};

/**
 * Aprender pista without a compatible reference: no brake point is announced (the corner calls
 * need the cues of a compatible reference) and the panel asks for a first valid lap, once per
 * episode.
 */
export const learnReferenceRule: RadioRule<{ shown: boolean }> = {
  id: 'learnReference',
  priority: 'instruction',
  modes: ['training'],
  profiles: ['learnTrack'],
  init: () => ({ shown: false }),
  evaluate(ctx, s) {
    const status = ctx.frame.engineer?.status;
    if (status === 'ready') s.shown = false;
    if (s.shown || (status !== 'waitingReference' && status !== 'incompatible')) return [];
    return [
      {
        key: 'no-reference',
        utterance: [],
        label:
          status === 'incompatible'
            ? 'Referência de outro carro ou traçado · faça uma primeira volta válida'
            : 'Sem referência compatível · faça uma primeira volta válida',
        evidence: { status },
        panelOnly: true,
      },
    ];
  },
  delivered(_candidate, s) {
    s.shown = true;
  },
};
