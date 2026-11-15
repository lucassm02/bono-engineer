/** Pure helpers of the race result (spec 21): the headline, the position series and the timeline. */

import { isTyreCompound, type Session, type SessionEvent } from '@gt7/shared';
import { formatFixed } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { compoundLabel } from '../../lib/tyres.ts';

export interface PositionPoint {
  /** Epoch ms. */
  at: number;
  position: number;
}

/** Places gained from the start to the flag (+ better); null when either end is unknown. */
export function placesGained(s: Pick<Session, 'startPosition' | 'finishPosition'>): number | null {
  if (s.startPosition == null || s.finishPosition == null) return null;
  return s.startPosition - s.finishPosition;
}

/** "Largou em P4 de 15 · terminou em P5". */
export function raceHeadline(
  s: Pick<Session, 'startPosition' | 'finishPosition' | 'fieldSize'>,
): string {
  const cars = s.fieldSize ?? null;
  const parts: string[] = [];
  if (s.startPosition != null) {
    parts.push(
      cars !== null
        ? uiText('Largou em P{0} de {1}', s.startPosition, cars)
        : uiText('Largou em P{0}', s.startPosition),
    );
  }
  if (s.finishPosition != null) {
    parts.push(
      cars !== null
        ? uiText('terminou em P{0} de {1}', s.finishPosition, cars)
        : uiText('terminou em P{0}', s.finishPosition),
    );
  }
  return parts.length > 0 ? parts.join(' · ') : uiText('Resultado não registrado');
}

/** "Ganhou 2 posições", "Perdeu 1 posição", "Manteve a posição"; empty when unknown. */
export function gainedText(gained: number | null): string {
  if (gained === null) return '';
  if (gained === 0) return uiText('Manteve a posição');
  const n = Math.abs(gained);
  if (gained > 0) {
    return n === 1 ? uiText('Ganhou 1 posição') : uiText('Ganhou {0} posições', n);
  }
  return n === 1 ? uiText('Perdeu 1 posição') : uiText('Perdeu {0} posições', n);
}

/** The position along the race: start, every stable change and the flag. */
export function positionSeries(events: readonly SessionEvent[]): PositionPoint[] {
  const pts: PositionPoint[] = [];
  const start = events.find((e) => e.kind === 'grid' && e.data.start === true);
  if (start && typeof start.data.position === 'number') {
    pts.push({ at: start.at, position: start.data.position });
  }
  for (const e of events) {
    if (e.kind === 'position' && typeof e.data.to === 'number') {
      pts.push({ at: e.at, position: e.data.to });
    }
  }
  const fin = events.find((e) => e.kind === 'finish');
  if (fin && typeof fin.data.position === 'number') {
    pts.push({ at: fin.at, position: fin.data.position });
  }
  return pts;
}

export interface TimelineRow {
  id: string;
  lap: number;
  kind: 'position' | 'cars' | 'impact' | 'finish' | 'restart' | 'tyreWearWarning';
  tone: 'gain' | 'loss' | 'neutral';
  text: string;
}

/** What happened, in order, in words (the grid is the headline, not a row). */
export function timelineRows(events: readonly SessionEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const e of events) {
    const d = e.data;
    if (e.kind === 'position' && typeof d.from === 'number' && typeof d.to === 'number') {
      rows.push({
        id: e.id,
        lap: e.lap,
        kind: 'position',
        tone: d.to < d.from ? 'gain' : 'loss',
        text: uiText('P{0} → P{1}', d.from, d.to),
      });
    } else if (e.kind === 'cars' && typeof d.from === 'number' && typeof d.to === 'number') {
      const out = d.from - d.to;
      rows.push({
        id: e.id,
        lap: e.lap,
        kind: 'cars',
        tone: 'neutral',
        text:
          out === 1
            ? uiText('Saiu 1 carro da prova ({0} → {1})', d.from, d.to)
            : uiText('Saíram {0} carros da prova ({1} → {2})', out, d.from, d.to),
      });
    } else if (e.kind === 'impact') {
      const speed =
        typeof d.speedBeforeKmh === 'number' && typeof d.speedAfterKmh === 'number'
          ? ` · ${uiText('{0} → {1} km/h', d.speedBeforeKmh, d.speedAfterKmh)}`
          : '';
      const where = e.distanceM !== null ? ` · ${uiText('a {0} m', Math.round(e.distanceM))}` : '';
      rows.push({
        id: e.id,
        lap: e.lap,
        kind: 'impact',
        tone: 'loss',
        text: `${uiText('Impacto')}${where}${speed}`,
      });
    } else if (e.kind === 'tyreWearWarning' && typeof d.estimatedLapsLeft === 'number') {
      const tyre = isTyreCompound(d.compound) ? compoundLabel(d.compound) : uiText('Pneus');
      const multiplier = typeof d.wearMultiplier === 'number' ? ` ×${d.wearMultiplier}` : '';
      const estimate =
        d.estimatedLapsLeft === 0
          ? uiText('Pneus no limite estimado.')
          : uiText('~{0} voltas até o limite', formatFixed(d.estimatedLapsLeft));
      rows.push({
        id: e.id,
        lap: e.lap,
        kind: 'tyreWearWarning',
        tone: 'neutral',
        text: `${estimate} · ${tyre}${multiplier}`,
      });
    } else if (e.kind === 'restart') {
      rows.push({
        id: e.id,
        lap: e.lap,
        kind: 'restart',
        tone: 'neutral',
        text: uiText('Corrida reiniciada'),
      });
    } else if (e.kind === 'finish') {
      rows.push({
        id: e.id,
        lap: e.lap,
        kind: 'finish',
        tone: 'neutral',
        text:
          typeof d.position === 'number'
            ? uiText('Bandeirada · P{0}', d.position)
            : uiText('Bandeirada'),
      });
    }
  }
  return rows;
}

export function impactCount(events: readonly SessionEvent[]): number {
  return events.filter((e) => e.kind === 'impact').length;
}
