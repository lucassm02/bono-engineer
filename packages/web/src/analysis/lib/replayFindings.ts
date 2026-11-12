/**
 * "O que acertou / o que errou" of a lap in the replay: one list of moments to jump to, made only
 * from what the analysis already measures (driving events, the time lost and gained per corner
 * against the reference, the validity issues). No new rule is invented here.
 */

import {
  CORNER_LOSS_MIN_MS,
  type Corner,
  cornerLossRanking,
  type DrivingEvent,
  type LapComparison,
  type LapValidityReport,
} from '@gt7/shared';
import { formatFixed } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { cornerLabel, cornerRange, eventRange } from './chartData.ts';
import { DRIVING_EVENT_LABELS } from './labels.ts';

export type FindingTone = 'good' | 'bad' | 'info';

export interface ReplayFinding {
  id: string;
  tone: FindingTone;
  title: string;
  detail: string;
  /** Where the replay goes when the finding is chosen (m along the lap). */
  distanceM: number;
  /** Chart range shown around it, null = leave the zoom alone. */
  range: [number, number] | null;
  cornerId: string | null;
}

export const MAX_LOSSES = 3;
export const MAX_GAINS = 3;
export const MAX_ISSUES = 3;
/** A corner counts as a gain from this much time gained on the reference (ms). */
export const GAIN_MIN_MS = CORNER_LOSS_MIN_MS;

export interface FindingsInput {
  lengthM: number;
  corners: Corner[];
  /** Driving events of the lap (null = not loaded / unavailable). */
  events: DrivingEvent[] | null;
  /** Comparison with the chosen reference (null = replay without reference). */
  comparison: LapComparison | null;
  /** Validity issues of the lap analysis (null = not loaded). */
  issues: LapValidityReport['issues'] | null;
}

const seconds = (ms: number) => `${formatFixed(Math.abs(ms) / 1000, 3)} s`;
const kmh = (v: number | null | undefined) =>
  v === null || v === undefined ? '–' : formatFixed(v, 0);

/** Distance where the replay lands for a corner: the start of its braking zone, else the entry. */
export function cornerSeekM(
  corner: Pick<Corner, 'entryM'>,
  zone: { fromM: number } | null | undefined,
  brakePointM: number | null | undefined,
): number {
  const candidates = [corner.entryM - 40];
  if (zone) candidates.push(zone.fromM);
  if (brakePointM !== null && brakePointM !== undefined && Number.isFinite(brakePointM)) {
    candidates.push(brakePointM - 20);
  }
  return Math.max(0, Math.min(...candidates));
}

/** The moments of the lap worth a look, in the order they happen along the lap. */
export function buildFindings(input: FindingsInput): ReplayFinding[] {
  const { lengthM, corners, events, comparison, issues } = input;
  const out: ReplayFinding[] = [];
  const cornerOf = (id: string | null) => (id ? corners.find((c) => c.id === id) : undefined);

  for (const e of events ?? []) {
    const corner = cornerOf(e.cornerId);
    out.push({
      id: `event:${e.id}`,
      tone: e.confidence === 'low' ? 'info' : 'bad',
      title: `${DRIVING_EVENT_LABELS[e.kind]} · ${corner ? cornerLabel(corner) : (e.cornerId ?? uiText('Reta'))}`,
      detail: e.message,
      distanceM: Math.max(0, e.startM - 20),
      range: eventRange(e, lengthM),
      cornerId: e.cornerId,
    });
  }

  if (comparison) {
    const rowOf = (id: string) => comparison.rows.find((r) => r.corner.id === id);
    for (const loss of cornerLossRanking(comparison, { topN: MAX_LOSSES }).rows) {
      const row = rowOf(loss.cornerId);
      if (!row) continue;
      const reason = loss.reasons[0];
      out.push({
        id: `loss:${loss.cornerId}`,
        tone: 'bad',
        title: uiText('Perdeu {0} em {1}', seconds(loss.lossMs), cornerLabel(row.corner)),
        detail:
          reason?.message ??
          uiText(
            'Sem causa clara. V-mín {0} km/h · {1} km/h na referência.',
            kmh(loss.minSpeedKmh[0]),
            kmh(loss.minSpeedKmh[1]),
          ),
        distanceM: cornerSeekM(row.corner, row.zone, row.a.brakePointM),
        range: cornerRange(row.corner, row, lengthM),
        cornerId: loss.cornerId,
      });
    }
    const gains = comparison.rows
      .filter((r) => r.timeLostMs <= -GAIN_MIN_MS)
      .sort((a, b) => a.timeLostMs - b.timeLostMs)
      .slice(0, MAX_GAINS);
    for (const row of gains) {
      out.push({
        id: `gain:${row.corner.id}`,
        tone: 'good',
        title: uiText('Ganhou {0} em {1}', seconds(row.timeLostMs), cornerLabel(row.corner)),
        detail: uiText(
          'V-mín {0} km/h (ref. {1}) · saída {2} km/h (ref. {3}).',
          kmh(row.a.minSpeedKmh),
          kmh(row.b.minSpeedKmh),
          kmh(row.a.exitSpeedKmh),
          kmh(row.b.exitSpeedKmh),
        ),
        distanceM: cornerSeekM(row.corner, row.zone, row.a.brakePointM),
        range: cornerRange(row.corner, row, lengthM),
        cornerId: row.corner.id,
      });
    }
  }

  for (const [i, issue] of (issues ?? [])
    .filter((x) => x.atM !== null)
    .slice(0, MAX_ISSUES)
    .entries()) {
    out.push({
      id: `issue:${issue.kind}:${i}`,
      tone: 'bad',
      title: uiText('Problema na volta'),
      detail: issue.message,
      distanceM: Math.max(0, (issue.atM ?? 0) - 20),
      range: null,
      cornerId: null,
    });
  }

  return out.sort((a, b) => a.distanceM - b.distanceM);
}
