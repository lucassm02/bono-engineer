import type { ApiTraces, Corner, DrivingEvent } from '@gt7/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DrivingEventsPanel, evidenceChips } from '../components/DrivingEventsPanel.tsx';
import { EVENT_PANELS, eventRange, lapSeries, mergeEventTraces } from './chartData.ts';

const traces: ApiTraces = {
  fromM: 0,
  toM: 4,
  stepM: 2,
  distanceM: [0, 2, 4],
  channels: ['speed'],
  laps: [{ lapId: 'a', channels: { speed: [100, 110, 120] } }],
};

const event: DrivingEvent = {
  id: 'understeer:T2:631',
  kind: 'understeer',
  lapId: 'a',
  cornerId: 'T2',
  phase: 'exit',
  startM: 631,
  endM: 676,
  startS: 10.9,
  endS: 11.7,
  durationS: 0.83,
  confidence: 'medium',
  evidence: {
    speedKmh: 193,
    steeringDeg: 86,
    steeringChangeDeg: 10,
    yawRateDps: 1,
    expectedYawRateDps: 24.6,
    yawRatio: 0.04,
    lineOpeningM: 5.1,
    slipAngleDeg: null,
    countersteerS: null,
    frontSlipPeak: null,
    rearSlipPeak: null,
    brake: 0,
    throttle: 0.9,
    tcsActiveS: null,
    verticalG: 1,
  },
  notes: ['Carga vertical variou 1,0 g (lombada, compressão ou zebra).'],
  message: 'Provável saída de frente na T2: volante a 86° e quase sem guinada por 0,8 s.',
  action: 'Na lombada, vire menos e espere o carro assentar antes de pedir mais volante.',
  settledM: 902,
};

describe('driving events in the lap review', () => {
  it('merges yaw and the worst front/rear wheel slip on the same grid', () => {
    const extra: ApiTraces = {
      ...traces,
      channels: ['yawRate', 'slipFL', 'slipFR', 'slipRL', 'slipRR'],
      laps: [
        {
          lapId: 'a',
          channels: {
            yawRate: [0.1, 0.2, 0.3],
            slipFL: [-0.02, -0.15, null],
            slipFR: [-0.05, -0.1, -0.01],
            slipRL: [0.02, 0.3, -0.2],
            slipRR: [0.05, 0.1, 0.1],
          },
        },
      ],
    };
    const merged = mergeEventTraces(traces, extra);
    expect(lapSeries(merged, 'a', 'speed')).toEqual([100, 110, 120]);
    expect(lapSeries(merged, 'a', 'slipFront')).toEqual([-0.05, -0.15, -0.01]);
    expect(lapSeries(merged, 'a', 'slipRear')).toEqual([0.05, 0.3, -0.2]);
    expect(lapSeries(merged, 'a', 'yawRate')).toEqual([0.1, 0.2, 0.3]);
    expect(EVENT_PANELS.map((p) => p.key)).toEqual(['yawRate', 'slipFront', 'slipRear']);
    // Different grid → untouched.
    expect(mergeEventTraces(traces, { ...extra, distanceM: [0, 2] })).toBe(traces);
    expect(mergeEventTraces(traces, null)).toBe(traces);
  });

  it('zooms on the event with context, clamped to the lap', () => {
    expect(eventRange(event, 5344)).toEqual([571, 736]);
    expect(eventRange({ startM: 20, endM: 5330 }, 5344)).toEqual([0, 5344]);
  });

  it('lists kind, corner, confidence, action and evidence', () => {
    const html = renderToStaticMarkup(
      createElement(DrivingEventsPanel, {
        events: [event],
        corners: [{ id: 'T2', name: null } as Corner],
        selectedId: event.id,
        onOpen: () => {},
      }),
    );
    expect(html).toContain('Saída de frente');
    expect(html).toContain('saída da curva');
    expect(html).toContain('T2');
    expect(html).toContain('Confiança média');
    expect(html).toContain('Na lombada, vire menos');
    expect(html).toContain('Ver traços');
    expect(html).toContain('data-selected="1"');
    expect(evidenceChips(event.evidence)).toContain('linha abriu 5,1 m');
    const empty = renderToStaticMarkup(
      createElement(DrivingEventsPanel, {
        events: [],
        corners: [],
        selectedId: null,
        onOpen: () => {},
      }),
    );
    expect(empty).toContain('Nenhum evento nesta volta');
  });
});
