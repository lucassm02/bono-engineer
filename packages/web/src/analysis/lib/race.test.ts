import type { LiveFrame, SessionEvent } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { savedToastText } from '../../lib/captureStatus.ts';
import { lapCounterText, racePositionText, racePositionTone } from '../../views/RaceView.tsx';
import {
  gainedText,
  impactCount,
  placesGained,
  positionSeries,
  raceHeadline,
  timelineRows,
} from './race.ts';

const ev = (
  id: string,
  kind: SessionEvent['kind'],
  at: number,
  data: SessionEvent['data'],
  extra: Partial<SessionEvent> = {},
): SessionEvent => ({ id, sessionId: 's', at, kind, lap: 1, distanceM: null, data, ...extra });

describe('race result', () => {
  it('tells the start and the finish, and the places gained', () => {
    const s = { startPosition: 3, finishPosition: 6, fieldSize: 12 };
    expect(raceHeadline(s)).toBe('Largou em P3 de 12 · terminou em P6 de 12');
    expect(placesGained(s)).toBe(-3);
    expect(gainedText(-3)).toBe('Perdeu 3 posições');
    expect(gainedText(1)).toBe('Ganhou 1 posição');
    expect(gainedText(0)).toBe('Manteve a posição');
    expect(gainedText(null)).toBe('');
    expect(raceHeadline({ startPosition: null, finishPosition: null, fieldSize: null })).toBe(
      'Resultado não registrado',
    );
  });

  it('draws the position from the start, every stable change and the flag', () => {
    const events = [
      ev('g', 'grid', 0, { position: 4, cars: 15, start: true }),
      ev('p1', 'position', 100, { from: 4, to: 5 }),
      ev('i', 'impact', 150, { speedBeforeKmh: 100, speedAfterKmh: 90 }),
      ev('p2', 'position', 200, { from: 5, to: 4 }),
      ev('f', 'finish', 300, { position: 4, cars: 15, totalLaps: 4 }),
    ];
    expect(positionSeries(events)).toEqual([
      { at: 0, position: 4 },
      { at: 100, position: 5 },
      { at: 200, position: 4 },
      { at: 300, position: 4 },
    ]);
    expect(impactCount(events)).toBe(1);
  });

  it('writes the timeline in words, with the tone of each change', () => {
    const rows = timelineRows([
      ev('p', 'position', 1, { from: 5, to: 4 }, { lap: 2 }),
      ev('p2', 'position', 2, { from: 4, to: 7 }, { lap: 3 }),
      ev('c', 'cars', 3, { from: 15, to: 12 }, { lap: 3 }),
      ev(
        'i',
        'impact',
        4,
        { speedBeforeKmh: 178, speedAfterKmh: 162 },
        { lap: 4, distanceM: 812.4 },
      ),
      ev('f', 'finish', 5, { position: 6, cars: 12, totalLaps: 4 }, { lap: 4 }),
    ]);
    expect(rows.map((r) => [r.lap, r.tone, r.text])).toEqual([
      [2, 'gain', 'P5 → P4'],
      [3, 'loss', 'P4 → P7'],
      [3, 'neutral', 'Saíram 3 carros da prova (15 → 12)'],
      [4, 'loss', 'Impacto · a 812 m · 178 → 162 km/h'],
      [4, 'neutral', 'Bandeirada · P6'],
    ]);
  });
});

function frame(patch: Partial<LiveFrame>): LiveFrame {
  return {
    lap: { lap: 2, totalLaps: 4, currentLapMs: 0, lastLapMs: null, bestLapMs: null },
    ...patch,
  } as LiveFrame;
}

describe('live panel in a race', () => {
  it('shows N of N at the flag, never N + 1', () => {
    const f = frame({
      lap: { lap: 4, totalLaps: 4, finished: true } as LiveFrame['lap'],
    });
    expect(lapCounterText(f)).toBe('Bandeirada · 4/4');
    expect(lapCounterText(frame({}))).toBe('Volta 2/4');
  });

  it('shows the position with the places gained, and nothing outside a race', () => {
    const race = (gained: number | null) =>
      frame({
        race: {
          state: 'racing',
          totalLaps: 4,
          position: 5,
          cars: 15,
          startPosition: 4,
          gained,
          impacts: 0,
          lastChange: null,
        },
      });
    expect(racePositionText(race(null))).toBe('P5/15');
    expect(racePositionText(race(0))).toBe('P5/15');
    expect(racePositionText(race(2))).toBe('P5/15 ▲2');
    expect(racePositionText(race(-1))).toBe('P5/15 ▼1');
    expect(racePositionTone(race(2))).toBe('gain');
    expect(racePositionTone(race(-1))).toBe('loss');
    expect(racePositionText(frame({}))).toBe('');
  });
});

describe('toast of a saved session', () => {
  it('tells a race by its result and a practice by its best lap', () => {
    expect(
      savedToastText({
        trackName: 'Trial Mountain',
        lapCount: 4,
        bestLapMs: 125_979,
        kind: 'race',
        startPosition: 4,
        finishPosition: 5,
      }),
    ).toBe('Corrida salva: Trial Mountain, 4 voltas, largou em P4, terminou em P5');
    expect(
      savedToastText({ trackName: 'Trial Mountain', lapCount: 3, bestLapMs: 123_936, kind: null }),
    ).toBe('Sessão salva: Trial Mountain, 3 voltas, melhor 2:03,936');
  });
});
