/**
 * Renders sample comparison charts from synthetic data (amateur × pro replay reference).
 * Usage: node --disable-warning=ExperimentalWarning --import tsx packages/mcp/src/cli/sample-chart.ts [outDir]
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Gt7Runtime, seedSyntheticData } from '@gt7/core';
import { buildComparisonChart } from '../chart.ts';

const outDir = resolve(process.argv[2] ?? 'docs');
mkdirSync(outDir, { recursive: true });
const dir = mkdtempSync(join(tmpdir(), 'gt7-sample-chart-'));
const rt = new Gt7Runtime({ dataDir: dir, record: false });
try {
  const seed = await seedSyntheticData(rt, [
    { profile: 'amateur', laps: 2, seed: 4 },
    { profile: 'pro', laps: 1, seed: 9, reference: { driverName: 'Líder Mundial' } },
  ]);
  const lapId = seed.sessions[0]!.lapIds[0]!;
  const full = await buildComparisonChart(rt.analysis, { lapId, reference: 'bestReference' });
  writeFileSync(join(outDir, 'chart-example.png'), full.png);
  const worst = full.comparison.comparison.topLosses[0]!.corner.id;
  const zoom = await buildComparisonChart(rt.analysis, {
    lapId,
    reference: 'bestReference',
    cornerId: worst,
  });
  writeFileSync(join(outDir, 'corner-chart-example.png'), zoom.png);
  console.log(`ok: ${full.png.length} B + ${zoom.png.length} B (${worst}) em ${outDir}`);
} finally {
  await rt.close();
  rmSync(dir, { recursive: true, force: true });
}
