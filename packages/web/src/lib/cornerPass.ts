/**
 * Client-side corner pass tracker for the "Treino de curva" view (pure).
 *
 * The core's `nextCorner` hint names the next corner and switches to the following one as soon as
 * the car passes the corner entry. A pass of corner C therefore has two phases:
 * - approach: C is the hint; we look for the brake onset (last brake episode starting within
 *   {@link BRAKE_WINDOW_M} before the entry);
 * - exit: the hint moved on; we keep tracking the minimum speed and the throttle pickup (first
 *   throttle ≥ 10 % after the V-min) until the car accelerates away, the next braking starts or the
 *   hint moves again.
 *
 * Distances are lap distances (m) as in the hint (`referenceBrakePointM` is a lap distance).
 * Internally they are unwrapped across the start line.
 */

import {
  BRAKE_ON_THRESHOLD,
  type CornerDirection,
  type NextCornerHint,
  THROTTLE_ON_THRESHOLD,
} from '@gt7/shared';
import { formatInt } from './format.ts';
import { lapDiff, wrapDistance } from './mapMath.ts';

/**
 * The live contract has no reference throttle-pickup target yet; a core/mock may add
 * `referenceThrottleOnM` (lap distance). Read defensively.
 */
export type CornerHintExt = NextCornerHint & { referenceThrottleOnM?: number | null };

export interface CornerTargets {
  brakeM: number | null;
  vminKmh: number | null;
  gear: number | null;
  throttleOnM: number | null;
}

export interface CornerPass {
  seq: number;
  cornerId: string;
  name: string | null;
  direction: CornerDirection;
  lengthM: number | null;
  /** Lap distance of the corner entry. */
  entryM: number;
  /** Lap distance where braking started, null = no braking. */
  brakeM: number | null;
  vminKmh: number;
  vminM: number;
  gearAtVmin: number;
  throttleOnM: number | null;
  ref: CornerTargets;
  /** Core's result for the previous pass of this corner (ms, + = slower), from the hint. */
  lastPassDeltaMs: number | null;
  /** Frame time (ms) when the pass completed. */
  completedAt: number;
}

export interface CornerFrameInput {
  /** Frame time (ms). */
  t: number;
  onTrack: boolean;
  distanceM: number | null;
  lengthM: number | null;
  speedKmh: number;
  brake: number;
  throttle: number;
  gear: number;
  hint: CornerHintExt | null;
}

/** Brake onsets further than this before the entry belong to something else. */
export const BRAKE_WINDOW_M = 350;
/** Brake off for longer than this starts a new brake episode. */
const BRAKE_GAP_MS = 400;
/** A distance jump larger than this (not a lap wrap) is a discontinuity. */
const JUMP_M = 120;

interface Open {
  cornerId: string;
  name: string | null;
  direction: CornerDirection;
  entryU: number;
  ref: CornerTargets;
  lastPassDeltaMs: number | null;
  brakeU: number | null;
  lastBrakeT: number | null;
  minActive: boolean;
  vmin: number;
  vminU: number;
  gear: number;
  throttleU: number | null;
  phase: 'approach' | 'exit';
}

export class CornerPassTracker {
  private approach: Open | null = null;
  private exiting: Open | null = null;
  private prevD: number | null = null;
  private offset = 0;
  private lengthM: number | null = null;
  private seq = 0;

  reset(): void {
    this.approach = null;
    this.exiting = null;
    this.prevD = null;
    this.offset = 0;
  }

  /** Corner currently being approached (for the UI), null if none. */
  get approaching(): string | null {
    return this.approach?.cornerId ?? null;
  }

  /** Feeds a frame; returns a pass when one completed on this frame. */
  push(f: CornerFrameInput): CornerPass | null {
    if (!f.onTrack || f.distanceM === null) {
      this.reset();
      return null;
    }
    const L = f.lengthM && f.lengthM > 0 ? f.lengthM : null;
    this.lengthM = L;
    const d = f.distanceM;
    if (this.prevD !== null) {
      let step = d - this.prevD;
      if (L && step < -L / 2) {
        this.offset += L;
        step += L;
      } else if (L && step > L / 2) {
        this.offset -= L;
        step -= L;
      }
      if (Math.abs(step) > JUMP_M || step < -5) {
        this.reset();
        this.prevD = d;
        return null;
      }
    }
    this.prevD = d;
    const u = d + this.offset;
    let done: CornerPass | null = null;

    const hint = f.hint;
    if ((hint?.cornerId ?? null) !== (this.approach?.cornerId ?? null)) {
      if (this.exiting) done = this.complete(this.exiting, f.t);
      this.exiting = null;
      if (this.approach) {
        this.approach.phase = 'exit';
        this.exiting = this.approach;
      }
      this.approach = hint ? this.open(hint, u, f) : null;
    } else if (this.approach && hint) {
      // Refine the entry estimate as the car gets closer.
      this.approach.entryU = u + hint.distanceToEntryM;
    }

    if (this.approach) this.update(this.approach, f, u);
    if (this.exiting) {
      const finished = this.update(this.exiting, f, u);
      if (finished) {
        const p = this.complete(this.exiting, f.t);
        this.exiting = null;
        done = done ?? p;
      }
    }
    return done;
  }

  private open(h: CornerHintExt, u: number, f: CornerFrameInput): Open {
    return {
      cornerId: h.cornerId,
      name: h.name,
      direction: h.direction,
      entryU: u + h.distanceToEntryM,
      ref: {
        brakeM: h.referenceBrakePointM,
        vminKmh: h.referenceMinSpeedKmh,
        gear: h.referenceGearAtApex,
        throttleOnM: h.referenceThrottleOnM ?? null,
      },
      lastPassDeltaMs: h.lastPassDeltaMs,
      brakeU: null,
      // Braking already in progress belongs to the previous corner (no onset for this one).
      lastBrakeT: f.brake > BRAKE_ON_THRESHOLD ? f.t : null,
      minActive: false,
      vmin: Number.POSITIVE_INFINITY,
      vminU: u,
      gear: 0,
      throttleU: null,
      phase: 'approach',
    };
  }

  /** Updates an open pass; returns true when an exiting pass is finished. */
  private update(p: Open, f: CornerFrameInput, u: number): boolean {
    const brakeOn = f.brake > BRAKE_ON_THRESHOLD;
    if (brakeOn) {
      const newEpisode = p.lastBrakeT === null || f.t - p.lastBrakeT > BRAKE_GAP_MS;
      p.lastBrakeT = f.t;
      if (newEpisode) {
        if (p.phase === 'exit' && p.throttleU !== null) return true; // next corner's braking
        if (p.phase === 'approach' && p.entryU - u <= BRAKE_WINDOW_M) {
          p.brakeU = u;
          p.minActive = true;
          p.vmin = f.speedKmh;
          p.vminU = u;
          p.gear = f.gear;
          p.throttleU = null;
        }
      }
    }
    if (!p.minActive && u >= p.entryU) {
      p.minActive = true;
      p.vmin = f.speedKmh;
      p.vminU = u;
      p.gear = f.gear;
    }
    if (p.minActive) {
      if (f.speedKmh < p.vmin) {
        p.vmin = f.speedKmh;
        p.vminU = u;
        p.gear = f.gear;
        p.throttleU = null;
      } else if (p.throttleU === null && !brakeOn && f.throttle >= THROTTLE_ON_THRESHOLD) {
        p.throttleU = u;
      }
    }
    if (p.phase !== 'exit') return false;
    if (p.throttleU !== null && (f.speedKmh >= p.vmin + 25 || u - p.throttleU > 150)) return true;
    return u - p.entryU > 600;
  }

  private complete(p: Open, t: number): CornerPass | null {
    if (!p.minActive || !Number.isFinite(p.vmin)) return null;
    const L = this.lengthM;
    const w = (x: number) => (L ? wrapDistance(x, L) : x);
    return {
      seq: ++this.seq,
      cornerId: p.cornerId,
      name: p.name,
      direction: p.direction,
      lengthM: L,
      entryM: w(p.entryU),
      brakeM: p.brakeU === null ? null : w(p.brakeU),
      vminKmh: p.vmin,
      vminM: w(p.vminU),
      gearAtVmin: p.gear,
      throttleOnM: p.throttleU === null ? null : w(p.throttleU),
      ref: p.ref,
      lastPassDeltaMs: p.lastPassDeltaMs,
      completedAt: t,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Assessment (pt-BR feedback)
// ---------------------------------------------------------------------------------------------

export const BRAKE_TOL_M = 5;
export const VMIN_TOL_KMH = 2;
export const THROTTLE_TOL_M = 8;

export type ItemTone = 'good' | 'bad' | 'info';

export interface AssessItem {
  key: 'brake' | 'vmin' | 'throttle';
  label: string;
  /** Your value, formatted. */
  you: string;
  /** Target value, formatted ('–' when none). */
  target: string;
  /** Short verdict ("10 m cedo", "−6 km/h"). */
  text: string;
  tone: ItemTone;
  /** What the target is: the reference lap or your previous pass. */
  basis: 'referência' | 'passagem anterior' | null;
  /** Spoken version (no abbreviations). */
  speech: string;
}

export interface PassAssessment {
  items: AssessItem[];
  verdict: 'good' | 'bad' | 'neutral';
  headline: string;
  /** One phrase for text-to-speech. */
  phrase: string;
}

function m(v: number): string {
  return `${formatInt(Math.abs(v))} m`;
}

function signedKmh(v: number): string {
  const r = Math.round(v);
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)} km/h`;
}

/** Compares a pass with the reference targets (or with the previous pass when no reference). */
export function assessPass(pass: CornerPass, prev: CornerPass | null): PassAssessment {
  const L = pass.lengthM;
  const items: AssessItem[] = [];

  // Brake point.
  {
    const refM = pass.ref.brakeM;
    const basis = refM !== null ? 'referência' : prev?.brakeM != null ? 'passagem anterior' : null;
    const target = refM ?? prev?.brakeM ?? null;
    const you = pass.brakeM;
    let text = '–';
    let speech = '';
    let tone: ItemTone = 'info';
    if (you === null) {
      text = target !== null ? 'Sem frenagem' : 'Sem frenagem';
      speech = target !== null && basis === 'referência' ? 'sem frenagem' : '';
      tone = 'info';
    } else if (target !== null) {
      const diff = lapDiff(you, target, L); // + = later
      if (Math.abs(diff) <= BRAKE_TOL_M) {
        text = 'No ponto';
        speech = 'frenagem no ponto';
        tone = basis === 'referência' ? 'good' : 'info';
      } else if (diff < 0) {
        text = `${m(diff)} cedo`;
        speech = `frenagem ${formatInt(Math.abs(diff))} metros cedo`;
        tone = basis === 'referência' ? 'bad' : 'info';
      } else {
        text = `${m(diff)} tarde`;
        speech = `frenagem ${formatInt(diff)} metros tarde`;
        tone = 'info';
      }
    }
    items.push({
      key: 'brake',
      label: 'Frenagem',
      you: you === null ? '–' : `${formatInt(you)} m`,
      target: target === null ? '–' : `${formatInt(target)} m`,
      text,
      tone,
      basis,
      speech,
    });
  }

  // Minimum speed.
  {
    const refV = pass.ref.vminKmh;
    const basis = refV !== null ? 'referência' : prev ? 'passagem anterior' : null;
    const target = refV ?? prev?.vminKmh ?? null;
    let text = '–';
    let speech = '';
    let tone: ItemTone = 'info';
    if (target !== null) {
      const diff = pass.vminKmh - target;
      text = Math.abs(diff) < 0.5 ? 'No alvo' : signedKmh(diff);
      if (diff >= -VMIN_TOL_KMH) {
        tone = basis === 'referência' ? 'good' : 'info';
        speech = diff > VMIN_TOL_KMH ? `velocidade mínima ${Math.round(diff)} acima` : '';
      } else {
        tone = basis === 'referência' ? 'bad' : 'info';
        speech = `velocidade mínima ${Math.round(-diff)} quilômetros por hora abaixo`;
      }
    }
    items.push({
      key: 'vmin',
      label: 'V-mín',
      you: `${formatInt(pass.vminKmh)} km/h`,
      target: target === null ? '–' : `${formatInt(target)} km/h`,
      text,
      tone,
      basis,
      speech,
    });
  }

  // Throttle pickup.
  {
    const refT = pass.ref.throttleOnM;
    const basis =
      refT !== null ? 'referência' : prev?.throttleOnM != null ? 'passagem anterior' : null;
    const target = refT ?? prev?.throttleOnM ?? null;
    const you = pass.throttleOnM;
    let text = '–';
    let speech = '';
    let tone: ItemTone = 'info';
    if (you !== null && target !== null) {
      const diff = lapDiff(you, target, L); // + = later
      if (diff <= THROTTLE_TOL_M) {
        text = diff < -THROTTLE_TOL_M ? `${m(diff)} antes` : 'No ponto';
        tone = basis === 'referência' ? 'good' : 'info';
      } else {
        text = `${m(diff)} tarde`;
        speech = `acelerou ${formatInt(diff)} metros tarde`;
        tone = basis === 'referência' ? 'bad' : 'info';
      }
    }
    items.push({
      key: 'throttle',
      label: 'Retomada',
      you: you === null ? '–' : `${formatInt(you)} m`,
      target: target === null ? '–' : `${formatInt(target)} m`,
      text,
      tone,
      basis,
      speech,
    });
  }

  const bad = items.filter((i) => i.tone === 'bad');
  const good = items.filter((i) => i.tone === 'good');
  const verdict = bad.length > 0 ? 'bad' : good.length > 0 ? 'good' : 'neutral';
  const label = pass.name ?? pass.cornerId;
  const headline =
    bad.length > 0
      ? bad.map((i) => `${i.label} ${i.text.toLowerCase()}`).join(' · ')
      : verdict === 'good'
        ? 'Curva no alvo'
        : 'Passagem registrada';
  const spoken = bad
    .map((i) => i.speech)
    .filter(Boolean)
    .slice(0, 2);
  const phrase =
    spoken.length > 0
      ? `${label}: ${spoken.join(', ')}`
      : verdict === 'good'
        ? `${label}: boa, no alvo`
        : '';
  return { items, verdict, headline, phrase };
}

/** Distance (m) from the car to the reference brake point (or to the entry), ≥ 0 when ahead. */
export function distanceToBrake(
  hint: NextCornerHint,
  distanceM: number | null,
  lengthM: number | null,
): { meters: number; kind: 'brake' | 'entry' } {
  if (hint.referenceBrakePointM !== null && distanceM !== null) {
    const toBrake = lapDiff(hint.referenceBrakePointM, distanceM, lengthM);
    // Only while the brake point is still ahead (and belongs to this approach); once passed,
    // the countdown switches to the corner entry.
    if (toBrake >= 0 && toBrake <= hint.distanceToEntryM + 5) {
      return { meters: toBrake, kind: 'brake' };
    }
  }
  return { meters: hint.distanceToEntryM, kind: 'entry' };
}
