import { describe, expect, it } from 'vitest';
import { THEME } from '../../lib/theme.ts';
import { mixHex, rampColor, rampGradient } from './mapRamp.ts';

describe('mixHex', () => {
  it('interpolates two theme colours', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)');
    expect(mixHex('#102030', '#102030', 0.7)).toBe('rgb(16, 32, 48)');
    expect(mixHex('#000000', '#ffffff', 2)).toBe('rgb(255, 255, 255)');
  });
});

describe('rampColor', () => {
  it('speed: slow is cold (blue), fast is hot (red)', () => {
    const ramp = { mode: 'speed', lo: 60, hi: 240 } as const;
    expect(rampColor(ramp, 60)).toBe(mixHex(THEME.info, THEME.warn, 0));
    expect(rampColor(ramp, 240)).toBe(mixHex(THEME.warn, THEME.loss, 1));
    expect(rampColor(ramp, 150)).toBe(mixHex(THEME.warn, THEME.loss, 0));
  });

  it('diff ignores the sign: the colour says how far, the marker says which side', () => {
    const ramp = { mode: 'diff', lo: 0, hi: 4 } as const;
    expect(rampColor(ramp, -3)).toBe(rampColor(ramp, 3));
    expect(rampColor(ramp, 0)).toBe(mixHex(THEME.text2, THEME.warn, 0));
  });

  it('has no colour without data', () => {
    expect(rampColor({ mode: 'brake', lo: 0, hi: 1 }, null)).toBeNull();
    expect(rampColor({ mode: 'brake', lo: 1, hi: 1 }, 0.5)).toBeNull();
  });

  it('builds a legend gradient from the same stops', () => {
    expect(rampGradient('throttle')).toContain(THEME.gain);
  });
});
