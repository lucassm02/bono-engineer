/** The result of a race (spec 21): where it started, where it ended, the way and the impacts. */

import type { Session, SessionEvent } from '@gt7/shared';
import { t as uiText } from '../../lib/i18n.ts';
import { api } from '../api.ts';
import {
  gainedText,
  impactCount,
  type PositionPoint,
  placesGained,
  positionSeries,
  raceHeadline,
  timelineRows,
} from '../lib/race.ts';
import { useFetch } from '../useFetch.ts';
import { Panel } from './Panel.tsx';

const W = 600;
const H = 140;
const PAD = { l: 34, r: 12, t: 12, b: 18 };

/** Position along the race as a step line (P1 on top), with a mark at every impact. */
export function PositionChart({
  points,
  impacts,
  cars,
}: {
  points: PositionPoint[];
  impacts: SessionEvent[];
  cars: number;
}) {
  if (points.length < 2) return null;
  const t0 = points[0]!.at;
  const t1 = points[points.length - 1]!.at;
  const span = Math.max(1, t1 - t0);
  const worst = Math.max(cars, ...points.map((p) => p.position));
  const x = (at: number) => PAD.l + ((at - t0) / span) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + ((p - 1) / Math.max(1, worst - 1)) * (H - PAD.t - PAD.b);
  let d = `M ${x(points[0]!.at)} ${y(points[0]!.position)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H ${x(points[i]!.at)} V ${y(points[i]!.position)}`;
  }
  const ticks = [1, Math.ceil(worst / 2), worst].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <svg
      className="race-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={uiText('Posição ao longo da corrida')}
    >
      {ticks.map((p) => (
        <g key={p}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(p)} y2={y(p)} className="race-chart-grid" />
          <text x={PAD.l - 6} y={y(p) + 4} textAnchor="end" className="race-chart-tick">
            P{p}
          </text>
        </g>
      ))}
      {impacts.map((e) => (
        <line
          key={e.id}
          x1={x(e.at)}
          x2={x(e.at)}
          y1={PAD.t}
          y2={H - PAD.b}
          className="race-chart-impact"
        />
      ))}
      <path d={d} className="race-chart-line" />
    </svg>
  );
}

export function RaceResult({ session }: { session: Session }) {
  const race = useFetch(`race:${session.id}`, () => api.sessionRace(session.id));
  const events = race.data?.events ?? [];
  const s = race.data?.session ?? session;
  const gained = placesGained(s);
  const rows = timelineRows(events);
  const impacts = events.filter((e) => e.kind === 'impact');
  const total = impactCount(events);
  return (
    <Panel
      id="race-result"
      title={uiText('Resultado da corrida')}
      description={s.raceTotalLaps ? uiText('{0} voltas', s.raceTotalLaps) : undefined}
    >
      <div className="race-result">
        <p className="race-result-head">
          <strong>{raceHeadline(s)}</strong>
          {gained !== null && (
            <span className="race-gain" data-tone={gained > 0 ? 'gain' : gained < 0 ? 'loss' : ''}>
              {gainedText(gained)}
            </span>
          )}
          {events.some((e) => e.kind === 'restart') && (
            <span className="race-gain">
              {uiText('Reiniciada: a corrida seguinte está em outra sessão')}
            </span>
          )}
          {total > 0 && (
            <span className="race-gain" data-tone="loss">
              {total === 1 ? uiText('1 impacto') : uiText('{0} impactos', total)}
            </span>
          )}
        </p>
        <PositionChart points={positionSeries(events)} impacts={impacts} cars={s.fieldSize ?? 0} />
        {rows.length > 0 && (
          <ul className="race-timeline">
            {rows.map((r) => (
              <li key={r.id} data-tone={r.tone} data-kind={r.kind}>
                <span className="race-timeline-lap">{uiText('Volta {0}', r.lap)}</span>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
