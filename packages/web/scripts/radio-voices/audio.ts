/**
 * Small, dependency-free DSP used by the radio clip generator: resampling, silence trimming,
 * loudness normalization and WAV encoding. All functions work on mono Float32 samples in [-1, 1].
 */

const FRAME_MS = 10;

function frameRms(samples: Float32Array, sampleRate: number): Float64Array {
  const size = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000));
  const frames = new Float64Array(Math.ceil(samples.length / size));
  for (let f = 0; f < frames.length; f++) {
    let sum = 0;
    const end = Math.min(samples.length, (f + 1) * size);
    for (let i = f * size; i < end; i++) sum += samples[i]! * samples[i]!;
    frames[f] = Math.sqrt(sum / Math.max(1, end - f * size));
  }
  return frames;
}

export const db = (value: number) => 20 * Math.log10(Math.max(value, 1e-9));
export const fromDb = (value: number) => 10 ** (value / 20);

/** Windowed-sinc (Blackman) resampler, good enough for speech. */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples.slice();
  const ratio = to / from;
  const out = new Float32Array(Math.round(samples.length * ratio));
  const cutoff = Math.min(1, ratio) * 0.95;
  const half = 24;
  const step = 1 / ratio;
  for (let n = 0; n < out.length; n++) {
    const center = n * step;
    const first = Math.ceil(center - half / cutoff);
    const last = Math.floor(center + half / cutoff);
    let acc = 0;
    let norm = 0;
    for (let k = first; k <= last; k++) {
      if (k < 0 || k >= samples.length) continue;
      const x = (k - center) * cutoff;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = (k - center) / (half / cutoff);
      const blackman = 0.42 + 0.5 * Math.cos(Math.PI * w) + 0.08 * Math.cos(2 * Math.PI * w);
      const tap = sinc * blackman;
      acc += samples[k]! * tap;
      norm += tap;
    }
    out[n] = norm ? acc / norm : 0;
  }
  return out;
}

/** Remove DC and low rumble (one-pole high-pass, ~70 Hz). */
export function highPass(samples: Float32Array, sampleRate: number, hz = 70): Float32Array {
  const out = new Float32Array(samples.length);
  const rc = 1 / (2 * Math.PI * hz);
  const alpha = rc / (rc + 1 / sampleRate);
  let prevIn = 0;
  let prevOut = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    prevOut = alpha * (prevOut + x - prevIn);
    prevIn = x;
    out[i] = prevOut;
  }
  return out;
}

export interface TrimOptions {
  /** Frames quieter than the loudest frame minus this many dB count as silence. */
  relativeDb?: number;
  /** Absolute floor in dBFS. */
  floorDb?: number;
  leadMs?: number;
  tailMs?: number;
  fadeMs?: number;
}

/** Trim leading/trailing silence, keep a short pad and fade the edges to avoid clicks. */
export function trimSilence(
  samples: Float32Array,
  sampleRate: number,
  { relativeDb = 42, floorDb = -55, leadMs = 15, tailMs = 45, fadeMs = 6 }: TrimOptions = {},
): Float32Array {
  const frames = frameRms(samples, sampleRate);
  const loudest = Math.max(...frames);
  const threshold = Math.max(fromDb(floorDb), loudest * fromDb(-relativeDb));
  let first = frames.findIndex((v) => v >= threshold);
  let last = frames.length - 1 - [...frames].reverse().findIndex((v) => v >= threshold);
  if (first < 0) {
    first = 0;
    last = frames.length - 1;
  }
  const size = Math.round((sampleRate * FRAME_MS) / 1000);
  const start = Math.max(0, first * size - Math.round((sampleRate * leadMs) / 1000));
  const end = Math.min(
    samples.length,
    (last + 1) * size + Math.round((sampleRate * tailMs) / 1000),
  );
  const out = samples.slice(start, end);
  const fade = Math.min(Math.round((sampleRate * fadeMs) / 1000), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i]! *= g;
    out[out.length - 1 - i]! *= g;
  }
  return out;
}

/** RMS over the active (speech) frames only, so pauses do not lower the measure. */
export function activeRms(samples: Float32Array, sampleRate: number, gateDb = 30): number {
  const frames = frameRms(samples, sampleRate);
  const loudest = Math.max(...frames);
  const gate = loudest * fromDb(-gateDb);
  let sum = 0;
  let count = 0;
  for (const v of frames) {
    if (v < gate) continue;
    sum += v * v;
    count++;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

export function peak(samples: Float32Array): number {
  let max = 0;
  for (const v of samples) max = Math.max(max, Math.abs(v));
  return max;
}

export interface LoudnessTarget {
  /** Active speech RMS target, dBFS. */
  rmsDb: number;
  /** Sample peak ceiling, dBFS. */
  peakDb: number;
}

/**
 * Bring a clip to the active-RMS target. Peaks above the ceiling go through a smooth limiter
 * (gain envelope with 1 ms attack, 60 ms release) instead of lowering the whole clip.
 */
export function normalize(
  samples: Float32Array,
  sampleRate: number,
  target: LoudnessTarget,
): Float32Array {
  const rms = activeRms(samples, sampleRate);
  const gain = rms > 0 ? fromDb(target.rmsDb) / rms : 1;
  const ceiling = fromDb(target.peakDb);
  const out = new Float32Array(samples.length);
  const lookahead = Math.round(sampleRate * 0.001);
  const release = Math.exp(-1 / (sampleRate * 0.06));
  const needed = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const level = Math.abs(samples[i]! * gain);
    needed[i] = level > ceiling ? ceiling / level : 1;
  }
  let env = 1;
  for (let i = 0; i < samples.length; i++) {
    let want = 1;
    for (let k = i; k < Math.min(samples.length, i + lookahead + 1); k++)
      want = Math.min(want, needed[k]!);
    env = want < env ? want : want + (env - want) * release;
    out[i] = Math.max(-ceiling, Math.min(ceiling, samples[i]! * gain * env));
  }
  return out;
}

/** Concatenate clips with a fixed gap (in samples) between them. */
export function concat(clips: readonly Float32Array[], gap: number): Float32Array {
  const total = clips.reduce((sum, clip) => sum + clip.length, 0) + gap * (clips.length - 1);
  const out = new Float32Array(Math.max(0, total));
  let at = 0;
  clips.forEach((clip, index) => {
    out.set(clip, at);
    at += clip.length + (index < clips.length - 1 ? gap : 0);
  });
  return out;
}

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
  }
  return bytes;
}

/** Median F0 (Hz) over voiced frames, by normalized autocorrelation. Used for auditions. */
export function medianPitch(samples: Float32Array, sampleRate: number): number {
  const size = Math.round(sampleRate * 0.04);
  const minLag = Math.floor(sampleRate / 300);
  const maxLag = Math.ceil(sampleRate / 60);
  const loud = activeRms(samples, sampleRate) * fromDb(-12);
  const pitches: number[] = [];
  for (let start = 0; start + size + maxLag < samples.length; start += size / 2) {
    let energy = 0;
    for (let i = 0; i < size; i++) energy += samples[start + i]! ** 2;
    if (Math.sqrt(energy / size) < loud) continue;
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0;
      let e2 = 0;
      for (let i = 0; i < size; i++) {
        num += samples[start + i]! * samples[start + i + lag]!;
        e2 += samples[start + i + lag]! ** 2;
      }
      const r = num / Math.sqrt(energy * e2 || 1);
      if (r > best) {
        best = r;
        bestLag = lag;
      }
    }
    if (best > 0.6) pitches.push(sampleRate / bestLag);
  }
  pitches.sort((a, b) => a - b);
  return pitches[Math.floor(pitches.length / 2)] ?? 0;
}
