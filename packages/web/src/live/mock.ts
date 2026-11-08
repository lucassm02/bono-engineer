/**
 * Mock telemetry generator (dev without server/console): a scripted circuit driven by a simple
 * point-mass car. Produces plausible LiveFrames (speed/rpm/gear/pedals/tyres/delta/sectors) and
 * LapCompletedEvents. Pure and deterministic for a given seed (no DOM, no timers): unit-testable.
 */

import type {
  Corner,
  DeltaReferenceKind,
  LapCompletedEvent,
  LiveFrame,
  SectorSplit,
  SectorStatus,
  Wheels,
} from '@gt7/shared';
import type { CornerHintExt } from '../lib/cornerPass.ts';
import type { TrackGeometry } from '../lib/trackOutline.ts';

const G = 9.81;
const SECTORS = 3;
const TOTAL_LAPS = 10;
const RPM_MAX = 8500;
const GEAR_TOP_KMH = [72, 104, 136, 168, 202, 238, 286] as const;
const FUEL_PER_LAP = 2.6;
const FUEL_START = 32;
const MENU_MS = 1500;
/** Fraction of the arc where the reference lap picks up the throttle. */
const REF_PICKUP_FRAC = 0.3;
export const MOCK_TRACK_ID = 'mock-ring';

interface MockCornerTargets {
  brakeM: number | null;
  vminKmh: number;
  gear: number;
  throttleOnM: number;
}

/** Mulberry32 PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Circuit description: straights (radius 0) and arcs (signed radius, + = left). Total turn = −360°
 * and two straights were solved so the loop closes (< 1 m), so the map draws a closed outline.
 */
const LAYOUT: { len?: number; r?: number; deg?: number }[] = [
  { len: 560 },
  { r: -45, deg: 100 },
  { len: 180 },
  { r: -120, deg: 60 },
  { len: 792 },
  { r: 28, deg: 165 },
  { len: 260 },
  { r: -200, deg: 45 },
  { len: 140 },
  { r: -70, deg: 80 },
  { r: -70, deg: 80 },
  { len: 380 },
  { r: -90, deg: 95 },
  { len: 172 },
  { r: 260, deg: 40 },
  { len: 220 },
  { r: -55, deg: 105 },
  { len: 120 },
];

/** Display names of some mock corners (by 1-based corner number); the rest stay unnamed. */
const CORNER_NAMES: Record<number, string> = { 3: 'Grampo', 5: 'Dupla 1', 6: 'Dupla 2' };

export interface MockTrack {
  lengthM: number;
  /** Signed curvature per meter (1/m, + = left). */
  kappa: Float32Array;
  x: Float32Array;
  z: Float32Array;
  heading: Float32Array;
  /** One corner per arc of the layout (entry = arc start, apex = middle, exit = arc end). */
  corners: Corner[];
}

function buildCorners(): Corner[] {
  const corners: Corner[] = [];
  let pos = 0;
  for (const s of LAYOUT) {
    if (s.len) {
      pos += s.len;
      continue;
    }
    if (!s.r || !s.deg) continue;
    const len = Math.round(Math.abs(s.r) * ((s.deg * Math.PI) / 180));
    const n = corners.length + 1;
    corners.push({
      id: `T${n}`,
      index: n - 1,
      name: CORNER_NAMES[n] ?? null,
      entryM: pos,
      apexM: pos + Math.round(len / 2),
      exitM: pos + len,
      direction: s.r > 0 ? 'left' : 'right',
      minRadiusM: Math.abs(s.r),
    });
    pos += len;
  }
  return corners;
}

export function buildTrack(): MockTrack {
  const k: number[] = [];
  for (const s of LAYOUT) {
    if (s.len) for (let i = 0; i < s.len; i++) k.push(0);
    else if (s.r && s.deg) {
      const len = Math.round(Math.abs(s.r) * ((s.deg * Math.PI) / 180));
      for (let i = 0; i < len; i++) k.push(1 / s.r);
    }
  }
  const n = k.length;
  const kappa = new Float32Array(k);
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const heading = new Float32Array(n);
  let h = 0;
  let px = 0;
  let pz = 0;
  for (let i = 0; i < n; i++) {
    x[i] = px;
    z[i] = pz;
    heading[i] = h;
    h -= kappa[i]!; // + curvature = left = heading decreases with θ=0 → +Z, dir (sin θ, cos θ)
    px += Math.sin(h);
    pz += Math.cos(h);
  }
  return { lengthM: n, kappa, x, z, heading, corners: buildCorners() };
}

/** Max longitudinal acceleration (m/s²) at speed v: power-limited, traction-capped, minus drag. */
function accelAt(v: number): number {
  return Math.min(9, 338 / Math.max(v, 5)) - 7.1e-4 * v * v;
}
const BRAKE = 13;

/**
 * Speed profile (m/s per meter) for a lap. `cornerFactor[i]` scales the lateral grip per sector,
 * `mistakeAt` (meter index) adds a slow corner.
 */
export function speedProfile(
  t: MockTrack,
  sectorGrip: number[],
  mistakeAt: number | null,
): Float32Array {
  const n = t.lengthM;
  const lim = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const sector = Math.min(SECTORS - 1, Math.floor((i / n) * SECTORS));
    const grip = 1.6 * G * (sectorGrip[sector] ?? 1);
    const kk = Math.abs(t.kappa[i]!);
    let v = kk > 0 ? Math.sqrt(grip / kk) : 90;
    if (mistakeAt !== null && Math.abs(i - mistakeAt) < 60) v = Math.min(v * 0.8, 24);
    lim[i] = Math.min(v, 90);
  }
  const v = new Float32Array(n);
  // Forward pass (twice around so the start speed matches the end speed).
  let cur = lim[0]!;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      cur = Math.min(lim[i]!, Math.sqrt(cur * cur + 2 * Math.max(accelAt(cur), 0)));
      v[i] = cur;
    }
  }
  // Backward pass (braking), also wrapping.
  let nxt = v[0]!;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      nxt = Math.min(v[i]!, Math.sqrt(nxt * nxt + 2 * BRAKE));
      v[i] = nxt;
    }
  }
  return v;
}

/** Cumulative time (ms) at each meter for a profile (length n+1, last = lap time). */
export function cumulativeTime(v: Float32Array): Float64Array {
  const out = new Float64Array(v.length + 1);
  for (let i = 0; i < v.length; i++) out[i + 1] = out[i]! + 1000 / Math.max(v[i]!, 1);
  return out;
}

function sectorTimes(cum: Float64Array, n: number): number[] {
  const res: number[] = [];
  for (let s = 0; s < SECTORS; s++) {
    const a = Math.floor((s * n) / SECTORS);
    const b = Math.floor(((s + 1) * n) / SECTORS);
    res.push(cum[b]! - cum[a]!);
  }
  return res;
}

function gearFor(kmh: number): number {
  for (let g = 0; g < GEAR_TOP_KMH.length; g++) if (kmh <= GEAR_TOP_KMH[g]! * 0.93) return g + 1;
  return GEAR_TOP_KMH.length;
}

function rpmFor(kmh: number, gear: number): number {
  const top = GEAR_TOP_KMH[gear - 1] ?? 286;
  return Math.min(RPM_MAX, Math.max(1100, (kmh / top) * RPM_MAX));
}

interface RefLap {
  id: string;
  /** Speed profile (m/s per meter) of the lap (corner targets for the hints). */
  profile: Float32Array;
  cum: Float64Array;
  sectors: number[];
  timeMs: number;
}

export interface MockOptions {
  seed?: number;
  /** Epoch ms of the first frame. */
  startAt?: number;
  /** Skip the initial "menu" state. */
  skipMenu?: boolean;
}

export interface MockStep {
  frame: LiveFrame;
  lapCompleted: LapCompletedEvent | null;
}

/** Stateful mock session. Call {@link MockSession.step} with the elapsed ms (any rate). */
export class MockSession {
  readonly track = buildTrack();
  private readonly rand: () => number;
  private seq = 0;
  private elapsed = 0;
  private readonly startAt: number;
  private menuLeft: number;

  private lap = 1;
  private lapMs = 0;
  private dist = 0;
  private profile: Float32Array;
  private lapCum: Float64Array;
  private sectorSplits: (number | null)[] = [null, null, null];
  private sectorStatus: SectorStatus[] = ['pending', 'pending', 'pending'];
  private sectorDelta: (number | null)[] = [null, null, null];
  private lastLapMs: number | null = null;
  private fuel = FUEL_START;
  private fuelPerLap: number | null = null;
  private lapFuelStart = FUEL_START;
  private mistakeThisLap = false;
  private mistakeAt = Number.POSITIVE_INFINITY;

  private reference: DeltaReferenceKind = 'personalBest';
  private readonly personalBest: RefLap;
  private sessionBest: RefLap | null = null;
  private readonly topRef: RefLap;
  private readonly overallBestSectors: number[];
  private readonly pbSectors: number[];

  // Smoothed channels
  private throttle = 0;
  private brake = 0;
  private clutchUntil = 0;
  private gear = 1;
  private tyreT: Wheels = [58, 58, 54, 54];
  private prevDelta: number | null = null;
  private deltaRate = 0;
  private lockEvent = 0;
  private energy = 0;
  private pickupFrac = REF_PICKUP_FRAC;
  /** Corner index per lap meter (−1 on straights). */
  private readonly cornerIndex: Int16Array;

  // Corner hints: reference targets per (reference lap, corner) and the last pass delta.
  private readonly targetCache = new Map<string, MockCornerTargets>();
  private readonly lastPassDelta = new Map<string, number>();

  constructor(opts: MockOptions = {}) {
    this.rand = rng(opts.seed ?? 7);
    this.startAt = opts.startAt ?? 0;
    this.menuLeft = opts.skipMenu ? 0 : MENU_MS;
    const n = this.track.lengthM;
    this.cornerIndex = new Int16Array(n).fill(-1);
    this.track.corners.forEach((c, k) => {
      for (let m = c.entryM; m < c.exitM && m < n; m++) this.cornerIndex[m] = k;
    });
    const pbProfile = speedProfile(this.track, [0.995, 0.995, 0.995], null);
    const pbCum = cumulativeTime(pbProfile);
    this.personalBest = {
      id: 'mock-pb',
      profile: pbProfile,
      cum: pbCum,
      sectors: sectorTimes(pbCum, n),
      timeMs: pbCum[n]!,
    };
    const topProfile = speedProfile(this.track, [1.025, 1.025, 1.025], null);
    const topCum = cumulativeTime(topProfile);
    this.topRef = {
      id: 'mock-top',
      profile: topProfile,
      cum: topCum,
      sectors: sectorTimes(topCum, n),
      timeMs: topCum[n]!,
    };
    this.pbSectors = [...this.personalBest.sectors];
    this.overallBestSectors = this.pbSectors.map((s) => s * 0.997);
    this.profile = this.newLapProfile();
    this.lapCum = new Float64Array(n + 1);
  }

  setReference(kind: DeltaReferenceKind): void {
    this.reference = kind;
  }

  get currentReference(): DeltaReferenceKind {
    return this.reference;
  }

  private newLapProfile(): Float32Array {
    const grip = [0, 1, 2].map(() => 0.965 + this.rand() * 0.06);
    this.mistakeThisLap = this.rand() < 0.15;
    const mistakeAt = this.mistakeThisLap ? Math.floor(this.rand() * this.track.lengthM) : null;
    this.mistakeAt = mistakeAt ?? Number.POSITIVE_INFINITY;
    this.lockEvent = Math.floor(this.rand() * this.track.lengthM);
    this.pickupFrac = 0.22 + this.rand() * 0.24;
    return speedProfile(this.track, grip, mistakeAt);
  }

  /** Corner containing lap meter `i` (null on straights). */
  private cornerAtM(i: number): Corner | null {
    const k = this.cornerIndex[i] ?? -1;
    return k >= 0 ? (this.track.corners[k] ?? null) : null;
  }

  /** Reference targets of a corner from a reference lap's speed profile (cached). */
  private targetsFor(ref: RefLap, c: Corner): MockCornerTargets {
    const key = `${ref.id}|${ref.timeMs}|${c.id}`;
    const hit = this.targetCache.get(key);
    if (hit) return hit;
    const p = ref.profile;
    const n = p.length;
    const at = (m: number) => p[((m % n) + n) % n]!;
    const decel = (m: number) => (at(m + 1) ** 2 - at(m) ** 2) / 2 < -0.6;
    let brakeM: number | null = null;
    // Like the core provider, but not before the previous corner's exit (back-to-back corners).
    const prev = this.track.corners[c.index - 1];
    const from = Math.max(c.entryM - 300, prev ? prev.exitM : -Infinity);
    for (let m = from; m <= c.apexM; m++) {
      if (decel(m) && !decel(m - 1)) {
        brakeM = ((m % n) + n) % n;
        break;
      }
    }
    let vmin = Number.POSITIVE_INFINITY;
    let vminM = c.entryM;
    for (let m = c.entryM; m <= c.exitM; m++) {
      if (at(m) < vmin) {
        vmin = at(m);
        vminM = m;
      }
    }
    const pickup = Math.max(vminM, c.entryM + Math.round((c.exitM - c.entryM) * REF_PICKUP_FRAC));
    const t: MockCornerTargets = {
      brakeM,
      vminKmh: vmin * 3.6,
      gear: gearFor(vmin * 3.6),
      throttleOnM: pickup % n,
    };
    this.targetCache.set(key, t);
    return t;
  }

  private nextCornerHint(): CornerHintExt | null {
    const corners = this.track.corners;
    if (corners.length === 0) return null;
    const n = this.track.lengthM;
    const d = this.dist;
    let c = corners.find((x) => x.entryM >= d);
    let distance: number;
    if (c) distance = c.entryM - d;
    else {
      c = corners[0]!;
      distance = c.entryM + n - d;
    }
    const ref = this.refLap();
    const t = ref ? this.targetsFor(ref, c) : null;
    return {
      cornerId: c.id,
      name: c.name,
      direction: c.direction,
      distanceToEntryM: distance,
      referenceBrakePointM: t?.brakeM ?? null,
      referenceMinSpeedKmh: t?.vminKmh ?? null,
      referenceGearAtApex: t?.gear ?? null,
      lastPassDeltaMs: this.lastPassDelta.get(c.id) ?? null,
      ...(t?.throttleOnM != null ? { referenceThrottleOnM: t.throttleOnM } : {}),
    };
  }

  /** Interpolated world position at a lap distance (smooth map dot between meters). */
  private positionAt(dist: number): { x: number; y: number; z: number } {
    const n = this.track.lengthM;
    const i = Math.min(n - 1, Math.max(0, Math.floor(dist)));
    const j = (i + 1) % n;
    const f = Math.min(1, Math.max(0, dist - i));
    const { x, z } = this.track;
    return { x: x[i]! + (x[j]! - x[i]!) * f, y: 0, z: z[i]! + (z[j]! - z[i]!) * f };
  }

  /** Track polyline/corners for the map (the server would serve this over REST). */
  geometry(): TrackGeometry {
    const n = this.track.lengthM;
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = i;
    return {
      trackId: MOCK_TRACK_ID,
      x: this.track.x,
      z: this.track.z,
      d,
      lengthM: n,
      corners: this.track.corners,
      sectorStartsM: [0, 1, 2].map((s) => Math.floor((s * n) / SECTORS)),
      source: 'mock',
      closed: true,
    };
  }

  private refLap(): RefLap | null {
    if (this.reference === 'reference') return this.topRef;
    if (this.reference === 'sessionBest') return this.sessionBest;
    return this.personalBest;
  }

  /** Advances the simulation by `dtMs` and returns the frame (plus a lap event when a lap closed). */
  step(dtMs: number): MockStep {
    const dt = Math.min(Math.max(dtMs, 0), 250) / 1000;
    this.elapsed += dtMs;
    this.seq++;
    let lapCompleted: LapCompletedEvent | null = null;
    const n = this.track.lengthM;

    if (this.menuLeft > 0) {
      this.menuLeft -= dtMs;
      return { frame: this.buildFrame('menu', 0, 0, 0), lapCompleted };
    }

    const i0 = Math.min(n - 1, Math.floor(this.dist));
    const v = this.profile[i0]!;
    const prevDist = this.dist;
    this.dist += v * dt;
    this.lapMs += dt * 1000;
    // Fill the per-meter cumulative time of the current lap.
    for (let m = Math.floor(prevDist) + 1; m <= Math.min(Math.floor(this.dist), n); m++) {
      const frac = (m - prevDist) / Math.max(this.dist - prevDist, 1e-6);
      this.lapCum[m] = this.lapMs - dt * 1000 * (1 - frac);
    }
    // Sector boundaries.
    for (let s = 0; s < SECTORS; s++) {
      const boundary = Math.floor(((s + 1) * n) / SECTORS);
      if (this.sectorSplits[s] === null && this.dist >= boundary) {
        const start = s === 0 ? 0 : Math.floor((s * n) / SECTORS);
        const time = this.lapCum[Math.min(boundary, n)]! - this.lapCum[start]!;
        this.closeSector(s, time);
      }
    }
    // Corner passes (time through entry → exit vs the reference) for `lastPassDeltaMs`.
    const ref = this.refLap();
    for (const c of this.track.corners) {
      if (prevDist < c.exitM && this.dist >= c.exitM && ref && c.exitM <= n) {
        const mine = this.lapCum[c.exitM]! - this.lapCum[c.entryM]!;
        const theirs = ref.cum[c.exitM]! - ref.cum[c.entryM]!;
        if (this.lapCum[c.entryM]! > 0 || c.entryM === 0)
          this.lastPassDelta.set(c.id, mine - theirs);
      }
    }
    if (this.dist >= n) {
      lapCompleted = this.closeLap();
    }

    // Channels from the profile slope.
    const i = Math.min(n - 1, Math.floor(this.dist));
    const vNow = this.profile[i]!;
    const vNext = this.profile[(i + 1) % n]!;
    const accel = (vNext * vNext - vNow * vNow) / 2; // m/s² over 1 m
    return { frame: this.buildFrame('onTrack', vNow, accel, dt), lapCompleted };
  }

  private closeSector(s: number, time: number): void {
    this.sectorSplits[s] = time;
    const ref = this.refLap();
    this.sectorDelta[s] = ref ? time - ref.sectors[s]! : null;
    if (time < this.overallBestSectors[s]!) {
      this.overallBestSectors[s] = time;
      this.pbSectors[s] = Math.min(this.pbSectors[s]!, time);
      this.sectorStatus[s] = 'overallBest';
    } else if (time < this.pbSectors[s]!) {
      this.pbSectors[s] = time;
      this.sectorStatus[s] = 'personalBest';
    } else {
      this.sectorStatus[s] = 'slower';
    }
  }

  private closeLap(): LapCompletedEvent {
    const n = this.track.lengthM;
    const overshoot = this.dist - n;
    const v = Math.max(this.profile[n - 1]!, 1);
    const timeMs = this.lapMs - (overshoot / v) * 1000;
    this.lapCum[n] = timeMs;
    const ref = this.refLap();
    const cum = this.lapCum.slice();
    const lap: RefLap = {
      id: `mock-lap-${this.lap}`,
      profile: this.profile,
      cum,
      sectors: this.sectorSplits.map((s) => s ?? 0),
      timeMs,
    };
    const deltaMs = ref ? timeMs - ref.timeMs : null;
    const valid = !this.mistakeThisLap;
    const isPb = valid && timeMs < this.personalBest.timeMs;
    const isSb = valid && (!this.sessionBest || timeMs < this.sessionBest.timeMs);
    if (isSb) this.sessionBest = lap;
    if (isPb) {
      this.personalBest.cum = cum;
      this.personalBest.profile = this.profile;
      this.personalBest.sectors = [...lap.sectors];
      this.personalBest.timeMs = timeMs;
      this.personalBest.id = lap.id;
    }
    let bestSectorIndex: number | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    this.sectorDelta.forEach((d, idx) => {
      if (d !== null && d < bestDelta) {
        bestDelta = d;
        bestSectorIndex = idx;
      }
    });
    const fuelUsed = this.lapFuelStart - this.fuel;
    this.fuelPerLap = this.fuelPerLap === null ? fuelUsed : this.fuelPerLap * 0.6 + fuelUsed * 0.4;
    const event: LapCompletedEvent = {
      sessionId: 'mock',
      lapId: lap.id,
      lapNumber: this.lap,
      timeMs,
      sectorTimesMs: [...this.sectorSplits],
      sectorStatus: [...this.sectorStatus],
      valid,
      flags: valid ? [] : ['offTrack'],
      deltaMs,
      deltaReference: this.reference,
      isPersonalBest: isPb,
      isSessionBest: isSb,
      bestSectorIndex,
      fuelUsedL: fuelUsed,
      completedAt: this.startAt + this.elapsed,
    };
    // Next lap.
    this.lastLapMs = timeMs;
    this.lap++;
    if (this.lap > TOTAL_LAPS) {
      this.lap = 1;
      this.fuel = FUEL_START;
    }
    this.lapFuelStart = this.fuel;
    this.dist = overshoot;
    this.lapMs = (overshoot / v) * 1000;
    this.lapCum = new Float64Array(n + 1);
    this.sectorSplits = [null, null, null];
    this.sectorStatus = ['pending', 'pending', 'pending'];
    this.sectorDelta = [null, null, null];
    this.profile = this.newLapProfile();
    this.prevDelta = null;
    return event;
  }

  private buildFrame(state: 'menu' | 'onTrack', v: number, accel: number, dt: number): LiveFrame {
    const n = this.track.lengthM;
    const i = Math.min(n - 1, Math.floor(this.dist));
    const kappa = state === 'onTrack' ? this.track.kappa[i]! : 0;
    const kmh = v * 3.6;
    const onTrack = state === 'onTrack';

    // Pedals (first-order smoothing ~80 ms).
    const k = dt > 0 ? Math.min(1, dt / 0.08) : 1;
    let thrTarget = 0;
    let brkTarget = 0;
    if (onTrack) {
      if (accel > 0.4) thrTarget = Math.min(1, 0.45 + accel / Math.max(accelAt(v), 0.5));
      else if (accel < -0.6) brkTarget = Math.min(1, -accel / BRAKE + 0.05);
      else if (kappa !== 0) {
        // Corner: maintenance below 10 % until the pickup point, then partial throttle.
        const c = this.cornerAtM(i);
        const frac = c ? (i - c.entryM) / Math.max(1, c.exitM - c.entryM) : 1;
        thrTarget = frac < this.pickupFrac ? 0.04 : 0.38;
      } else thrTarget = 0.95;
    }
    this.throttle += (thrTarget - this.throttle) * k;
    this.brake += (brkTarget - this.brake) * k;

    const gear = onTrack ? gearFor(kmh) : 0;
    const now = this.elapsed;
    if (gear !== this.gear) {
      this.gear = gear;
      this.clutchUntil = now + 140;
    }
    const clutch = now < this.clutchUntil ? 1 : 0;
    const rpm = onTrack ? rpmFor(kmh, Math.max(gear, 1)) : 1000 + Math.sin(now / 900) * 40;
    const latG = onTrack ? (v * v * kappa) / G : 0;
    const lonG = onTrack ? accel / G : 0;

    // Wheel slip: rear spin under full throttle in low gears, front lock in one braking zone.
    const wob = Math.sin(now / 37) * 0.5 + 0.5;
    const rearSpin = onTrack && this.throttle > 0.9 && gear <= 2 ? 0.06 + wob * 0.14 : 0.01 * wob;
    const nearLock = Math.abs(i - this.lockEvent) < 40 && this.brake > 0.6;
    const frontLock = nearLock ? -(0.15 + wob * 0.12) : -0.01 * this.brake;
    const slip: Wheels = [frontLock, frontLock * 0.8, rearSpin, rearSpin * 0.9];
    const tcs = rearSpin > 0.12;
    const asm = Math.abs(latG) > 1.45 && wob > 0.8;

    // Tyre temperatures: load-based heating, Newtonian cooling to 30 °C.
    if (dt > 0) {
      const leftLoad = 1 - latG * 0.35; // left turn (latG > 0) loads the right side
      const rightLoad = 1 + latG * 0.35;
      const heat: Wheels = [
        Math.abs(latG) * 0.9 * leftLoad + this.brake * 2.2 + (nearLock ? 4 : 0),
        Math.abs(latG) * 0.9 * rightLoad + this.brake * 2.2 + (nearLock ? 3 : 0),
        Math.abs(latG) * 0.8 * leftLoad + this.throttle * 0.7 + rearSpin * 12,
        Math.abs(latG) * 0.8 * rightLoad + this.throttle * 0.7 + rearSpin * 11,
      ];
      for (let w = 0; w < 4; w++) {
        const t = this.tyreT[w]!;
        this.tyreT[w] = t + (heat[w]! * 1.45 - (t - 30) * 0.026) * dt;
      }
    }

    // Suspension height: pitch with longitudinal G, roll with lateral G, small bumps.
    const bump = Math.sin(this.dist / 3.1) * 0.003 + Math.sin(this.dist / 7.7) * 0.002;
    const base = 0.085;
    const suspension: Wheels = [
      base + lonG * 0.012 + latG * 0.01 + bump,
      base + lonG * 0.012 - latG * 0.01 - bump,
      base - lonG * 0.012 + latG * 0.01 - bump,
      base - lonG * 0.012 - latG * 0.01 + bump,
    ];
    // Surface: inner wheels on the kerb near corner apexes.
    const onKerb = Math.abs(kappa) > 1 / 80 && Math.sin(this.dist / 9) > 0.7;
    const left = kappa > 0;
    const surface: Wheels<string> = [
      onKerb && left ? 'C' : 'T',
      onKerb && !left ? 'C' : 'T',
      onKerb && left ? 'C' : 'T',
      onKerb && !left ? 'C' : 'T',
    ];

    // Energy recovery (hybrid-like regen under braking, smoothed).
    if (dt > 0) this.energy += (this.brake * 60 * (v / 60) - this.energy) * Math.min(1, dt / 0.3);

    // Fuel.
    if (onTrack && dt > 0) {
      this.fuel = Math.max(0, this.fuel - (FUEL_PER_LAP / 88) * dt * (0.4 + this.throttle * 0.9));
    }

    // Delta vs reference at this distance.
    const ref = this.refLap();
    let deltaMs: number | null = null;
    if (onTrack && ref && this.dist > 5) {
      const m = Math.min(n, Math.floor(this.dist));
      const frac = this.dist - m;
      const refT = ref.cum[m]! + (ref.cum[Math.min(n, m + 1)]! - ref.cum[m]!) * frac;
      deltaMs = this.lapMs - refT;
      if (this.prevDelta !== null && dt > 0) {
        const rate = (deltaMs - this.prevDelta) / dt;
        this.deltaRate += (rate - this.deltaRate) * Math.min(1, dt / 0.5);
      }
      this.prevDelta = deltaMs;
    }

    const sectors: SectorSplit[] = this.sectorSplits.map((t, index) => ({
      index,
      timeMs: t,
      status: this.sectorStatus[index]!,
      deltaMs: this.sectorDelta[index]!,
    }));

    const steer = onTrack ? Math.atan(2.7 * kappa) * 14 + Math.sin(now / 160) * 0.02 : 0;
    const boost = onTrack ? -0.8 + this.throttle * (rpm / RPM_MAX) * 2.1 : -0.9;
    const t = this.startAt + this.elapsed;

    return {
      seq: this.seq,
      t,
      packetId: 100000 + this.seq,
      format: 'C',
      state,
      car: {
        speedKmh: kmh,
        rpm,
        gear,
        suggestedGear: onTrack && accel < -3 && gear > 2 ? gear - 1 : null,
        throttle: this.throttle,
        brake: this.brake,
        clutch,
        throttleRaw: Math.min(1, this.throttle * (tcs ? 1.15 : 1)),
        brakeRaw: this.brake,
        steeringRad: steer,
        boostBar: boost,
        oilPressureBar: 1.4 + (rpm / RPM_MAX) * 4.2,
        rpmAlert: { min: 6600, max: 8100 },
        maxSpeedKmh: 286,
        carCode: 3337,
      },
      tyres: {
        tempC: [...this.tyreT] as Wheels,
        slip,
        suspensionM: suspension,
        surface,
      },
      fuel: {
        level: this.fuel,
        capacity: 100,
        perLapAvg: this.fuelPerLap,
        lapsRemaining: this.fuelPerLap ? this.fuel / this.fuelPerLap : null,
        // Same semantics as the core: total needed from here to the flag (not what to add).
        neededToFinish: this.fuelPerLap
          ? Math.max(0, (TOTAL_LAPS - this.lap + 1 - this.dist / n) * this.fuelPerLap)
          : null,
        energyRecovery: onTrack ? this.energy : null,
      },
      g: { lateral: latG, longitudinal: lonG, vertical: onTrack ? 1 + bump * 20 : 1 },
      flags: {
        carOnTrack: onTrack,
        paused: false,
        loadingOrProcessing: false,
        inGear: gear > 0,
        hasTurbo: true,
        revLimiterAlert: rpm > 8150,
        handBrake: false,
        lights: false,
        highBeam: false,
        lowBeam: false,
        asmActive: asm,
        tcsActive: tcs,
      },
      position: this.positionAt(this.dist),
      headingRad: this.track.heading[i]!,
      lap: {
        lap: this.lap,
        totalLaps: TOTAL_LAPS,
        currentLapMs: onTrack ? this.lapMs : 0,
        lastLapMs: this.lastLapMs,
        bestLapMs: this.sessionBest?.timeMs ?? null,
        predictedLapMs: ref && deltaMs !== null ? ref.timeMs + deltaMs : null,
        referenceLapMs: ref?.timeMs ?? null,
        currentLapValid: !(this.mistakeThisLap && this.dist > this.mistakeAt),
        delta: {
          ms: deltaMs,
          reference: this.reference,
          referenceLapId: ref?.id ?? null,
          rateMsPerS: deltaMs === null ? null : this.deltaRate,
        },
      },
      sectors,
      distanceM: onTrack ? this.dist : null,
      lapFraction: onTrack ? this.dist / n : null,
      track: {
        id: MOCK_TRACK_ID,
        name: 'Circuito de demonstração',
        lengthM: n,
        confidence: 'confirmed',
      },
      nextCorner: onTrack ? this.nextCornerHint() : null,
      link: { rateHz: 60, lossPct: 0, lost: 0, received: this.seq, lastPacketAt: t },
    };
  }
}
