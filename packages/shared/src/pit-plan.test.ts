import { describe, expect, it } from 'vitest';
import { PIT_MARGIN_LAPS, pitPlan } from './pit-plan.ts';

const base = { perLap: 3, refuelTo: 60, currentLap: 5 };

describe('pitPlan', () => {
  it('needs consumption and a race length', () => {
    expect(pitPlan({ ...base, level: 30, perLap: null, lapsLeft: 10 })).toEqual({
      kind: 'unknown',
    });
    expect(pitPlan({ ...base, level: 30, lapsLeft: null })).toEqual({ kind: 'unknown' });
    expect(pitPlan({ ...base, level: 30, lapsLeft: 0 })).toEqual({ kind: 'unknown' });
  });

  it('says the fuel is enough, with the surplus', () => {
    // 10 laps x 3 L = 30 L, 36 L in the tank
    const p = pitPlan({ ...base, level: 36, lapsLeft: 10 });
    expect(p.kind).toBe('enough');
    if (p.kind === 'enough') expect(p.surplusL).toBeCloseTo(6, 6);
  });

  it('plans one stop and the lap to enter in, with the safety margin', () => {
    // 20 laps x 3 L = 60 L needed, 30 L now: 10 laps of fuel, lap 5 now
    const p = pitPlan({ ...base, level: 30, lapsLeft: 20 });
    expect(p.kind).toBe('stop');
    if (p.kind !== 'stop') return;
    expect(p.missingL).toBe(30);
    expect(p.stops).toBe(1);
    expect(p.lapsOfFuel).toBe(10);
    // keeps PIT_MARGIN_LAPS of fuel: enters after floor(10 - 0.5) = 9 more laps
    expect(p.pitByLap).toBe(5 + Math.floor(10 - PIT_MARGIN_LAPS));
    // 30 L missing is what one stop must add
    expect(p.addL).toBeCloseTo(30, 6);
  });

  it('needs more stops when one fill is not enough', () => {
    // 60 laps x 3 L = 180 L; tank 60 L
    const p = pitPlan({ ...base, level: 30, lapsLeft: 60 });
    expect(p.kind).toBe('stop');
    if (p.kind === 'stop') expect(p.stops).toBe(Math.ceil(150 / (60 - 1.5)));
  });

  it('never tells to pit in a lap that already passed', () => {
    const p = pitPlan({ ...base, level: 2, lapsLeft: 20 });
    expect(p.kind).toBe('stop');
    if (p.kind === 'stop') expect(p.pitByLap).toBe(5);
  });

  it('is impossible when the refuel limit is below a lap of fuel', () => {
    expect(pitPlan({ ...base, level: 5, lapsLeft: 20, refuelTo: 3 })).toEqual({
      kind: 'impossible',
    });
  });
});
