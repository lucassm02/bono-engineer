/**
 * Lap validity heuristics from a prepared lap: off-track (large lateral deviation from the reference
 * line), time gaps (lost packets / pause), distance jumps (rewind/teleport), going backwards,
 * incomplete coverage and official-vs-measured lap time mismatch.
 *
 * Note: the reference line is a racing line, not the track center, so the off-track threshold must
 * cover the full track width (default 12 m). Surface data (packet C) is a better signal when known.
 */

import type { LapValidityFlag, LapValidityReport } from '@gt7/shared';
import { fmt } from './math.ts';
import { channel, type PreparedLap } from './prepare.ts';

export interface ValidityOptions {
  /** |lateral offset| (m) considered off track, default 12. */
  maxLateralM?: number;
  /** Minimum off-track duration (s), default 0.3. */
  minOffTrackS?: number;
  /** Sample time gap (s) considered a data gap, default 0.25. */
  maxGapS?: number;
  /** Extra distance (m) over speed × dt tolerated between samples, default 15. */
  jumpToleranceM?: number;
  /** Backwards movement (m) tolerated, default 5. */
  backwardsM?: number;
  /** Missing distance at the start/end tolerated (m), default 40. */
  coverageM?: number;
  /** Official vs sample lap time tolerance (s), default 0.1. */
  timeToleranceS?: number;
}

/** Checks a lap and returns flags + human readable issues (pt-BR). */
export function checkLapValidity(lap: PreparedLap, opts: ValidityOptions = {}): LapValidityReport {
  const maxLat = opts.maxLateralM ?? 12;
  const minOff = opts.minOffTrackS ?? 0.3;
  const maxGap = opts.maxGapS ?? 0.25;
  const jumpTol = opts.jumpToleranceM ?? 15;
  const backTol = opts.backwardsM ?? 5;
  const cov = opts.coverageM ?? 40;
  const issues: LapValidityReport['issues'] = [];
  const flags = new Set<LapValidityFlag>();
  const speed = channel(lap.trace, 'speedKmh');
  const { t, sRaw, lateral, n } = lap;

  // off track runs
  let runStart = -1;
  let runMax = 0;
  const closeRun = (end: number) => {
    if (runStart < 0) return;
    const dur = lap.t[end]! - lap.t[runStart]!;
    if (dur >= minOff) {
      flags.add('offTrack');
      issues.push({
        kind: 'offTrack',
        atM: Math.round(lap.s[runStart]!),
        value: Math.round(runMax * 10) / 10,
        message: `Fora da linha por ${fmt(dur, 1)} s a ${fmt(lap.s[runStart]!)} m (desvio ${fmt(runMax, 1)} m)`,
      });
    }
    runStart = -1;
    runMax = 0;
  };
  for (let i = 0; i < n; i++) {
    const a = Math.abs(lateral[i]!);
    if (a > maxLat) {
      if (runStart < 0) runStart = i;
      runMax = Math.max(runMax, a);
    } else closeRun(i);
  }
  closeRun(n - 1);

  for (let i = 1; i < n; i++) {
    const dt = t[i]! - t[i - 1]!;
    const ds = sRaw[i]! - sRaw[i - 1]!;
    const atM = Math.round(lap.s[i]!);
    if (dt > maxGap) {
      flags.add('incompleteData');
      issues.push({
        kind: 'timeGap',
        atM,
        value: Math.round(dt * 1000) / 1000,
        message: `Lacuna de ${fmt(dt, 2)} s nos dados a ${fmt(atM)} m`,
      });
    } else if (dt < 0) {
      flags.add('discontinuity');
      issues.push({
        kind: 'timeGap',
        atM,
        value: Math.round(dt * 1000) / 1000,
        message: `Tempo voltou ${fmt(-dt, 2)} s a ${fmt(atM)} m (rewind?)`,
      });
    }
    const v = Math.max(speed[i]!, speed[i - 1]!) / 3.6;
    const expected = v * Math.max(dt, 0) + jumpTol;
    if (Number.isFinite(ds) && ds > expected) {
      flags.add('discontinuity');
      issues.push({
        kind: 'distanceJump',
        atM,
        value: Math.round(ds),
        message: `Salto de ${fmt(ds)} m na distância a ${fmt(atM)} m`,
      });
    } else if (Number.isFinite(ds) && ds < -backTol) {
      flags.add('discontinuity');
      issues.push({
        kind: 'backwards',
        atM,
        value: Math.round(-ds),
        message: `Recuo de ${fmt(-ds)} m a ${fmt(atM)} m (rewind ou rodada)`,
      });
    }
  }

  if (lap.s[0]! > cov || lap.s[n - 1]! < lap.lengthM - cov) {
    flags.add('incompleteData');
    issues.push({
      kind: 'incomplete',
      atM: null,
      value: Math.round(Math.max(lap.s[0]!, lap.lengthM - lap.s[n - 1]!)),
      message: `Volta incompleta: dados de ${fmt(lap.s[0]!)} m a ${fmt(lap.s[n - 1]!)} m de ${fmt(lap.lengthM)} m`,
    });
  }
  const dT = lap.lapTimeS - lap.sampleLapTimeS;
  if (Math.abs(dT) > (opts.timeToleranceS ?? 0.1)) {
    flags.add('timeMismatch');
    issues.push({
      kind: 'timeMismatch',
      atM: null,
      value: Math.round(dT * 1000),
      message: `Tempo oficial difere ${fmt(dT, 3)} s do tempo medido pelos pacotes`,
    });
  }
  // keep the report compact: at most 20 issues
  const valid =
    !flags.has('offTrack') && !flags.has('discontinuity') && !flags.has('incompleteData');
  return { lapId: lap.lapId, valid, flags: [...flags], issues: issues.slice(0, 20) };
}
