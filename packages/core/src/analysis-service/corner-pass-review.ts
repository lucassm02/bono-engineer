/**
 * Live review of one corner pass (docs/radio-engineer-spec.md, "Ganhar tempo" and "Eventos de
 * pilotagem"): the pass and the reference are aligned by distance on the same line, the corner
 * metrics of the analysis (brake release, trail braking, throttle pickup, coasting, gear) are
 * compared, and a cause is kept only with an observable effect in the zone delta. A different line
 * or more steering alone is never a cause.
 *
 * Tolerances: an approach speed far below the reference weakens a braking-point cause (> 10 km/h)
 * or cancels the comparison (> 30 km/h); the minimum speed is set by the corner, so mid-corner
 * causes keep their confidence. A replay reference needs larger distance differences (smoothed
 * inputs, a few meters of precision). The high-confidence driving event of the pass (at most one) comes from
 * {@link detectCornerPassEvents} / {@link radioEventForPass}.
 *
 * Pure and deterministic: same samples, reference and model → same review.
 */

import {
  computeCornerMetrics,
  cornerWindows,
  cornerZones,
  deltaBetween,
  diagnoseCorner,
  type PreparedLap,
  valueAtDistance,
} from '@gt7/analysis';
import type {
  Corner,
  CornerFinding,
  CornerMetrics,
  CornerPhaseLoss,
  DrivingEvent,
  DrivingEventModel,
  LiveCornerCause,
  LiveCornerCauseKind,
  LiveDrivingEventCall,
} from '@gt7/shared';
import type { CornerPassReview } from '../live/corner-hints.ts';
import { detectCornerPassEvents, radioEventForPass } from './driving-events.ts';

/** Thresholds of the pass review (tuned on the Trial Mountain laps, see the tests). */
export const PASS_REVIEW = {
  /** Approach speed deficit (km/h) that lowers a braking-point cause one level. */
  approachToleranceKmh: 10,
  /** Approach speed deficit (km/h) beyond which the pass is not compared. */
  approachMaxKmh: 30,
  /** Brake released this much later than the reference (m); replay reference: the second. */
  heldBrakeReleaseM: 10,
  heldBrakeReleaseReplayM: 20,
  /** Extra braking while turning (s) and ratio to the reference trail braking. */
  heldBrakeExtraTrailS: 0.4,
  heldBrakeTrailRatio: 1.5,
  /** Minimum speed lost at the apex (km/h) for a held brake to count. */
  heldBrakeMinSpeedKmh: 3,
  /** Braking + mid-corner loss (ms) a held brake must show; high confidence from the second. */
  heldBrakeEffectMs: 100,
  heldBrakeHighEffectMs: 200,
  /** Analysis findings need at least this cost (ms) to be a cause (observable effect). */
  findingMinCostMs: 60,
} as const;

const LEVELS = ['low', 'medium', 'high'] as const;

/** Findings of the analysis that have a radio action (line and steering stay in the review). */
const FINDING_CAUSES: Partial<Record<CornerFinding['kind'], LiveCornerCauseKind>> = {
  brakeEarlier: 'brakeEarly',
  lateThrottle: 'lateThrottle',
  coasting: 'coasting',
  gearChoice: 'gear',
};

const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;
const num = (v: number, d = 0) => v.toFixed(d).replace('.', ',');

interface Ranked {
  cause: LiveCornerCause;
  level: number;
}

function heldBrake(
  corner: Corner,
  a: CornerMetrics,
  b: CornerMetrics,
  loss: CornerPhaseLoss,
  replay: boolean,
): Ranked | null {
  const th = PASS_REVIEW;
  if (
    a.brakeReleaseM === null ||
    b.brakeReleaseM === null ||
    a.trailBrakingS === null ||
    b.trailBrakingS === null
  )
    return null;
  const lateM = a.brakeReleaseM - b.brakeReleaseM;
  const extraS = a.trailBrakingS - b.trailBrakingS;
  const minLate = replay ? th.heldBrakeReleaseReplayM : th.heldBrakeReleaseM;
  if (
    lateM < minLate ||
    extraS < th.heldBrakeExtraTrailS ||
    a.trailBrakingS < th.heldBrakeTrailRatio * b.trailBrakingS
  )
    return null;
  const effect = Math.max(0, loss.brakingMs) + Math.max(0, loss.midMs);
  const vDeficit = b.minSpeedKmh - a.minSpeedKmh;
  if (effect < th.heldBrakeEffectMs || vDeficit < th.heldBrakeMinSpeedKmh) return null;
  const severity = Math.min(lateM / minLate, extraS / th.heldBrakeExtraTrailS);
  return {
    level: severity >= 2 && effect >= th.heldBrakeHighEffectMs ? 2 : 1,
    cause: {
      kind: 'heldBrake',
      confidence: 'medium',
      costMs: Math.round(effect),
      message:
        `Na ${corner.id} você segurou o freio: soltou ${num(lateM)} m depois da referência e ` +
        `freou virando por ${num(a.trailBrakingS, 1)} s (referência ${num(b.trailBrakingS, 1)} s)`,
      evidence: {
        brakeReleaseM: round(a.brakeReleaseM, 1),
        referenceBrakeReleaseM: round(b.brakeReleaseM, 1),
        trailBrakingS: round(a.trailBrakingS, 2),
        referenceTrailBrakingS: round(b.trailBrakingS, 2),
        minSpeedKmh: round(a.minSpeedKmh, 1),
        referenceMinSpeedKmh: round(b.minSpeedKmh, 1),
      },
    },
  };
}

function fromFinding(f: CornerFinding): Ranked | null {
  const kind = FINDING_CAUSES[f.kind];
  const cost = f.costMs ?? 0;
  if (!kind || cost < PASS_REVIEW.findingMinCostMs) return null;
  const level = LEVELS.indexOf(f.confidence ?? 'low');
  return {
    level: Math.max(0, level),
    cause: {
      kind,
      confidence: 'medium',
      costMs: Math.round(cost),
      message: f.message ?? f.kind,
      evidence: { value: round(f.value, 2), subject: f.subjectValue ?? null, reference: f.referenceValue ?? null },
      ...(kind === 'gear' && f.referenceValue ? { gear: f.referenceValue } : {}),
    },
  };
}

function eventCall(e: DrivingEvent | null): LiveDrivingEventCall | null {
  if (!e) return null;
  return {
    id: e.id,
    kind: e.kind,
    phase: e.phase,
    settledM: e.settledM,
    startM: e.startM,
    endM: e.endM,
    throttle: e.evidence.throttle,
    message: e.message,
    action: e.action,
  };
}

export interface CornerPassReviewOptions {
  /** Driving-event model of the car; without it no event is judged. */
  model?: DrivingEventModel | null;
}

/**
 * Reviews `cornerId` on `pass` (the current lap up to ~80 m after the corner exit) against
 * `reference`. Without a reference only the driving event is judged.
 */
export function reviewCornerPass(
  pass: PreparedLap,
  reference: PreparedLap | null,
  corners: readonly Corner[],
  cornerId: string,
  opts: CornerPassReviewOptions = {},
): CornerPassReview | null {
  const sorted = [...corners].sort((x, y) => x.entryM - y.entryM);
  const k = sorted.findIndex((c) => c.id === cornerId);
  if (k < 0) return null;
  const win = cornerWindows(sorted, pass.lengthM)[k]!;
  const corner = win.corner;
  const event = opts.model
    ? eventCall(radioEventForPass(detectCornerPassEvents(pass, sorted, cornerId, { model: opts.model })))
    : null;
  const a = computeCornerMetrics(pass, win);
  const base: CornerPassReview = {
    cornerId,
    referenceIsReplay: reference?.isReplay ?? false,
    timeLostMs: null,
    brakePointM: a.brakePointM === null ? null : round(a.brakePointM, 1),
    referenceBrakePointM: null,
    gearAtApex: a.gearAtApex > 0 ? a.gearAtApex : null,
    referenceGearAtApex: null,
    cause: null,
    event,
  };
  if (!reference) return { ...base, incomparable: 'sem referência compatível' };
  const b = computeCornerMetrics(reference, win);
  const withRef: CornerPassReview = {
    ...base,
    referenceBrakePointM: b.brakePointM === null ? null : round(b.brakePointM, 1),
    referenceGearAtApex: b.gearAtApex > 0 ? b.gearAtApex : null,
  };

  const L = Math.min(pass.lengthM, reference.lengthM);
  const only = (m: CornerMetrics) => sorted.map((_, i) => (i === k ? m.brakePointM : null));
  const zone = cornerZones(sorted, L, [only(a), only(b)])[k]!;
  if (pass.s[0]! > zone.fromM + 1 || pass.s[pass.n - 1]! < zone.toM - 1)
    return { ...withRef, incomparable: 'passagem incompleta' };
  const approach = valueAtDistance(pass, 'speedKmh', zone.fromM);
  const refApproach = valueAtDistance(reference, 'speedKmh', zone.fromM);
  const deficit = refApproach - approach;
  if (!Number.isFinite(deficit)) return { ...withRef, incomparable: 'sem velocidade' };
  if (deficit > PASS_REVIEW.approachMaxKmh)
    return { ...withRef, incomparable: 'velocidade de aproximação muito diferente' };

  const d = (from: number, to: number) =>
    to > from ? deltaBetween(pass, reference, from, to) * 1000 : 0;
  const entry = Math.min(Math.max(corner.entryM, zone.fromM), zone.toM);
  const exit = Math.min(Math.max(corner.exitM, entry), zone.toM);
  const loss: CornerPhaseLoss = {
    brakingMs: d(zone.fromM, entry),
    midMs: d(entry, exit),
    exitMs: d(exit, zone.toM),
    followingStraightMs: 0,
  };
  const timeLostMs = Math.round(loss.brakingMs + loss.midMs + loss.exitMs);

  const replay = reference.isReplay;
  const ranked: Ranked[] = [];
  const held = heldBrake(corner, a, b, loss, replay);
  if (held) ranked.push(held);
  for (const f of diagnoseCorner(corner, a, b, loss, { referenceIsReplay: replay })) {
    const r = fromFinding(f);
    if (r && !ranked.some((x) => x.cause.kind === r.cause.kind)) ranked.push(r);
  }
  // A slower approach explains the braking-phase loss (not the minimum speed, set by the corner):
  // a braking-point cause is one level less sure.
  const weaker = deficit > PASS_REVIEW.approachToleranceKmh;
  for (const r of ranked) {
    if (weaker && r.cause.kind === 'brakeEarly') r.level = Math.max(0, r.level - 1);
    r.cause.confidence = LEVELS[r.level]!;
    r.cause.evidence.approachKmh = round(approach, 1);
    r.cause.evidence.referenceApproachKmh = round(refApproach, 1);
  }
  ranked.sort((x, y) => y.level - x.level || y.cause.costMs - x.cause.costMs);
  return { ...withRef, timeLostMs, cause: ranked[0]?.cause ?? null };
}
