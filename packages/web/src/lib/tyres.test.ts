import { type LiveTyreWear, TYRE_COMPOUNDS } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import {
  compoundLabel,
  defaultOfGroup,
  groupOf,
  hardnessLabel,
  lapsLeftText,
  TYRE_GROUPS,
  wearPct,
  wearTone,
} from './tyres.ts';

const wear = (over: Partial<LiveTyreWear> = {}): LiveTyreWear => ({
  compound: 'sportMedium',
  wear: [0.1, 0.1, 0.1, 0.1],
  worst: 0.1,
  multiplier: 1,
  distKm: 5,
  perLap: 0.02,
  lapsLeft: 12.4,
  ...over,
});

describe('tyre groups', () => {
  it('cover every compound exactly once', () => {
    const all = TYRE_GROUPS.flatMap((g) => g.compounds);
    expect([...all].sort()).toEqual([...TYRE_COMPOUNDS].sort());
    for (const c of TYRE_COMPOUNDS) expect(groupOf(c)).not.toBeNull();
    expect(groupOf(null)).toBeNull();
  });

  it('a tap on a group picks the medium of three, the only one otherwise', () => {
    expect(defaultOfGroup(TYRE_GROUPS.find((g) => g.id === 'racing')!)).toBe('racingMedium');
    expect(defaultOfGroup(TYRE_GROUPS.find((g) => g.id === 'dirt')!)).toBe('dirt');
    expect(defaultOfGroup(TYRE_GROUPS.find((g) => g.id === 'snow')!)).toBe('snow');
  });

  it('names the compounds', () => {
    expect(compoundLabel('sportMedium')).toBe('Esportivo Médio');
    expect(compoundLabel('comfortSoft')).toBe('Conforto Macio');
    expect(compoundLabel('racingHard')).toBe('Competição Duro');
    expect(compoundLabel('heavyWet')).toBe('Chuva pesada');
    expect(compoundLabel('snow')).toBe('Neve');
    expect(compoundLabel(null)).toBe('não informado');
    expect(hardnessLabel('dirt')).toBeNull();
    expect(hardnessLabel('sportSoft')).toBe('Macio');
  });
});

describe('wear wording', () => {
  it('tones the wear as it nears the limit', () => {
    expect(wearTone(0.1)).toBe('ok');
    expect(wearTone(0.5)).toBe('warn');
    expect(wearTone(0.8)).toBe('loss');
  });

  it('says the laps left, the limit, and nothing without an estimate', () => {
    expect(lapsLeftText(wear())).toBe('~12 voltas até o limite');
    expect(lapsLeftText(wear({ lapsLeft: 0.4 }))).toBe('menos de 1 volta até o limite');
    expect(lapsLeftText(wear({ worst: 0.9, lapsLeft: 0 }))).toBe('no limite: hora de trocar');
    expect(lapsLeftText(wear({ lapsLeft: null }))).toBeNull();
  });

  it('formats the percentage within 0…100', () => {
    expect(wearPct(0.184)).toBe('18%');
    expect(wearPct(1.4)).toBe('100%');
    expect(wearPct(-1)).toBe('0%');
  });
});
