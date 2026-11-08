/**
 * AI-friendly summaries: compact structured JSON (no raw 60 Hz arrays, rounded numbers, units in
 * the keys) for MCP tool results, plus a pt-BR Markdown report of a comparison.
 *
 * Pairs are always `[subject, reference]` (você, referência).
 */

import type {
  Corner,
  CornerMetrics,
  LapComparison,
  LapValidityReport,
  MicrosectorReport,
} from '@gt7/shared';
import { equalSectors } from './compare.ts';
import { findingText } from './findings.ts';
import { fmt, round } from './math.ts';
import { computeLapMetrics } from './metrics.ts';
import { type PreparedLap, timeAtDistance } from './prepare.ts';

const DIR = { left: 'L', right: 'R' } as const;

export interface LapSummaryOptions {
  /** Precomputed metrics (otherwise computed). */
  metrics?: CornerMetrics[];
  validity?: LapValidityReport;
  microsectors?: MicrosectorReport;
  sectorStartsM?: number[];
}

/** Compact per-lap summary for an AI client (~2–3 KB for 10 corners). */
export function summarizeLapForAI(
  lap: PreparedLap,
  corners: readonly Corner[],
  opts: LapSummaryOptions = {},
) {
  const metrics = opts.metrics ?? computeLapMetrics(lap, corners);
  const L = lap.lengthM;
  const starts = opts.sectorStartsM ?? equalSectors(L);
  const sectors = starts.map(
    (from, i) => round(timeAtDistance(lap, starts[i + 1] ?? L) - timeAtDistance(lap, from), 3)!,
  );
  const ms = opts.microsectors;
  return {
    lapId: lap.lapId,
    lapTime_s: round(lap.lapTimeS, 3),
    length_m: round(L),
    isReplay: lap.isReplay,
    sectors_s: sectors,
    ...(opts.validity ? { valid: opts.validity.valid, flags: opts.validity.flags } : {}),
    ...(ms
      ? {
          theoreticalBest_s: round(ms.theoreticalBestMs / 1000, 3),
          bestLapInSet_s: round(ms.bestLapMs / 1000, 3),
        }
      : {}),
    corners: corners.map((c, i) => {
      const m = metrics[i]!;
      return {
        id: c.id,
        ...(c.name ? { name: c.name } : {}),
        kind: c.kind ?? null,
        dir: DIR[c.direction],
        entry_m: round(c.entryM),
        exit_m: round(c.exitM),
        brakePoint_m: round(m.brakePointM),
        peakBrake_pct: round(m.peakBrake === null ? null : m.peakBrake * 100),
        trail_s: round(m.trailBrakingS, 2),
        vmin_kmh: round(m.minSpeedKmh),
        vminAt_m: round(m.minSpeedM),
        gear: m.gearAtApex,
        throttle_m: round(m.throttlePickupM),
        coast_s: round(m.coastingS, 2),
        exit_kmh: round(m.exitSpeedKmh),
        ...(m.steeringCorrections !== null ? { corrections: m.steeringCorrections } : {}),
        ...(m.tcsActiveS > 0.05 ? { tcs_s: round(m.tcsActiveS, 2) } : {}),
        ...(m.frontLockS > 0.05 ? { lock_s: round(m.frontLockS, 2) } : {}),
        time_s: round(m.timeInCornerS, 2),
      };
    }),
  };
}

export type LapSummaryAI = ReturnType<typeof summarizeLapForAI>;

export interface ComparisonSummaryOptions {
  /** Max findings listed (default 6). */
  maxFindings?: number;
  /** Max warnings listed (default 3). */
  maxWarnings?: number;
}

const pair = (a: number | null | undefined, b: number | null | undefined, digits = 0) => [
  round(a, digits),
  round(b, digits),
];

/** Compact comparison summary for an AI client (target < 4 KB). */
export function summarizeComparisonForAI(cmp: LapComparison, opts: ComparisonSummaryOptions = {}) {
  const findings = (cmp.findings ?? []).slice(0, opts.maxFindings ?? 6);
  return {
    pairs: '[voce, referencia]',
    lapA: cmp.lapA,
    lapB: cmp.lapB,
    lapTime_s: [round(cmp.lapATimeMs / 1000, 3), round(cmp.lapBTimeMs / 1000, 3)],
    delta_s: round(cmp.totalDeltaMs / 1000, 3),
    straights_s: round(cmp.straightsDeltaMs / 1000, 2),
    ...(cmp.sectorDeltasMs ? { sectors_s: cmp.sectorDeltasMs.map((v) => round(v / 1000, 2)) } : {}),
    refReplay: cmp.referenceIsReplay ?? false,
    topLosses: cmp.topLosses.map((r) => r.corner.id),
    corners: cmp.rows.map((r) => ({
      id: r.corner.id,
      kind: r.corner.kind ?? null,
      lost_s: round(r.timeLostMs / 1000, 2),
      brakePoint_m: pair(r.a.brakePointM, r.b.brakePointM),
      vmin_kmh: pair(r.a.minSpeedKmh, r.b.minSpeedKmh),
      throttle_m: pair(r.a.throttlePickupM, r.b.throttlePickupM),
      exit_kmh: pair(r.a.exitSpeedKmh, r.b.exitSpeedKmh),
      coast_s: pair(r.a.coastingS, r.b.coastingS, 1),
      trail_s: pair(r.a.trailBrakingS, r.b.trailBrakingS, 1),
      gear: [r.a.gearAtApex, r.b.gearAtApex],
    })),
    findings: findings.map((f) => ({
      c: f.cornerId ?? null,
      kind: f.kind,
      cost_s: round((f.costMs ?? 0) / 1000, 2),
      conf: f.confidence ?? null,
      text: findingText(f),
    })),
    warnings: cmp.warnings.slice(0, opts.maxWarnings ?? 3),
  };
}

export type ComparisonSummaryAI = ReturnType<typeof summarizeComparisonForAI>;

/** m:ss,mmm */
export function formatLapTime(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const v = Math.abs(Math.round(ms));
  const m = Math.floor(v / 60000);
  const s = Math.floor((v % 60000) / 1000);
  const r = v % 1000;
  return `${sign}${m}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
}

/** Signed seconds pt-BR: +0,43 s / −0,12 s. */
export function formatDelta(ms: number, digits = 2): string {
  const s = ms / 1000;
  const txt = fmt(Math.abs(s), digits);
  return `${s >= 0 ? '+' : '−'}${txt} s`;
}

const cell = (a: number | null, b: number | null, digits = 0) =>
  `${a === null ? '–' : fmt(a, digits)} / ${b === null ? '–' : fmt(b, digits)}`;

/** pt-BR Markdown report of a comparison (for humans and AI). */
export function formatComparisonMarkdown(cmp: LapComparison): string {
  const lines: string[] = [];
  lines.push(`## Comparação: ${cmp.lapA} × ${cmp.lapB} (referência)`);
  lines.push('');
  lines.push(
    `Tempo: **${formatLapTime(cmp.lapATimeMs)}** × ${formatLapTime(cmp.lapBTimeMs)} → ` +
      `**${formatDelta(cmp.totalDeltaMs, 3)}**`,
  );
  if (cmp.sectorDeltasMs) {
    const secs = cmp.sectorDeltasMs.map((v, i) => `S${i + 1} ${formatDelta(v)}`).join(' · ');
    lines.push(`Setores: ${secs} · Retas: ${formatDelta(cmp.straightsDeltaMs)}`);
  }
  lines.push('');
  lines.push('### Onde você perde mais');
  cmp.topLosses.forEach((r, i) => {
    const f = r.findings?.[0];
    const kind = r.corner.kind ? `${r.corner.kind}, ` : '';
    const dir = r.corner.direction === 'left' ? 'esquerda' : 'direita';
    lines.push(
      `${i + 1}. **${r.corner.id}** (${kind}${dir}): ${formatDelta(r.timeLostMs)}` +
        (f ? ` — ${findingText(f)}` : ''),
    );
  });
  lines.push('');
  lines.push('### Curva a curva (você / referência)');
  lines.push('| Curva | Δ tempo | Frenagem (m) | V-mín (km/h) | Acelerador (m) | Saída (km/h) |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of cmp.rows) {
    lines.push(
      `| ${r.corner.id} | ${formatDelta(r.timeLostMs)} | ${cell(r.a.brakePointM, r.b.brakePointM)} | ` +
        `${cell(r.a.minSpeedKmh, r.b.minSpeedKmh)} | ${cell(r.a.throttlePickupM, r.b.throttlePickupM)} | ` +
        `${cell(r.a.exitSpeedKmh, r.b.exitSpeedKmh)} |`,
    );
  }
  const plan = cmp.keyFindings ?? [];
  if (plan.length > 0) {
    lines.push('');
    lines.push('### Plano: uma ação por curva');
    for (const f of plan) {
      const cost = f.costMs
        ? ` (~${fmt((f.costMs ?? 0) / 1000, 2)} s, confiança ${f.confidence})`
        : '';
      lines.push(`- **${f.cornerId}**: ${f.action ?? f.kind}${cost}`);
    }
  }
  if (cmp.warnings.length > 0) {
    lines.push('');
    for (const w of cmp.warnings) lines.push(`> ⚠ ${w}`);
  }
  return lines.join('\n');
}
