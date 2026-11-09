import { channel, type PreparedLap, sampleAtOrAfter } from '@gt7/analysis';
import {
  COAST_PEDAL_THRESHOLD,
  type CornerMetrics,
  type LapSampleChannel,
  THROTTLE_ON_THRESHOLD,
} from '@gt7/shared';
import type { EngineerMark } from '../live/corner-hints.ts';

/** Keep samples on both sides of the line available to corners whose windows wrap. */
export function wrapEngineerLap(lap: PreparedLap): PreparedLap {
  const { s, t, n, lengthM, lapTimeS } = lap;
  const last = n - 1;
  // Avoid manufacturing a pedal transition across an incomplete trace.
  if (s[0]! + lengthM - s[last]! > 12 || t[0]! + lapTimeS - t[last]! > 0.2) return lap;
  const samples: { i: number; turn: number }[] = [];
  for (let i = sampleAtOrAfter(lap, lengthM - 650); i < n; i++) {
    if (s[i]! - lengthM < s[0]! && t[i]! - lapTimeS < t[0]!) samples.push({ i, turn: -1 });
  }
  for (let i = 0; i < n; i++) samples.push({ i, turn: 0 });
  for (let i = 0; i < n && s[i]! <= 650; i++) {
    if (s[i]! + lengthM > s[last]! && t[i]! + lapTimeS > t[last]!) samples.push({ i, turn: 1 });
  }
  const expand = (values: ArrayLike<number>, step = 0) =>
    Float64Array.from(samples, ({ i, turn }) => values[i]! + turn * step);
  const channels = { ...lap.trace.channels };
  for (const key of Object.keys(channels) as LapSampleChannel[]) {
    if (channels[key].length === n) channels[key] = expand(channels[key]);
  }
  return {
    ...lap,
    n: samples.length,
    s: expand(s, lengthM),
    sRaw: expand(lap.sRaw, lengthM),
    t: expand(t, lapTimeS),
    lateral: expand(lap.lateral),
    distToLine: expand(lap.distToLine),
    trace: { ...lap.trace, length: samples.length, channels },
  };
}

/** Extract actionable points from the same projected trace used by the comparison page. */
export function engineerMarks(lap: PreparedLap, m: CornerMetrics, exitM: number): EngineerMark[] {
  const { brakePointM, brakeReleaseM, peakBrake, throttlePickupM, timeToFullThrottleS } = m;
  const brake = channel(lap.trace, 'brake');
  const throttle = channel(lap.trace, 'throttle');
  const x = channel(lap.trace, 'x');
  const z = channel(lap.trace, 'z');
  const { s, t, distToLine, n, isReplay } = lap;
  const marks: EngineerMark[] = [];
  const reliable = (i: number) => distToLine[i]! <= 18;
  const point = (i: number) => ({ x: x[i]!, z: z[i]! });
  const brakeStart = brakePointM === null ? -1 : sampleAtOrAfter(lap, brakePointM);
  const brakeEnd = brakeReleaseM === null ? -1 : sampleAtOrAfter(lap, brakeReleaseM);
  const pickup = throttlePickupM === null ? n : sampleAtOrAfter(lap, throttlePickupM);
  const last = Math.min(n - 1, sampleAtOrAfter(lap, exitM + 35));

  if (
    brakeStart >= 0 &&
    brakeEnd > brakeStart &&
    reliable(brakeStart) &&
    t[brakeEnd]! - t[brakeStart]! >= (isReplay ? 0.25 : 0.15)
  ) {
    let strongS = 0;
    let peakIndex = brakeStart;
    for (let i = brakeStart; i < brakeEnd; i++) {
      if (brake[i]! > brake[peakIndex]!) peakIndex = i;
      if (brake[i]! >= 0.65) strongS += Math.min(0.05, t[i + 1]! - t[i]!);
    }
    const kind =
      strongS >= 0.18 ? 'brakeHard' : !isReplay && peakBrake! <= 0.32 ? 'brakeLight' : 'brake';
    marks.push({ kind, atM: s[brakeStart]!, position: point(brakeStart) });

    if (brakeEnd < n - 1 && reliable(brakeEnd)) {
      let coastEnd = brakeEnd + 1;
      while (
        coastEnd <= last &&
        reliable(coastEnd) &&
        brake[coastEnd]! < COAST_PEDAL_THRESHOLD &&
        throttle[coastEnd]! < COAST_PEDAL_THRESHOLD &&
        t[coastEnd]! - t[coastEnd - 1]! <= 0.1
      )
        coastEnd++;
      const coastStart = brakeEnd + 1;
      const end = coastEnd - 1;
      if (end > coastStart && t[end]! - t[coastStart]! >= (isReplay ? 0.85 : 0.55)) {
        marks.push({
          kind: 'coast',
          atM: s[coastStart]!,
          position: point(coastStart),
          untilM: s[end]!,
          endPosition: point(end),
        });
      } else if (t[brakeEnd]! - t[brakeStart]! >= 0.65) {
        let release = peakIndex;
        while (release < brakeEnd && brake[release]! >= 0.75 * brake[peakIndex]!) release++;
        const smooth = !isReplay && t[brakeEnd]! - t[release]! >= 0.4 && reliable(release);
        const i = smooth ? release : brakeEnd;
        marks.push({
          kind: smooth ? 'releaseSmooth' : 'release',
          atM: s[i]!,
          position: point(i),
        });
      }
    }
  }

  // Require a genuine pickup edge with sustained throttle, rather than maintenance throttle or
  // the first sample of a trace already under power.
  if (
    pickup > 0 &&
    pickup < last &&
    pickup >= brakeEnd &&
    reliable(pickup) &&
    throttle[pickup - 1]! < THROTTLE_ON_THRESHOLD
  ) {
    let end = pickup;
    while (end < last && throttle[end + 1]! >= THROTTLE_ON_THRESHOLD) end++;
    if (t[end]! - t[pickup]! >= 0.25) {
      const smooth = !isReplay && timeToFullThrottleS !== null && timeToFullThrottleS >= 0.45;
      marks.push({
        kind: smooth ? 'throttleSmooth' : 'throttle',
        atM: s[pickup]!,
        position: point(pickup),
      });
    }
  }
  return marks;
}
