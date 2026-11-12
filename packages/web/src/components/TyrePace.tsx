/**
 * Tyre pace estimate (spec 16) for the Pneus view. The game sends no tyre wear, so this reads the
 * lap times: clean laps that keep getting slower mean the tyres are probably going. Always labelled
 * as an estimate.
 */

import { tyrePaceTrend } from '@gt7/shared';
import { useMemo } from 'react';
import { t as uiText } from '../lib/i18n.ts';
import { useSessionLaps } from '../state/sessionStore.ts';

export function TyrePace() {
  const laps = useSessionLaps((s) => s.laps);
  const trend = useMemo(
    () => tyrePaceTrend(laps.filter((l) => l.valid && l.timeMs > 0).map((l) => l.timeMs)),
    [laps],
  );
  if (trend.state === 'unknown') {
    return (
      <p className="tyre-pace dim" data-state="unknown">
        {uiText('Ritmo do pneu (estimativa): precisa de 4 voltas limpas.')}
      </p>
    );
  }
  const perLap = ((trend.slopeMsPerLap ?? 0) / 1000).toFixed(2).replace('.', ',');
  return (
    <p className="tyre-pace" data-state={trend.state} aria-live="polite">
      {trend.state === 'dropping'
        ? uiText(
            'Ritmo caindo (~{0} s por volta): o pneu provavelmente está no fim. É uma estimativa pelos tempos de volta.',
            perLap,
          )
        : uiText('Ritmo estável nas últimas {0} voltas limpas (estimativa).', trend.laps)}
    </p>
  );
}
