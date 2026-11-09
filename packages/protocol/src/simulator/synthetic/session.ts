/**
 * Stateful synthetic telemetry stream: menu/loading packets, an out lap, then flying laps, at a
 * fixed packet rate (60 Hz). Deterministic for a given seed.
 */

import {
  encodeFlags,
  formatIncludes,
  type PacketFormat,
  SUGGESTED_GEAR_NONE,
  type TelemetryPacket,
  type Wheels,
} from '@gt7/shared';
import {
  buildCornerMaps,
  CAR,
  type CornerIndexMaps,
  DRIVER_PROFILES,
  type DriverProfile,
  type DriverProfileName,
  dragDecel,
  drawCornerPlans,
  findTimeIndex,
  G,
  type LapPlan,
  maxPropulsion,
  planLap,
  rpmFor,
} from './model.ts';
import { Rng } from './rng.ts';
import { getSyntheticTrack, type SyntheticTrack, sampleTrackAt } from './track.ts';

export interface SyntheticOptions {
  profile?: DriverProfileName;
  seed?: number;
  /** Packet format of the produced packets (fields outside the format are stripped). Default 'C'. */
  format?: PacketFormat;
  /** Packet rate (default 60). */
  rateHz?: number;
  /** Emit menu + loading packets before the car is on track (default true). */
  includeMenu?: boolean;
  /** Seconds of menu packets (default 2) and loading packets (default 1). */
  menuS?: number;
  loadingS?: number;
  /** Out lap distance before the start line in meters (default 600). */
  outLapM?: number;
  /**
   * Mimic what a real PS5 sends while a REPLAY plays (measured, Onda 9a): car data in real time
   * but `carOnTrack` false (flags carry only inGear / revLimiterAlert), no lap clock
   * (currentLapMs 0, lastLapMs / bestLapMs empty), a lapCount that stays at 1 and never advances,
   * and zeroed packets (speed 0, position 0,0,0, carCode 0) in the "menu" stretch. Inputs are
   * smoothed and fuel is not consumed. Default false.
   */
  replay?: boolean;
  /** First packetId (default derived from seed). */
  firstPacketId?: number;
  /** Car code (default synthetic car). */
  carCode?: number;
}

export type SyntheticPhase = 'menu' | 'loading' | 'outLap' | 'lap';

interface WheelState {
  temp: number;
}

const AMBIENT_C = 25;
const START_TYRE_C = 45;

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function smoothstep(u: number): number {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Keeps only the fields that exist in `format`. */
export function stripToFormat(p: TelemetryPacket, format: PacketFormat): TelemetryPacket {
  const out: TelemetryPacket = { ...p, format };
  if (!formatIncludes(format, 'B')) {
    delete out.steeringAngle;
    delete out.steeringAngularVelocity;
    delete out.sway;
    delete out.heave;
    delete out.surge;
  }
  if (!formatIncludes(format, '~')) {
    delete out.throttleRaw;
    delete out.brakeRaw;
    delete out.unknown0x13E;
    delete out.energyRecoveryFlag;
    delete out.torqueVectoring;
    delete out.energyRecovery;
    delete out.unknown0x154;
  }
  if (!formatIncludes(format, 'C')) {
    delete out.surfaceTypes;
    delete out.currentLapMs;
    delete out.wheelSteerAngle;
    delete out.wheelbase;
    delete out.carCategory;
  }
  return out;
}

export interface CompletedLapInfo {
  lapNumber: number;
  timeMs: number;
  /** Corners where the driver made a mistake (ids). */
  mistakes: string[];
}

export class SyntheticSession {
  readonly track: SyntheticTrack;
  readonly profile: DriverProfile;
  readonly options: Required<Omit<SyntheticOptions, 'firstPacketId' | 'carCode'>> & {
    carCode: number;
  };
  readonly completedLaps: CompletedLapInfo[] = [];

  #rng: Rng;
  #maps: CornerIndexMaps;
  #dt: number;
  #phase: SyntheticPhase;
  #phaseT = 0;
  #plan: LapPlan;
  #tau = 0;
  #lapCount = 0;
  #lastLapMs = -1;
  #bestLapMs = -1;
  #packetId: number;
  #elapsed = 0;
  // driver/car state
  #gear = 1;
  #lastShiftT = -1;
  #throttle = 0;
  #brake = 0;
  #throttleSmooth = 0;
  #brakeSmooth = 0;
  #steer = 0;
  #fuel: number;
  #wheels: WheelState[];
  #lockTimer = 0;
  #prevSlope = 0;

  constructor(opts: SyntheticOptions = {}) {
    const seed = opts.seed ?? 1;
    this.options = {
      profile: opts.profile ?? 'pro',
      seed,
      format: opts.format ?? 'C',
      rateHz: opts.rateHz ?? 60,
      includeMenu: opts.includeMenu ?? true,
      menuS: opts.menuS ?? 2,
      loadingS: opts.loadingS ?? 1,
      outLapM: opts.outLapM ?? 600,
      replay: opts.replay ?? false,
      carCode: opts.carCode ?? CAR.carCode,
    };
    this.track = getSyntheticTrack();
    this.profile = DRIVER_PROFILES[this.options.profile];
    this.#rng = new Rng(seed);
    this.#maps = buildCornerMaps(this.track);
    this.#dt = 1 / this.options.rateHz;
    this.#packetId = opts.firstPacketId ?? 1000 + (this.#rng.u32() % 100000);
    this.#fuel = CAR.fuelStartL;
    this.#wheels = [0, 1, 2, 3].map(() => ({ temp: START_TYRE_C }));
    this.#phase = this.options.includeMenu ? 'menu' : 'outLap';
    // Out lap plan: starts outLapM before the line from a rolling 15 m/s.
    const startIdx = Math.max(
      0,
      Math.min(
        this.track.samples.length - 1,
        Math.round(this.track.lengthM - this.options.outLapM),
      ),
    );
    this.#plan = planLap(
      this.track,
      this.#maps,
      this.profile,
      drawCornerPlans(this.track, this.profile, this.#rng.fork(999)),
      15,
      startIdx,
    );
  }

  get phase(): SyntheticPhase {
    return this.#phase;
  }

  get lapCount(): number {
    return this.#lapCount;
  }

  /** Elapsed session time in seconds. */
  get elapsedS(): number {
    return this.#elapsed;
  }

  /** Produces the next packet (advances time by 1/rateHz). */
  next(): TelemetryPacket {
    const p =
      this.#phase === 'menu' || this.#phase === 'loading'
        ? this.#menuPacket()
        : this.#drivePacket();
    this.#packetId = (this.#packetId + 1) | 0;
    this.#elapsed += this.#dt;
    return stripToFormat(p, this.options.format);
  }

  // ------------------------------------------------------------------------------------------

  #basePacket(): TelemetryPacket {
    const zero = { x: 0, y: 0, z: 0 };
    const temps = this.#wheels.map((w) => w.temp) as Wheels;
    return {
      format: 'C',
      position: zero,
      velocity: zero,
      rotation: zero,
      relativeOrientationToNorth: 1,
      angularVelocity: zero,
      bodyHeight: 0.075,
      engineRpm: CAR.idleRpm,
      fuelLevel: this.#fuel,
      fuelCapacity: CAR.fuelCapacityL,
      speedMps: 0,
      boost: 0.9,
      oilPressure: 1.2,
      waterTemp: 85,
      oilTemp: 110,
      tyreTemp: temps,
      packetId: this.#packetId,
      lapCount: this.#lapCount,
      totalLaps: 0,
      bestLapMs: this.#bestLapMs,
      lastLapMs: this.#lastLapMs,
      timeOfDayMs: Math.round(14 * 3600_000 + this.#elapsed * 1000),
      preRacePosition: -1,
      numCarsPreRace: -1,
      rpmAlertMin: CAR.rpmAlertMin,
      rpmAlertMax: CAR.rpmAlertMax,
      calculatedMaxSpeedKmh: CAR.calculatedMaxSpeedKmh,
      flags: 0,
      gear: 0,
      suggestedGear: SUGGESTED_GEAR_NONE,
      throttle: 0,
      brake: 0,
      roadPlane: { x: 0, y: 1, z: 0 },
      roadPlaneDistance: 0,
      wheelRps: [0, 0, 0, 0],
      tyreRadius: [...CAR.tyreRadius] as Wheels,
      suspensionHeight: [0.08, 0.08, 0.085, 0.085],
      clutchPedal: 0,
      clutchEngagement: 1,
      rpmClutchToGearbox: 0,
      transmissionTopSpeed: CAR.gearRatios[CAR.gearRatios.length - 1]!,
      gearRatios: [...CAR.gearRatios, 0],
      carCode: this.options.carCode,
      steeringAngle: 0,
      steeringAngularVelocity: 0,
      sway: 0,
      heave: 0,
      surge: 0,
      throttleRaw: 0,
      brakeRaw: 0,
      unknown0x13E: 0,
      energyRecoveryFlag: 0,
      torqueVectoring: [0, 0, 0, 0],
      energyRecovery: 0,
      unknown0x154: 0,
      surfaceTypes: ['T', 'T', 'T', 'T'],
      currentLapMs: 0,
      wheelSteerAngle: [0, 0],
      wheelbase: CAR.wheelbaseM,
      carCategory: CAR.category,
    };
  }

  #menuPacket(): TelemetryPacket {
    const p = this.#basePacket();
    if (this.options.replay) {
      // a real console sends all-zero packets in menus / garage
      this.#phaseT += this.#dt;
      if (this.#phaseT >= (this.#phase === 'menu' ? this.options.menuS : this.options.loadingS)) {
        this.#phase = this.#phase === 'menu' ? 'loading' : 'outLap';
        this.#phaseT = 0;
      }
      return {
        ...p,
        position: { x: 0, y: 0, z: 0 },
        engineRpm: 0,
        speedMps: 0,
        carCode: 0,
        flags: 0,
        lapCount: 0,
        bestLapMs: -1,
        lastLapMs: -1,
        currentLapMs: 0,
      };
    }
    const start = sampleTrackAt(this.track, this.track.lengthM - this.options.outLapM);
    p.position = { x: start.x, y: start.y, z: start.z };
    p.rotation = { x: 0, y: Math.sin(start.heading / 2), z: 0 };
    p.relativeOrientationToNorth = Math.cos(start.heading / 2);
    if (this.#phase === 'menu') {
      p.flags = encodeFlags({ paused: true, hasTurbo: true });
    } else {
      p.flags = encodeFlags({ loadingOrProcessing: true, hasTurbo: true });
    }
    this.#phaseT += this.#dt;
    if (this.#phase === 'menu' && this.#phaseT >= this.options.menuS) {
      this.#phase = 'loading';
      this.#phaseT = 0;
    } else if (this.#phase === 'loading' && this.#phaseT >= this.options.loadingS) {
      this.#phase = 'outLap';
      this.#phaseT = 0;
    }
    return p;
  }

  #completeLap(): void {
    const plan = this.#plan;
    const isOut = this.#phase === 'outLap';
    if (!isOut) {
      const ms = Math.round(plan.lapTimeS * 1000);
      this.#lastLapMs = ms;
      if (this.#bestLapMs < 0 || ms < this.#bestLapMs) this.#bestLapMs = ms;
      this.completedLaps.push({
        lapNumber: this.#lapCount,
        timeMs: ms,
        mistakes: plan.corners.flatMap((c, i) => (c.mistake ? [this.track.corners[i]!.id] : [])),
      });
    }
    this.#tau -= plan.lapTimeS;
    this.#lapCount++;
    this.#phase = 'lap';
    const corners = drawCornerPlans(this.track, this.profile, this.#rng.fork(this.#lapCount));
    this.#plan = planLap(this.track, this.#maps, this.profile, corners, plan.vEnd, 0);
  }

  /** Lateral offset (m, + = left) of the driven line vs the centerline at distance s. */
  #lineOffset(s: number, plan: LapPlan): number {
    const L = this.track.lengthM;
    let offset = 0;
    this.track.corners.forEach((c, i) => {
      const cp = plan.corners[i]!;
      let d = s - c.entryM;
      if (d < -L / 2) d += L;
      if (d >= L / 2) d -= L;
      const keys: [number, number][] = [
        [-60, 0],
        [0, cp.offsetEntry],
        [c.apexM - c.entryM, cp.offsetApex],
        [c.exitM - c.entryM, cp.offsetExit],
        [c.exitM - c.entryM + 80, 0],
      ];
      for (let k = 0; k < keys.length - 1; k++) {
        const [sa, va] = keys[k]!;
        const [sb, vb] = keys[k + 1]!;
        if (d >= sa && d < sb) {
          offset += va + (vb - va) * smoothstep((d - sa) / Math.max(1e-6, sb - sa));
          break;
        }
      }
    });
    return offset;
  }

  #drivePacket(): TelemetryPacket {
    const dt = this.#dt;
    this.#tau += dt;
    while (this.#tau >= this.#plan.lapTimeS) this.#completeLap();
    const plan = this.#plan;
    const track = this.track;
    const prof = this.profile;
    const replay = this.options.replay;

    // ---- position along the lap ----
    const j = findTimeIndex(plan, this.#tau);
    const t0 = plan.t[j]!;
    const t1 = plan.t[j + 1]!;
    const u = t1 > t0 ? (this.#tau - t0) / (t1 - t0) : 0;
    const s = plan.s[j]! + (plan.s[j + 1]! - plan.s[j]!) * u;
    const v = plan.v[j]! + (plan.v[j + 1]! - plan.v[j]!) * u;
    const aLon = plan.a[j]! + (plan.a[j + 1]! - plan.a[j]!) * u;
    const ts = sampleTrackAt(track, s);
    const kappa = ts.curvatureSmooth;
    const aLat = v * v * kappa; // + = left
    const ci = this.#maps.next[Math.min(track.samples.length - 1, Math.floor(s))]!;
    const corner = track.corners[ci]!;
    const cp = plan.corners[ci]!;

    // ---- racing line lateral offset ----
    const offset = this.#lineOffset(s, plan);
    const nx = Math.cos(ts.heading);
    const nz = -Math.sin(ts.heading);
    const px = ts.x + nx * offset;
    const pz = ts.z + nz * offset;

    // ---- pedals ----
    const needed = aLon + dragDecel(v);
    let throttleTarget = 0;
    let brakeTarget = 0;
    if (needed >= 0) {
      throttleTarget = clamp(needed / maxPropulsion(v), 0, 1);
    } else if (-needed > CAR.engineBrakeMps2 * 0.9) {
      brakeTarget = clamp((-needed - CAR.engineBrakeMps2) / (CAR.maxBrakeG * G), 0, 1);
    }
    const rate = (cur: number, target: number, up: number, down: number) =>
      target > cur ? Math.min(target, cur + up * dt) : Math.max(target, cur - down * dt);
    this.#throttle = rate(this.#throttle, throttleTarget, prof.throttleRise, 8);
    this.#brake = rate(this.#brake, brakeTarget, prof.brakeRise, 6);
    // replay smoothing (exponential, ~0.25 s)
    const alpha = replay ? dt / 0.25 : 1;
    this.#throttleSmooth += (this.#throttle - this.#throttleSmooth) * alpha;
    this.#brakeSmooth += (this.#brake - this.#brakeSmooth) * alpha;
    const throttle = this.#throttleSmooth;
    const brake = this.#brakeSmooth;

    // ---- gearbox ----
    const nGears = CAR.gearRatios.length;
    const rpmNow = rpmFor(v, this.#gear);
    if (this.#elapsed - this.#lastShiftT > 0.25) {
      if (rpmNow > prof.shiftUpRpm && this.#gear < nGears) {
        this.#gear++;
        this.#lastShiftT = this.#elapsed;
      } else if (
        this.#gear > 1 &&
        rpmFor(v, this.#gear - 1) < prof.downshiftRpm &&
        throttle < 0.5
      ) {
        this.#gear--;
        this.#lastShiftT = this.#elapsed;
      }
    }
    // suggested gear: while braking, the gear that fits the corner's min speed
    let suggested: number | null = null;
    if (brake > 0.2) {
      const apexIdx = Math.min(plan.v.length - 1, Math.floor(corner.apexM));
      const vApex = plan.v[apexIdx] ?? v;
      for (let g = nGears; g >= 1; g--) {
        if (rpmFor(vApex, g) >= 4500) {
          suggested = g;
          break;
        }
      }
    }

    // ---- slip ----
    const latRatio = Math.min(1, Math.abs(aLat) / (CAR.lateralG * G));
    let rearSlip =
      0.012 * throttle +
      throttle * 0.06 * (maxPropulsion(v) / (CAR.tractionG * G)) * (0.4 + latRatio) +
      (prof.name === 'amateur' && this.#throttle - throttleTarget > -0.05 && latRatio > 0.5
        ? 0.04 * throttle
        : 0);
    let tcs = false;
    if (prof.tcs && rearSlip > 0.09) {
      rearSlip = 0.09;
      tcs = true;
    }
    let frontSlip = -0.015 * brake - 0.04 * brake * brake;
    if (cp.mistake && brake > 0.6 && this.#lockTimer <= 0) this.#lockTimer = 0.35;
    if (this.#lockTimer > 0) {
      this.#lockTimer -= dt;
      if (brake > 0.3) frontSlip = -0.28;
    }
    const halfW = CAR.trackWidthM / 2;
    const inner = (left: boolean) => 1 - (left ? 1 : -1) * kappa * halfW;
    const slips: Wheels = [frontSlip, frontSlip, rearSlip, rearSlip];
    const wheelRps = [0, 1, 2, 3].map((i) => {
      const left = i === 0 || i === 2;
      const r = CAR.tyreRadius[i as 0 | 1 | 2 | 3];
      return ((v * inner(left)) / r) * (1 + slips[i as 0 | 1 | 2 | 3]);
    }) as Wheels;

    // ---- engine ----
    let rpm = rpmFor(v, this.#gear) * (1 + rearSlip);
    rpm = clamp(rpm, CAR.idleRpm, CAR.limiterRpm);
    const rpmRatio = rpm / CAR.limiterRpm;
    const boost = 1 + (throttle > 0.05 ? 1.3 * throttle * rpmRatio ** 1.5 : -0.35);
    const oilPressure = 1.4 + 4.6 * rpmRatio;

    // ---- steering ----
    const delta = Math.atan(CAR.wheelbaseM * kappa) + 0.0025 * aLat; // slight understeer
    const inCorner = Math.abs(kappa) > 0.002;
    const wobble = inCorner
      ? cp.wobble * Math.sin(2 * Math.PI * 1.6 * this.#elapsed) +
        cp.wobble * 0.5 * Math.sin(2 * Math.PI * 3.1 * this.#elapsed + 1)
      : 0;
    let steer = (delta + wobble) * CAR.steeringRatio;
    if (replay) steer = this.#steer + (steer - this.#steer) * (dt / 0.15);
    const steerRate = (steer - this.#steer) / dt;
    this.#steer = steer;

    // ---- tyre temperatures ----
    const latG = aLat / G;
    const lonG = aLon / G;
    for (let i = 0; i < 4; i++) {
      const left = i === 0 || i === 2;
      const front = i < 2;
      const outer = (latG > 0 && !left) || (latG < 0 && left);
      const latLoad = Math.abs(latG) * (outer ? 0.72 : 0.28);
      const lonLoad = lonG < 0 ? -lonG * (front ? 0.68 : 0.32) : lonG * (front ? 0.25 : 0.75);
      const slipHeat = Math.abs(slips[i as 0 | 1 | 2 | 3]) * 6;
      const heat = v * (latLoad + lonLoad + slipHeat + 0.05) * 0.15;
      const w = this.#wheels[i]!;
      w.temp += (heat - 0.045 * (w.temp - AMBIENT_C) * (1 + v / 60)) * dt;
    }

    // ---- suspension / body ----
    const bump = 0.0015 * Math.sin(s * 0.7) + 0.001 * Math.sin(s * 2.3 + 1);
    const suspension = [0, 1, 2, 3].map((i) => {
      const left = i === 0 || i === 2;
      const front = i < 2;
      const base = front ? 0.08 : 0.085;
      // smaller value = compressed. Braking (lonG<0) compresses fronts, extends rears.
      const pitch = lonG * 0.008 * (front ? 1 : -1);
      // Left turn (latG>0) compresses the right (outer) side.
      const roll = latG * 0.007 * (left ? 1 : -1);
      return base + pitch + roll + bump;
    }) as Wheels;
    const heave = (v * v * (ts.slope - this.#prevSlope)) / Math.max(0.01, v * dt) / G;
    this.#prevSlope = ts.slope;

    // ---- fuel ----
    if (!replay)
      this.#fuel = Math.max(0, this.#fuel - throttle * rpm * CAR.fuelPerThrottleRpmS * dt);

    // ---- assemble ----
    const p = this.#basePacket();
    const heading = ts.heading;
    p.position = { x: px, y: ts.y, z: pz };
    p.velocity = { x: v * Math.sin(heading), y: v * ts.slope, z: v * Math.cos(heading) };
    p.rotation = { x: 0, y: Math.sin(heading / 2), z: 0 };
    p.relativeOrientationToNorth = Math.cos(heading / 2);
    p.angularVelocity = { x: 0, y: v * kappa, z: 0 };
    p.bodyHeight = 0.075 - 0.004 * Math.abs(lonG) - 0.003 * Math.abs(latG);
    p.engineRpm = rpm;
    p.speedMps = v;
    p.boost = boost;
    p.oilPressure = oilPressure;
    p.flags = replay
      ? encodeFlags({ inGear: true, revLimiterAlert: rpm >= CAR.rpmAlertMax })
      : encodeFlags({
          carOnTrack: true,
          inGear: true,
          hasTurbo: true,
          revLimiterAlert: rpm >= CAR.rpmAlertMax,
          tcsActive: tcs,
          asmActive: prof.name === 'amateur' && cp.mistake && inCorner && latRatio > 0.8,
        });
    p.gear = this.#gear;
    p.suggestedGear = suggested ?? SUGGESTED_GEAR_NONE;
    p.throttle = Math.round(throttle * 255);
    p.brake = Math.round(brake * 255);
    p.roadPlane = { x: -ts.slope * Math.sin(heading), y: 1, z: -ts.slope * Math.cos(heading) };
    p.roadPlaneDistance = ts.y;
    p.wheelRps = wheelRps;
    p.suspensionHeight = suspension;
    p.rpmClutchToGearbox = rpm;
    p.steeringAngle = steer;
    p.steeringAngularVelocity = steerRate;
    // Real-console units (verified): m/s², sway + = right (latG here is + = left), surge + = forward.
    p.sway = -latG * G;
    p.heave = clamp(heave, -3, 3) * G;
    p.surge = lonG * G;
    p.throttleRaw = Math.round(throttleTarget * 255);
    p.brakeRaw = Math.round(brakeTarget * 255);
    p.currentLapMs = this.#phase === 'lap' && !replay ? Math.round(this.#tau * 1000) : 0;
    if (replay) {
      // what the console really sends in a replay: no lap clock, lapCount stuck at 1, car not
      // "on track" as far as the flags go
      p.lapCount = 1;
      p.bestLapMs = -1;
      p.lastLapMs = -1;
    }
    p.wheelSteerAngle = [delta, delta];
    const offTrack = Math.abs(offset) > 5;
    p.surfaceTypes = offTrack
      ? ['G', 'G', 'G', 'G']
      : Math.abs(offset) > 3.5
        ? ['C', 'C', 'T', 'T']
        : ['T', 'T', 'T', 'T'];
    return p;
  }
}
