/**
 * Pure logic of the lap replay (`#/analise/volta/:id`): the lap clock (time ↔ distance), the pace of
 * the playback, the ghost of the reference (same distance or same time) and the live gap.
 *
 * The traces endpoint resamples laps on a distance grid and already carries the lap time at each
 * grid point (`time`), so one lap is a monotone `timeS(distance)`: inverting it gives the position
 * at any instant. Nothing here touches the DOM or React.
 */

import { gridIndex, type Series, valueAt } from './chartData.ts';

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];
export const DEFAULT_SPEED: PlaybackSpeed = 1;

/** Where the ghost of the reference is drawn: same lap distance, or same lap clock. */
export type GhostMode = 'distance' | 'time';
export const DEFAULT_GHOST_MODE: GhostMode = 'distance';

/** Arrow keys step 0.1 s; with Shift, 1 s. */
export const STEP_S = 0.1;
export const BIG_STEP_S = 1;
/** A frame longer than this (tab in the background) does not make the car jump. */
export const MAX_FRAME_MS = 250;

/** One lap as a monotone clock over the distance grid. */
export interface LapClock {
  distanceM: ArrayLike<number>;
  /** Lap clock (s) at each grid point, non-decreasing, starting at the first point. */
  timeS: Float64Array;
  durationS: number;
}

export interface ReplayPoint {
  timeS: number;
  distanceM: number;
}

/**
 * Clock of a lap from the traces: gaps are carried forward and time never goes back. Null when
 * there is no usable time channel (the replay then has nothing to play).
 */
export function buildClock(distanceM: ArrayLike<number>, timeS: Series): LapClock | null {
  const n = Math.min(distanceM.length, timeS.length);
  if (n < 2) return null;
  const out = new Float64Array(n);
  let last: number | null = null;
  let first: number | null = null;
  for (let i = 0; i < n; i++) {
    const v = timeS[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      if (first === null) first = v;
      last = last === null ? v : Math.max(last, v);
    }
    out[i] = last ?? Number.NaN;
  }
  if (first === null) return null;
  // Leading gap: the lap starts at the first known time.
  for (let i = 0; i < n && Number.isNaN(out[i]!); i++) out[i] = first;
  const t0 = out[0]!;
  for (let i = 0; i < n; i++) out[i] = out[i]! - t0;
  const durationS = out[n - 1]!;
  if (!(durationS > 0)) return null;
  return {
    distanceM: Array.prototype.slice.call(distanceM, 0, n) as number[],
    timeS: out,
    durationS,
  };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Lap clock (s) at a distance (linear between grid points, clamped to the lap). */
export function timeAtDistance(clock: LapClock, d: number): number {
  const g = clock.distanceM;
  const last = g.length - 1;
  if (d <= g[0]!) return clock.timeS[0]!;
  if (d >= g[last]!) return clock.timeS[last]!;
  const i = gridIndex(g, d);
  const x0 = g[i]!;
  const x1 = g[i + 1]!;
  const f = x1 > x0 ? (d - x0) / (x1 - x0) : 0;
  return clock.timeS[i]! + (clock.timeS[i + 1]! - clock.timeS[i]!) * f;
}

/** Distance at a lap clock instant (the inverse of {@link timeAtDistance}, clamped to the lap). */
export function distanceAtTime(clock: LapClock, t: number): number {
  const ts = clock.timeS;
  const g = clock.distanceM;
  const last = ts.length - 1;
  if (t <= ts[0]!) return g[0]!;
  if (t >= ts[last]!) return g[last]!;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const t0 = ts[lo]!;
  const t1 = ts[hi]!;
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return g[lo]! + (g[hi]! - g[lo]!) * f;
}

export function pointAtTime(clock: LapClock, t: number): ReplayPoint {
  const timeS = clamp(t, 0, clock.durationS);
  return { timeS, distanceM: distanceAtTime(clock, timeS) };
}

export function pointAtDistance(clock: LapClock, d: number): ReplayPoint {
  const distanceM = clamp(d, clock.distanceM[0]!, clock.distanceM[clock.distanceM.length - 1]!);
  return { distanceM, timeS: timeAtDistance(clock, distanceM) };
}

/**
 * Where the reference is while the subject is at `p`: at the same distance (what each driver did
 * at that point of the lap) or at the same lap clock (who is ahead on the track).
 */
export function ghostPoint(mode: GhostMode, ghost: LapClock, p: ReplayPoint): ReplayPoint {
  return mode === 'time' ? pointAtTime(ghost, p.timeS) : pointAtDistance(ghost, p.distanceM);
}

export interface LiveGap {
  /** Time delta at the subject's distance, subject − reference (s): + = slower. */
  deltaS: number;
  /** Subject distance − ghost distance (m): + = the subject is ahead on the track. */
  gapM: number;
}

export function liveGap(subject: LapClock, ghost: LapClock, mode: GhostMode, p: ReplayPoint) {
  const g = ghostPoint(mode, ghost, p);
  return {
    deltaS: timeAtDistance(subject, p.distanceM) - timeAtDistance(ghost, p.distanceM),
    gapM: p.distanceM - g.distanceM,
  } satisfies LiveGap;
}

/**
 * Advances the replay clock by `elapsedMs` of wall time at `speed`. Stops at the end of the lap
 * (`ended`) unless `loop`, which wraps around.
 */
export function advancePlayback(
  t: number,
  elapsedMs: number,
  speed: number,
  durationS: number,
  loop = false,
): { t: number; ended: boolean } {
  const dt = (clamp(elapsedMs, 0, MAX_FRAME_MS) / 1000) * speed;
  const next = t + dt;
  if (next < durationS) return { t: Math.max(0, next), ended: false };
  if (loop && durationS > 0) return { t: next % durationS, ended: false };
  return { t: durationS, ended: true };
}

/** One step of the arrow keys / buttons, clamped to the lap. */
export function stepTime(t: number, seconds: number, durationS: number): number {
  return clamp(t + seconds, 0, durationS);
}

/** The next speed in the list (`dir` +1 faster, −1 slower), staying at the ends. */
export function shiftSpeed(speed: number, dir: 1 | -1): PlaybackSpeed {
  const i = PLAYBACK_SPEEDS.findIndex((s) => s === speed);
  const from = i < 0 ? PLAYBACK_SPEEDS.indexOf(DEFAULT_SPEED) : i;
  return PLAYBACK_SPEEDS[clamp(from + dir, 0, PLAYBACK_SPEEDS.length - 1)]!;
}

/** A channel at a distance; `step` keeps the last grid value (gear) instead of interpolating. */
export function sampleAt(
  grid: ArrayLike<number>,
  values: Series,
  d: number,
  step = false,
): number | null {
  if (!step) return valueAt(grid, values, d);
  const i = gridIndex(grid, d);
  return i < 0 ? null : (values[i] ?? null);
}

/**
 * Keeps `d` inside a zoomed chart range while playing: the window keeps its width and moves so the
 * car stays inside. Returns the same range when `d` is already inside (or there is no zoom).
 */
export function followRange(
  range: [number, number] | null,
  d: number,
  lengthM: number,
): [number, number] | null {
  if (!range) return null;
  const [a, b] = range;
  if (d >= a && d <= b) return range;
  const width = b - a;
  if (!(width > 0) || width >= lengthM) return null;
  const from = clamp(d - width * 0.25, 0, Math.max(0, lengthM - width));
  return [from, from + width];
}

/** Reading of a pedal or steering for the bars: 0..1 of the full travel, or null without data. */
export function barFraction(v: number | null, full: number): number | null {
  if (v === null || !Number.isFinite(v) || !(full > 0)) return null;
  return clamp(Math.abs(v) / full, 0, 1);
}

// ---------------------------------------------------------------------------------------------
// One instant of the replay
// ---------------------------------------------------------------------------------------------

/** A lap prepared for the replay: its clock and the channels on the shared distance grid. */
export interface ReplayLapData {
  clock: LapClock;
  /** `speed`, `throttle`, `brake`, `gear`, `steering`, `rpm`, `x`, `z` (raw units). */
  series: Record<string, Series>;
}

/** Channels that keep the grid value instead of being interpolated. */
const STEPPED_CHANNELS: ReadonlySet<string> = new Set(['gear']);

export interface LapSample extends ReplayPoint {
  values: Record<string, number | null>;
}

export function sampleLap(lap: ReplayLapData, grid: ArrayLike<number>, p: ReplayPoint): LapSample {
  const values: Record<string, number | null> = {};
  for (const [key, s] of Object.entries(lap.series)) {
    values[key] = sampleAt(grid, s, p.distanceM, STEPPED_CHANNELS.has(key));
  }
  return { ...p, values };
}

export interface ReplayFrame {
  subject: LapSample;
  /** The reference (null = replay without a reference). */
  ghost: LapSample | null;
  gap: LiveGap | null;
}

/** Everything the screen shows at the replay instant `t` (s of the subject's lap clock). */
export function frameAt(
  grid: ArrayLike<number>,
  subject: ReplayLapData,
  ghost: ReplayLapData | null,
  mode: GhostMode,
  t: number,
): ReplayFrame {
  const p = pointAtTime(subject.clock, t);
  if (!ghost) return { subject: sampleLap(subject, grid, p), ghost: null, gap: null };
  return {
    subject: sampleLap(subject, grid, p),
    ghost: sampleLap(ghost, grid, ghostPoint(mode, ghost.clock, p)),
    gap: liveGap(subject.clock, ghost.clock, mode, p),
  };
}

// ---------------------------------------------------------------------------------------------
// Player: the clock of the replay, outside React (it changes at frame rate)
// ---------------------------------------------------------------------------------------------

export interface PlayerState {
  timeS: number;
  playing: boolean;
  speed: PlaybackSpeed;
}

export interface PlayerScheduler {
  request: (cb: (nowMs: number) => void) => number;
  cancel: (id: number) => void;
}

const BROWSER_SCHEDULER: PlayerScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

/**
 * Play / pause / seek / speed of one replay. The state is replaced (never mutated) on every change,
 * so it works with `useSyncExternalStore`. At the end of the lap it pauses on the last instant;
 * playing again from there starts over.
 */
export class ReplayPlayer {
  #state: PlayerState = { timeS: 0, playing: false, speed: DEFAULT_SPEED };
  #listeners = new Set<() => void>();
  #raf = 0;
  #last: number | null = null;
  readonly durationS: number;
  readonly #scheduler: PlayerScheduler;

  constructor(durationS: number, scheduler: PlayerScheduler = BROWSER_SCHEDULER) {
    this.durationS = durationS;
    this.#scheduler = scheduler;
  }

  get state(): PlayerState {
    return this.#state;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): PlayerState => this.#state;

  #set(patch: Partial<PlayerState>): void {
    const next = { ...this.#state, ...patch };
    if (
      next.timeS === this.#state.timeS &&
      next.playing === this.#state.playing &&
      next.speed === this.#state.speed
    ) {
      return;
    }
    this.#state = next;
    for (const fn of this.#listeners) fn();
  }

  play(): void {
    if (this.#state.playing || this.durationS <= 0) return;
    if (this.#state.timeS >= this.durationS) this.#state = { ...this.#state, timeS: 0 };
    this.#last = null;
    this.#set({ playing: true });
    this.#raf = this.#scheduler.request(this.#tick);
  }

  pause(): void {
    this.#scheduler.cancel(this.#raf);
    this.#raf = 0;
    this.#set({ playing: false });
  }

  toggle(): void {
    if (this.#state.playing) this.pause();
    else this.play();
  }

  seek(t: number): void {
    this.#set({ timeS: clamp(t, 0, this.durationS) });
  }

  step(seconds: number): void {
    this.seek(stepTime(this.#state.timeS, seconds, this.durationS));
  }

  setSpeed(speed: PlaybackSpeed): void {
    this.#set({ speed });
  }

  dispose(): void {
    this.pause();
    this.#listeners.clear();
  }

  #tick = (nowMs: number): void => {
    if (!this.#state.playing) return;
    const elapsed = this.#last === null ? 0 : nowMs - this.#last;
    this.#last = nowMs;
    const r = advancePlayback(this.#state.timeS, elapsed, this.#state.speed, this.durationS);
    if (r.ended) {
      this.#raf = 0;
      this.#set({ timeS: r.t, playing: false });
      return;
    }
    this.#set({ timeS: r.t });
    this.#raf = this.#scheduler.request(this.#tick);
  };
}
