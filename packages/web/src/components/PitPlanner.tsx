/**
 * Pit planner of the Combustível view (spec 16): when the fuel makes a stop necessary. It uses the
 * race length of the game when there is one, or the number of laps typed here (practice, endurance
 * tests), and says it is an estimate.
 */

import { type LiveFrame, pitPlan, raceLapsLeft } from '@gt7/shared';
import { useState } from 'react';
import { formatFixed } from '../lib/format.ts';
import { t as uiText } from '../lib/i18n.ts';
import { useLiveRender } from '../live/raf.ts';

interface Snap {
  level: number;
  perLap: number | null;
  capacity: number;
  lap: number;
  /** Laps left in the game's race, null outside races. */
  gameLapsLeft: number | null;
  /** Laps completed of the current lap (0–1). */
  fraction: number;
}

function snapOf(f: LiveFrame): Snap {
  return {
    level: Math.round(f.fuel.level * 10) / 10,
    perLap: f.fuel.perLapAvg === null ? null : Math.round(f.fuel.perLapAvg * 100) / 100,
    capacity: f.fuel.capacity > 0 ? f.fuel.capacity : 100,
    lap: f.lap.lap,
    gameLapsLeft: raceLapsLeft(f.lap, f.lapFraction),
    fraction: Math.round((f.lapFraction ?? 0) * 20) / 20,
  };
}

const same = (a: Snap | null, b: Snap) =>
  !!a &&
  a.level === b.level &&
  a.perLap === b.perLap &&
  a.lap === b.lap &&
  a.gameLapsLeft === b.gameLapsLeft &&
  a.fraction === b.fraction;

function num(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(v) && v > 0 ? v : null;
}

export function PitPlanner() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [raceLaps, setRaceLaps] = useState('');
  const [refuelTo, setRefuelTo] = useState('');

  useLiveRender((f) => {
    const next = snapOf(f);
    setSnap((cur) => (same(cur, next) ? cur : next));
  });

  if (!snap) return null;
  const typedLaps = num(raceLaps);
  // laps still to drive: the game's race when there is one, else the typed length
  const lapsLeft =
    snap.gameLapsLeft ??
    (typedLaps !== null
      ? Math.max(0, typedLaps - Math.max(0, snap.lap - 1) - snap.fraction)
      : null);
  const plan = pitPlan({
    level: snap.level,
    perLap: snap.perLap,
    lapsLeft,
    refuelTo: num(refuelTo) ?? snap.capacity,
    currentLap: Math.max(1, snap.lap),
  });

  return (
    <section className="pit-plan" aria-label={uiText('Planejador de parada')} data-no-gesture>
      <h3 className="readout-label">{uiText('Planejador de parada (estimativa)')}</h3>
      <div className="pit-fields">
        {snap.gameLapsLeft === null && (
          <label className="pit-field">
            <span>{uiText('Voltas da corrida')}</span>
            <input
              className="ui-input num"
              inputMode="numeric"
              value={raceLaps}
              placeholder="20"
              onChange={(e) => setRaceLaps(e.target.value)}
            />
          </label>
        )}
        <label className="pit-field">
          <span>{uiText('Reabastecer até (L)')}</span>
          <input
            className="ui-input num"
            inputMode="decimal"
            value={refuelTo}
            placeholder={formatFixed(snap.capacity, 0)}
            onChange={(e) => setRefuelTo(e.target.value)}
          />
        </label>
      </div>
      <p className="pit-result" aria-live="polite">
        {plan.kind === 'unknown' &&
          (snap.perLap === null
            ? uiText('O consumo médio aparece depois da primeira volta completa.')
            : uiText('Informe as voltas da corrida para ver quando parar.'))}
        {plan.kind === 'enough' &&
          uiText(
            'Não precisa parar: o combustível chega ao fim e sobram ~{0} L.',
            formatFixed(plan.surplusL, 1),
          )}
        {plan.kind === 'stop' &&
          uiText(
            'Entre no box até a volta {0}. Faltam {1} L para terminar: {2} parada(s), reabasteça ~{3} L.',
            plan.pitByLap,
            formatFixed(plan.missingL, 1),
            plan.stops,
            formatFixed(plan.addL, 1),
          )}
        {plan.kind === 'impossible' &&
          uiText('Com esse limite de reabastecimento não dá para terminar a corrida.')}
      </p>
    </section>
  );
}
