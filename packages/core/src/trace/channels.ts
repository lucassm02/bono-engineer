/** Canonical LapSample channel list, a growable column builder and LapTrace helpers. */

import type { Id, LapSample, LapSampleChannel, LapTrace } from '@gt7/shared';

/** Every LapSample channel, in file order. */
export const LAP_SAMPLE_CHANNELS = [
  'tMs',
  'distanceM',
  'packetId',
  'x',
  'y',
  'z',
  'speedKmh',
  'rpm',
  'gear',
  'throttle',
  'brake',
  'clutch',
  'steeringRad',
  'throttleRaw',
  'yawRate',
  'latG',
  'lonG',
  'vertG',
  'slipFL',
  'slipFR',
  'slipRL',
  'slipRR',
  'tyreTempFL',
  'tyreTempFR',
  'tyreTempRL',
  'tyreTempRR',
  'suspFL',
  'suspFR',
  'suspRL',
  'suspRR',
  'fuelL',
  'flags',
] as const satisfies readonly LapSampleChannel[];

// Compile-time exhaustiveness: every LapSample key must be listed above.
type Missing = Exclude<LapSampleChannel, (typeof LAP_SAMPLE_CHANNELS)[number]>;
const _exhaustive: Missing extends never ? true : Missing = true;
void _exhaustive;

/** Channels stored as float64 in trace files (the rest as float32). */
export const FLOAT64_CHANNELS: ReadonlySet<LapSampleChannel> = new Set<LapSampleChannel>([
  'tMs',
  'distanceM',
  'packetId',
]);

/** Growable column-oriented sample buffer. */
export class TraceBuilder {
  #cols: Record<LapSampleChannel, Float64Array>;
  #len = 0;
  #cap: number;

  constructor(initialCapacity = 6000) {
    this.#cap = Math.max(16, initialCapacity);
    this.#cols = {} as Record<LapSampleChannel, Float64Array>;
    for (const c of LAP_SAMPLE_CHANNELS) this.#cols[c] = new Float64Array(this.#cap);
  }

  get length(): number {
    return this.#len;
  }

  push(s: LapSample): void {
    if (this.#len === this.#cap) this.#grow();
    const i = this.#len++;
    for (const c of LAP_SAMPLE_CHANNELS) this.#cols[c][i] = s[c];
  }

  /** Read-only view of a channel (length = this.length). */
  column(c: LapSampleChannel): Float64Array {
    return this.#cols[c].subarray(0, this.#len);
  }

  /** Last value of a channel, NaN if empty. */
  last(c: LapSampleChannel): number {
    return this.#len ? this.#cols[c][this.#len - 1]! : Number.NaN;
  }

  /** Copies the samples into a standalone LapTrace. */
  build(lapId: Id, sampleRateHz = 60): LapTrace {
    const channels = {} as LapTrace['channels'];
    for (const c of LAP_SAMPLE_CHANNELS) channels[c] = this.#cols[c].slice(0, this.#len);
    return { lapId, sampleRateHz, length: this.#len, channels };
  }

  #grow(): void {
    this.#cap *= 2;
    for (const c of LAP_SAMPLE_CHANNELS) {
      const n = new Float64Array(this.#cap);
      n.set(this.#cols[c]);
      this.#cols[c] = n;
    }
  }
}

/** Channel accessor that works for Float64Array and number[] columns. */
export function traceColumn(trace: LapTrace, c: LapSampleChannel): ArrayLike<number> {
  return trace.channels[c];
}

/** Row i of a trace as a LapSample. */
export function traceSample(trace: LapTrace, i: number): LapSample {
  const row = {} as LapSample;
  for (const c of LAP_SAMPLE_CHANNELS) row[c] = Number(trace.channels[c][i]);
  return row;
}
