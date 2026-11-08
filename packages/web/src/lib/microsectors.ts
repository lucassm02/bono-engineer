/**
 * Live microsector gain/loss vs the delta reference (map colouring).
 *
 * The lap is split in `count` equal-length microsectors. When the car crosses from microsector k
 * into k+1 the change of the live delta over k is stored (− = gained time). The current lap's
 * values win; microsectors not reached yet this lap show the previous lap's value (dimmed).
 * Changing the delta reference clears everything (values are reference-relative).
 */

export type MicroTone = 'gain' | 'loss' | 'neutral' | 'none';

/** |change| below this (ms) is neutral (same as the analysis map colours). */
export const MICRO_NEUTRAL_MS = 10;

export function microTone(changeMs: number): MicroTone {
  if (!Number.isFinite(changeMs)) return 'none';
  if (Math.abs(changeMs) <= MICRO_NEUTRAL_MS) return 'neutral';
  return changeMs < 0 ? 'gain' : 'loss';
}

export class MicrosectorTracker {
  readonly count: number;
  current: Float64Array;
  previous: Float64Array;
  /** Bumps when any stored value changes. */
  version = 0;
  private idx = -1;
  private entryDelta = Number.NaN;
  private lastDelta = Number.NaN;
  private lap: number | null = null;
  private refKey = '';

  constructor(count: number) {
    this.count = count;
    this.current = new Float64Array(count).fill(Number.NaN);
    this.previous = new Float64Array(count).fill(Number.NaN);
  }

  reset(): void {
    this.current.fill(Number.NaN);
    this.previous.fill(Number.NaN);
    this.idx = -1;
    this.entryDelta = Number.NaN;
    this.lastDelta = Number.NaN;
    this.lap = null;
    this.version++;
  }

  push(
    distanceM: number | null,
    lengthM: number | null,
    deltaMs: number | null,
    lap: number,
    refKey: string,
  ): void {
    if (refKey !== this.refKey) {
      this.refKey = refKey;
      this.reset();
    }
    if (this.lap !== lap) {
      // Close the last microsector with the final delta of the lap that just ended.
      if (this.idx === this.count - 1 && Number.isFinite(this.entryDelta)) {
        this.current[this.idx] = this.lastDelta - this.entryDelta;
      }
      if (this.lap !== null) {
        this.previous = this.current;
        this.current = new Float64Array(this.count).fill(Number.NaN);
      }
      this.lap = lap;
      this.idx = -1;
      this.entryDelta = Number.NaN;
      this.version++;
    }
    if (distanceM === null || !lengthM || !(lengthM > 0) || deltaMs === null) {
      this.idx = -1;
      return;
    }
    const k = Math.min(this.count - 1, Math.max(0, Math.floor((distanceM / lengthM) * this.count)));
    if (k !== this.idx) {
      // Only a forward step to the adjacent microsector is a clean measurement.
      if (this.idx >= 0 && k === this.idx + 1 && Number.isFinite(this.entryDelta)) {
        this.current[this.idx] = deltaMs - this.entryDelta;
        this.version++;
      }
      this.idx = k;
      this.entryDelta = deltaMs;
    }
    this.lastDelta = deltaMs;
  }

  /** Value shown for microsector i and whether it comes from the previous lap. */
  value(i: number): { ms: number; stale: boolean } {
    const c = this.current[i]!;
    if (Number.isFinite(c)) return { ms: c, stale: false };
    return { ms: this.previous[i]!, stale: true };
  }

  /** Index of the microsector the car is in (−1 unknown). */
  get currentIndex(): number {
    return this.idx;
  }
}
