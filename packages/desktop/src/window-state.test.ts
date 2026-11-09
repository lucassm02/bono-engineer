import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW, fitWindowState, parseWindowState } from './window-state.ts';

const SCREEN = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND = { x: 1920, y: 0, width: 1280, height: 1024 };

describe('parseWindowState', () => {
  it('accepts a sane saved state', () => {
    expect(
      parseWindowState({ x: 10.4, y: 20, width: 1000, height: 700.2, maximized: true }),
    ).toEqual({ x: 10, y: 20, width: 1000, height: 700, maximized: true });
  });
  it('rejects garbage', () => {
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState('x')).toBeNull();
    expect(parseWindowState({ width: 'a', height: 5 })).toBeNull();
    expect(parseWindowState({ width: 10, height: 10 })).toBeNull(); // below the minimum size
    expect(parseWindowState({ width: 1e9, height: 700 })).toBeNull();
    expect(parseWindowState({ width: Number.NaN, height: 700 })).toBeNull();
  });
  it('drops an invalid position but keeps the size', () => {
    expect(parseWindowState({ x: 'a', y: 1, width: 900, height: 600 })).toEqual({
      width: 900,
      height: 600,
      maximized: false,
    });
  });
});

describe('fitWindowState', () => {
  it('defaults without a saved state (no position: the OS centers it)', () => {
    expect(fitWindowState(null, [SCREEN])).toEqual(DEFAULT_WINDOW);
  });
  it('keeps a position that is on a screen', () => {
    const s = { x: 100, y: 50, width: 1200, height: 800, maximized: false };
    expect(fitWindowState(s, [SCREEN])).toEqual(s);
  });
  it('keeps a second-monitor position while it exists and drops it when unplugged', () => {
    const s = { x: 2000, y: 100, width: 1000, height: 700, maximized: false };
    expect(fitWindowState(s, [SCREEN, SECOND])).toEqual(s);
    const back = fitWindowState(s, [SCREEN]);
    expect(back.x).toBeUndefined();
    expect(back.y).toBeUndefined();
    expect(back.width).toBe(1000);
  });
  it('drops a position that is barely visible', () => {
    const s = { x: 1900, y: 1030, width: 1000, height: 700, maximized: false };
    expect(fitWindowState(s, [SCREEN]).x).toBeUndefined();
  });
  it('shrinks a window bigger than the biggest screen and keeps the maximized flag', () => {
    const r = fitWindowState({ x: 0, y: 0, width: 5000, height: 4000, maximized: true }, [SCREEN]);
    expect(r).toEqual({ x: 0, y: 0, width: 1920, height: 1040, maximized: true });
  });
});
