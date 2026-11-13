import { createDefaultDeviceProfile, type DeviceProfile } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { TYRE_TEMP_SCALE } from '../config.ts';
import { carouselSlots, settledSlot, stepIndex, wrapIndex } from './carousel.ts';
import {
  deltaBarFraction,
  deltaTone,
  formatDelta,
  formatGear,
  formatLapTime,
  formatSectorTime,
} from './format.ts';
import {
  type GestureConfig,
  type GestureInput,
  type GestureOutput,
  type GestureState,
  INITIAL_GESTURE_STATE,
  nextDeadline,
  stepGesture,
} from './gestures.ts';
import { disabledViews, nextDeltaReference, reconcileProfiles, reduceProfile } from './profile.ts';
import { TYRE_COLORS, tyreTempBand, tyreTempRgb } from './tyreColor.ts';

const CFG: GestureConfig = { longPressMs: 600, doubleTapMs: 280, moveTolerancePx: 12 };

/** Feeds inputs, auto-delivering timeouts that fall due before each input (like the real hook). */
function play(inputs: GestureInput[], endT: number): GestureOutput[] {
  let state: GestureState = INITIAL_GESTURE_STATE;
  const out: GestureOutput[] = [];
  const flush = (until: number) => {
    for (;;) {
      const d = nextDeadline(state, CFG);
      if (d === null || d > until) return;
      const r = stepGesture(state, { type: 'timeout', t: d }, CFG);
      out.push(...r.emit);
      if (r.state === state) return;
      state = r.state;
    }
  };
  for (const i of inputs) {
    flush(i.t);
    const r = stepGesture(state, i, CFG);
    state = r.state;
    out.push(...r.emit);
  }
  flush(endT);
  return out;
}

describe('gesture recognizer', () => {
  it('single tap fires after the double-tap window', () => {
    const inputs: GestureInput[] = [
      { type: 'down', t: 0, x: 10, y: 10 },
      { type: 'up', t: 80, x: 10, y: 10 },
    ];
    expect(play(inputs, 200)).toEqual([]);
    expect(play(inputs, 1000)).toEqual(['tap']);
  });

  it('double tap emits only doubleTap', () => {
    expect(
      play(
        [
          { type: 'down', t: 0, x: 10, y: 10 },
          { type: 'up', t: 70, x: 10, y: 10 },
          { type: 'down', t: 200, x: 14, y: 12 },
          { type: 'up', t: 260, x: 14, y: 12 },
        ],
        2000,
      ),
    ).toEqual(['doubleTap']);
  });

  it('two slow taps are two taps', () => {
    expect(
      play(
        [
          { type: 'down', t: 0, x: 0, y: 0 },
          { type: 'up', t: 50, x: 0, y: 0 },
          { type: 'down', t: 700, x: 0, y: 0 },
          { type: 'up', t: 760, x: 0, y: 0 },
        ],
        3000,
      ),
    ).toEqual(['tap', 'tap']);
  });

  it('long press fires while held, and release emits nothing more', () => {
    expect(
      play(
        [
          { type: 'down', t: 0, x: 0, y: 0 },
          { type: 'move', t: 300, x: 3, y: 2 },
          { type: 'up', t: 1200, x: 3, y: 2 },
        ],
        3000,
      ),
    ).toEqual(['longPress']);
  });

  it('moving beyond tolerance (swipe) cancels everything', () => {
    expect(
      play(
        [
          { type: 'down', t: 0, x: 0, y: 0 },
          { type: 'move', t: 40, x: 40, y: 0 },
          { type: 'up', t: 900, x: 120, y: 0 },
        ],
        3000,
      ),
    ).toEqual([]);
  });

  it('pointercancel (browser scroll takeover) cancels a press', () => {
    expect(
      play(
        [
          { type: 'down', t: 0, x: 0, y: 0 },
          { type: 'cancel', t: 100 },
        ],
        3000,
      ),
    ).toEqual([]);
  });

  it('late release after a missed timeout is still a long press', () => {
    let s: GestureState = INITIAL_GESTURE_STATE;
    s = stepGesture(s, { type: 'down', t: 0, x: 0, y: 0 }, CFG).state;
    expect(stepGesture(s, { type: 'up', t: 650, x: 0, y: 0 }, CFG).emit).toEqual(['longPress']);
  });

  it('deadlines', () => {
    expect(nextDeadline(INITIAL_GESTURE_STATE, CFG)).toBeNull();
    const s = stepGesture(INITIAL_GESTURE_STATE, { type: 'down', t: 100, x: 0, y: 0 }, CFG).state;
    expect(nextDeadline(s, CFG)).toBe(700);
  });
});

describe('carousel', () => {
  it('wraps indices in both directions', () => {
    expect(wrapIndex(5, 5)).toBe(0);
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(wrapIndex(-6, 5)).toBe(4);
    expect(wrapIndex(3, 0)).toBe(0);
    expect(stepIndex(4, 1, 5)).toBe(0);
    expect(stepIndex(0, -1, 5)).toBe(4);
  });

  it('slots are prev/cur/next, single view has no neighbours', () => {
    expect(carouselSlots(0, 5)).toEqual([
      { role: 'prev', index: 4 },
      { role: 'cur', index: 0 },
      { role: 'next', index: 1 },
    ]);
    expect(carouselSlots(0, 1)).toEqual([{ role: 'cur', index: 0 }]);
    expect(carouselSlots(1, 2).map((s) => s.index)).toEqual([0, 1, 0]);
  });

  it('settled slot from scroll position', () => {
    expect(settledSlot(0, 400, 3)).toBe(0);
    expect(settledSlot(395, 400, 3)).toBe(1);
    expect(settledSlot(820, 400, 3)).toBe(2);
    expect(settledSlot(5000, 400, 3)).toBe(2);
    expect(settledSlot(10, 0, 3)).toBe(0);
  });
});

describe('profile reducer', () => {
  const base = (): DeviceProfile => createDefaultDeviceProfile('dev1', 'Celular');

  it('toggles views and keeps at least one', () => {
    let p = base();
    p = reduceProfile(p, { type: 'toggleView', view: 'map' }, 10);
    expect(p.views.at(-1)).toBe('map');
    expect(p.updatedAt).toBe(10);
    p = reduceProfile(p, { type: 'toggleView', view: 'race' }, 11);
    expect(p.views).not.toContain('race');
    expect(p.startView).toBe(p.views[0]); // start view moved off the disabled one
    let single: DeviceProfile = { ...base(), views: ['tyres'], startView: 'tyres' };
    single = reduceProfile(single, { type: 'toggleView', view: 'tyres' }, 12);
    expect(single.views).toEqual(['tyres']);
  });

  it('moves views up and down within bounds', () => {
    let p = base();
    p = reduceProfile(p, { type: 'moveView', view: 'tyres', by: -1 }, 1);
    expect(p.views.slice(0, 3)).toEqual(['race', 'tyres', 'bigDelta']);
    const same = reduceProfile(p, { type: 'moveView', view: 'race', by: -1 }, 2);
    expect(same).toBe(p);
    const last = p.views.at(-1)!;
    expect(reduceProfile(p, { type: 'moveView', view: last, by: 1 }, 3)).toBe(p);
  });

  it('start view must be enabled', () => {
    const p = base();
    expect(reduceProfile(p, { type: 'setStartView', view: 'map' }, 1)).toBe(p);
    expect(reduceProfile(p, { type: 'setStartView', view: 'engine' }, 1).startView).toBe('engine');
  });

  it('toggles and disabled list', () => {
    const p = reduceProfile(base(), { type: 'setPopups', enabled: false }, 5);
    expect(p.popupsEnabled).toBe(false);
    expect(reduceProfile(p, { type: 'setLocked', locked: true }, 6).locked).toBe(true);
    expect(disabledViews(base())).toEqual([
      'map',
      'times',
      'fuel',
      'gForces',
      'cornerDrill',
      'custom',
    ]);
  });

  it('delta reference cycle skips reference when unavailable', () => {
    expect(nextDeltaReference('personalBest', true)).toBe('sessionBest');
    expect(nextDeltaReference('sessionBest', true)).toBe('reference');
    expect(nextDeltaReference('reference', true)).toBe('personalBest');
    expect(nextDeltaReference('sessionBest', false)).toBe('personalBest');
  });

  it('reconcile: newest wins', () => {
    const local = { ...base(), updatedAt: 50, startView: 'engine' as const };
    const remote = { ...base(), updatedAt: 20 };
    expect(reconcileProfiles(local, remote)).toEqual({ profile: local, pushToServer: true });
    expect(reconcileProfiles(null, remote).pushToServer).toBe(false);
    expect(reconcileProfiles({ ...local, updatedAt: 1 }, remote).profile).toBe(remote);
  });
});

describe('formatting', () => {
  it('lap and sector times', () => {
    expect(formatLapTime(102617)).toBe('1:42,617');
    expect(formatLapTime(59_999.6)).toBe('1:00,000');
    expect(formatLapTime(31204, true)).toBe('31,204');
    expect(formatLapTime(null)).toBe('–:––,–––');
    expect(formatSectorTime(31204)).toBe('31,204');
    expect(formatSectorTime(null)).toBe('––,–––');
  });

  it('delta with true minus and sign', () => {
    expect(formatDelta(-384)).toBe('−0,384');
    expect(formatDelta(1207)).toBe('+1,207');
    expect(formatDelta(0.2)).toBe('±0,000');
    expect(formatDelta(-1234, 2)).toBe('−1,23');
    expect(formatDelta(null)).toBe('––,–––');
  });

  it('delta tone and bar', () => {
    expect(deltaTone(-50)).toBe('gain');
    expect(deltaTone(50)).toBe('loss');
    expect(deltaTone(2)).toBe('neutral');
    expect(deltaTone(null)).toBe('neutral');
    expect(deltaBarFraction(1000, 2000)).toBe(0.5);
    expect(deltaBarFraction(-9000, 2000)).toBe(-1);
    expect(deltaBarFraction(null, 2000)).toBe(0);
  });

  it('gear', () => {
    expect(formatGear(0)).toBe('N');
    expect(formatGear(4)).toBe('4');
  });
});

describe('tyre temperature scale', () => {
  const s = TYRE_TEMP_SCALE;
  it('anchors', () => {
    expect(tyreTempRgb(s.cold - 10, s)).toEqual(TYRE_COLORS.cold);
    expect(tyreTempRgb((s.idealMin + s.idealMax) / 2, s)).toEqual(TYRE_COLORS.ideal);
    expect(tyreTempRgb(s.hot + 10, s)).toEqual(TYRE_COLORS.hot);
  });

  it('interpolates between anchors', () => {
    const mid = tyreTempRgb((s.cold + s.idealMin) / 2, s);
    expect(mid[2]).toBeLessThan(TYRE_COLORS.cold[2]);
    expect(mid[2]).toBeGreaterThan(TYRE_COLORS.ideal[2]);
    const warm = tyreTempRgb((s.idealMax + s.hot) / 2, s);
    expect(warm[0]).toBeGreaterThan(TYRE_COLORS.ideal[0]);
    expect(warm[0]).toBeLessThan(TYRE_COLORS.hot[0]);
  });

  it('bands', () => {
    expect(tyreTempBand(40, s)).toBe('cold');
    expect(tyreTempBand(60, s)).toBe('warming');
    expect(tyreTempBand(85, s)).toBe('ideal');
    expect(tyreTempBand(105, s)).toBe('overheating');
    expect(tyreTempBand(130, s)).toBe('hot');
  });
});
