/**
 * Car and driver models for the synthetic generator, plus the per-lap speed planner
 * (curvature-limited speed, forward/backward passes with a friction circle).
 */

import type { Rng } from './rng.ts';
import type { SyntheticTrack } from './track.ts';

export const G = 9.81;

export const CAR = {
  /** Arbitrary car code for the synthetic car. */
  carCode: 3455,
  category: 'GR3',
  massKg: 1300,
  powerW: 440_000,
  /** Top speed used to calibrate drag. */
  topSpeedMps: 80,
  /** Max longitudinal traction (g). */
  tractionG: 1.25,
  /** Brake system capability at 100% pedal (g). */
  maxBrakeG: 1.6,
  /** Engine braking + rolling resistance with no pedal (m/s²). */
  engineBrakeMps2: 0.8,
  rollingMps2: 0.15,
  /** Base lateral grip (g). */
  lateralG: 1.6,
  gearRatios: [3.15, 2.35, 1.85, 1.52, 1.28, 1.1, 0.96],
  finalDrive: 3.7,
  tyreRadius: [0.33, 0.33, 0.345, 0.345] as [number, number, number, number],
  trackWidthM: 1.6,
  wheelbaseM: 2.65,
  steeringRatio: 11,
  idleRpm: 1100,
  limiterRpm: 8800,
  rpmAlertMin: 7400,
  rpmAlertMax: 8600,
  calculatedMaxSpeedKmh: 289,
  fuelCapacityL: 100,
  fuelStartL: 60,
  /** Liters per (throttle · rpm · s). Calibrated for ~2.6 L/lap. */
  fuelPerThrottleRpmS: 5.6e-6,
} as const;

/** Aerodynamic drag coefficient so that power-limited accel = drag at top speed. */
export const DRAG_K =
  (CAR.powerW / CAR.massKg / CAR.topSpeedMps - CAR.rollingMps2) / CAR.topSpeedMps ** 2;

export function dragDecel(v: number): number {
  return DRAG_K * v * v + CAR.rollingMps2;
}

/** Max propulsive acceleration (before drag) at speed v. */
export function maxPropulsion(v: number): number {
  return Math.min(CAR.tractionG * G, CAR.powerW / CAR.massKg / Math.max(v, 1));
}

export function rpmFor(v: number, gear: number): number {
  const ratio = CAR.gearRatios[Math.max(0, Math.min(CAR.gearRatios.length, gear) - 1)] ?? 1;
  return ((v / CAR.tyreRadius[2]) * ratio * CAR.finalDrive * 60) / (2 * Math.PI);
}

export type DriverProfileName = 'amateur' | 'pro';

export interface DriverProfile {
  name: DriverProfileName;
  /** Fraction of the car's lateral grip used in corners. */
  grip: number;
  gripSdLap: number;
  gripSdCorner: number;
  /** Braking deceleration target (g) and per-corner spread. */
  brakeG: number;
  brakeGSd: number;
  /** Keeps braking while turning in (friction circle) — reference technique. */
  trailBraking: boolean;
  /** Coasting distance before turn-in (m), [min, max] (amateur). */
  coastM: [number, number];
  /** Throttle pickup delay after the apex (m), [min, max]. */
  throttleDelayM: [number, number];
  /** Probability of one mistake per lap. */
  mistakeProb: number;
  /** Pedal rate limits (units of full travel per second). */
  throttleRise: number;
  brakeRise: number;
  shiftUpRpm: number;
  downshiftRpm: number;
  /** Line deviation sd (m) at entry/apex/exit. */
  lineSdM: number;
  /** Steering correction oscillation amplitude (rad at the wheel). */
  steeringWobble: number;
  /** TCS setting (amateur relies on it). */
  tcs: boolean;
}

export const DRIVER_PROFILES: Record<DriverProfileName, DriverProfile> = {
  pro: {
    name: 'pro',
    grip: 0.995,
    gripSdLap: 0.002,
    gripSdCorner: 0.003,
    brakeG: 1.52,
    brakeGSd: 0.02,
    trailBraking: true,
    coastM: [0, 0],
    throttleDelayM: [0, 2],
    mistakeProb: 0,
    throttleRise: 5,
    brakeRise: 12,
    shiftUpRpm: 8450,
    downshiftRpm: 7800,
    lineSdM: 0.15,
    steeringWobble: 0.004,
    tcs: false,
  },
  amateur: {
    name: 'amateur',
    grip: 0.95,
    gripSdLap: 0.008,
    gripSdCorner: 0.012,
    brakeG: 1.3,
    brakeGSd: 0.07,
    trailBraking: false,
    coastM: [4, 14],
    throttleDelayM: [4, 18],
    mistakeProb: 0.25,
    throttleRise: 2.5,
    brakeRise: 5,
    shiftUpRpm: 8000,
    downshiftRpm: 6800,
    lineSdM: 0.9,
    steeringWobble: 0.012,
    tcs: true,
  },
};

/** Per-corner execution for one lap. */
export interface CornerPlan {
  grip: number;
  brakeG: number;
  coastM: number;
  throttleDelayM: number;
  /** Lateral offsets (m, + = left) at entry/apex/exit. */
  offsetEntry: number;
  offsetApex: number;
  offsetExit: number;
  mistake: boolean;
  wobble: number;
}

export interface LapPlan {
  /** Index of the first track sample of this plan (out lap starts mid-lap). */
  startIdx: number;
  /** Distances of the grid (track samples + the closing point at lengthM). */
  s: Float64Array;
  /** Speed (m/s) per grid point. */
  v: Float64Array;
  /** Time (s) since plan start per grid point (NaN before startIdx). */
  t: Float64Array;
  /** Longitudinal acceleration (m/s²) per grid point. */
  a: Float64Array;
  lapTimeS: number;
  vEnd: number;
  corners: CornerPlan[];
}

/** Draws this lap's per-corner parameters. */
export function drawCornerPlans(
  track: SyntheticTrack,
  profile: DriverProfile,
  rng: Rng,
): CornerPlan[] {
  const lapGrip = profile.grip + rng.gauss(profile.gripSdLap);
  const mistakeCorner = rng.chance(profile.mistakeProb) ? rng.int(track.corners.length) : -1;
  return track.corners.map((c, i) => {
    const mistake = i === mistakeCorner;
    const outward = c.direction === 'left' ? -1 : 1; // + = left; outside of a left turn is right
    const sd = profile.lineSdM;
    return {
      grip: (lapGrip + rng.gauss(profile.gripSdCorner)) * (mistake ? 0.86 : 1),
      brakeG: (profile.brakeG + rng.gauss(profile.brakeGSd)) * (mistake ? 0.85 : 1),
      coastM: rng.range(profile.coastM[0], profile.coastM[1]),
      throttleDelayM:
        rng.range(profile.throttleDelayM[0], profile.throttleDelayM[1]) * (mistake ? 2 : 1),
      offsetEntry: rng.gauss(sd),
      // amateurs tend to miss the apex (stay outside)
      offsetApex: outward * Math.abs(rng.gauss(sd)) * 1.2 + rng.gauss(sd * 0.3),
      offsetExit: rng.gauss(sd),
      mistake,
      wobble: profile.steeringWobble * (mistake ? 4 : 1) * rng.range(0.6, 1.4),
    };
  });
}

/**
 * For each track sample: the corner whose window contains it (for grip) and the next corner
 * ahead (for braking / throttle decisions).
 */
export interface CornerIndexMaps {
  nearest: Int16Array;
  next: Int16Array;
}

export function buildCornerMaps(track: SyntheticTrack): CornerIndexMaps {
  const n = track.samples.length;
  const nearest = new Int16Array(n);
  const next = new Int16Array(n);
  const L = track.lengthM;
  const cs = track.corners;
  for (let j = 0; j < n; j++) {
    const s = track.samples[j]!.s;
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    let nxt = 0;
    let nxtD = Number.POSITIVE_INFINITY;
    cs.forEach((c, i) => {
      const d =
        s < c.entryM
          ? Math.min(c.entryM - s, s + L - c.exitM)
          : s > c.exitM
            ? Math.min(s - c.exitM, c.entryM + L - s)
            : 0;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      const ahead = s <= c.exitM ? c.exitM - s : c.exitM + L - s;
      if (ahead < nxtD) {
        nxtD = ahead;
        nxt = i;
      }
    });
    nearest[j] = best;
    next[j] = nxt;
  }
  return { nearest, next };
}

/**
 * Plans the speed profile of one lap (or of the out lap when startIdx > 0, from speed v0).
 */
export function planLap(
  track: SyntheticTrack,
  maps: CornerIndexMaps,
  profile: DriverProfile,
  corners: CornerPlan[],
  v0: number,
  startIdx = 0,
): LapPlan {
  const n = track.samples.length;
  const N = n + 1;
  const s = new Float64Array(N);
  const kap = new Float64Array(N);
  const nearest = new Int16Array(N);
  const next = new Int16Array(N);
  for (let j = 0; j < n; j++) {
    s[j] = track.samples[j]!.s;
    kap[j] = Math.abs(track.samples[j]!.curvatureSmooth);
    nearest[j] = maps.nearest[j]!;
    next[j] = maps.next[j]!;
  }
  s[n] = track.lengthM;
  kap[n] = kap[0]!;
  nearest[n] = nearest[0]!;
  next[n] = next[0]!;

  const latMaxAt = (j: number) => CAR.lateralG * G * corners[nearest[j]!]!.grip;
  const vlim = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const k = kap[j]!;
    vlim[j] = k > 1e-6 ? Math.min(CAR.topSpeedMps, Math.sqrt(latMaxAt(j) / k)) : CAR.topSpeedMps;
  }

  // Backward pass (braking feasibility), run twice around the loop for periodicity.
  const vb = Float64Array.from(vlim);
  for (let pass = 0; pass < 2; pass++) {
    for (let jj = N - 2; jj >= 0; jj--) {
      const j = jj;
      const ds = s[j + 1]! - s[j]!;
      const vNext = pass === 0 && j === N - 2 ? vb[N - 1]! : vb[j + 1]!;
      const c = track.corners[next[j]!]!;
      const cp = corners[next[j]!]!;
      const v = vNext;
      let decel: number;
      const inCoastZone =
        !profile.trailBraking && s[j]! >= c.entryM - cp.coastM && s[j]! <= c.apexM;
      if (inCoastZone) {
        decel = dragDecel(v) + CAR.engineBrakeMps2;
      } else {
        const alat = v * v * kap[j]!;
        const ratio = Math.min(1, alat / latMaxAt(j));
        const circle = profile.trailBraking ? Math.sqrt(Math.max(0.0225, 1 - ratio * ratio)) : 1;
        decel = cp.brakeG * G * circle + dragDecel(v);
        // non trail-braking drivers do not brake once the car is turning
        if (!profile.trailBraking && ratio > 0.5) decel = dragDecel(v) + CAR.engineBrakeMps2;
      }
      const vMax = Math.sqrt(vNext * vNext + 2 * decel * ds);
      if (vMax < vb[j]!) vb[j] = vMax;
    }
    vb[N - 1] = Math.min(vb[N - 1]!, vb[0]!);
  }

  // Forward pass (traction / power), from v0 at startIdx.
  const v = new Float64Array(N);
  v.fill(Number.NaN);
  v[startIdx] = Math.min(v0, vb[startIdx]!);
  for (let j = startIdx; j < N - 1; j++) {
    const ds = s[j + 1]! - s[j]!;
    const vj = v[j]!;
    const c = track.corners[nearest[j]!]!;
    const cp = corners[nearest[j]!]!;
    const alat = vj * vj * kap[j]!;
    const ratio = Math.min(1, alat / latMaxAt(j));
    let acc = Math.min(
      maxPropulsion(vj),
      CAR.tractionG * G * Math.sqrt(Math.max(0, 1 - ratio * ratio)),
    );
    const delayed = s[j]! >= c.apexM - 3 && s[j]! <= c.apexM + cp.throttleDelayM;
    if (delayed && ratio > 0.3) acc = Math.min(acc, dragDecel(vj)); // maintenance throttle only
    acc -= dragDecel(vj);
    const vNext = Math.sqrt(Math.max(0.25, vj * vj + 2 * acc * ds));
    v[j + 1] = Math.min(vNext, vb[j + 1]!);
  }

  const t = new Float64Array(N);
  const a = new Float64Array(N);
  t.fill(Number.NaN);
  t[startIdx] = 0;
  for (let j = startIdx; j < N - 1; j++) {
    const ds = s[j + 1]! - s[j]!;
    const vm = Math.max(0.5, (v[j]! + v[j + 1]!) / 2);
    t[j + 1] = t[j]! + ds / vm;
    a[j] = (v[j + 1]! ** 2 - v[j]! ** 2) / (2 * ds);
  }
  a[N - 1] = a[N - 2]!;
  return { startIdx, s, v, t, a, lapTimeS: t[N - 1]!, vEnd: v[N - 1]!, corners };
}

/** Index i such that t[i] <= tau < t[i+1] (binary search over the plan's valid range). */
export function findTimeIndex(plan: LapPlan, tau: number): number {
  let lo = plan.startIdx;
  let hi = plan.t.length - 1;
  if (tau <= 0) return lo;
  if (tau >= plan.t[hi]!) return hi - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (plan.t[mid]! <= tau) lo = mid;
    else hi = mid;
  }
  return lo;
}
