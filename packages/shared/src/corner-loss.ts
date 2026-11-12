/**
 * Time lost per corner (spec 15): from a lap comparison, the corners that cost the most with the
 * probable cause of each. Pure: it only reorganises what `compareLaps` already measured.
 *
 * A cause is shown only when its rule is at least `medium` confidence; a corner without a
 * confident cause still appears with its loss, and the raw numbers (brake point, minimum speed).
 */

import type {
  CornerComparisonRow,
  CornerLossReason,
  CornerLossReport,
  CornerLossRow,
  LapComparison,
} from './analysis.ts';

/** Corners that lose less than this (ms) are lap-to-lap noise and are not listed. */
export const CORNER_LOSS_MIN_MS = 20;
/** Reasons shown per corner. */
export const MAX_REASONS_PER_CORNER = 2;

const CONFIDENT = new Set(['high', 'medium']);

function reasonsOf(row: CornerComparisonRow): CornerLossReason[] {
  return (row.findings ?? [])
    .filter((f) => f.message && f.confidence && CONFIDENT.has(f.confidence))
    .sort((a, b) => (b.costMs ?? 0) - (a.costMs ?? 0))
    .slice(0, MAX_REASONS_PER_CORNER)
    .map((f) => ({
      kind: f.kind,
      message: f.message!,
      action: f.action ?? null,
      confidence: f.confidence!,
      costMs: f.costMs ?? null,
    }));
}

export function cornerLossRanking(
  cmp: LapComparison,
  opts: { topN?: number; minLossMs?: number } = {},
): CornerLossReport {
  const minLossMs = opts.minLossMs ?? CORNER_LOSS_MIN_MS;
  const topN = opts.topN ?? 3;
  const losses = cmp.rows
    .filter((r) => r.timeLostMs >= minLossMs)
    .sort((a, b) => b.timeLostMs - a.timeLostMs)
    .slice(0, topN);
  const listed = new Set(losses.map((r) => r.corner.id));
  const otherCornersMs = cmp.rows
    .filter((r) => !listed.has(r.corner.id))
    .reduce((acc, r) => acc + r.timeLostMs, 0);

  const rows: CornerLossRow[] = losses.map((r) => ({
    cornerId: r.corner.id,
    name: r.corner.name ?? null,
    lossMs: Math.round(r.timeLostMs),
    phaseLoss: r.phaseLoss ?? null,
    reasons: reasonsOf(r),
    brakePointM: [r.a.brakePointM, r.b.brakePointM],
    minSpeedKmh: [r.a.minSpeedKmh, r.b.minSpeedKmh],
  }));

  return {
    lapA: cmp.lapA,
    lapB: cmp.lapB,
    totalDeltaMs: cmp.totalDeltaMs,
    rows,
    otherCornersMs: Math.round(otherCornersMs),
    straightsMs: cmp.straightsDeltaMs,
    minLossMs,
    referenceIsReplay: cmp.referenceIsReplay === true,
    warnings: cmp.warnings,
  };
}
